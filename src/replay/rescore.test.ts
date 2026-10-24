import { describe, expect, it } from "vitest";
import { NUM_CHANNELS } from "../signal/channels";
import { Performer, runScenario, type ScenarioPlayer } from "../sync/synthetic";
import type { TrackerFrame } from "../tracking/faceTracker";
import { FrameRecorder, type Recording } from "./recording";
import { rescore } from "./rescore";

const CAL = 4000;
const ROUND = 20000;

/** Records a synthetic session the way app.ts does: calibrate, then a round. */
function record(players: [ScenarioPlayer, ScenarioPlayer]): Recording {
  const rec = new FrameRecorder();
  rec.begin(0);
  rec.mark("calibrateStart", 0);
  runScenario(players, CAL + ROUND + 500, (t, a, b) => {
    if (t >= CAL) rec.mark("calibrateEnd", CAL);
    if (t >= CAL) rec.mark("roundStart", CAL);
    // Players sit still while calibrating.
    const still = t < CAL;
    const frame: TrackerFrame = {
      t,
      players: [
        { present: true, channels: still ? new Float64Array(NUM_CHANNELS) : a, landmarks: null, blendshapes: null },
        { present: true, channels: still ? new Float64Array(NUM_CHANNELS) : b, landmarks: null, blendshapes: null },
      ],
    };
    rec.push(frame);
  });
  return rec.finish(ROUND);
}

describe("record + rescore", () => {
  it("survives a JSON round trip and scores a mirror session well", () => {
    const p = new Performer(4, CAL + ROUND + 1000);
    const rec: Recording = JSON.parse(JSON.stringify(record([{ source: p }, { source: p, delayMs: 300 }])));
    const r = rescore(rec);
    expect(r.recap.durationS).toBe(ROUND / 1000);
    expect(r.recap.inSyncShare).toBeGreaterThan(0.6);
    expect(r.recap.medianLagMs).toBeGreaterThan(200);
    expect(r.height).toBeGreaterThan(10);
  });

  it("lets settings change the outcome (stricter chance level climbs less)", () => {
    const p = new Performer(4, CAL + ROUND + 1000);
    const rec = record([{ source: p }, { source: p, delayMs: 300, gain: 0.6, noise: 0.03 }]);
    const base = rescore(rec).height;
    const strict = rescore(rec, { sync: { chanceR: 0.7 } }).height;
    expect(strict).toBeLessThan(base);
  });

  it("rejects recordings made with a different channel set", () => {
    const rec = record([{ source: null }, { source: null }]);
    rec.channels = rec.channels.slice(1);
    expect(() => rescore(rec)).toThrow(/channels differ/);
  });

  it("stores missing faces as null", () => {
    const rec = new FrameRecorder();
    rec.begin(100);
    rec.push({
      t: 150,
      players: [
        { present: true, channels: new Float64Array(NUM_CHANNELS).fill(0.123456), landmarks: null, blendshapes: null },
        { present: false, channels: new Float64Array(NUM_CHANNELS), landmarks: null, blendshapes: null },
      ],
    });
    const out = rec.finish(60000);
    expect(out.frames[0]).toEqual({ t: 50, a: Array(NUM_CHANNELS).fill(0.1235), b: null });
  });
});
