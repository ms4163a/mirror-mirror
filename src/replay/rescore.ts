// Re-scores a recording offline with any engine/climb settings, exactly the
// way the live app does: calibrate on the calibration frames, then a round
// with a snapshot every 100 ms.
import { computeRecap, type Recap } from "../game/recap";
import { Round, type ClimbTuning, DEFAULT_CLIMB, type RoundSample } from "../game/round";
import { SyncEngine, type SyncOptions } from "../sync/syncEngine";
import { checkRecording, type Recording } from "./recording";

export const SNAPSHOT_EVERY_MS = 100;

export interface RescoreResult {
  samples: RoundSample[];
  recap: Recap;
  height: number;
}

export function rescore(
  rec: Recording,
  opts: { sync?: Partial<SyncOptions>; climb?: ClimbTuning } = {},
): RescoreResult {
  checkRecording(rec);
  const engine = new SyncEngine(opts.sync);
  const round = new Round(rec.roundMs, opts.climb ?? DEFAULT_CLIMB);
  const { calibrateStart = 0, calibrateEnd, roundStart = 0 } = rec.marks;

  let calibrating = false;
  let lastT: number | null = null;
  let nextSnap = roundStart;

  for (const f of rec.frames) {
    if (!calibrating && calibrateEnd !== undefined && f.t >= calibrateStart && f.t < calibrateEnd) {
      engine.startCalibration();
      calibrating = true;
    }
    if (calibrating && calibrateEnd !== undefined && f.t >= calibrateEnd) {
      engine.endCalibration();
      calibrating = false;
    }
    const vec = (x: number[] | null) => x && Float64Array.from(x);
    if (f.a !== undefined && f.b !== undefined) engine.push(f.t, vec(f.a), vec(f.b));
    else if (f.a !== undefined) engine.pushPlayer(0, f.t, vec(f.a));
    else if (f.b !== undefined) engine.pushPlayer(1, f.t, vec(f.b));
    if (f.t < roundStart) continue;

    let snap = null;
    if (f.t >= nextSnap) {
      nextSnap = f.t + SNAPSHOT_EVERY_MS;
      snap = engine.snapshot();
      if (snap) round.record(snap);
    }
    round.update(lastT === null ? 0 : f.t - lastT, snap ?? round.last);
    lastT = f.t;
    if (round.done) break;
  }
  const recap = { ...computeRecap(round.samples, round.durationMs), height: round.height }; // same as app.ts
  return { samples: round.samples, recap, height: round.height };
}
