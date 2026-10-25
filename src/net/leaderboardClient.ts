// Sends finished rounds to the leaderboard server. If the server is
// unreachable, the round is queued in localStorage and sent later, so the
// game never depends on the network (offline core).
import type { RoundMode, RoundSubmission } from "../../shared/leaderboard";
import type { Recap } from "../game/recap";
import type { RoundSample } from "../game/round";

const QUEUE_KEY = "mm.pendingRounds";
const TEAM_KEY = "mm.team";
const TIMEOUT_MS = 4000;

/** API base: same origin by default (Vite proxies /api), or ?api=http://host:8787 */
export const API_BASE = new URLSearchParams(location.search).get("api") ?? "";

export function toSubmission(recap: Recap, samples: RoundSample[], team: string, mode: RoundMode): RoundSubmission {
  // Samples are 10 Hz; keep every 5th for a 2 Hz sparkline.
  const sync = samples.filter((_, i) => i % 5 === 0).map((s) => Math.round(s.sync * 1000) / 1000).slice(0, 360);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    team,
    mode,
    playedAt: new Date().toISOString(),
    durationS: recap.durationS,
    height: Math.round(recap.height * 10) / 10,
    inSyncShare: r3(recap.inSyncShare),
    meanSync: r3(recap.meanSync),
    bestStreakS: Math.round(recap.bestStreakS * 10) / 10,
    medianLagMs: recap.medianLagMs === null ? null : Math.round(recap.medianLagMs),
    lead: { left: r3(recap.lead.left), right: r3(recap.lead.right), unison: r3(recap.lead.unison) },
    bestExpression: recap.families[0]?.label ?? null,
    sync,
  };
}

export interface SubmitResult {
  id: string;
  rank: number | null;
  total: number;
}

function readQueue(): RoundSubmission[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeQueue(q: RoundSubmission[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-50)));
  } catch {
    // Storage unavailable: the round is simply not retried.
  }
}

async function post(sub: RoundSubmission): Promise<SubmitResult | null> {
  try {
    const res = await fetch(`${API_BASE}/api/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Sends a round. On failure, queues it and resolves null. */
export async function submitRound(sub: RoundSubmission): Promise<SubmitResult | null> {
  const result = await post(sub);
  if (!result) writeQueue([...readQueue(), sub]);
  else void flushQueue();
  return result;
}

/** Retries queued rounds; keeps the ones that still fail. */
export async function flushQueue(): Promise<number> {
  const queue = readQueue();
  if (!queue.length) return 0;
  const failed: RoundSubmission[] = [];
  for (const sub of queue) if (!(await post(sub))) failed.push(sub);
  writeQueue(failed);
  return queue.length - failed.length;
}

export function rememberedTeam(): string {
  try {
    return localStorage.getItem(TEAM_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberTeam(team: string) {
  try {
    localStorage.setItem(TEAM_KEY, team);
  } catch {
    // ignore
  }
}
