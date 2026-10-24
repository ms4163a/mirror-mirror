// Round recap statistics. These numbers are the only input the Llama recap may
// use later, so every figure here must come straight from the measurements.
import { FAMILIES, type Family } from "../signal/channels";
import { ROUND_SCRIPT } from "./prompts";
import type { RoundSample } from "./round";

export interface Recap {
  durationS: number;
  height: number;
  /** Mean sync over samples where both players were moving. */
  meanSync: number;
  /** Share of the round both players were moving. */
  activeShare: number;
  /** Share of the round with sync above `IN_SYNC`. */
  inSyncShare: number;
  /** Longest unbroken in-sync stretch, seconds. */
  bestStreakS: number;
  /** Median absolute lag over in-sync samples, ms. */
  medianLagMs: number | null;
  /** Share of in-sync time each player led, plus unison. Sums to 1 if there was any. */
  lead: { left: number; right: number; unison: number };
  /** Families both players used, best match first. */
  families: { family: Family; label: string; score: number; seconds: number }[];
  /** Mean sync during the leader segments of the script. */
  leaderSegments: { left: number | null; right: number | null };
}

export const IN_SYNC = 0.4;

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeRecap(samples: RoundSample[], durationMs: number): Recap {
  const n = samples.length || 1;
  const active = samples.filter((s) => s.active);
  const inSync = samples.filter((s) => s.sync >= IN_SYNC);

  // Samples are about 100 ms apart; use real gaps so a dropped tick doesn't skew streaks.
  let best = 0;
  let runStart: number | null = null;
  let prevT = 0;
  for (const s of samples) {
    if (s.sync >= IN_SYNC) {
      if (runStart === null) runStart = prevT;
      best = Math.max(best, s.t - runStart);
    } else {
      runStart = null;
    }
    prevT = s.t;
  }

  const lead = { left: 0, right: 0, unison: 0 };
  for (const s of inSync) {
    if (s.leader === 0) lead.left++;
    else if (s.leader === 1) lead.right++;
    else lead.unison++;
  }
  if (inSync.length) {
    lead.left /= inSync.length;
    lead.right /= inSync.length;
    lead.unison /= inSync.length;
  }

  const dt = durationMs / 1000 / n;
  const families = FAMILIES.map(({ id, label }) => {
    const scores = samples.map((s) => s.families[id]).filter((x): x is number => x !== undefined);
    return {
      family: id,
      label,
      score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      seconds: scores.length * dt,
    };
  })
    .filter((f) => f.seconds >= 2)
    .sort((a, b) => b.score - a.score);

  const segMean = (lead: "left" | "right") => {
    const idx = new Set(ROUND_SCRIPT.flatMap((c, i) => (c.lead === lead ? [i] : [])));
    const xs = samples.filter((s) => idx.has(s.promptIndex)).map((s) => s.sync);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };

  return {
    durationS: durationMs / 1000,
    height: samples.length ? samples[samples.length - 1].height : 0,
    meanSync: active.length ? active.reduce((a, s) => a + s.sync, 0) / active.length : 0,
    activeShare: active.length / n,
    inSyncShare: inSync.length / n,
    bestStreakS: best / 1000,
    medianLagMs: median(inSync.map((s) => Math.abs(s.lagMs))),
    lead,
    families,
    leaderSegments: { left: segMean("left"), right: segMean("right") },
  };
}
