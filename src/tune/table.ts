// Turns re-scored rounds into table rows and compares them with the defaults.
import type { Recap } from "../game/recap";

/** The part of `rescore()`'s result the table reads. */
export interface ScoredRound {
  height: number;
  recap: Recap;
}

export interface Row {
  height: number;
  /** Share of the round in sync, 0..1 */
  inSync: number;
  meanSync: number;
  medianLagMs: number | null;
  lead: { left: number; right: number; unison: number };
}

export function summarize(r: ScoredRound): Row {
  return {
    height: r.height,
    inSync: r.recap.inSyncShare,
    meanSync: r.recap.meanSync,
    medianLagMs: r.recap.medianLagMs,
    lead: { ...r.recap.lead },
  };
}

export interface RowDelta {
  height: number;
  inSync: number;
  meanSync: number;
  /** null when either side has no lag (nothing in sync). */
  medianLagMs: number | null;
  lead: { left: number; right: number; unison: number };
}

/** `cur - base`, field by field. */
export function deltaRow(cur: Row, base: Row): RowDelta {
  return {
    height: cur.height - base.height,
    inSync: cur.inSync - base.inSync,
    meanSync: cur.meanSync - base.meanSync,
    medianLagMs: cur.medianLagMs === null || base.medianLagMs === null ? null : cur.medianLagMs - base.medianLagMs,
    lead: {
      left: cur.lead.left - base.lead.left,
      right: cur.lead.right - base.lead.right,
      unison: cur.lead.unison - base.lead.unison,
    },
  };
}

/** Average across sessions. Lag averages only the sessions that have one. */
export function meanRow(rows: Row[]): Row | null {
  if (!rows.length) return null;
  const avg = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  const lags = rows.map((r) => r.medianLagMs).filter((x): x is number => x !== null);
  return {
    height: avg((r) => r.height),
    inSync: avg((r) => r.inSync),
    meanSync: avg((r) => r.meanSync),
    medianLagMs: lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : null,
    lead: { left: avg((r) => r.lead.left), right: avg((r) => r.lead.right), unison: avg((r) => r.lead.unison) },
  };
}

/** "+3.2", "-0.4", or "±0" when the change is below `eps` (so noise doesn't look like a result). */
export function formatDelta(d: number | null, digits = 1, eps = 0.5 * 10 ** -digits): string {
  if (d === null) return "–";
  if (Math.abs(d) < eps) return "±0";
  const s = d.toFixed(digits);
  return d > 0 ? `+${s}` : s;
}

/** Calls `fn` once, `ms` after the last call. `cancel()` drops a pending call. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** Index of the sample closest in time to `t`, or -1 when there are none. Samples must be in time order. */
export function nearestIndex(samples: { t: number }[], t: number): number {
  if (!samples.length) return -1;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  // `lo` is the first sample at or after t; the one before it may be closer.
  return lo > 0 && t - samples[lo - 1].t <= samples[lo].t - t ? lo - 1 : lo;
}
