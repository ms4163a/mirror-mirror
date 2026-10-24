// Synthetic "players" for tests and camera-free development. Expressions are
// smooth pulses on a family's channels, roughly what the tracker gives for a
// smile, a brow raise and so on.
import { CHANNELS, FAMILIES, NUM_CHANNELS } from "../signal/channels";

/** Small seeded PRNG (mulberry32) so tests are deterministic. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Approximate standard normal. */
function gauss(r: () => number) {
  return (r() + r() + r() + r() - 2) * 1.7321; // var of the sum is 1/3
}

interface Pulse {
  start: number;
  dur: number;
  amps: Float64Array;
}

export class Performer {
  private pulses: Pulse[] = [];

  /** Schedules expression events every `gapMs` (jittered) for `durationMs`. */
  constructor(seed: number, durationMs: number, gapMs = 1200) {
    const r = rng(seed);
    for (let t = 300 + r() * gapMs; t < durationMs; t += gapMs * (0.6 + 0.8 * r())) {
      const fam = FAMILIES[Math.floor(r() * FAMILIES.length)].id;
      const amps = new Float64Array(NUM_CHANNELS);
      CHANNELS.forEach((ch, c) => {
        if (ch.family === fam) amps[c] = 0.3 + 0.5 * r();
      });
      this.pulses.push({ start: t, dur: 600 + 1400 * r(), amps });
    }
  }

  value(t: number, out: Float64Array = new Float64Array(NUM_CHANNELS)): Float64Array {
    out.fill(0);
    for (const p of this.pulses) {
      const u = (t - p.start) / p.dur;
      if (u <= 0 || u >= 1) continue;
      const env = 0.5 - 0.5 * Math.cos(2 * Math.PI * u); // raised cosine
      for (let c = 0; c < out.length; c++) out[c] += p.amps[c] * env;
    }
    return out;
  }
}

export interface ScenarioPlayer {
  /** Expression source, or null for a still face. */
  source: Performer | null;
  /** Delay applied to the source (ms). Positive = follows. */
  delayMs?: number;
  gain?: number;
  noise?: number;
}

/**
 * Generates tracker-like frames at `fps` with timing jitter.
 * Calls `emit(t, a, b)` for each frame.
 */
export function runScenario(
  players: [ScenarioPlayer, ScenarioPlayer],
  durationMs: number,
  emit: (t: number, a: Float64Array, b: Float64Array) => void,
  { fps = 30, seed = 99 } = {},
) {
  const r = rng(seed);
  const frames = players.map(() => new Float64Array(NUM_CHANNELS)) as [Float64Array, Float64Array];
  for (let t = 0; t < durationMs; t += (1000 / fps) * (0.8 + 0.4 * r())) {
    players.forEach((p, i) => {
      const out = frames[i];
      if (p.source) p.source.value(t - (p.delayMs ?? 0), out);
      else out.fill(0);
      const g = p.gain ?? 1;
      const noise = p.noise ?? 0.005;
      for (let c = 0; c < out.length; c++) out[c] = out[c] * g + noise * gauss(r);
    });
    emit(t, frames[0], frames[1]);
  }
}
