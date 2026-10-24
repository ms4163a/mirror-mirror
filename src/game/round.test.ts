import { describe, expect, it } from "vitest";
import { SyncEngine } from "../sync/syncEngine";
import { Performer, runScenario, type ScenarioPlayer } from "../sync/synthetic";
import { ROUND_MS } from "./prompts";
import { computeRecap } from "./recap";
import { Round } from "./round";

/** Plays a full round with synthetic players, the way the app loop does. */
function play(players: [ScenarioPlayer, ScenarioPlayer]) {
  const engine = new SyncEngine();
  const round = new Round();
  let lastT = 0;
  let nextSnap = 0;
  runScenario(players, ROUND_MS, (t, a, b) => {
    engine.push(t, a, b);
    let snap = null;
    if (t >= nextSnap) {
      nextSnap = t + 100;
      snap = engine.snapshot();
      if (snap) round.record(snap);
    }
    round.update(t - lastT, snap ?? round.last);
    lastT = t;
  });
  return { round, recap: computeRecap(round.samples, ROUND_MS) };
}

describe("Round + recap", () => {
  it("climbs well when players mirror, with the leader identified", () => {
    const p = new Performer(5, ROUND_MS);
    const { round, recap } = play([{ source: p }, { source: p, delayMs: 300, gain: 0.7, noise: 0.02 }]);
    expect(round.height).toBeGreaterThan(40);
    expect(recap.inSyncShare).toBeGreaterThan(0.6);
    expect(recap.lead.left).toBeGreaterThan(0.7);
    expect(recap.medianLagMs).toBeGreaterThan(200);
    expect(recap.medianLagMs).toBeLessThan(400);
    expect(recap.families.length).toBeGreaterThan(0);
  });

  it("stays on the ground when both faces are still", () => {
    const { round, recap } = play([{ source: null }, { source: null }]);
    expect(round.height).toBe(0);
    expect(recap.meanSync).toBe(0);
    expect(recap.medianLagMs).toBeNull();
  });

  it("barely climbs when players move independently", () => {
    const { round } = play([{ source: new Performer(1, ROUND_MS) }, { source: new Performer(2, ROUND_MS) }]);
    expect(round.height).toBeLessThan(8);
  });
});
