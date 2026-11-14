-- Upped: database, security rules and video storage.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to run again: it only creates what is missing and replaces the rules.
--
-- Privacy model (built for kids):
--   * Players sign in anonymously: no email, no phone, no real name required.
--   * Everything is private to a lobby. You only see lobbies you joined with a code,
--     and only the clips, comments and players in them.
--   * Whoever creates a lobby is its admin and can delete any clip in it.
--   * No locations are stored.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 20),
  emoji text not null default '🏀' check (char_length(emoji) <= 8),
  created_at timestamptz not null default now()
);

create table if not exists public.lobbies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 30),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.lobby_members (
  lobby_id uuid not null references public.lobbies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (lobby_id, user_id)
);
create index if not exists lobby_members_user_idx on public.lobby_members (user_id);

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 50),
  description text not null default '' check (char_length(description) <= 200),
  rules text[] not null default '{}',
  created_by uuid references public.profiles (id) on delete set null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null
);

create table if not exists public.posts (
  id uuid primary key,
  lobby_id uuid not null references public.lobbies (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('original', 'matched', 'upped')),
  root_id uuid references public.posts (id) on delete cascade,
  -- lobby challenge uuid, or an official weekly challenge id like "official-2915-0"
  challenge_id text,
  title text not null default '' check (char_length(title) <= 60),
  rules text[] not null default '{}',
  spot text check (spot in ('court', 'home')),
  distance text check (distance in ('reach', 'short', 'medium', 'long', 'deep')),
  distance_ft real check (distance_ft is null or distance_ft between 0 and 500),
  measured boolean not null default false,
  target_size text check (target_size in ('small', 'medium', 'big')),
  video_path text not null,
  thumb_path text,
  miss_paths text[] not null default '{}',
  attempts int not null default 1 check (attempts between 1 and 10000),
  target jsonb,
  moment_ms int not null default 0,
  duration_ms int not null default 0,
  verify_code text not null default '',
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check ((kind = 'original') = (root_id is null))
);
-- Added after the first version: difficulty tags and AR-measured distance.
alter table public.posts add column if not exists distance text check (distance in ('reach', 'short', 'medium', 'long', 'deep'));
alter table public.posts add column if not exists distance_ft real check (distance_ft is null or distance_ft between 0 and 500);
alter table public.posts add column if not exists measured boolean not null default false;
alter table public.posts add column if not exists target_size text check (target_size in ('small', 'medium', 'big'));
create index if not exists posts_lobby_idx on public.posts (lobby_id, created_at desc);
create index if not exists posts_root_idx on public.posts (root_id);

create table if not exists public.reactions (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (emoji in ('🔥', '😱', '😂', '🐐')),
  primary key (post_id, user_id, emoji)
);

create table if not exists public.votes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  up boolean not null,
  primary key (post_id, user_id)
);

create table if not exists public.flags (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (post_id, user_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 280),
  created_at timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments (post_id);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies don't recurse)
-- ---------------------------------------------------------------------------

create or replace function public.is_lobby_member(p_lobby uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from lobby_members where lobby_id = p_lobby and user_id = auth.uid());
$$;

create or replace function public.is_lobby_admin(p_lobby uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from lobbies where id = p_lobby and created_by = auth.uid());
$$;

create or replace function public.shares_lobby_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user = auth.uid() or exists (
    select 1 from lobby_members a join lobby_members b on a.lobby_id = b.lobby_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

create or replace function public.post_lobby(p_post uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select lobby_id from posts where id = p_post;
$$;

create or replace function public.post_author(p_post uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select author_id from posts where id = p_post;
$$;

-- Create a lobby with a fresh invite code; the creator joins it and is its admin.
create or replace function public.create_lobby(p_name text)
returns public.lobbies language plpgsql security definer set search_path = public as $$
declare
  v_lobby lobbies;
  v_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    exit when not exists (select 1 from lobbies where code = v_code);
  end loop;
  insert into lobbies (name, code, created_by) values (trim(p_name), v_code, auth.uid()) returning * into v_lobby;
  insert into lobby_members (lobby_id, user_id) values (v_lobby.id, auth.uid());
  return v_lobby;
end;
$$;

-- Join with an invite code. Returns the lobby id, or null if the code is wrong.
create or replace function public.join_lobby(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into v_id from lobbies where code = upper(trim(p_code));
  if v_id is null then return null; end if;
  insert into lobby_members (lobby_id, user_id) values (v_id, auth.uid()) on conflict do nothing;
  return v_id;
end;
$$;

-- Lobby admins can remove a player (for example someone who got the code by mistake).
create or replace function public.remove_member(p_lobby uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_lobby_admin(p_lobby) and p_user <> auth.uid() then raise exception 'Only the lobby admin can do that'; end if;
  delete from lobby_members where lobby_id = p_lobby and user_id = p_user;
end;
$$;

revoke all on function public.create_lobby(text), public.join_lobby(text), public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.create_lobby(text), public.join_lobby(text), public.remove_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.lobbies enable row level security;
alter table public.lobby_members enable row level security;
alter table public.challenges enable row level security;
alter table public.posts enable row level security;
alter table public.reactions enable row level security;
alter table public.votes enable row level security;
alter table public.flags enable row level security;
alter table public.comments enable row level security;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('profiles','lobbies','lobby_members','challenges','posts','reactions','votes','flags','comments')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "see lobby mates" on public.profiles for select to authenticated using (shares_lobby_with(id));
create policy "create own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "edit own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "see my lobbies" on public.lobbies for select to authenticated using (is_lobby_member(id));
create policy "admin renames lobby" on public.lobbies for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "admin deletes lobby" on public.lobbies for delete to authenticated using (created_by = auth.uid());

create policy "see lobby members" on public.lobby_members for select to authenticated using (is_lobby_member(lobby_id));

create policy "see lobby challenges" on public.challenges for select to authenticated using (is_lobby_member(lobby_id));
create policy "members set challenges" on public.challenges for insert to authenticated
  with check (is_lobby_member(lobby_id) and created_by = auth.uid());
create policy "creator or admin removes challenge" on public.challenges for delete to authenticated
  using (created_by = auth.uid() or is_lobby_admin(lobby_id));

create policy "see lobby posts" on public.posts for select to authenticated using (is_lobby_member(lobby_id));
create policy "members post" on public.posts for insert to authenticated
  with check (author_id = auth.uid() and is_lobby_member(lobby_id)
    and (root_id is null or post_lobby(root_id) = lobby_id));
create policy "author edits post" on public.posts for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "author or admin deletes post" on public.posts for delete to authenticated
  using (author_id = auth.uid() or is_lobby_admin(lobby_id));

create policy "see reactions" on public.reactions for select to authenticated using (is_lobby_member(post_lobby(post_id)));
create policy "react" on public.reactions for insert to authenticated with check (user_id = auth.uid() and is_lobby_member(post_lobby(post_id)));
create policy "unreact" on public.reactions for delete to authenticated using (user_id = auth.uid());

create policy "see votes" on public.votes for select to authenticated using (is_lobby_member(post_lobby(post_id)));
create policy "vote, not on own clip" on public.votes for insert to authenticated
  with check (user_id = auth.uid() and is_lobby_member(post_lobby(post_id)) and post_author(post_id) <> auth.uid());
create policy "change vote" on public.votes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "remove vote" on public.votes for delete to authenticated using (user_id = auth.uid());

create policy "see flags" on public.flags for select to authenticated using (is_lobby_member(post_lobby(post_id)));
create policy "flag, not own clip" on public.flags for insert to authenticated
  with check (user_id = auth.uid() and is_lobby_member(post_lobby(post_id)) and post_author(post_id) <> auth.uid());
create policy "unflag" on public.flags for delete to authenticated using (user_id = auth.uid());

create policy "see comments" on public.comments for select to authenticated using (is_lobby_member(post_lobby(post_id)));
create policy "comment" on public.comments for insert to authenticated with check (user_id = auth.uid() and is_lobby_member(post_lobby(post_id)));
create policy "author or admin deletes comment" on public.comments for delete to authenticated
  using (user_id = auth.uid() or is_lobby_admin(post_lobby(post_id)));

-- ---------------------------------------------------------------------------
-- Video storage: private bucket, files stored under <lobby id>/<post id>/...
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clips', 'clips', false, 15728640, array['video/webm', 'video/mp4', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.clip_lobby(p_name text)
returns uuid language sql immutable as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end;
$$;

drop policy if exists "upped: members watch clips" on storage.objects;
drop policy if exists "upped: members upload clips" on storage.objects;
drop policy if exists "upped: owner or admin deletes clips" on storage.objects;

create policy "upped: members watch clips" on storage.objects for select to authenticated
  using (bucket_id = 'clips' and is_lobby_member(clip_lobby(name)));
create policy "upped: members upload clips" on storage.objects for insert to authenticated
  with check (bucket_id = 'clips' and is_lobby_member(clip_lobby(name)));
create policy "upped: owner or admin deletes clips" on storage.objects for delete to authenticated
  using (bucket_id = 'clips' and (owner_id = auth.uid()::text or is_lobby_admin(clip_lobby(name))));

-- ---------------------------------------------------------------------------
-- Live updates: new clips, votes and comments show up without refreshing.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['lobbies','lobby_members','challenges','posts','reactions','votes','flags','comments','profiles'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
