# Upped: trick shot lobby (web prototype)

Post a trick shot, your lobby matches it or ups it, everyone votes, the winner holds the crown.

## Run it

```bash
cd trickshot
npm install
npm run dev      # open the printed URL on your phone (same Wi-Fi)
```

Phone cameras only work on `https://` or `localhost`, so for real phone testing either deploy
`npm run build` output (`dist/`) to any static host (Netlify, Vercel, GitHub Pages) or use a tunnel.

## What's in v0.1

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

## Not yet

- Shared backend (data lives on one device in IndexedDB). `src/store.ts` is the seam for Supabase.
- Stronger anti-cheat (device attestation, motion-sensor check, audio codes) needs the native app.
- Ball tracer.
