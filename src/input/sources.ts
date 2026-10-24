// Where player frames come from: the real camera, or simulated players for
// camera-free development and testing (?sim=...).
import { checkRecording, type Recording } from "../replay/recording";
import { NUM_CHANNELS } from "../signal/channels";
import { Performer, rng } from "../sync/synthetic";
import { FaceTracker, type PlayerFrame, type TrackerFrame } from "../tracking/faceTracker";

export interface FrameSource {
  readonly kind: "camera" | "sim";
  /** Returns a new frame if one is available. */
  poll(now: number): TrackerFrame | null;
}

export class CameraSource implements FrameSource {
  readonly kind = "camera";
  constructor(readonly tracker: FaceTracker) {}
  poll(now: number) {
    return this.tracker.poll(now);
  }
}

/**
 * Simulated players:
 *   mirror       right follows left by 300 ms
 *   swap         left leads for 30 s, then right leads (repeats)
 *   unison       both move together
 *   independent  both move, unrelated
 *   still        two blank faces
 *   solo         only the left player moves
 */
export type SimMode = "mirror" | "swap" | "unison" | "independent" | "still" | "solo";

export class SimSource implements FrameSource {
  readonly kind = "sim";
  private readonly a = new Performer(7, 3_600_000);
  private readonly b = new Performer(8, 3_600_000);
  private readonly noise = rng(3);
  private readonly start = performance.now();
  private lastEmit = -Infinity;

  constructor(readonly mode: SimMode) {}

  poll(now: number): TrackerFrame | null {
    if (now - this.lastEmit < 1000 / 30) return null;
    this.lastEmit = now;
    const t = now - this.start;
    const lag = 300;
    let va: Float64Array | null;
    let vb: Float64Array | null;
    switch (this.mode) {
      case "mirror":
        [va, vb] = [this.a.value(t), this.a.value(t - lag)];
        break;
      case "swap": {
        const leftLeads = Math.floor(t / 30_000) % 2 === 0;
        [va, vb] = leftLeads ? [this.a.value(t), this.a.value(t - lag)] : [this.a.value(t - lag), this.a.value(t)];
        break;
      }
      case "unison":
        [va, vb] = [this.a.value(t), this.a.value(t)];
        break;
      case "independent":
        [va, vb] = [this.a.value(t), this.b.value(t)];
        break;
      case "solo":
        [va, vb] = [this.a.value(t), new Float64Array(NUM_CHANNELS)];
        break;
      default:
        [va, vb] = [new Float64Array(NUM_CHANNELS), new Float64Array(NUM_CHANNELS)];
    }
    const frame = (v: Float64Array): PlayerFrame => {
      for (let c = 0; c < v.length; c++) v[c] += 0.005 * (this.noise() - 0.5);
      return { present: true, channels: v, landmarks: null, blendshapes: null };
    };
    return { t: now, players: [frame(va), frame(vb)] };
  }
}

export const SIM_MODES: SimMode[] = ["mirror", "swap", "unison", "independent", "still", "solo"];

/**
 * Plays a recorded session in real time. Playback starts when `restart()` is
 * called (app.ts calls it when the game starts) and holds the last frame at the end.
 */
export class ReplaySource implements FrameSource {
  readonly kind = "sim";
  private origin = NaN;
  private next = 0;

  constructor(readonly rec: Recording) {
    checkRecording(rec);
  }

  restart(now: number) {
    this.origin = now;
    this.next = 0;
  }

  poll(now: number): TrackerFrame | null {
    if (Number.isNaN(this.origin)) this.restart(now);
    const frames = this.rec.frames;
    if (this.next >= frames.length) return null;
    const f = frames[this.next];
    if (f.t > now - this.origin) return null;
    this.next++;
    const player = (v: number[] | null): PlayerFrame => ({
      present: v !== null,
      channels: v ? Float64Array.from(v) : new Float64Array(NUM_CHANNELS),
      landmarks: null,
      blendshapes: null,
    });
    return { t: this.origin + f.t, players: [player(f.a), player(f.b)] };
  }
}
