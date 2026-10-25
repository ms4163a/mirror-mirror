import { describe, expect, it } from "vitest";
import type { SyncSnapshot } from "../sync/syncEngine";
import { DEFAULT_CLIMB, Round } from "./round";

const ROUND = 20_000;

const snap = (sync: number, active = true) => ({ sync, active }) as SyncSnapshot;

/**
 * Plays a round with a fixed step size, holding each snapshot for 100 ms like the
 * app does (the engine snapshots at ~10 Hz while the screen steps at 30-60 Hz).
 */
function run(stepMs: number, syncAt: (snapshotIndex: number) => number, active = true) {
  const round = new Round(ROUND);
  let t = 0;
  while (!round.done) {
    round.update(stepMs, snap(syncAt(Math.floor((t + 1e-6) / 100)), active));
    t += stepMs;
  }
  return round;
}

/** About ten rises a round: sync high for 1.2 s, low for 0.8 s, repeating. */
const pulses = (i: number) => (i % 20 < 12 ? 0.9 : 0.1);

describe("Round.update climb", () => {
  it("climbs the same height at 60 Hz and 30 Hz steps", () => {
    const fast = run(100 / 6, pulses).height; // ~16.7 ms
    const slow = run(100 / 3, pulses).height; // ~33.3 ms
    expect(fast).toBeGreaterThan(10);
    expect(Math.abs(fast - slow)).toBeLessThan(0.05);
  });

  it("is also consistent at 120 Hz, and with a slowly rising and falling sync", () => {
    const wave = (i: number) => 0.5 + 0.4 * Math.sin(i / 8);
    const heights = [100 / 12, 100 / 6, 100 / 3].map((ms) => run(ms, wave).height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.05);
  });

  it("stays accurate even with very coarse steps when sync flips quickly", () => {
    // Before the trapezoid climb, a 100 ms step overshot every rise by about 0.06 m over a round.
    const flips = (i: number) => (i % 6 < 3 ? 0.9 : 0.1);
    const fine = run(100 / 12, flips).height;
    const coarse = run(100, flips).height;
    expect(Math.abs(coarse - fine)).toBeLessThan(0.02);
  });

  it("does not climb while sync stays below the threshold", () => {
    expect(run(100 / 6, () => DEFAULT_CLIMB.syncThreshold - 0.05).height).toBe(0);
  });

  it("settles at the climb speed for the steady sync", () => {
    const sync = 0.8;
    const u = (sync - DEFAULT_CLIMB.syncThreshold) / (1 - DEFAULT_CLIMB.syncThreshold);
    const expected = DEFAULT_CLIMB.maxClimb * u * (ROUND / 1000);
    const h = run(100 / 3, () => sync).height;
    // The smoothing delays the start by about 300 ms, so it falls a little short.
    expect(h).toBeLessThan(expected);
    expect(h).toBeGreaterThan(expected - DEFAULT_CLIMB.maxClimb * u * 0.4);
  });
});

describe("Round.update slipping", () => {
  it("slips at the still speed while both players are still, whatever the step", () => {
    for (const ms of [100 / 6, 100 / 3]) {
      const round = new Round(ROUND);
      // Climb for a while first so there is height to lose.
      for (let t = 0; t < 4000; t += ms) round.update(ms, snap(0.9));
      const before = round.height;
      let slipped = 0;
      for (let t = 0; t < 1000 - 1e-6; t += ms) {
        round.update(ms, snap(0, false));
        slipped += ms;
      }
      expect(before - round.height).toBeCloseTo(DEFAULT_CLIMB.stillSlip * (slipped / 1000), 6);
    }
  });

  it("never goes below the ground", () => {
    const round = new Round(ROUND);
    for (let i = 0; i < 100; i++) round.update(100, snap(0, false));
    expect(round.height).toBe(0);
  });
});
