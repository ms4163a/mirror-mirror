# Mirror, Mirror

A two-player browser game for HackTX 2026. Two people copy each other's facial expressions, and the better they mirror each other, the higher Jack climbs the beanstalk. After each round, a recap shows sync over time, follow lag in milliseconds, who led and for how long, and which expressions matched best.

The AI only **interprets** what your faces do. All face tracking runs in your browser, and no video ever leaves your computer. It's feedback on one round of a game, not a verdict on the players.

---

## Contents
1. [Quick start (one computer)](#1-quick-start-one-computer)
2. [How to play](#2-how-to-play)
3. [Other ways to play](#3-other-ways-to-play): remote on two computers · practice against a bot
4. [Leaderboard (second screen)](#4-leaderboard-second-screen)
5. [Optional: Llama coach's note](#5-optional-llama-coachs-note)
6. [Troubleshooting](#6-troubleshooting)
7. [All commands, pages and URL options](#7-all-commands-pages-and-url-options)
8. [How it works](#8-how-it-works)
9. [Project status: what's done and what isn't](#9-project-status-whats-done-and-whats-not)

---

## 1. Quick start (one computer)

**You need:** [Node.js 24](https://nodejs.org), Chrome or Edge, a webcam, and git.

```sh
git clone https://github.com/ms4163a/mirror-mirror.git
cd mirror-mirror
npm install
npm run dev:all
```

Open **http://localhost:5173** and allow the camera. After `npm install`, everything runs offline (the face model and runtime are bundled).

`npm run dev:all` starts two things: the game, and a small server for the leaderboard and remote play. Keep that terminal open while you play.

---

## 2. How to play

1. **Sit side by side** in front of the camera, both faces fully in view. The camera should be at eye level and straight ahead, with light on your faces.
2. When both dots in the lobby turn green, press **Space** (or click **Start**). If Start stays locked, the lobby says exactly what it's waiting for.
3. **Relax your faces for 4 seconds** while the game measures your resting faces.
4. **Play the 60-second round:** follow the prompt cards ("Big smiles", "Left player leads", "Swap!", …) and copy each other.
   - Hold each expression **together for 2–3 seconds**. Matches build over a 10-second window, so quick flashes don't count much.
   - Make expressions **big**. Your bars in the "Expression match" panel show what the camera reads for each of you.
5. **Recap:** see your climb, sync chart, lag, who led and your best-matched expressions. You can type a team name and **Save** to the leaderboard.

**Keys:** `Space` start · `Esc` back to the lobby · `F` fullscreen.

**If a red note appears on the camera panel** ("face your camera" or "put your camera at eye level"), fix the camera angle. Tracking gets much worse when a head is turned or tilted more than about 25°.

---

## 3. Other ways to play

### Remote: two computers, one player each

Each computer tracks only its own player. Only 21 numbers per frame are sent, never video. Each player sees both players as cartoon faces.

1. **Host (Left player):** run `npm run dev:https`. This serves the game over HTTPS, which browsers require for cameras on other devices.
2. **Give the guest a way to reach the host.** Pick one:
   - **Same network:** the host opens `https://localhost:5173/?remote=new` (or clicks "Start a remote game" in the lobby). The lobby lists a guest link for each of this computer's network addresses.
   - **Different networks, or campus/venue Wi-Fi that blocks devices from seeing each other:** in a **separate terminal that you keep open**, run:
     ```sh
     npx cloudflared tunnel --url https://localhost:5173 --no-tls-verify
     ```
     It prints a public `https://….trycloudflare.com` address. The host opens `https://<that-address>/?remote=new` and sends the guest the link shown in the lobby. Each tunnel run gives a **new** address, and the tunnel stops when its terminal closes.
3. **Guest (Right player):** open the link and accept the certificate warning if one appears ("Advanced → Proceed"). Allow the camera. Both players must use the **same** address.
4. Either player presses Space to start. Only the host can download the round data.

A mistyped link (room codes are 4 letters) shows an error instead of starting a one-computer game.

### Practice against a bot (one person)

Open **http://localhost:5173/?bot=1**, or click "Practice against a bot" in the lobby.
- **You play Left.** The bot on the Right mirrors you about 0.65 s late, imperfectly, so the score isn't free.
- During "Right player leads" prompts, **the bot leads** and you copy it.
- Bot rounds count as test rounds and stay off the main leaderboard.

---

## 4. Leaderboard (second screen)

1. Run `npm run dev:all` (or `dev:https`) on the game computer.
2. On any device on the same network, open `http://<game-computer-IP>:5173/leaderboard.html`. Use `https://` if the game runs with `dev:https`. It updates live when a team saves a round.

**Details:**
- Saving is optional. Only the team name and the round's numbers are stored, no images. They're stored in `server/data/rounds.jsonl` on the game computer.
- Rounds from simulated players, replays and the bot are stored but **hidden**. Add `?test=1` to the leaderboard URL to show them.
- If the server is down, saved rounds wait in the browser and upload the next time the game starts.

---

## 5. Optional: Llama coach's note

Install [Ollama](https://ollama.com) on the game computer and run `ollama pull llama3.1:8b`. After each round, the recap then shows a 2–3 sentence coach's note.
- Llama 3.1 sees **only the measured numbers** from the recap.
- Every number in its note is checked against those numbers, and any relationship or compatibility talk is rejected.
- If Ollama isn't running, or a note fails the checks, no note is shown. Everything else works the same.
- Turn it off with `?coach=off`. The note only appears on the host's screen in remote games.

---

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| Lobby says "Waiting for the camera…" | Click the camera icon at the right end of the address bar and choose **Allow**. Use Chrome or Edge (Opera GX blocks more). |
| "The camera is busy" | Close Zoom, Teams, OBS, Phone Link or the Camera app, then reload. |
| Wrong camera (e.g. a phone/virtual camera) | Pick the right one in the lobby's camera dropdown, or add `?camera=usb` (any part of the camera's name). |
| Camera blocked on another computer | Open the `https://` address (from `npm run dev:https`); browsers only allow cameras on https or localhost. |
| Guest link won't load | Allow Node through the Windows Firewall on the host (private networks), or use the Cloudflare tunnel. |
| Tunnel link stopped working | The `cloudflared` terminal was closed or the PC slept. Start it again and share the **new** address. |
| One player's expressions barely register | Face the camera straight on, camera at eye level, light from the front. Watch the per-player bars in "Expression match". |
| Need to check speed | Open `/dev.html` with both players in view and read **"2-face fps"** (frames per second while both faces are tracked). **20 or more** is fine. |

---

## 7. All commands, pages and URL options

**Commands**
```sh
npm run dev          # game only, http://localhost:5173
npm run server       # leaderboard + remote-play server on port 8787
npm run dev:all      # both of the above
npm run dev:https    # both, with the game on HTTPS (for cameras on other devices / remote play)
npm test             # all tests
npm run typecheck    # browser + server code
npm run build        # typecheck + production build into dist/
npm start            # build, then serve the app + API from one Node process (port 8787)
```

**Pages**
- `/`: the game.
- `/leaderboard.html`: live leaderboard (`?test=1` includes test rounds).
- `/dev.html`: tracking check (fps, "2-face fps", camera, GPU/CPU, all blendshapes).
- `/tune.html`: load saved rounds and re-score them with different scoring settings.

**Game URL options**

| Option | What it does |
|---|---|
| `?bot=1` | practice against a bot |
| `?remote=new` / `?room=ABCD&seat=left\|right` | remote play |
| `?camera=<text>` | prefer a camera whose name contains this text |
| `?delegate=CPU` | force CPU face tracking |
| `?coach=off` | no Llama note |
| `?roundMs=30000` | shorter rounds (prompts compress to fit) |
| `?sim=mirror\|swap\|unison\|independent\|still\|solo` | simulated players, no camera (for testing) |
| `?replay=<url>` | replay a saved round (put files in `public/bench/`) |
| `?filter=off` | no jitter smoothing |
| `?brows=blend` | angry-brow detection from the blendshape only (no geometry) |
| `?api=http://host:8787` | use a different leaderboard server |

**Recording rounds for tuning:** "Download round data" on the recap saves the recap plus the raw face data. Load the files in `/tune.html`, or replay them with `?replay=`.

---

## 8. How it works

1. **Tracking:** MediaPipe Face Landmarker runs in the browser and tracks 2 faces (52 blendshapes plus head pose each).
2. **Channels:** these become 21 expression channels.
   - Left/right sides are averaged, so mirroring and copying score the same.
   - A One Euro filter removes webcam jitter.
   - Angry brows are also measured geometrically from the face mesh, because the browDown blendshape is weak for some faces.
3. **Sync engine** (`src/sync/syncEngine.ts`): every 100 ms, it correlates the two players over a 10-second window at lags of up to ±1.5 s (human reaction time).
   - Channels are grouped into expression families (smile, frown, mouth open, …). Each player's family signal is relative to their own range, so a smile that one camera reads as "mouth corners up" matches one another camera reads as "dimples and pressed lips".
   - The peak correlation gives **sync**. Its timing gives **lag** and **who led**.
   - **Anti-stillness:** each player's movement is compared with their own resting face from calibration, so two still faces score 0.
4. **Climb:** Jack climbs when smoothed sync is above 0.2, and slips if both players are still.
5. **Tuning on real play:** the scoring settings were tuned on real two-person rounds. They were compared against the same rounds with one player time-shifted, which keeps real faces but removes any mirroring.
   - Real rounds climbed 26–63 m, except one where a player's head was turned about 37° from their camera.
   - The time-shifted controls averaged about 4 m.

**Code map:** `src/app.ts` (game flow) · `src/tracking/` (camera, MediaPipe) · `src/signal/` (channels, filter, brows, meters) · `src/sync/` (engine) · `src/game/` (round, prompts, recap) · `src/ui/` (scene, HUD, recap) · `src/llm/` (coach) · `src/remote/` + `server/rooms.ts` (remote play) · `src/net/` + `server/` + `shared/` (leaderboard) · `src/input/` (camera, simulated, replay, bot sources) · `src/replay/` (recording, re-scoring) · `src/tune/` (tuning page).

---

## 9. Project status: what's done and what's not

**Working and tested:**
- One-computer two-player game, recap, leaderboard (live updates, offline queue).
- Remote play on two computers: played in real rounds over a Cloudflare tunnel.
- Llama coach's note (needs local Ollama).
- Recording, replay and the tuning page.
- Camera picker and warnings.
- 138 automated tests.

**New, with limited testing:**
- **Angry-brow geometry:** the logic is unit-tested, but it isn't yet tuned on real recordings, because saved rounds don't store the face mesh. Add `?brows=blend` to fall back to the blendshape-only signal.
- **Practice against a bot:** the bot logic is unit-tested, but it hasn't been played live much yet.

**Not built:**
- Hosted deployment (Vultr) and a database (Tiger Data). The leaderboard uses a local file. `npm start` can serve everything from one process, but it hasn't been deployed.
- Custom art and sound. Jack and the scenery are simple placeholder drawings; a hand-drawn `public/assets/jack.png` would replace Jack automatically.
- Scoring tuned for more than one pair of players. It was tuned on one pair's rounds, so other faces may score differently.
