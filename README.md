# Mirror, Mirror

A two-player browser game (HackTX 2026). It measures how well two people mirror each other's facial expressions in real time. The better they sync, the higher Jack climbs the beanstalk.

## Run

```sh
npm install
npm run dev:all    # game + leaderboard server together, or separately:
npm run dev        #   game:        http://localhost:5173/              (Chrome)
                   #   feasibility: http://localhost:5173/dev.html
npm run server     #   leaderboard server on :8787 (the game proxies /api to it)
npm test           # all tests
npm run typecheck  # browser + server code
```

## Leaderboard

- After a round, players can type an optional team name and press **Save**. Only the team name and the round's numbers are sent: height, in-sync share, lag, who led, best expression, and a 2 Hz sync curve. No images.
- **Display:** open `http://<game-PC-IP>:5173/leaderboard.html` on the leaderboard laptop, on the same network. It updates live over Server-Sent Events. If the laptop can't connect, allow Node through the Windows firewall on the game PC.
- **Test rounds:** rounds from `?sim=` and `?replay=` are stored but hidden from the board. Add `?test=1` to show them.
- **Offline:** if the server is down, the game queues saved rounds in localStorage and uploads them on the next start.
- **Storage:** `server/data/rounds.jsonl`, gitignored. The store sits behind an interface (`server/store.ts`), so a Tiger Data (Postgres) store can replace it for the Vultr deployment.
- **Production:** `npm start` builds the app and serves it plus the API from one Node process (`node server/index.ts --static dist`).

`npm run dev` copies the MediaPipe wasm runtime into `public/mediapipe/` before it starts. The face model is committed in `public/models/`. After `npm install` the app needs no internet.

### Game URL options
- `?sim=mirror|swap|unison|independent|still|solo`: simulated players, no camera. Use these to work on the game and UI.
- `?roundMs=20000`: shorter rounds for testing
- `?delegate=CPU`: force the CPU tracker delegate
- `?replay=<url>`: replay a recorded session in real time (put the file in `public/bench/`, e.g. `?replay=/bench/round.json`)
- `?coach=off`: skip the Llama coach's note

### Recording real sessions for tuning
"Download round data" on the recap saves a JSON file containing the recap, the 10 Hz samples and a **recording**: raw channel frames from calibration to the end of the round. A recording can be:
- replayed through the live game with `?replay=`
- re-scored offline with different settings using `rescore()` in `src/replay/rescore.ts`, which gives the same result as the live game

Please save a few real two-person rounds during playtesting. They're what we tune `chanceR`, the climb settings and `IN_SYNC` on.

### Llama coach's note (optional, needs Ollama)
With Ollama running locally (`ollama pull llama3.1:8b`), the recap gets a 2–3 sentence coach's note. The dev server proxies `/ollama` to `http://localhost:11434`.
- **Input:** the model receives only the measured recap numbers (`recapFacts()` in `src/llm/coach.ts`) and must return JSON listing the facts it used.
- **Checks:** every number in the note must belong to one of the facts it listed, and relationship or compatibility language is rejected.
- **Fallback:** if Ollama is off, slow, or the note fails the checks, no note is shown and everything else works the same.

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
