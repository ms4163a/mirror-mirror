import { describe, expect, it } from "vitest";
import { ROUND_SCRIPT } from "./prompts";
import { IN_SYNC, computeRecap } from "./recap";
import type { RoundSample } from "./round";

const HIGH = 0.8;
const LOW = 0.1;

function sample(t: number, over: Partial<RoundSample> = {}): RoundSample {
  return { t, sync: LOW, lagMs: 0, leader: null, active: true, height: 0, families: {}, promptIndex: 0, ...over };
}

/** Samples 100 ms apart starting at t = 100, with the given sync values. */
function series(syncs: number[], over: Partial<RoundSample> = {}) {
  return syncs.map((sync, i) => sample((i + 1) * 100, { sync, ...over }));
}

describe("computeRecap: degenerate input", () => {
  it("handles no samples without NaN", () => {
    const r = computeRecap([], 60_000);
    expect(r).toEqual({
      durationS: 60,
      height: 0,
      meanSync: 0,
      activeShare: 0,
      inSyncShare: 0,
      bestStreakS: 0,
      medianLagMs: null,
      lead: { left: 0, right: 0, unison: 0 },
      families: [],
      leaderSegments: { left: null, right: null },
    });
  });

  it("handles a single in-sync sample", () => {
    const r = computeRecap([sample(100, { sync: HIGH, leader: 0, lagMs: 300, height: 1.5 })], 60_000);
    expect(r.inSyncShare).toBe(1);
    expect(r.activeShare).toBe(1);
    expect(r.meanSync).toBe(HIGH);
    expect(r.height).toBe(1.5);
    expect(r.medianLagMs).toBe(300);
    expect(r.lead).toEqual({ left: 1, right: 0, unison: 0 });
    // A run is credited from the previous sample's time (0 for the first sample).
    expect(r.bestStreakS).toBeCloseTo(0.1);
  });

  it("reports nothing in sync when sync stays below the threshold", () => {
    const r = computeRecap(series([LOW, IN_SYNC - 0.01, LOW], { leader: 1, lagMs: 200 }), 60_000);
    expect(r.inSyncShare).toBe(0);
    expect(r.bestStreakS).toBe(0);
    expect(r.medianLagMs).toBeNull();
    expect(r.lead).toEqual({ left: 0, right: 0, unison: 0 });
    expect(r.meanSync).toBeCloseTo((LOW + IN_SYNC - 0.01 + LOW) / 3);
  });

  it("counts a sample exactly at the threshold as in sync", () => {
    expect(computeRecap(series([IN_SYNC]), 60_000).inSyncShare).toBe(1);
  });
});

describe("computeRecap: activity and sync averages", () => {
  it("averages sync over active samples only", () => {
    const r = computeRecap([sample(100, { sync: HIGH }), sample(200, { sync: 0, active: false })], 60_000);
    expect(r.meanSync).toBe(HIGH);
    expect(r.activeShare).toBe(0.5);
    expect(r.inSyncShare).toBe(0.5);
  });

  it("takes height from the last sample", () => {
    const r = computeRecap([sample(100, { height: 3 }), sample(200, { height: 7.5 })], 60_000);
    expect(r.height).toBe(7.5);
  });
});

describe("computeRecap: streaks", () => {
  it("finds the longest unbroken run", () => {
    // 3 in sync, a break, 5 in sync: the 5-run is credited from the break sample (t = 400).
    const r = computeRecap(series([HIGH, HIGH, HIGH, LOW, HIGH, HIGH, HIGH, HIGH, HIGH]), 60_000);
    expect(r.bestStreakS).toBeCloseTo(0.5);
  });

  it("uses real time gaps when ticks were dropped", () => {
    const samples = [
      sample(100, { sync: HIGH }),
      sample(200, { sync: HIGH }),
      sample(600, { sync: HIGH }), // 400 ms gap: bridged, still the same run
      sample(700, { sync: LOW }),
      sample(800, { sync: HIGH }),
      sample(900, { sync: HIGH }),
    ];
    const r = computeRecap(samples, 60_000);
    expect(r.bestStreakS).toBeCloseTo(0.6);
  });

  it("is broken by a low sample even when the gap around it is large", () => {
    const samples = [sample(100, { sync: HIGH }), sample(5_000, { sync: LOW }), sample(5_100, { sync: HIGH })];
    const r = computeRecap(samples, 60_000);
    expect(r.bestStreakS).toBeCloseTo(0.1);
  });
});

describe("computeRecap: lag and leader", () => {
  it("takes the median absolute lag over in-sync samples only", () => {
    const samples = [
      sample(100, { sync: HIGH, lagMs: -100 }),
      sample(200, { sync: HIGH, lagMs: 300 }),
      sample(300, { sync: HIGH, lagMs: 200 }),
      sample(400, { sync: LOW, lagMs: 900 }), // ignored
    ];
    expect(computeRecap(samples, 60_000).medianLagMs).toBe(200);
  });

  it("averages the two middle values for an even count", () => {
    const samples = [sample(100, { sync: HIGH, lagMs: 100 }), sample(200, { sync: HIGH, lagMs: -300 })];
    expect(computeRecap(samples, 60_000).medianLagMs).toBe(200);
  });

  it("splits lead shares across left, right and unison and they sum to 1", () => {
    const samples = [
      sample(100, { sync: HIGH, leader: 0 }),
      sample(200, { sync: HIGH, leader: 0 }),
      sample(300, { sync: HIGH, leader: 1 }),
      sample(400, { sync: HIGH, leader: null }),
      sample(500, { sync: LOW, leader: 1 }), // not in sync: doesn't count
    ];
    const { lead } = computeRecap(samples, 60_000);
    expect(lead.left).toBeCloseTo(0.5);
    expect(lead.right).toBeCloseTo(0.25);
    expect(lead.unison).toBeCloseTo(0.25);
    expect(lead.left + lead.right + lead.unison).toBeCloseTo(1);
  });
});

describe("computeRecap: leader segments", () => {
  const leftIdx = ROUND_SCRIPT.findIndex((c) => c.lead === "left");
  const rightIdx = ROUND_SCRIPT.findIndex((c) => c.lead === "right");

  it("sanity: the script has one segment of each kind", () => {
    expect(leftIdx).toBeGreaterThanOrEqual(0);
    expect(rightIdx).toBeGreaterThanOrEqual(0);
  });

  it("is null for a segment that never happened", () => {
    const samples = [
      sample(100, { sync: 0.6, promptIndex: leftIdx }),
      sample(200, { sync: 0.8, promptIndex: leftIdx }),
      sample(300, { sync: 0.9, promptIndex: 0 }),
    ];
    const r = computeRecap(samples, 60_000);
    expect(r.leaderSegments.left).toBeCloseTo(0.7);
    expect(r.leaderSegments.right).toBeNull();
  });

  it("averages each segment separately, including low-sync samples", () => {
    const samples = [
      sample(100, { sync: 0.8, promptIndex: leftIdx }),
      sample(200, { sync: 0.4, promptIndex: leftIdx }),
      sample(300, { sync: 0.2, promptIndex: rightIdx }),
      sample(400, { sync: 0, active: false, promptIndex: rightIdx }),
    ];
    const r = computeRecap(samples, 60_000);
    expect(r.leaderSegments.left).toBeCloseTo(0.6);
    expect(r.leaderSegments.right).toBeCloseTo(0.1);
  });
});

describe("computeRecap: families", () => {
  /** 10 samples over 10 s, so each sample is 1 s. `uses` lists the samples each family appears in. */
  function withFamilies(uses: Partial<Record<"smile" | "jaw" | "eyes" | "frown", [number, number]>>) {
    const samples = Array.from({ length: 10 }, (_, i) => sample((i + 1) * 1000));
    for (const [family, [score, count]] of Object.entries(uses) as [string, [number, number]][]) {
      for (let i = 0; i < count; i++) samples[i].families[family as "smile"] = score;
    }
    return computeRecap(samples, 10_000).families;
  }

  it("drops families used for less than 2 s and keeps exactly 2 s", () => {
    const fams = withFamilies({ smile: [0.5, 2], eyes: [0.9, 1] });
    expect(fams.map((f) => f.family)).toEqual(["smile"]);
    expect(fams[0].seconds).toBeCloseTo(2);
  });

  it("sorts best match first", () => {
    const fams = withFamilies({ smile: [0.5, 5], jaw: [0.9, 4], frown: [0.7, 3] });
    expect(fams.map((f) => f.family)).toEqual(["jaw", "frown", "smile"]);
  });

  it("averages a family's score over the samples that used it", () => {
    const samples = Array.from({ length: 10 }, (_, i) => sample((i + 1) * 1000));
    samples[0].families.smile = 0.2;
    samples[1].families.smile = 0.6;
    samples[2].families.smile = 1;
    const [smile] = computeRecap(samples, 10_000).families;
    expect(smile.score).toBeCloseTo(0.6);
    expect(smile.seconds).toBeCloseTo(3);
    expect(smile.label).toBe("Smile");
  });
});
