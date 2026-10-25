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

## Remote play (two computers)

Each computer tracks only its own player. Only the face-channel numbers (21 per frame) go through the server, and **video never leaves either computer**. Each player sees both players as cartoon faces. The host (Left) runs the game and streams its state and the recap to the guest (Right). Lag is measured from timestamps on a clock synced with ping/pong, not from arrival times, so network delay doesn't distort it.

1. On the host machine: `npm run dev:https` (game + server over HTTPS). Browsers only allow the camera on `https://` or `localhost`.
2. Host: open `https://localhost:5173/?remote=new`, or click "Start a remote game" in the lobby. The lobby lists a guest link for each of this PC's network addresses, for example `https://192.168.1.23:5173/?room=ABCD&seat=right (Wi-Fi)` and a Tailscale one. Send the one for a network you both share.
3. Guest, on another computer on the same network: open that link and accept the self-signed-certificate warning ("Advanced", then "Proceed"). If it won't load, allow Node through the Windows firewall on the host.
   Campus and venue Wi-Fi often blocks devices from reaching each other. If the guest's page never loads, use Tailscale (both machines signed in to the same tailnet, then the Tailscale link) or a tunnel (step 4).
4. Different networks: expose the host with a tunnel instead, for example `npx cloudflared tunnel --url https://localhost:5173 --no-tls-verify` or Tailscale Funnel. Then share the tunnel URL with `?room=ABCD&seat=right`. The dev server already allows `*.trycloudflare.com` and `*.ts.net`.
5. A mistyped link (room codes are 4 letters) shows an error instead of quietly starting a one-computer game.
6. Either player presses Space to start. Remote rounds count on the leaderboard like local camera rounds, and the host's "Download round data" includes both players' streams.

Test without cameras: open `?room=TEST&seat=left&sim=mirror` and `?room=TEST&seat=right&sim=mirror` in two browsers.

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
3. **Sync engine** (`src/sync/syncEngine.ts`): every 100 ms, Pearson cross-correlation per channel on an **8 s** window at lags of **±1.5 s** (human reaction time), weighted by movement.
   - A channel counts if either player moves on it; if only one does, it adds half weight (`oneSidedPenalty`) but no correlation, so different faces lower the score.
   - Mouth channels carry the most weight. Brows, squints, blinks and head pose count for less or nothing, because in real play they correlated about as well by chance.
   - The peak's height becomes **sync**: 0 at the chance level `chanceR` = 0.25, 1 at `fullR` = 0.5. The peak's position becomes **lag**, and its sign gives the **leader** (dead zone ±80 ms).
   - **Anti-stillness:** each player's movement is compared with their own floor from a 4 s calibration (capped at 1.5× the default, so fidgeting during calibration can't switch channels off). Two still faces score 0.
   - **Tuning data:** these defaults come from a real two-person round, compared against the same round with one player shifted 15–57 s in time (real faces, no mirroring). With the old 4 s settings the real round scored 0.0 m. Now the real round scores 37.7 m and 37% in sync; the shifted versions score at most 2.3 m and 3%.
4. **Round** (`src/game/round.ts`): Jack climbs when smoothed sync is above 0.2, and slips while both players are still. `src/game/prompts.ts` holds the round script for tuning.
5. **Recap** (`src/game/recap.ts`): time in sync, best streak, median lag, who led, leader-segment comparison, and best-matched expressions. Only measured numbers.

### Feasibility page options (`dev.html`)
- `?delegate=CPU`
- `?bench=<image url>`: draws the image twice side by side for a camera-free fps benchmark (put images in the gitignored `public/bench/`)
