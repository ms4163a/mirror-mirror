# Mirror, Mirror

A two-player browser game (HackTX 2026). It measures how well two people mirror each other's facial expressions in real time. The better they sync, the higher Jack climbs the beanstalk.

## Run

```sh
npm install
npm run dev        # game:        http://localhost:5173/          (Chrome)
                   # feasibility: http://localhost:5173/dev.html
npm test           # sync engine, tracking and round tests
```

`npm run dev` copies the MediaPipe wasm runtime into `public/mediapipe/` before it starts. The face model is committed in `public/models/`. After `npm install` the app needs no internet.

### Game URL options
- `?sim=mirror|swap|unison|independent|still|solo`: simulated players, no camera. Use these to work on the game and UI.
- `?roundMs=20000`: shorter rounds for testing
- `?delegate=CPU`: force the CPU tracker delegate

### Art
The scene uses simple vector placeholder shapes. Drop `public/assets/jack.png` (Jack, feet at the bottom of the image) in and it replaces the placeholder automatically.

## How sync is measured

1. **Channels** (`src/signal/channels.ts`): 52 blendshapes become 18 expression channels, plus head yaw, pitch and roll. Left/right pairs are averaged and yaw and roll use absolute values, so mirroring and copying score the same. Gaze is dropped.
2. **History** (`src/sync/history.ts`): camera frames are resampled onto a fixed 30 Hz grid. A missing face is marked absent.
3. **Sync engine** (`src/sync/syncEngine.ts`): on a 4 s window, Pearson cross-correlation per channel at lags of ±1 s, weighted by movement.
   - A channel counts if either player moves on it, but only adds correlation if both do. Different faces therefore lower the score.
   - Peak height becomes **sync** (above a chance level of 0.25). Peak position becomes **lag**, and its sign gives the **leader** (dead zone ±80 ms).
   - **Anti-stillness:** each player's movement is compared with their own floor from a 4 s calibration. Two still faces score 0.
4. **Round** (`src/game/round.ts`): Jack climbs when smoothed sync is above 0.2, and slips while both players are still. `src/game/prompts.ts` holds the round script for tuning.
5. **Recap** (`src/game/recap.ts`): time in sync, best streak, median lag, who led, leader-segment comparison, and best-matched expressions. Only measured numbers.

### Feasibility page options (`dev.html`)
- `?delegate=CPU`
- `?bench=<image url>`: draws the image twice side by side for a camera-free fps benchmark (put images in the gitignored `public/bench/`)
