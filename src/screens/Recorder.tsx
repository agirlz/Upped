import { useEffect, useMemo, useRef, useState } from 'react';
import { canvasToBlob, drawOverlay, pickMimeType, TargetMotion } from '../capture';
import { ClipPlayer } from '../components/ClipPlayer';
import { go } from '../router';
import { createPost, myLobbies, randomCode, useAppState } from '../store';
import { RULE_OPTIONS, type PostKind, type Target } from '../types';

interface Props {
  lobbyId?: string;
  rootId?: string;
  kind: PostKind;
  challengeId?: string;
}

type Phase = 'aim' | 'countdown' | 'recording' | 'judge' | 'review';

interface Clip {
  blob: Blob;
  url: string;
  durationMs: number;
  momentMs: number;
  thumb?: Blob;
  recordedAt: number;
}

const MAX_BLOOPERS = 12;

export function Recorder({ lobbyId: lobbyParam, rootId, kind, challengeId }: Props) {
  const s = useAppState();
  const lobbies = myLobbies(s);
  const root = rootId ? s.posts[rootId] : undefined;
  const challenge = challengeId ? s.challenges[challengeId] : undefined;
  const [lobbyId, setLobbyId] = useState(lobbyParam ?? root?.lobbyId ?? lobbies[0]?.id ?? '');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const motion = useMemo(() => new TargetMotion(), []);
  const thumbCanvas = useMemo(() => document.createElement('canvas'), []);

  const [camError, setCamError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('aim');
  const [target, setTarget] = useState<Target | undefined>(root?.target ? { ...root.target } : undefined);
  const [ringSize, setRingSize] = useState(root?.target?.r ?? 0.07);
  const [clipLen, setClipLen] = useState(10);
  const [countdownLen, setCountdownLen] = useState(5);
  const [code] = useState(() => randomCode());
  const [attempt, setAttempt] = useState(1);
  const [misses, setMisses] = useState<Blob[]>([]);
  const [clip, setClip] = useState<Clip>();
  const [title, setTitle] = useState('');
  const [rules, setRules] = useState<string[]>(root?.rules ?? challenge?.rules ?? []);
  const [posting, setPosting] = useState(false);

  // Live values the draw loop reads without re-subscribing.
  const live = useRef({ phase, target, attempt, countdown: 0, recStart: 0, maxMotion: 0 });
  live.current.phase = phase;
  live.current.target = target;
  live.current.attempt = attempt;

  // ---- camera -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError('This browser cannot use the camera. Open the app in Safari or Chrome on your phone.');
        return;
      }
      const video = { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        } catch (e) {
          setCamError(
            (e as Error)?.name === 'NotAllowedError'
              ? 'Camera access was blocked. Allow camera access for this site in your browser settings, then reload.'
              : 'No camera was found on this device.',
          );
          return;
        }
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play().catch(() => {});
      setReady(true);
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recRef.current?.state === 'recording' && recRef.current.stop();
    };
  }, []);

  // ---- draw loop: camera + burned-in overlay onto the canvas we record ------
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    const v = videoRef.current!;
    const c = canvasRef.current!;
    const ctx = c.getContext('2d')!;
    const draw = () => {
      const vw = v.videoWidth || 1280;
      const vh = v.videoHeight || 720;
      const scale = Math.min(1, 960 / vw);
      const w = Math.round(vw * scale);
      const h = Math.round(vh * scale);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      ctx.drawImage(v, 0, 0, w, h);
      const L = live.current;
      const recording = L.phase === 'recording';
      const elapsed = recording ? performance.now() - L.recStart : 0;
      let hit = false;
      if (recording && L.target) {
        const d = motion.sample(v, vw, vh, L.target, elapsed);
        if (d > L.maxMotion && elapsed > 500) {
          L.maxMotion = d;
          hit = d > 8;
          thumbCanvas.width = 480;
          thumbCanvas.height = Math.round((480 * h) / w);
          thumbCanvas.getContext('2d')!.drawImage(c, 0, 0, thumbCanvas.width, thumbCanvas.height);
        }
      }
      drawOverlay(ctx, w, h, {
        target: L.target,
        code,
        attempt: L.attempt,
        recording,
        elapsedMs: elapsed,
        clock: new Date(),
        countdown: L.phase === 'countdown' ? L.countdown : undefined,
        hit,
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [ready, code, motion, thumbCanvas]);

  // ---- aiming ---------------------------------------------------------------
  const onCanvasTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (phase !== 'aim') return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTarget({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      r: ringSize,
    });
  };

  useEffect(() => {
    setTarget((t) => (t ? { ...t, r: ringSize } : t));
  }, [ringSize]);

  // ---- record an attempt ------------------------------------------------------
  const startAttempt = () => {
    live.current.countdown = countdownLen;
    setPhase('countdown');
    const tick = () => {
      live.current.countdown -= 1;
      if (live.current.countdown <= 0) beginRecording();
      else window.setTimeout(tick, 1000);
    };
    window.setTimeout(tick, 1000);
  };

  const beginRecording = () => {
    const c = canvasRef.current!;
    const out = c.captureStream(30);
    streamRef.current?.getAudioTracks().forEach((t) => out.addTrack(t));
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(out, mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const recordedAt = Date.now();
    rec.onstop = () => {
      const durationMs = performance.now() - live.current.recStart;
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'video/webm' });
      const momentMs = target ? motion.peak(durationMs / 2) : durationMs / 2;
      void canvasToBlob(thumbCanvas).then((thumb) => {
        setClip({ blob, url: URL.createObjectURL(blob), durationMs, momentMs, thumb: thumb ?? undefined, recordedAt });
        setPhase('judge');
      });
    };
    motion.reset();
    live.current.maxMotion = 0;
    // default thumbnail: first frame
    thumbCanvas.width = 480;
    thumbCanvas.height = Math.round((480 * c.height) / c.width);
    thumbCanvas.getContext('2d')!.drawImage(c, 0, 0, thumbCanvas.width, thumbCanvas.height);
    recRef.current = rec;
    live.current.recStart = performance.now();
    rec.start(250);
    setPhase('recording');
    window.setTimeout(() => rec.state === 'recording' && rec.stop(), clipLen * 1000);
  };

  const stopEarly = () => {
    if (recRef.current?.state === 'recording') recRef.current.stop();
  };

  const judge = (made: boolean) => {
    if (!clip) return;
    if (made) {
      setPhase('review');
      return;
    }
    setMisses((m) => [...m, clip.blob].slice(-MAX_BLOOPERS));
    URL.revokeObjectURL(clip.url);
    setClip(undefined);
    setAttempt((a) => a + 1);
    setPhase('aim');
  };

  const post = async () => {
    if (!clip || !lobbyId) return;
    setPosting(true);
    const p = await createPost({
      lobbyId,
      kind,
      rootId,
      challengeId,
      title: title || (kind === 'original' ? 'Untitled trick shot' : root?.title ?? ''),
      rules,
      video: clip.blob,
      thumb: clip.thumb,
      misses,
      attempts: attempt,
      target,
      momentMs: clip.momentMs,
      durationMs: clip.durationMs,
      verifyCode: code,
      recordedAt: clip.recordedAt,
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    go(`/post/${p.rootId ?? p.id}`);
  };

  // ---- UI -------------------------------------------------------------------
  const heading =
    kind === 'matched' ? 'Match it' : kind === 'upped' ? 'Up it 🔼' : challenge ? 'Challenge entry' : 'New trick shot';

  if (!lobbies.length) {
    return (
      <div className="page">
        <h1>{heading}</h1>
        <p className="muted">Join or create a lobby first so your shot has somewhere to go.</p>
        <button className="btn" onClick={() => go('/')}>
          Go to lobbies
        </button>
      </div>
    );
  }

  if (phase === 'review' && clip) {
    return (
      <div className="page">
        <h1>🎯 Nice. Make on attempt #{attempt}</h1>
        <ClipPlayer src={clip.url} momentMs={clip.momentMs} target={target} />
        <label className="field">
          <span>Moment the ball hit the target ({(clip.momentMs / 1000).toFixed(1)}s)</span>
          <input
            type="range"
            min={0}
            max={Math.round(clip.durationMs)}
            step={50}
            value={Math.round(clip.momentMs)}
            onChange={(e) => setClip({ ...clip, momentMs: Number(e.target.value) })}
          />
          <small className="muted">The app guessed this from motion inside your target ring. Drag to fix it.</small>
        </label>
        {kind === 'original' && (
          <>
            <label className="field">
              <span>Name your shot</span>
              <input
                value={title}
                maxLength={60}
                placeholder="e.g. Couch-to-hamper double bank"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div className="field">
              <span>Rules others must follow</span>
              <div className="chips">
                {RULE_OPTIONS.map((r) => (
                  <button
                    key={r}
                    className={`chip ${rules.includes(r) ? 'chip-on' : ''}`}
                    onClick={() => setRules((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]))}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {!lobbyParam && !root && lobbies.length > 1 && (
          <label className="field">
            <span>Post to</span>
            <select value={lobbyId} onChange={(e) => setLobbyId(e.target.value)}>
              {lobbies.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="verify-box">
          <b>Verification on this clip</b>
          <span>✓ Recorded in the app, one continuous take</span>
          <span>✓ Session code {code} and clock burned into the video</span>
          <span>✓ {attempt} attempt{attempt === 1 ? '' : 's'} logged ({misses.length} blooper clip{misses.length === 1 ? '' : 's'} kept)</span>
          {target && <span>✓ Target called before the shot</span>}
        </div>
        <div className="row">
          <button className="btn btn-ghost" onClick={() => setPhase('judge')}>
            Back
          </button>
          <button className="btn grow" disabled={posting} onClick={post}>
            {posting ? 'Posting…' : 'Post to lobby'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page recorder">
      <div className="rec-head">
        <h1>{heading}</h1>
        <span className="pill">Attempt #{attempt}</span>
      </div>
      {root && (
        <p className="muted small">
          {kind === 'matched' ? 'Do the same shot: ' : 'Do something harder than: '}
          <b>{root.title}</b>
          {root.rules.length > 0 && <> · Rules: {root.rules.join(', ')}</>}
        </p>
      )}
      {challenge && (
        <p className="muted small">
          <b>{challenge.title}</b> · {challenge.description}
        </p>
      )}

      <div className="cam">
        <video ref={videoRef} muted playsInline className="cam-src" />
        <canvas ref={canvasRef} onPointerDown={onCanvasTap} className={phase === 'aim' ? 'aimable' : ''} />
        {!ready && !camError && <div className="cam-msg">Starting camera…</div>}
        {camError && <div className="cam-msg error">{camError}</div>}
        {phase === 'judge' && clip && (
          <div className="cam-judge">
            <ClipPlayer src={clip.url} momentMs={clip.momentMs} target={target} compact />
          </div>
        )}
      </div>

      {phase === 'aim' && ready && (
        <>
          <p className="hint">{target ? 'Target called. Tap again to move it.' : '👆 Tap your target on the screen to call your shot.'}</p>
          <div className="settings">
            <label>
              Ring size
              <input type="range" min={0.03} max={0.2} step={0.005} value={ringSize} onChange={(e) => setRingSize(Number(e.target.value))} />
            </label>
            <label>
              Countdown
              <select value={countdownLen} onChange={(e) => setCountdownLen(Number(e.target.value))}>
                {[3, 5, 10, 15].map((n) => (
                  <option key={n} value={n}>
                    {n}s
                  </option>
                ))}
              </select>
            </label>
            <label>
              Clip length
              <select value={clipLen} onChange={(e) => setClipLen(Number(e.target.value))}>
                {[5, 8, 10, 15, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}s
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="btn btn-rec full" onClick={startAttempt}>
            ● Record attempt #{attempt}
          </button>
          <p className="muted small center">
            Prop your phone up, tap record, get in position. It stops by itself after {clipLen}s.
          </p>
        </>
      )}
      {phase === 'countdown' && <p className="hint big">Get in position…</p>}
      {phase === 'recording' && (
        <button className="btn btn-ghost full" onClick={stopEarly}>
          ■ Stop now
        </button>
      )}
      {phase === 'judge' && (
        <>
          <p className="hint big">Did it go in?</p>
          <div className="row">
            <button className="btn btn-miss grow" onClick={() => judge(false)}>
              ✗ Missed
            </button>
            <button className="btn grow" onClick={() => judge(true)}>
              🎯 Made it!
            </button>
          </div>
          <p className="muted small center">Misses are saved to your blooper reel and count toward your attempt total.</p>
        </>
      )}
    </div>
  );
}
