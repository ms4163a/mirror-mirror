// Fixed-rate history of both players' channel vectors.
//
// Camera frames arrive at uneven intervals, so incoming samples are linearly
// interpolated onto a fixed grid (default 30 Hz). Cross-correlation lags are
// then whole grid steps. A missing face holds its last value and is marked
// absent, so the engine can refuse to score while someone is out of frame.

export const DEFAULT_RATE_HZ = 30;

export class PlayerHistory {
  readonly values: Float64Array[]; // [channel] ring buffer
  readonly present: Uint8Array;

  constructor(channels: number, readonly capacity: number) {
    this.values = Array.from({ length: channels }, () => new Float64Array(capacity));
    this.present = new Uint8Array(capacity);
  }
}

interface Sample {
  t: number;
  v: Float64Array | null;
}

export class History {
  readonly players: [PlayerHistory, PlayerHistory];
  /** Total grid samples written so far. */
  count = 0;
  /** Time (ms) of the most recent grid sample. */
  lastGridT = NaN;
  readonly dtMs: number;

  // Each player's incoming samples are kept separately, because in remote play
  // they come from different machines and arrive at different times. Grid points
  // are only written once BOTH players have data at or beyond them.
  private streams: [Sample[], Sample[]] = [[], []];
  private held: [Float64Array, Float64Array];

  constructor(
    readonly channels: number,
    readonly capacity = 300,
    readonly rateHz = DEFAULT_RATE_HZ,
  ) {
    this.dtMs = 1000 / rateHz;
    this.players = [new PlayerHistory(channels, capacity), new PlayerHistory(channels, capacity)];
    this.held = [new Float64Array(channels), new Float64Array(channels)];
  }

  reset() {
    this.count = 0;
    this.lastGridT = NaN;
    this.streams = [[], []];
    this.held[0].fill(0);
    this.held[1].fill(0);
  }

  /** Adds one tracker frame with both players. `null` means that player's face was not found. */
  push(t: number, a: Float64Array | null, b: Float64Array | null) {
    this.add(0, t, a);
    this.add(1, t, b);
    this.emit();
  }

  /** Adds one player's sample (remote play). Out-of-order samples are dropped. */
  pushPlayer(player: 0 | 1, t: number, v: Float64Array | null) {
    this.add(player, t, v);
    this.emit();
  }

  /** Time of the newest sample from a player, or NaN. */
  latest(player: 0 | 1): number {
    const s = this.streams[player];
    return s.length ? s[s.length - 1].t : NaN;
  }

  private add(p: 0 | 1, t: number, v: Float64Array | null) {
    const s = this.streams[p];
    if (s.length && t <= s[s.length - 1].t) return;
    s.push({ t, v: v && v.slice() });
  }

  private emit() {
    const [sa, sb] = this.streams;
    if (!sa.length || !sb.length) return;
    const ready = Math.min(sa[sa.length - 1].t, sb[sb.length - 1].t);
    if (Number.isNaN(this.lastGridT)) {
      const g0 = Math.max(sa[0].t, sb[0].t);
      if (g0 > ready) return;
      this.write(g0);
    }
    for (let g = this.lastGridT + this.dtMs; g <= ready; g += this.dtMs) this.write(g);
    // Keep only the last sample at or before the grid (the next left bracket) and newer ones.
    for (const s of this.streams) {
      let i = 0;
      while (i + 1 < s.length && s[i + 1].t <= this.lastGridT) i++;
      if (i > 0) s.splice(0, i);
    }
  }

  private write(g: number) {
    const slot = this.count % this.capacity;
    for (let p = 0; p < 2; p++) {
      const s = this.streams[p];
      // Bracket g with (t0, t1]; exactly at the first sample, use it on both sides.
      let j = 0;
      while (j < s.length && s[j].t < g) j++;
      const right = s[Math.min(j, s.length - 1)];
      const left = j === 0 ? right : s[j - 1];
      const x0 = left.v;
      const x1 = right.v;
      const f = right.t === left.t ? 1 : (g - left.t) / (right.t - left.t);
      const ph = this.players[p];
      const held = this.held[p];
      if (x0 && x1) {
        for (let c = 0; c < this.channels; c++) held[c] = x0[c] + (x1[c] - x0[c]) * f;
      } else if (x1 && f >= 0.5) {
        held.set(x1);
      } else if (x0 && !x1 && f < 0.5) {
        held.set(x0);
      }
      const present = f < 0.5 ? x0 : x1;
      for (let c = 0; c < this.channels; c++) ph.values[c][slot] = held[c];
      ph.present[slot] = present ? 1 : 0;
    }
    this.count++;
    this.lastGridT = g;
  }

  /** Copies the most recent `n` samples (oldest first) of one channel into `out`. */
  window(player: 0 | 1, channel: number, n: number, out: Float64Array): Float64Array {
    const src = this.players[player].values[channel];
    const start = this.count - n;
    for (let i = 0; i < n; i++) out[i] = src[(((start + i) % this.capacity) + this.capacity) % this.capacity];
    return out;
  }

  /** Fraction of the last `n` samples where the player's face was present. */
  presence(player: 0 | 1, n: number): number {
    const pr = this.players[player].present;
    let s = 0;
    for (let i = this.count - n; i < this.count; i++) s += pr[((i % this.capacity) + this.capacity) % this.capacity];
    return s / n;
  }
}
