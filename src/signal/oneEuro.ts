// One Euro filter (Casiez, Roussel & Vogel, CHI 2012): an adaptive low-pass
// filter for noisy real-time signals. It smooths hard while a value moves
// slowly (kills tracker jitter) and lightly while it moves fast (keeps lag low).
//
// Webcam blendshapes jitter frame to frame, more so with dim light or a weak
// camera. In playtesting one player's readings jumped ~3x more than the other's.

export interface OneEuroParams {
  /** Cutoff (Hz) at rest. Lower = smoother when still. */
  minCutoff: number;
  /** How quickly the cutoff rises with speed. Higher = less lag on fast moves. */
  beta: number;
  /** Cutoff (Hz) for the speed estimate. */
  dCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroParams = { minCutoff: 1.5, beta: 2, dCutoff: 1 };

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

/** Filters a vector of channels sampled at irregular times (ms). */
export class OneEuroVector {
  private x: Float64Array | null = null;
  private dx: Float64Array;
  private lastT = NaN;

  constructor(
    readonly size: number,
    readonly params: OneEuroParams = DEFAULT_ONE_EURO,
  ) {
    this.dx = new Float64Array(size);
  }

  reset() {
    this.x = null;
    this.dx.fill(0);
    this.lastT = NaN;
  }

  /** Filters `v` in place and returns it. */
  filter(t: number, v: Float64Array): Float64Array {
    if (!this.x || !(t > this.lastT) || t - this.lastT > 500) {
      // First sample, out-of-order time, or a long gap (face was lost): restart.
      this.x = v.slice();
      this.dx.fill(0);
      this.lastT = t;
      return v;
    }
    const dt = (t - this.lastT) / 1000;
    this.lastT = t;
    const { minCutoff, beta, dCutoff } = this.params;
    const ad = alpha(dCutoff, dt);
    for (let i = 0; i < this.size; i++) {
      const rawDx = (v[i] - this.x[i]) / dt;
      this.dx[i] += ad * (rawDx - this.dx[i]);
      const a = alpha(minCutoff + beta * Math.abs(this.dx[i]), dt);
      this.x[i] += a * (v[i] - this.x[i]);
      v[i] = this.x[i];
    }
    return v;
  }
}
