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

export class History {
  readonly players: [PlayerHistory, PlayerHistory];
  /** Total grid samples written so far. */
  count = 0;
  /** Time (ms) of the most recent grid sample. */
  lastGridT = NaN;
  readonly dtMs: number;

  private prevT = NaN;
  private prev: [Float64Array | null, Float64Array | null] = [null, null];
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
    this.prevT = NaN;
    this.prev = [null, null];
    this.held[0].fill(0);
    this.held[1].fill(0);
  }

  /** Adds one tracker frame. `null` means that player's face was not found. */
  push(t: number, a: Float64Array | null, b: Float64Array | null) {
    const cur: [Float64Array | null, Float64Array | null] = [a, b];
    if (Number.isNaN(this.prevT)) {
      this.prevT = t;
      this.prev = [a && a.slice(), b && b.slice()];
      this.write(t, cur, cur, 1);
      return;
    }
    if (t <= this.prevT) return;
    // Emit every grid point in (lastGridT, t].
    for (let g = this.lastGridT + this.dtMs; g <= t; g += this.dtMs) {
      const f = (g - this.prevT) / (t - this.prevT);
      this.write(g, this.prev, cur, f);
    }
    this.prevT = t;
    this.prev = [a && a.slice(), b && b.slice()];
  }

  private write(g: number, from: (Float64Array | null)[], to: (Float64Array | null)[], f: number) {
    const slot = this.count % this.capacity;
    for (let p = 0; p < 2; p++) {
      const ph = this.players[p];
      const x0 = from[p];
      const x1 = to[p];
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
