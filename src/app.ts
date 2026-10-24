// Mirror, Mirror: the game. Connects the camera (or simulated players), the
// sync engine, the round, and the UI, and runs the screen flow:
//   lobby -> calibrate -> countdown -> round -> recap -> (again)
//
// URL options:
//   ?sim=mirror|swap|unison|independent|still|solo   simulated players, no camera
//   ?delegate=CPU                                     force the CPU tracker delegate
//   ?roundMs=20000                                    shorter rounds for testing
import { promptAt } from "./game/prompts";
import { computeRecap, type Recap } from "./game/recap";
import { Round } from "./game/round";
import { CameraSource, SIM_MODES, SimSource, type FrameSource, type SimMode } from "./input/sources";
import { SyncEngine, type SyncSnapshot } from "./sync/syncEngine";
import { FaceTracker, createLandmarker, openCamera } from "./tracking/faceTracker";
import { Hud } from "./ui/hud";
import { renderRecap } from "./ui/recapView";
import { Scene } from "./ui/scene";

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const CALIBRATE_MS = 4000;
const COUNTDOWN_MS = 3000;
const SNAPSHOT_EVERY_MS = 100;
const ROUND_MS = Number(params.get("roundMs")) || undefined;

type ScreenName = "lobby" | "calibrate" | "countdown" | "round" | "recap" | "error";

const video = $<HTMLVideoElement>("video");
const scene = new Scene($<HTMLCanvasElement>("scene"));
const hud = new Hud({
  camOverlay: $<HTMLCanvasElement>("cam-overlay"),
  syncValue: $("sync-value"),
  syncBar: $("sync-bar"),
  leader: $("leader"),
  lagGraph: $<HTMLCanvasElement>("lag-graph"),
  families: $("families"),
});

let source: FrameSource;
let engine = new SyncEngine();
let screen: ScreenName = "lobby";
let screenStart = 0;
let round: Round | null = null;
let recap: Recap | null = null;
let snap: SyncSnapshot | null = null;
let displaySync = 0;
let presence: [boolean, boolean] = [false, false];
let lastPromptIndex = -1;

// Read-only debug handle for headless checks.
const debug = {
  get screen() { return screen; },
  get height() { return round?.height ?? 0; },
  get snap() { return snap; },
  get recap() { return recap; },
  start: () => startGame(),
};
(window as unknown as { __mm: typeof debug }).__mm = debug;

function show(name: ScreenName) {
  screen = name;
  screenStart = performance.now();
  for (const s of ["lobby", "calibrate", "countdown", "recap", "error"]) $(`screen-${s}`).hidden = s !== name;
  $("prompt").hidden = name !== "round";
  $("timer").hidden = name !== "round";
}

function startGame() {
  if (screen !== "lobby" && screen !== "recap") return;
  if (screen === "lobby" && !(presence[0] && presence[1])) return;
  // Fresh engine per game so the history and calibration are clean.
  engine = new SyncEngine();
  engine.startCalibration();
  hud.clearHistory();
  scene.reset();
  round = null;
  recap = null;
  show("calibrate");
}

function finishRound() {
  if (!round) return;
  recap = computeRecap(round.samples, round.durationMs);
  const host = $("screen-recap");
  show("recap");
  renderRecap(host, recap, round.samples);
  host.querySelector('[data-action="again"]')!.addEventListener("click", startGame);
  host.querySelector('[data-action="download"]')!.addEventListener("click", downloadRound);
}

function downloadRound() {
  if (!round || !recap) return;
  const blob = new Blob([JSON.stringify({ recap, samples: round.samples }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mirror-round-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function updatePrompt() {
  if (!round) return;
  const { card, index } = promptAt(round.elapsed);
  if (index !== lastPromptIndex) {
    lastPromptIndex = index;
    $("prompt-title").textContent = card.title;
    $("prompt-hint").textContent = card.hint;
    const el = $("prompt");
    el.classList.remove("pop");
    void el.offsetWidth; // restart the animation
    el.classList.add("pop");
  }
  const left = Math.max(0, Math.ceil((round.durationMs - round.elapsed) / 1000));
  $("timer").textContent = `0:${String(left).padStart(2, "0")}`;
}

let lastFrameT = performance.now();
let lastSnapT = 0;

function tick(now: number) {
  requestAnimationFrame(tick);
  const dt = Math.min(100, now - lastFrameT);
  lastFrameT = now;

  const frame = source.poll(now);
  if (frame) {
    const [a, b] = frame.players;
    presence = [a.present, b.present];
    engine.push(frame.t, a.present ? a.channels : null, b.present ? b.channels : null);
    const w = source.kind === "camera" ? video.videoWidth : 1280;
    const h = source.kind === "camera" ? video.videoHeight : 720;
    hud.drawCamera(frame, w, h, source.kind === "sim");
  }

  let fresh = false;
  if (now - lastSnapT >= SNAPSHOT_EVERY_MS) {
    lastSnapT = now;
    snap = engine.snapshot();
    fresh = true;
  }

  const elapsed = now - screenStart;
  switch (screen) {
    case "lobby":
      for (const i of [0, 1]) $(`check-${i}`).classList.toggle("ok", presence[i]);
      $<HTMLButtonElement>("start").disabled = !(presence[0] && presence[1]);
      break;
    case "calibrate":
      $("calib-bar").style.width = `${Math.min(100, (elapsed / CALIBRATE_MS) * 100)}%`;
      if (elapsed >= CALIBRATE_MS) {
        engine.endCalibration();
        show("countdown");
      }
      break;
    case "countdown":
      $("countdown-num").textContent = String(Math.max(1, Math.ceil((COUNTDOWN_MS - elapsed) / 1000)));
      if (elapsed >= COUNTDOWN_MS) {
        round = new Round(ROUND_MS);
        lastPromptIndex = -1;
        show("round");
      }
      break;
    case "round":
      if (!round) break;
      if (fresh && snap) round.record(snap);
      round.update(dt, snap);
      updatePrompt();
      if (round.done) finishRound();
      break;
  }

  // During a round the meter shows the round's smoothed sync; otherwise ease toward the live value.
  const target = snap?.sync ?? 0;
  displaySync = round && screen === "round" ? round.sync : displaySync + (target - displaySync) * (1 - Math.exp(-dt / 300));
  if (fresh) hud.update(snap, displaySync);

  const height = round?.height ?? 0;
  $("height").textContent = `${height.toFixed(1)} m`;
  scene.render(dt, {
    height,
    sync: displaySync,
    slipping: screen === "round" && !!snap && !snap.active && height > 0,
  });
}

async function init() {
  show("lobby");
  const sim = params.get("sim") as SimMode | null;
  try {
    if (sim && SIM_MODES.includes(sim)) {
      source = new SimSource(sim);
      $("cam-note").hidden = false;
      $("cam-note").textContent = `Simulated players: ${sim}`;
    } else {
      $("leader").textContent = "Starting camera…";
      await openCamera(video);
      $("leader").textContent = "Loading face tracker…";
      const preferred = params.get("delegate")?.toUpperCase() === "CPU" ? "CPU" : undefined;
      const { landmarker } = await createLandmarker(preferred);
      source = new CameraSource(new FaceTracker(landmarker, video));
    }
  } catch (err) {
    console.error(err);
    $("error-msg").textContent =
      (err as Error).name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access and reload."
        : String((err as Error).message ?? err);
    show("error");
    return;
  }
  $("start").addEventListener("click", startGame);
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      startGame();
    } else if (e.code === "Escape") {
      round = null;
      show("lobby");
    }
  });
  requestAnimationFrame(tick);
}

init();
