# Motion studio rules

## Render contract
- Every film is a pure function of time: `window.seek(t)` paints frame t.
- No CSS transitions, no setTimeout, no requestAnimationFrame in render mode,
  no state carried between frames. Seeded noise only (mulberry32), never Math.random.
- Render with `node render.mjs`, encode H.264 yuv420p, CRF 16.

## Look
- Banned defaults: centered title on gradient, everything fading in,
  corner labels and frame borders, glow on UI chrome, generic particle bursts.
- One display face, one UI face. One accent color unless the brief says otherwise.
- Every 2 to 4 seconds something new must happen on screen.

## Sound
- Score and SFX are synthesized in code unless a track is supplied.
- Place hits on the measured beat grid (beats.json). Loudness -14 LUFS.

## Loop before you show me anything
1. Render one frame per beat as a contact sheet and LOOK at it.
2. Score it 1-10 on: hook in first 2s, readability at phone size,
   motion quality, variety, brand accuracy, sound sync.
3. Fix the 3 worst problems. Repeat until every score is 8+.
4. Only then do the full render.

## Tools
- Page contract: `window.FILM = { width, height, duration, fps }` and `window.seek(t)`;
  `window.RENDER` is true while rendering. `render.mjs` warns on seek-history
  dependence, running CSS animations, and Math.random/rAF/setTimeout/setInterval calls.
- `python3 beats.py score.wav --normalize score.norm.wav` → beats.json + -14 LUFS copy.
  `python3 beats.py --bpm 120 --duration 30` → grid for a score you are about to synthesize.
- `node render.mjs --sheet` → out/sheet.png, one labelled frame per beat (review loop step 1).
- `node render.mjs --audio score.norm.wav` → out/film.mp4 (H.264 yuv420p CRF 16).
