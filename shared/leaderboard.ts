// Leaderboard data contract, shared by the game (browser) and the server (Node).
// No imports, and only type syntax Node can strip, so the server can run
// this file directly.

export type RoundMode = "camera" | "sim" | "replay";

/** What the game sends after a round. Numbers only, never images or video. */
export interface RoundSubmission {
  team: string;
  mode: RoundMode;
  /** ISO timestamp from the game machine. */
  playedAt: string;
  durationS: number;
  height: number;
  inSyncShare: number;
  meanSync: number;
  bestStreakS: number;
  medianLagMs: number | null;
  lead: { left: number; right: number; unison: number };
  bestExpression: string | null;
  /** Sync over the round at 2 Hz, each 0..1 (for the sparkline). */
  sync: number[];
}

export interface StoredRound extends RoundSubmission {
  id: string;
  receivedAt: string;
}

export interface LeaderboardView {
  top: StoredRound[];
  recent: StoredRound[];
  total: number;
}

export const TEAM_MAX = 24;
export const SYNC_MAX_POINTS = 360;

const isNum = (x: unknown, lo: number, hi: number) => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;

/** Cleans team names: trims, collapses spaces, strips control and markup characters. */
export function cleanTeam(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  const cleaned = s
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TEAM_MAX);
  return cleaned || "Anonymous";
}

/** Validates an untrusted submission. Returns the cleaned value or an error message. */
export function validateSubmission(body: unknown): { ok: true; value: RoundSubmission } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be an object" };
  const b = body as Record<string, unknown>;
  const lead = b.lead as Record<string, unknown> | undefined;
  const checks: [boolean, string][] = [
    [b.mode === "camera" || b.mode === "sim" || b.mode === "replay", "mode"],
    [typeof b.playedAt === "string" && !Number.isNaN(Date.parse(b.playedAt)), "playedAt"],
    [isNum(b.durationS, 1, 600), "durationS"],
    [isNum(b.height, 0, 10_000), "height"],
    [isNum(b.inSyncShare, 0, 1), "inSyncShare"],
    [isNum(b.meanSync, 0, 1), "meanSync"],
    [isNum(b.bestStreakS, 0, 600), "bestStreakS"],
    [b.medianLagMs === null || isNum(b.medianLagMs, 0, 5000), "medianLagMs"],
    [!!lead && isNum(lead.left, 0, 1) && isNum(lead.right, 0, 1) && isNum(lead.unison, 0, 1), "lead"],
    [b.bestExpression === null || (typeof b.bestExpression === "string" && b.bestExpression.length <= 40), "bestExpression"],
    [Array.isArray(b.sync) && b.sync.length <= SYNC_MAX_POINTS && b.sync.every((x) => isNum(x, 0, 1)), "sync"],
  ];
  const bad = checks.filter(([ok]) => !ok).map(([, name]) => name);
  if (bad.length) return { ok: false, error: `invalid field(s): ${bad.join(", ")}` };
  return {
    ok: true,
    value: {
      team: cleanTeam(b.team),
      mode: b.mode as RoundMode,
      playedAt: new Date(b.playedAt as string).toISOString(),
      durationS: b.durationS as number,
      height: b.height as number,
      inSyncShare: b.inSyncShare as number,
      meanSync: b.meanSync as number,
      bestStreakS: b.bestStreakS as number,
      medianLagMs: b.medianLagMs as number | null,
      lead: { left: lead!.left as number, right: lead!.right as number, unison: lead!.unison as number },
      bestExpression: b.bestExpression as string | null,
      sync: b.sync as number[],
    },
  };
}

/** Best first: height, then share of the round in sync, then earlier play. */
export function compareRounds(a: RoundSubmission, b: RoundSubmission): number {
  return b.height - a.height || b.inSyncShare - a.inSyncShare || Date.parse(a.playedAt) - Date.parse(b.playedAt);
}

/** Builds the leaderboard view. Simulated and replayed rounds are excluded unless asked for. */
export function buildView(rounds: StoredRound[], opts: { limit?: number; includeTest?: boolean } = {}): LeaderboardView {
  const pool = opts.includeTest ? rounds : rounds.filter((r) => r.mode === "camera");
  const limit = opts.limit ?? 10;
  return {
    top: [...pool].sort(compareRounds).slice(0, limit),
    recent: [...pool].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)).slice(0, 5),
    total: pool.length,
  };
}

/** 1-based rank of `id` among the rounds the view would include. */
export function rankOf(rounds: StoredRound[], id: string, includeTest = false): number | null {
  const pool = includeTest ? rounds : rounds.filter((r) => r.mode === "camera");
  const i = [...pool].sort(compareRounds).findIndex((r) => r.id === id);
  return i < 0 ? null : i + 1;
}
