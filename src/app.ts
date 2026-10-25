// Mirror, Mirror: the game. Connects the camera (or simulated players), the
// sync engine, the round, and the UI, and runs the screen flow:
//   lobby -> calibrate -> countdown -> round -> recap -> (again)
//
// URL options:
//   ?sim=mirror|swap|unison|independent|still|solo   simulated players, no camera
//   ?delegate=CPU                                     force the CPU tracker delegate
//   ?roundMs=20000                                    shorter rounds for testing
//   ?replay=<url>                                     replay a recorded session (from "Download round data")
//   ?coach=off                                        skip the Llama coach's note
//   ?api=http://host:8787                             leaderboard server (default: same origin /api)
//   ?remote=new                                       start a remote game on two computers (you are Left)
//   ?room=ABCD&seat=left|right                        join a remote game (the host shares this link)
//   ?camera=<label text>                              prefer a camera whose name contains this text
import "./lobby.css";
import { ROUND_MS, ROUND_SCRIPT, promptAt } from "./game/prompts";
import { computeRecap, type Recap } from "./game/recap";
import { Round, type RoundSample } from "./game/round";
import { cancelCoachNote, showCoachNote } from "./llm/coachView";
import { flushQueue } from "./net/leaderboardClient";
import { showSaveBox } from "./net/saveView";
import { BotSource } from "./input/bot";
import { CameraSource, ReplaySource, SIM_MODES, SimSource, type FrameSource, type SimMode } from "./input/sources";
import { RemoteLink, newRoomCode, type Seat } from "./remote/link";
import type { RemoteMsg, ScreenName } from "./remote/protocol";
import { FrameRecorder, type Recording } from "./replay/recording";
import { CHANNELS, NUM_CHANNELS, PITCH_SCALE, YAW_SCALE } from "./signal/channels";
import { ExpressionMeter } from "./signal/meter";
import { SyncEngine, type SyncSnapshot } from "./sync/syncEngine";
import { cameraErrorMessage, fillCameraPicker, rememberCamera } from "./tracking/camera";
import { FaceTracker, createLandmarker, openCamera, type PlayerFrame, type TrackerFrame } from "./tracking/faceTracker";
import { Hud } from "./ui/hud";
import { renderRecap } from "./ui/recapView";
import { Scene } from "./ui/scene";

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const CALIBRATE_MS = 4000;
const COUNTDOWN_MS = 3000;
const SNAPSHOT_EVERY_MS = 100;
let roundMs = Number(params.get("roundMs")) || undefined;

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
// Raw frames from calibration to the end of the round, for offline tuning.
const recorder = new FrameRecorder();
let recording: Recording | null = null;

// --- remote play -----------------------------------------------------------
// Two computers, one player each. The host (Left) runs the engine and the round
// and streams state to the guest (Right). Only face-channel numbers travel.
let link: RemoteLink | null = null;
const absentFace = (): PlayerFrame => ({ present: false, channels: new Float64Array(NUM_CHANNELS), landmarks: null, blendshapes: null });
/** Latest face of each player (screen left, screen right), for the avatars. */
const faces: [PlayerFrame, PlayerFrame] = [absentFace(), absentFace()];
let lastRemoteAt = -Infinity;
/** Guest only: the newest state from the host. */
let hostState: Extract<RemoteMsg, { type: "state" }> | null = null;
let hostStateFresh = false;
const isGuest = () => !!link && !link.isHost;
/** "What the camera sees" levels per player for the HUD. */
const meters = [new ExpressionMeter(), new ExpressionMeter()] as const;
function updateMeters() {
  for (const p of [0, 1] as const) meters[p].update(faces[p].present ? faces[p].channels : null);
  hud.updateSeen([meters[0].levels, meters[1].levels]);
  updateFaceWarnings();
}

/**
 * Tracking degrades badly when a face is turned away from its camera (in one
 * playtest a player sat ~37 degrees off-axis all round and their brows and
 * mouth barely registered). Warn while the smoothed head turn exceeds 25 degrees.
 */
const HEAD_YAW = CHANNELS.findIndex((c) => c.name === "headYaw");
const HEAD_PITCH = CHANNELS.findIndex((c) => c.name === "headPitch");
const yawDeg: [number, number] = [0, 0];
const pitchDeg: [number, number] = [0, 0];
function updateFaceWarnings() {
  const notes: string[] = [];
  for (const p of [0, 1] as const) {
    const f = faces[p];
    if (!f.present) {
      yawDeg[p] *= 0.9;
      pitchDeg[p] *= 0.9;
      continue;
    }
    const toDeg = 180 / Math.PI;
    yawDeg[p] += (f.channels[HEAD_YAW] * YAW_SCALE * toDeg - yawDeg[p]) * 0.15; // about 1 s to settle at 10 Hz
    pitchDeg[p] += (Math.abs(f.channels[HEAD_PITCH]) * PITCH_SCALE * toDeg - pitchDeg[p]) * 0.15;
    const who = p === 0 ? "Left" : "Right";
    // A camera well above or below eye level also weakens mouth readings (seen in playtest round 6).
    if (yawDeg[p] > 25) notes.push(`${who}: face your camera (head turned ~${Math.round(yawDeg[p])}°)`);
    else if (pitchDeg[p] > 25) notes.push(`${who}: put your camera at eye level (head tilted ~${Math.round(pitchDeg[p])}°)`);
  }
  const el = $("cam-warn");
  const text = notes.join(" · ");
  if (el.textContent !== text) el.textContent = text;
  el.hidden = !text;
}

// Read-only debug handle for headless checks.
const debug = {
  get screen() { return screen; },
  get height() { return round?.height ?? 0; },
  get snap() { return snap; },
  get recap() { return recap; },
  get recording() { return recording; },
  get faceWarning() { return $("cam-warn").hidden ? "" : $("cam-warn").textContent; },
  get yaw() { return yawDeg.map((d) => Math.round(d)); },
  get pitch() { return pitchDeg.map((d) => Math.round(d)); },
  get present() { return faces.map((f) => f.present); },
  get remote() { return link && { seat: link.seat, ready: link.ready, peer: link.peerConnected, rtt: link.clock.rtt, presence }; },
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

function startGame(force = false) {
  if (isGuest()) {
    link!.send({ type: "start" });
    return;
  }
  if (screen !== "lobby" && screen !== "recap") return;
  if (screen === "lobby" && !force && !(presence[0] && presence[1])) {
    flashStartHint();
    return;
  }
  const now = performance.now();
  cancelCoachNote();
  if (source instanceof ReplaySource) source.restart(now);
  recorder.begin(now);
  recorder.mark("calibrateStart", now);
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
  recorder.mark("roundEnd", performance.now());
  recording = recorder.finish(round.durationMs);
  // Use Jack's final height, not the last 10 Hz sample's, so the recap matches the on-screen counter.
  recap = { ...computeRecap(round.samples, round.durationMs), height: round.height };
  const host = $("screen-recap");
  show("recap");
  renderRecap(host, recap, round.samples);
  host.querySelector('[data-action="again"]')!.addEventListener("click", () => startGame());
  host.querySelector('[data-action="download"]')!.addEventListener("click", downloadRound);
  if (params.get("coach") !== "off") showCoachNote(host, recap);
  showSaveBox(host, recap, round.samples, source instanceof CameraSource ? "camera" : source instanceof ReplaySource ? "replay" : "sim");
  link?.send({ type: "recap", recap, samples: round.samples });
}

/** Guest: shows the recap the host computed. */
function showRemoteRecap(r: Recap, samples: RoundSample[]) {
  recap = r;
  const host = $("screen-recap");
  show("recap");
  renderRecap(host, r, samples);
  host.querySelector('[data-action="again"]')!.addEventListener("click", () => startGame());
  host.querySelector('[data-action="download"]')!.addEventListener("click", () => download({ recap: r, samples }));
}

function downloadRound() {
  if (!round || !recap) return;
  download({ recap, samples: round.samples, recording });
}

function download(data: unknown) {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mirror-round-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function updatePrompt(elapsed: number, durationMs: number) {
  // promptAt scales the 60 s script to the round's length (?roundMs=).
  const { card, index } = promptAt(elapsed, ROUND_SCRIPT, durationMs);
  if (index !== lastPromptIndex) {
    lastPromptIndex = index;
    $("prompt-title").textContent = card.title;
    $("prompt-hint").textContent = card.hint;
    const el = $("prompt");
    el.classList.remove("pop");
    void el.offsetWidth; // restart the animation
    el.classList.add("pop");
  }
  const left = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
  $("timer").textContent = `0:${String(left).padStart(2, "0")}`;
}

/** In remote play each camera sees one player; sim test mode uses the seat's own column. */
function ownFace(frame: TrackerFrame, seatIdx: 0 | 1): PlayerFrame {
  if (source.kind === "sim") return frame.players[seatIdx];
  return frame.players.find((p) => p.present) ?? frame.players[0];
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

function onLocalRemoteFrame(frame: TrackerFrame, l: RemoteLink) {
  const seatIdx = l.isHost ? 0 : 1;
  const own = ownFace(frame, seatIdx);
  faces[seatIdx] = own;
  if (l.isHost) feedPlayer(0, frame.t, own);
  // The guest waits for clock sync so its timestamps are on the host's clock.
  if (l.ready) l.send({ type: "frame", t: l.toHost(frame.t), v: own.present ? Array.from(own.channels, round4) : null });
  hud.drawCamera({ t: frame.t, players: faces }, 1280, 720, true);
}

function feedPlayer(p: 0 | 1, t: number, face: PlayerFrame) {
  engine.pushPlayer(p, t, face.present ? face.channels : null);
  recorder.pushPlayer(p, t, face);
}

/** Host: if the guest goes quiet, mark them absent so the engine keeps moving. */
function hostKeepRemoteAlive(now: number) {
  const fresh = now - lastRemoteAt < 1000;
  presence = [faces[0].present, fresh && faces[1].present];
  const stale = now - 500;
  if (!fresh && !(engine.history.latest(1) >= stale)) feedPlayer(1, stale, absentFace());
}

function broadcastState(now: number) {
  link!.send({
    type: "state",
    screen,
    screenElapsed: now - screenStart,
    snap,
    sync: displaySync,
    height: round?.height ?? 0,
    roundElapsed: round?.elapsed ?? 0,
    roundMs: round?.durationMs ?? roundMs ?? ROUND_MS,
    presence,
    waiting: waitingFor(now, "guest"),
  });
}

/**
 * Plain-language reason Start is locked, or "" when both players are ready.
 * Computed on the host (or in local play); `viewer` "guest" words it for the
 * Right player's own screen in a remote game.
 */
function waitingFor(now: number, viewer: "self" | "guest" = "self"): string {
  const parts: string[] = [];
  const fix = "sit in view, face the camera, light on your face";
  for (const i of [0, 1] as const) {
    if (presence[i]) continue;
    if (link && i === 1) {
      if (!link.peerConnected) parts.push("the Right player to join (send them the link)");
      else if (now - lastRemoteAt > 1000)
        parts.push(viewer === "guest" ? "your data to reach the host (if this lasts, reload this tab)" : "data from the Right player's computer (if this lasts, reload their tab)");
      else parts.push(viewer === "guest" ? `your face (${fix})` : "the Right player's face (their camera can't find it)");
    } else if (link && viewer === "guest") {
      parts.push("the Left player's face (their camera can't find it)");
    } else {
      parts.push(`the ${i === 0 ? "Left" : "Right"} player's face (${fix})`);
    }
  }
  return parts.length ? `Waiting for ${parts.join(" and ")}.` : "";
}

function setStartHint(text: string) {
  const el = $("start-hint");
  if (el.textContent !== text) el.textContent = text;
  el.hidden = !text;
}

/** Pressing Start while it's locked flashes the reason instead of doing nothing. */
function flashStartHint() {
  const el = $("start-hint");
  el.classList.remove("flash");
  void el.offsetWidth; // restart the animation
  el.classList.add("flash");
}

function onRemoteMessage(msg: RemoteMsg) {
  if (msg.type === "frame") {
    const face: PlayerFrame = msg.v
      ? { present: true, channels: Float64Array.from(msg.v), landmarks: null, blendshapes: null }
      : absentFace();
    if (link!.isHost) {
      faces[1] = face;
      lastRemoteAt = performance.now();
      feedPlayer(1, msg.t, face);
    } else {
      faces[0] = face;
    }
  } else if (msg.type === "start" && link!.isHost) {
    // (Guest side: a new game's first state, "calibrate", clears the old recap below.)
    startGame();
  } else if (msg.type === "state" && !link!.isHost) {
    hostState = msg;
    hostStateFresh = true;
  } else if (msg.type === "recap" && !link!.isHost) {
    // Forget the last state: it was sent before the recap and still says "round".
    hostState = null;
    showRemoteRecap(msg.recap, msg.samples);
  }
}

/** Guest: mirror the host's screens, HUD and scene. */
function guestTick(dt: number) {
  const st = hostState;
  if (st) {
    // The recap screen is shown when its data arrives (showRemoteRecap), not from state alone.
    if (st.screen !== screen && (st.screen !== "recap" || recap)) show(st.screen);
    presence = st.presence;
    if (st.screen !== "recap") recap = null;
    switch (st.screen) {
      case "lobby":
        for (const i of [0, 1]) $(`check-${i}`).classList.toggle("ok", st.presence[i]);
        $<HTMLButtonElement>("start").disabled = !(st.presence[0] && st.presence[1]);
        setStartHint(st.waiting);
        break;
      case "calibrate":
        $("calib-bar").style.width = `${Math.min(100, (st.screenElapsed / CALIBRATE_MS) * 100)}%`;
        break;
      case "countdown":
        $("countdown-num").textContent = String(Math.max(1, Math.ceil((COUNTDOWN_MS - st.screenElapsed) / 1000)));
        break;
      case "round":
        updatePrompt(st.roundElapsed, st.roundMs);
        break;
    }
    if (hostStateFresh) {
      hostStateFresh = false;
      snap = st.snap;
      displaySync = st.sync;
      hud.update(snap, displaySync);
    }
  }
  const height = st?.height ?? 0;
  $("height").textContent = `${height.toFixed(1)} m`;
  scene.render(dt, { height, sync: displaySync, slipping: screen === "round" && !!snap && !snap.active && height > 0 });
}

/** Links the guest can open. On localhost they'd be useless, so ask the server for this PC's network addresses. */
let guestLinks: { url: string; label: string }[] = [];

async function loadGuestLinks(room: string) {
  const make = (host: string) => `${location.protocol}//${host}${location.port ? `:${location.port}` : ""}${location.pathname}?room=${room}&seat=right`;
  guestLinks = [{ url: make(location.hostname), label: "" }];
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
  try {
    const res = await fetch("/api/addresses", { signal: AbortSignal.timeout(3000) });
    const { addresses } = (await res.json()) as { addresses: { address: string; label: string }[] };
    if (addresses.length) guestLinks = addresses.map((a) => ({ url: make(a.address), label: a.label }));
  } catch {
    // Keep the localhost link; the README explains how to find the address.
  }
}

function updateRemoteInfo(l: RemoteLink) {
  const el = $("remote-info");
  if (l.fatal) {
    $("error-msg").textContent = l.fatal;
    if (screen !== "error") show("error");
    return;
  }
  const you = l.isHost ? "Left" : "Right";
  const links = guestLinks.map((g) => `<br><b>${g.url}</b>${g.label ? ` <span class="muted">(${g.label})</span>` : ""}`).join("");
  const status = !l.connected
    ? "Connecting to the server…"
    : !l.peerConnected
      ? l.isHost
        ? `Waiting for your partner. Send them ${guestLinks.length > 1 ? "the link for a network you share" : "this link"}:${links}`
        : "Waiting for the host…"
      : !l.ready
        ? "Syncing clocks…"
        : `Connected${l.isHost ? "" : ` · clock synced (±${Math.round(l.clock.rtt / 2)} ms)`}`;
  const html = `Remote game · room <b>${l.code}</b> · you are <b>${you}</b><br>${status}`;
  if (el.innerHTML !== html) el.innerHTML = html;
}

let lastFrameT = performance.now();
let lastMeterT = 0;
let lastSnapT = 0;

function tick(now: number) {
  requestAnimationFrame(tick);
  const dt = Math.min(100, now - lastFrameT);
  lastFrameT = now;

  const frame = source.poll(now);
  if (frame && link) {
    onLocalRemoteFrame(frame, link);
  } else if (frame) {
    const [a, b] = frame.players;
    faces[0] = a;
    faces[1] = b;
    presence = [a.present, b.present];
    recorder.push(frame);
    engine.push(frame.t, a.present ? a.channels : null, b.present ? b.channels : null);
    const w = source.kind === "camera" ? video.videoWidth : 1280;
    const h = source.kind === "camera" ? video.videoHeight : 720;
    hud.drawCamera(frame, w, h, source.kind === "sim");
  }
  if (link?.isHost) hostKeepRemoteAlive(now);
  if (link) updateRemoteInfo(link);

  if (now - lastMeterT >= 100) {
    lastMeterT = now;
    updateMeters();
  }

  if (isGuest()) {
    guestTick(dt);
    return;
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
      setStartHint(waitingFor(now));
      break;
    case "calibrate":
      $("calib-bar").style.width = `${Math.min(100, (elapsed / CALIBRATE_MS) * 100)}%`;
      if (elapsed >= CALIBRATE_MS) {
        engine.endCalibration();
        recorder.mark("calibrateEnd", now);
        show("countdown");
      }
      break;
    case "countdown":
      $("countdown-num").textContent = String(Math.max(1, Math.ceil((COUNTDOWN_MS - elapsed) / 1000)));
      if (elapsed >= COUNTDOWN_MS) {
        round = new Round(roundMs);
        recorder.mark("roundStart", now);
        lastPromptIndex = -1;
        show("round");
      }
      break;
    case "round":
      if (!round) break;
      if (fresh && snap) round.record(snap);
      round.update(dt, snap);
      updatePrompt(round.elapsed, round.durationMs);
      if (round.done) finishRound();
      break;
  }
  if (fresh && link?.isHost) broadcastState(now);

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

/** Lets players switch cameras from the lobby (e.g. away from a virtual camera). */
async function setupCameraPicker(currentId: string) {
  const select = $<HTMLSelectElement>("camera-select");
  const count = await fillCameraPicker(select, currentId, async (id) => {
    try {
      const cam = await openCamera(video, { deviceId: id });
      rememberCamera(cam.deviceId);
    } catch (err) {
      $("camera-status").hidden = false;
      $("camera-status").textContent = cameraErrorMessage(err);
    }
  });
  $("camera-row").hidden = count < 2;
}

async function init() {
  show("lobby");
  if (params.get("remote") === "new") {
    params.delete("remote");
    params.set("room", newRoomCode());
    params.set("seat", "left");
    history.replaceState(null, "", `?${params}`);
  }
  const room = params.get("room")?.trim().toUpperCase();
  const seat = params.get("seat") as Seat | null;
  if ((room !== undefined || seat !== null) && !(room && /^[A-Z]{4}$/.test(room) && (seat === "left" || seat === "right"))) {
    // A typo in a shared link must not silently turn into a one-computer game.
    $("error-msg").innerHTML =
      `This remote-game link isn't valid: room codes are 4 letters (got "${(room ?? "").replace(/[<>&"]/g, "")}") and the seat must be left or right. ` +
      `Ask the host to send the link again, or <a href="${location.pathname}">play on this computer</a>.`;
    show("error");
    return;
  }
  if (room && seat) {
    void loadGuestLinks(room);
    link = new RemoteLink(room, seat);
    link.onMessage(onRemoteMessage);
    $("remote-info").hidden = false;
    $("remote-start").hidden = true;
    $("cam-note").hidden = false;
    $("cam-note").textContent = `Remote · room ${room} · you are ${seat === "left" ? "Left" : "Right"}. Video stays on this computer.`;
    video.style.visibility = "hidden"; // both players are shown as avatars
    $("lobby-lede").textContent =
      "You're on two computers. Copy each other's faces; the better you mirror each other, the higher Jack climbs.";
    $("privacy-note").textContent =
      "Video never leaves your computer. Only face measurements (numbers) are sent to your partner.";
  }
  const sim = params.get("sim") as SimMode | null;
  try {
    const replayUrl = params.get("replay");
    if (replayUrl) {
      const rec: Recording = await (await fetch(replayUrl)).json();
      // Accept both a bare recording and the full "Download round data" file.
      const replay = new ReplaySource("frames" in rec ? rec : (rec as { recording: Recording }).recording);
      source = replay;
      roundMs = replay.rec.roundMs;
      $("cam-note").hidden = false;
      $("cam-note").textContent = `Replaying ${replayUrl.split("/").pop()}`;
    } else if (sim && SIM_MODES.includes(sim)) {
      // In a remote test, both sims follow the host's clock so they line up across machines.
      source = new SimSource(sim, link ? (now) => link!.toHost(now) : undefined);
      $("cam-note").hidden = false;
      if (!link) $("cam-note").textContent = `Simulated players: ${sim}`;
    } else {
      $("leader").textContent = "Starting camera…";
      const status = $("camera-status");
      const cam = await openCamera(video, {
        prefer: params.get("camera"),
        onSlow: () => {
          status.hidden = false;
          status.textContent =
            "Waiting for the camera… Look for a camera permission prompt near the address bar and click Allow. If nothing appears, click the camera icon in the address bar.";
        },
      });
      status.hidden = true;
      void setupCameraPicker(cam.deviceId);
      $("leader").textContent = "Loading face tracker…";
      const preferred = params.get("delegate")?.toUpperCase() === "CPU" ? "CPU" : undefined;
      const { landmarker } = await createLandmarker(preferred);
      source = new CameraSource(new FaceTracker(landmarker, video));
      if (params.get("bot") === "1" && !link) {
        // Practice alone: the player is Left, a bot mirrors them on the Right.
        source = new BotSource(source, () => (screen === "round" && round ? round.prompt.card : null));
        video.style.visibility = "hidden"; // both players are shown as avatars
        $("cam-note").hidden = false;
        $("cam-note").textContent = "Practice vs bot · you are Left";
        $("lobby-lede").textContent =
          "Practice mode: you're the Left player. The bot on the Right mirrors you, and leads when the prompt says the Right player leads. Bot rounds stay off the main leaderboard.";
        $("remote-start").hidden = true;
      }
    }
  } catch (err) {
    console.error(err);
    $("error-msg").textContent = cameraErrorMessage(err);
    show("error");
    return;
  }
  $("start").addEventListener("click", () => startGame());
  window.addEventListener("keydown", (e) => {
    // Typing a team name must not start a round.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      startGame();
    } else if (e.code === "KeyF") {
      // Fullscreen for the live demo.
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => {});
    } else if (e.code === "Escape" && !isGuest()) {
      // Abandon the round. startGame() rebuilds the engine, so only display state needs clearing.
      round = null;
      recap = null;
      recorder.finish(0); // discard
      hud.clearHistory();
      scene.reset();
      show("lobby");
    }
  });
  requestAnimationFrame(tick);
  void flushQueue(); // upload rounds saved while the leaderboard was offline
  // A replay starts by itself so its calibration and round line up with the recording.
  if (source instanceof ReplaySource) startGame(true);
}

init();
