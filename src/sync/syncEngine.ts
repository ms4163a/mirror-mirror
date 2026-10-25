// Sync engine: windowed, lagged cross-correlation between the two players.
//
// For each channel, a Pearson correlation between player A's window and player
// B's window shifted by k grid steps, for k in [-maxLag, +maxLag]. Channels
// only count when BOTH players are actually moving on them (anti-stillness
// gate). The curves are averaged with those gate weights. The peak height is the
// sync and its position is the lag.
//
// Lag convention: lagMs > 0 means the right player (1) follows the left player
// (0), so the left player leads.
import { CHANNELS, FAMILIES, NUM_CHANNELS, type ChannelDef, type Family } from "../signal/channels";
import { History } from "./history";

export interface SyncOptions {
  rateHz: number;
  windowMs: number;
  maxLagMs: number;
  /** |lag| below this counts as "in unison" (no leader). */
  leaderDeadZoneMs: number;
  /** Peak correlation that unrelated movement typically reaches. Maps to sync 0. */
  chanceR: number;
  /** Sum of gated activity weights needed for full credit. */
  fullActivity: number;
  /** Minimum face presence in the window for a valid snapshot. */
  minPresence: number;
}

export const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  rateHz: 30,
  windowMs: 4000,
  maxLagMs: 1000,
  leaderDeadZoneMs: 80,
  chanceR: 0.25,
  fullActivity: 2,
  minPresence: 0.8,
};

export interface FamilySync {
  family: Family;
  label: string;
  /** 0..1 sync for this expression family, or null if it wasn't used by both. */
  score: number | null;
  /** How much both players moved on this family (gate weight sum). */
  activity: number;
}

export interface SyncSnapshot {
  t: number;
  /** Game-facing sync score, 0..1. Already gated by activity and lag. */
  sync: number;
  /** Peak of the aggregate correlation curve (-1..1) before mapping. */
  peakR: number;
  /** Correlation at zero lag. */
  zeroLagR: number;
  lagMs: number;
  leader: 0 | 1 | null;
  /** True when both players are moving enough for sync to count. */
  active: boolean;
  /** Gated activity weight sum (anti-stillness measure). */
  activity: number;
  /** Each player's own movement level, 0..1. Used for "move!" hints. */
  playerActivity: [number, number];
  presence: [number, number];
  families: FamilySync[];
}

/** 0 below lo, 1 above hi, smooth in between. */
function smoothstep(lo: number, hi: number, x: number) {
  const u = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return u * u * (3 - 2 * u);
}

function std(x: Float64Array) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m += x[i];
  m /= x.length;
  let v = 0;
  for (let i = 0; i < x.length; i++) v += (x[i] - m) * (x[i] - m);
  return Math.sqrt(v / x.length);
}

/** Pearson correlation of x[i] against y[i + k] over their overlap. */
export function laggedCorr(x: Float64Array, y: Float64Array, k: number): number {
  const n = x.length;
  const i0 = Math.max(0, -k);
  const i1 = Math.min(n, n - k);
  const m = i1 - i0;
  if (m < 3) return 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = i0; i < i1; i++) {
    const a = x[i];
    const b = y[i + k];
    sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b;
  }
  const cov = sxy - (sx * sy) / m;
  const vx = sxx - (sx * sx) / m;
  const vy = syy - (sy * sy) / m;
  if (vx <= 1e-12 || vy <= 1e-12) return 0;
  return cov / Math.sqrt(vx * vy);
}

/** Sub-sample peak position from three points around the max. */
function parabolicOffset(ym: number, y0: number, yp: number) {
  const d = ym - 2 * y0 + yp;
  return d === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (ym - yp)) / d));
}

export class SyncEngine {
  readonly opts: SyncOptions;
  readonly history: History;
  readonly windowN: number;
  readonly maxLag: number;
  /** Per player per channel "moving" floor. Starts at defaults, raised by calibration. */
  readonly floors: [Float64Array, Float64Array];

  private readonly xa: Float64Array;
  private readonly xb: Float64Array;
  private readonly curves: Float64Array[]; // [channel][lag]
  private calib: { start: number } | null = null;

  constructor(opts: Partial<SyncOptions> = {}, readonly channels: ChannelDef[] = CHANNELS) {
    this.opts = { ...DEFAULT_SYNC_OPTIONS, ...opts };
    this.windowN = Math.round((this.opts.windowMs / 1000) * this.opts.rateHz);
    this.maxLag = Math.round((this.opts.maxLagMs / 1000) * this.opts.rateHz);
    this.history = new History(channels.length, Math.max(this.windowN * 3, 300), this.opts.rateHz);
    const f = Float64Array.from(channels.map((c) => c.floor));
    this.floors = [f.slice(), f.slice()];
    this.xa = new Float64Array(this.windowN);
    this.xb = new Float64Array(this.windowN);
    this.curves = channels.map(() => new Float64Array(2 * this.maxLag + 1));
  }

  push(t: number, a: Float64Array | null, b: Float64Array | null) {
    this.history.push(t, a, b);
  }

  /** One player's sample, for remote play where the two streams arrive separately. */
  pushPlayer(player: 0 | 1, t: number, v: Float64Array | null) {
    this.history.pushPlayer(player, t, v);
  }

  /** Begins collecting a neutral-face baseline (players sit still, faces relaxed). */
  startCalibration() {
    this.calib = { start: this.history.count };
  }

  /**
   * Ends calibration. Each channel's floor becomes max(default, 3x the measured
   * noise), capped at 3x the default so a fidgety calibration can't switch a
   * channel off.
   */
  endCalibration() {
    if (!this.calib) return;
    const n = Math.min(this.history.count - this.calib.start, this.history.capacity);
    this.calib = null;
    if (n < 10) return;
    const buf = new Float64Array(n);
    for (let p = 0 as 0 | 1; p < 2; p = (p + 1) as 0 | 1) {
      this.channels.forEach((ch, c) => {
        const noise = std(this.history.window(p, c, n, buf));
        this.floors[p][c] = Math.min(ch.floor * 3, Math.max(ch.floor, noise * 3));
      });
    }
  }

  ready() {
    return this.history.count >= this.windowN;
  }

  snapshot(): SyncSnapshot | null {
    if (!this.ready()) return null;
    const { history: h, windowN: n, maxLag: L, channels } = this;
    const presence: [number, number] = [h.presence(0, n), h.presence(1, n)];

    const weights = new Float64Array(channels.length);
    const own: [number, number] = [0, 0];
    let ownNorm = 0;
    let activity = 0;

    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      h.window(0, c, n, this.xa);
      h.window(1, c, n, this.xb);
      // Each player's movement gate opens between 1x and 2x their floor.
      const ga = smoothstep(1, 2, std(this.xa) / this.floors[0][c]);
      const gb = smoothstep(1, 2, std(this.xb) / this.floors[1][c]);
      const both = Math.min(ga, gb);
      // A channel counts if EITHER player moves on it. If only one does, it adds
      // weight but no correlation, so a mismatched expression lowers the score.
      // Counting only shared channels would reward two people making different
      // faces whenever they overlap by chance.
      weights[c] = Math.max(ga, gb) * ch.weight;
      if (ch.countsAsActivity) {
        activity += both * ch.weight;
        own[0] += ga * ch.weight;
        own[1] += gb * ch.weight;
        ownNorm += ch.weight;
      }
      const curve = this.curves[c];
      if (both > 0) {
        for (let k = -L; k <= L; k++) curve[k + L] = both * laggedCorr(this.xa, this.xb, k);
      } else {
        curve.fill(0);
      }
    }

    const agg = this.combine(weights, () => true);
    let best = 0;
    for (let i = 1; i < agg.curve.length; i++) if (agg.curve[i] > agg.curve[best]) best = i;
    const off =
      best > 0 && best < agg.curve.length - 1
        ? parabolicOffset(agg.curve[best - 1], agg.curve[best], agg.curve[best + 1])
        : 0;
    const lagMs = agg.weight > 0 ? ((best - L + off) / this.opts.rateHz) * 1000 : 0;
    const peakR = agg.weight > 0 ? agg.curve[best] : 0;
    const zeroLagR = agg.weight > 0 ? agg.curve[L] : 0;

    const valid = presence[0] >= this.opts.minPresence && presence[1] >= this.opts.minPresence;
    const active = valid && activity >= 0.5;
    const activityFactor = Math.min(1, activity / this.opts.fullActivity);
    // Following within the lag range is still mirroring, but a long lag is worth a bit less.
    const lagFactor = 1 - 0.4 * Math.min(1, Math.abs(lagMs) / this.opts.maxLagMs);
    const mapped = Math.max(0, Math.min(1, (peakR - this.opts.chanceR) / (1 - this.opts.chanceR)));
    const sync = active ? mapped * activityFactor * lagFactor : 0;

    let leader: 0 | 1 | null = null;
    if (active && mapped > 0 && Math.abs(lagMs) > this.opts.leaderDeadZoneMs) leader = lagMs > 0 ? 0 : 1;

    const families: FamilySync[] = FAMILIES.map(({ id, label }) => {
      const fam = this.combine(weights, (ch) => ch.family === id);
      let peak = -1;
      for (let i = 0; i < fam.curve.length; i++) peak = Math.max(peak, fam.curve[i]);
      const score =
        valid && fam.weight >= 0.5
          ? Math.max(0, Math.min(1, (peak - this.opts.chanceR) / (1 - this.opts.chanceR)))
          : null;
      return { family: id, label, score, activity: fam.weight };
    });

    return {
      t: h.lastGridT,
      sync,
      peakR,
      zeroLagR,
      lagMs,
      leader,
      active,
      activity,
      playerActivity: [own[0] / ownNorm, own[1] / ownNorm],
      presence,
      families,
    };
  }

  /** Weighted average of channel curves for channels passing `filter`. */
  private combine(weights: Float64Array, filter: (ch: ChannelDef) => boolean) {
    const curve = new Float64Array(2 * this.maxLag + 1);
    let weight = 0;
    this.channels.forEach((ch, c) => {
      const w = weights[c];
      if (w <= 0 || !filter(ch)) return;
      weight += w;
      const src = this.curves[c];
      for (let i = 0; i < curve.length; i++) curve[i] += w * src[i];
    });
    if (weight > 0) for (let i = 0; i < curve.length; i++) curve[i] /= weight;
    return { curve, weight };
  }
}

export { NUM_CHANNELS };
