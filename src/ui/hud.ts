// Live readouts beside the scene: camera with face outlines, sync meter, leader
// indicator, lag graph and per-expression breakdown. They show the measurements
// directly, so the game doesn't read as a face filter.
import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { CHANNELS, FAMILIES, type Family } from "../signal/channels";
import type { FamilyLevels } from "../signal/meter";
import "./hud.css";
import type { SyncSnapshot } from "../sync/syncEngine";
import type { TrackerFrame } from "../tracking/faceTracker";

export const PLAYER_COLORS = ["#e8552a", "#2f9fdc"] as const;
export const PLAYER_NAMES = ["Left", "Right"] as const;

const LAG_WINDOW_MS = 15_000;
const LAG_RANGE_MS = 1000;
const DEAD_ZONE_MS = 80;

function fitCanvas(c: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const r = c.getBoundingClientRect();
  const w = Math.round(r.width * dpr);
  const h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return dpr;
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export class Hud {
  private readonly lagHist: { t: number; lag: number; sync: number; active: boolean }[] = [];
  private readonly famRows = new Map<string, { bar: HTMLElement; val: HTMLElement; row: HTMLElement; seen: [HTMLElement, HTMLElement] }>();
  private readonly camCtx: CanvasRenderingContext2D;
  private readonly lagCtx: CanvasRenderingContext2D;

  constructor(
    private readonly el: {
      camOverlay: HTMLCanvasElement;
      syncValue: HTMLElement;
      syncBar: HTMLElement;
      leader: HTMLElement;
      lagGraph: HTMLCanvasElement;
      families: HTMLElement;
    },
  ) {
    this.camCtx = el.camOverlay.getContext("2d")!;
    this.lagCtx = el.lagGraph.getContext("2d")!;
    const legend = document.createElement("div");
    legend.className = "fam-legend";
    legend.innerHTML = `<span></span><span title="How strongly the camera reads it on each of you">seen <b class="p0">L</b> <b class="p1">R</b></span><span>match</span><span></span>`;
    el.families.appendChild(legend);
    for (const f of FAMILIES) {
      // A family with no weighted channels (blinks only) can never score, so don't show it.
      if (!CHANNELS.some((c) => c.family === f.id && c.weight > 0)) continue;
      const row = document.createElement("div");
      row.className = "fam";
      row.innerHTML = `<span class="fam-label">${f.label}</span><span class="fam-seen"><span><i></i></span><span><i></i></span></span><span class="fam-track"><span class="fam-bar"></span></span><span class="fam-val">–</span>`;
      el.families.appendChild(row);
      const seen = row.querySelectorAll<HTMLElement>(".fam-seen i");
      this.famRows.set(f.id, {
        row,
        bar: row.querySelector(".fam-bar")!,
        val: row.querySelector(".fam-val")!,
        seen: [seen[0], seen[1]],
      });
    }
  }

  clearHistory() {
    this.lagHist.length = 0;
  }

  /** Face outlines on the camera preview, or cartoon faces for simulated players. */
  drawCamera(frame: TrackerFrame, videoW: number, videoH: number, simulated: boolean) {
    const c = this.el.camOverlay;
    if (c.width !== videoW || c.height !== videoH) {
      c.width = videoW;
      c.height = videoH;
    }
    const ctx = this.camCtx;
    ctx.clearRect(0, 0, videoW, videoH);
    frame.players.forEach((p, i) => {
      if (simulated) {
        this.drawSimFace(ctx, p.channels, i === 0 ? videoW * 0.7 : videoW * 0.3, videoH / 2, videoH * 0.28, i);
        return;
      }
      if (!p.landmarks) return;
      ctx.beginPath();
      for (const { start, end } of FaceLandmarker.FACE_LANDMARKS_FACE_OVAL) {
        ctx.moveTo(p.landmarks[start].x * videoW, p.landmarks[start].y * videoH);
        ctx.lineTo(p.landmarks[end].x * videoW, p.landmarks[end].y * videoH);
      }
      ctx.lineWidth = 7;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.stroke();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = PLAYER_COLORS[i];
      ctx.stroke();
    });
  }

  /** Simple face driven by the channels, drawn in raw (unmirrored) coords. */
  private drawSimFace(ctx: CanvasRenderingContext2D, ch: Float64Array, x: number, y: number, r: number, i: number) {
    const v = (name: string) => ch[CHANNELS.findIndex((c) => c.name === name)] ?? 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(v("headRoll") * 0.3);
    ctx.lineWidth = r * 0.06;
    ctx.strokeStyle = PLAYER_COLORS[i];
    ctx.fillStyle = "#2a2c3a";
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.8, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#e8e8ef";
    // Brows are drawn as angled lines: the inner end drops (and the outer end lifts)
    // for an angry scowl, and the inner end rises for a worried/surprised look.
    const lift = (v("browInnerUp") + v("browOuterUp")) * r * 0.2;
    const angry = this.angryLevel(i, v("browDown"));
    const innerDrop = angry * r * 0.14 - v("browInnerUp") * r * 0.12;
    const outerLift = angry * r * 0.04 + v("browOuterUp") * r * 0.05;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.5, -r * 0.35 - lift - outerLift);
      ctx.lineTo(s * r * 0.15, -r * 0.4 - lift + innerDrop);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(s * r * 0.32, -r * 0.15, r * 0.1, r * 0.1 * (1 - 0.9 * v("eyeBlink")) + 1, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const open = v("jawOpen") * r * 0.5 + 2;
    const smile = (v("smile") - v("mouthFrown")) * r * 0.3;
    const wMouth = r * (0.4 - 0.25 * v("mouthPucker"));
    ctx.beginPath();
    ctx.moveTo(-wMouth, r * 0.4 - smile);
    ctx.quadraticCurveTo(0, r * 0.4 + smile + open, wMouth, r * 0.4 - smile);
    ctx.quadraticCurveTo(0, r * 0.4 + smile - open * 0.2, -wMouth, r * 0.4 - smile);
    ctx.stroke();
    ctx.restore();
  }

  /** Live per-player expression levels (what the camera reads), updated every frame batch. */
  updateSeen(levels: [FamilyLevels, FamilyLevels]) {
    for (const [id, row] of this.famRows) {
      for (const p of [0, 1] as const) row.seen[p].style.width = `${Math.round(levels[p][id as Family] * 100)}%`;
    }
  }

  // Per-player brow scaling for the cartoon faces: some faces only ever read a
  // small browDown, so tilt relative to that player's own resting level and
  // observed range, with a dead zone and smoothing so a neutral face stays still.
  private readonly browRest = [NaN, NaN];
  private readonly browPeak = [0, 0];
  private readonly browShown = [0, 0];

  private angryLevel(p: number, v: number): number {
    if (Number.isNaN(this.browRest[p])) this.browRest[p] = v;
    // Resting level follows drops at once and rises only slowly (about 15 s).
    this.browRest[p] = v < this.browRest[p] ? v : this.browRest[p] + (v - this.browRest[p]) * 0.002;
    // Peak follows rises at once and decays slowly toward rest.
    this.browPeak[p] = Math.max(v, this.browRest[p] + (this.browPeak[p] - this.browRest[p]) * 0.999);
    const span = Math.max(0.12, this.browPeak[p] - this.browRest[p]);
    const level = Math.max(0, Math.min(1, (v - this.browRest[p]) / span));
    const target = Math.max(0, (level - 0.25) / 0.75); // dead zone for jitter
    this.browShown[p] += (target - this.browShown[p]) * 0.2;
    return this.browShown[p];
  }

  update(snap: SyncSnapshot | null, displaySync: number) {
    const pct = Math.round(displaySync * 100);
    this.el.syncValue.textContent = `${pct}%`;
    this.el.syncBar.style.width = `${pct}%`;
    this.el.leader.innerHTML = this.leaderText(snap);

    if (snap) {
      this.lagHist.push({ t: snap.t, lag: snap.lagMs, sync: snap.sync, active: snap.active && snap.sync > 0 });
      while (this.lagHist.length && this.lagHist[0].t < snap.t - LAG_WINDOW_MS) this.lagHist.shift();
      for (const f of snap.families) {
        const row = this.famRows.get(f.family);
        if (!row) continue;
        const used = f.score !== null;
        row.row.classList.toggle("unused", !used);
        row.bar.style.width = used ? `${Math.round(f.score! * 100)}%` : "0";
        row.val.textContent = used ? `${Math.round(f.score! * 100)}%` : "–";
      }
    }
    this.drawLagGraph();
  }

  private leaderText(s: SyncSnapshot | null): string {
    const tag = (i: 0 | 1) => `<b class="p${i}">${PLAYER_NAMES[i]}</b>`;
    if (!s) return "Warming up…";
    if (s.presence[0] < 0.8 || s.presence[1] < 0.8) {
      const missing = [0, 1].filter((i) => s.presence[i] < 0.8) as (0 | 1)[];
      return `${missing.map(tag).join(" &amp; ")}: get in the camera`;
    }
    if (!s.active) {
      const still = [0, 1].filter((i) => s.playerActivity[i] < 0.08) as (0 | 1)[];
      if (still.length === 1) return `${tag(still[0])}: move your face!`;
      return "Both of you: make some faces!";
    }
    if (s.sync === 0) return "Different faces — try copying";
    const ms = Math.round(Math.abs(s.lagMs));
    if (s.leader === null) return `In unison <span class="muted">(${ms} ms)</span>`;
    const follower = (1 - s.leader) as 0 | 1;
    return `${tag(s.leader)} leads · ${tag(follower)} follows <span class="muted">${ms} ms behind</span>`;
  }

  private drawLagGraph() {
    const c = this.el.lagGraph;
    const dpr = fitCanvas(c);
    const ctx = this.lagCtx;
    const w = c.width;
    const h = c.height;
    const padL = 64 * dpr;
    const padR = 8 * dpr;
    const plotW = w - padL - padR;
    ctx.clearRect(0, 0, w, h);
    const yOf = (lag: number) => h / 2 - (Math.max(-LAG_RANGE_MS, Math.min(LAG_RANGE_MS, lag)) / LAG_RANGE_MS) * (h / 2 - 6 * dpr);

    // Unison band and grid
    const grid = cssVar("--grid");
    const muted = cssVar("--muted");
    ctx.fillStyle = grid;
    ctx.fillRect(padL, yOf(DEAD_ZONE_MS), plotW, yOf(-DEAD_ZONE_MS) - yOf(DEAD_ZONE_MS));
    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = muted;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillText("Left leads", padL - 6 * dpr, yOf(700));
    ctx.fillText("unison", padL - 6 * dpr, yOf(0));
    ctx.fillText("Right leads", padL - 6 * dpr, yOf(-700));
    ctx.strokeStyle = grid;
    ctx.lineWidth = dpr;
    for (const l of [-1000, -500, 500, 1000]) {
      ctx.beginPath();
      ctx.moveTo(padL, yOf(l));
      ctx.lineTo(w - padR, yOf(l));
      ctx.stroke();
    }

    const pts = this.lagHist;
    if (!pts.length) return;
    const tEnd = pts[pts.length - 1].t;
    const xOf = (t: number) => padL + plotW * (1 - (tEnd - t) / LAG_WINDOW_MS);
    ctx.lineWidth = 2 * dpr;
    ctx.lineCap = "round";
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a.active || !b.active) continue;
      const lag = (a.lag + b.lag) / 2;
      ctx.strokeStyle =
        lag > DEAD_ZONE_MS ? PLAYER_COLORS[0] : lag < -DEAD_ZONE_MS ? PLAYER_COLORS[1] : cssVar("--text");
      ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, b.sync * 1.5);
      ctx.beginPath();
      ctx.moveTo(xOf(a.t), yOf(a.lag));
      ctx.lineTo(xOf(b.t), yOf(b.lag));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const last = pts[pts.length - 1];
    if (last.active) {
      ctx.fillStyle = cssVar("--text");
      ctx.beginPath();
      ctx.arc(xOf(last.t), yOf(last.lag), 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
