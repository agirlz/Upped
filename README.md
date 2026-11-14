# Upped: trick shot lobby (web prototype)

Post a trick shot, your lobby matches it or ups it, everyone votes, the winner holds the crown.

## Live app

Every push to `main` publishes the app to **https://agirlz.github.io/Upped/** (GitHub Actions →
GitHub Pages). Open that link on your phone; on Android, use Chrome's menu → *Add to Home screen*.

## Run it locally

```bash
npm install
npm run dev        # "this phone only" demo mode (data stays in the browser)
```

To run against the shared server locally, copy `.env.production` to `.env.local`.
Phone cameras and AR only work on `https://` or `localhost`.

## Server (Supabase)

`supabase/schema.sql` creates the tables, privacy rules (everything is private to a lobby),
the private `clips` video bucket and live updates. Run it in the Supabase SQL Editor; it is
safe to run again after changes. Anonymous sign-ins must be on (Authentication → Sign In / Providers).

## Features

- **Lobbies** with invite codes, a feed of challenge chains, comments, and reactions (🔥 😱 😂 🐐)
- **In-app recorder only** (no camera-roll uploads): tap to *call your target*, countdown, auto-stop
- **Burned into every clip:** a one-time session code, wall clock, attempt number, and target ring
- **Attempt counter + blooper reel:** misses are kept; posts show "Made on attempt #N"
- **Auto slow-mo replay:** the app detects motion inside the target ring to find the moment
  the ball arrives, then zooms and slows down there
- **Match it / Up it** replies, lobby voting, crowns, **synced side-by-side** comparison
- **Flag as fake:** enough flags hide a clip and remove its points
- **Challenges:** 3 rotating official weekly challenges + lobby challenges with deadlines
- **Leaderboards:** lobby, near me (location rounded to ~10 km), global; this week / all time
- **Demo lobby** with generated sample clips, and a player switcher for pass-the-phone testing

- **Online:** anonymous accounts (no email), private lobbies, live updates, lobby admins can delete clips
- **Fast posting:** about 4 taps; auto-stop on landing; settings remembered; one-tap post
- **Camera flip** front/back mid-take without a cut
- **Difficulty:** distance bucket + target size + extras; Try it posts as Match or Up automatically
- **📏 AR distance measuring** on Android (WebXR)

## Not yet

- Stronger anti-cheat (device attestation, motion-sensor check, AR tracking during the shot) needs a native app.
- Ball tracer, AI ref / hype captions, push notifications.
