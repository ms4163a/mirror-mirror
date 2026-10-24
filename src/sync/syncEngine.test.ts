import { describe, expect, it } from "vitest";
import { History } from "./history";
import { SyncEngine, laggedCorr, type SyncSnapshot } from "./syncEngine";
import { Performer, runScenario, type ScenarioPlayer } from "./synthetic";

const DURATION = 20000;

/** Runs a scenario and returns a snapshot every 100 ms after warm-up. */
function simulate(players: [ScenarioPlayer, ScenarioPlayer], opts: { fps?: number; seed?: number } = {}) {
  const engine = new SyncEngine();
  const snaps: SyncSnapshot[] = [];
  let next = 0;
  runScenario(
    players,
    DURATION,
    (t, a, b) => {
      engine.push(t, a, b);
      if (t >= next) {
        next = t + 100;
        const s = engine.snapshot();
        if (s) snaps.push(s);
      }
    },
    opts,
  );
  return snaps;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe("laggedCorr", () => {
  it("finds the shift of a delayed copy", () => {
    const x = Float64Array.from({ length: 120 }, (_, i) => Math.sin(i / 5) + Math.sin(i / 13));
    const y = Float64Array.from({ length: 120 }, (_, i) => Math.sin((i - 6) / 5) + Math.sin((i - 6) / 13));
    let best = -99;
    let bestK = 0;
    for (let k = -30; k <= 30; k++) {
      const r = laggedCorr(x, y, k);
      if (r > best) [best, bestK] = [r, k];
    }
    expect(bestK).toBe(6);
    expect(best).toBeGreaterThan(0.99);
  });

  it("returns 0 for a constant signal instead of NaN", () => {
    expect(laggedCorr(new Float64Array(50), Float64Array.from({ length: 50 }, (_, i) => i), 0)).toBe(0);
  });
});

describe("History", () => {
  it("resamples jittery frames onto the grid with interpolation", () => {
    const h = new History(1, 100, 30);
    h.push(0, Float64Array.of(0), Float64Array.of(0));
    h.push(50, Float64Array.of(50), Float64Array.of(-50));
    h.push(100, Float64Array.of(100), Float64Array.of(-100));
    expect(h.count).toBe(4); // t = 0, 33.3, 66.7, 100
    const w = h.window(0, 0, 4, new Float64Array(4));
    expect(Array.from(w).map((v) => Math.round(v))).toEqual([0, 33, 67, 100]);
    expect(h.presence(1, 4)).toBe(1);
  });

  it("marks a missing face as absent and holds its last value", () => {
    const h = new History(1, 100, 30);
    h.push(0, Float64Array.of(1), Float64Array.of(1));
    h.push(200, Float64Array.of(1), null);
    expect(h.presence(1, 7)).toBeLessThan(0.5);
    expect(h.window(1, 0, 1, new Float64Array(1))[0]).toBe(1);
  });
});

describe("SyncEngine", () => {
  const leaderPerf = () => new Performer(1, DURATION);

  it("scores a delayed mirror highly and recovers lag and leader (left leads)", () => {
    const p = leaderPerf();
    const snaps = simulate([{ source: p }, { source: p, delayMs: 250, gain: 0.8, noise: 0.02 }]);
    expect(mean(snaps.map((s) => s.sync))).toBeGreaterThan(0.6);
    expect(Math.abs(median(snaps.map((s) => s.lagMs)) - 250)).toBeLessThan(40);
    const leaders = snaps.map((s) => s.leader);
    expect(leaders.filter((l) => l === 0).length / leaders.length).toBeGreaterThan(0.8);
  });

  it("detects the right player leading", () => {
    const p = leaderPerf();
    const snaps = simulate([{ source: p, delayMs: 400 }, { source: p }]);
    expect(Math.abs(median(snaps.map((s) => s.lagMs)) + 400)).toBeLessThan(40);
    expect(snaps.filter((s) => s.leader === 1).length / snaps.length).toBeGreaterThan(0.8);
  });

  it("calls near-simultaneous movement unison (no leader)", () => {
    const p = leaderPerf();
    const snaps = simulate([{ source: p }, { source: p, delayMs: 20 }]);
    expect(snaps.filter((s) => s.leader === null).length / snaps.length).toBeGreaterThan(0.8);
    expect(mean(snaps.map((s) => s.sync))).toBeGreaterThan(0.7);
  });

  it("gives two still faces zero sync (anti-stillness)", () => {
    const snaps = simulate([{ source: null }, { source: null }]);
    expect(Math.max(...snaps.map((s) => s.sync))).toBe(0);
    expect(snaps.every((s) => !s.active)).toBe(true);
  });

  it("gives zero sync when only one player moves", () => {
    const snaps = simulate([{ source: leaderPerf() }, { source: null }]);
    expect(Math.max(...snaps.map((s) => s.sync))).toBe(0);
    const last = snaps[snaps.length - 1];
    expect(last.playerActivity[0]).toBeGreaterThan(last.playerActivity[1]);
  });

  it("keeps independent movement well below mirroring", () => {
    const snaps = simulate([{ source: new Performer(11, DURATION) }, { source: new Performer(22, DURATION) }]);
    const s = mean(snaps.map((x) => x.sync));
    expect(s).toBeLessThan(0.3);
  });

  it("reports per-family scores only for families both players used", () => {
    const p = leaderPerf();
    const snaps = simulate([{ source: p }, { source: p, delayMs: 100 }]);
    const fams = snaps[snaps.length - 1].families;
    expect(fams.some((f) => f.score !== null && f.score > 0.5)).toBe(true);
    expect(fams.some((f) => f.score === null)).toBe(true);
  });

  it("raises floors after a fidgety-free calibration but caps them", () => {
    const engine = new SyncEngine();
    engine.startCalibration();
    runScenario([{ source: null, noise: 0.05 }, { source: null }], 5000, (t, a, b) => engine.push(t, a, b));
    engine.endCalibration();
    expect(engine.floors[0][0]).toBeCloseTo(0.09, 5); // capped at 3x default 0.03
    expect(engine.floors[1][0]).toBeCloseTo(0.03, 5); // quiet face keeps the default
  });
});
