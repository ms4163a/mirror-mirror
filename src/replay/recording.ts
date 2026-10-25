// Raw-frame recordings of real play sessions. Recordings let us tune the sync
// engine on real faces offline: replay a session through the live game
// (?replay=<url>) or re-score it with different settings (rescore.ts).
import { CHANNELS } from "../signal/channels";
import type { PlayerFrame, TrackerFrame } from "../tracking/faceTracker";

export interface RecordedFrame {
  /** ms since the recording started */
  t: number;
  /**
   * Channel vectors, rounded to 4 decimals; null when the face was missing.
   * Left out (undefined) when the frame carries only the other player's sample,
   * which happens in remote play, where the two streams arrive separately.
   */
  a?: number[] | null;
  b?: number[] | null;
}

export interface RecordingMarks {
  calibrateStart?: number;
  calibrateEnd?: number;
  roundStart?: number;
  roundEnd?: number;
}

export interface Recording {
  version: 1;
  /** Channel names in vector order, to catch mismatches after channel changes. */
  channels: string[];
  roundMs: number;
  marks: RecordingMarks;
  frames: RecordedFrame[];
}

const round4 = (v: Float64Array) => Array.from(v, (x) => Math.round(x * 1e4) / 1e4);

export class FrameRecorder {
  private start = NaN;
  private frames: RecordedFrame[] = [];
  private marks: RecordingMarks = {};

  begin(now: number) {
    this.start = now;
    this.frames = [];
    this.marks = {};
  }

  get active() {
    return !Number.isNaN(this.start);
  }

  push(frame: TrackerFrame) {
    if (!this.active) return;
    const [a, b] = frame.players;
    this.frames.push({
      t: Math.round((frame.t - this.start) * 10) / 10,
      a: a.present ? round4(a.channels) : null,
      b: b.present ? round4(b.channels) : null,
    });
  }

  /** One player's sample (remote play). `t` must be on the same clock as `begin()`. */
  pushPlayer(player: 0 | 1, t: number, face: PlayerFrame) {
    if (!this.active) return;
    const v = face.present ? round4(face.channels) : null;
    const f: RecordedFrame = { t: Math.round((t - this.start) * 10) / 10 };
    if (player === 0) f.a = v;
    else f.b = v;
    this.frames.push(f);
  }

  mark(name: keyof RecordingMarks, now: number) {
    if (this.active) this.marks[name] = Math.round(now - this.start);
  }

  finish(roundMs: number): Recording {
    const rec: Recording = {
      version: 1,
      channels: CHANNELS.map((c) => c.name),
      roundMs,
      marks: { ...this.marks },
      frames: this.frames,
    };
    this.start = NaN;
    this.frames = [];
    return rec;
  }
}

/** Throws if the recording can't be fed to the current engine. */
export function checkRecording(rec: Recording) {
  if (rec.version !== 1) throw new Error(`Unsupported recording version ${rec.version}`);
  const names = CHANNELS.map((c) => c.name);
  if (rec.channels.join(",") !== names.join(",")) {
    throw new Error("Recording channels differ from the current channel set");
  }
}
