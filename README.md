# Mirror, Mirror

A two-player browser game (HackTX 2026). It measures how well two people mirror each other's facial expressions in real time.

## Run

```sh
npm install
npm run dev        # http://localhost:5173 (Chrome)
```

`npm run dev` copies the MediaPipe wasm runtime into `public/mediapipe/` before it starts. The face model is committed in `public/models/`. After `npm install` the app needs no internet.

## Phase 2 feasibility page

Shows inference fps, the "2-face fps" (frames where both faces were found), ms per inference and all 52 blendshapes for each player. The gate is **2-face fps ≥ 20 on the demo laptop**.

URL options:
- `?delegate=CPU`: force the CPU delegate (default: GPU, with CPU as fallback)
- `?bench=<image url>`: no camera needed. The image is drawn twice side by side so there are always two faces, e.g. `?bench=/bench/portrait.jpg` (put test images in the gitignored `public/bench/`)
