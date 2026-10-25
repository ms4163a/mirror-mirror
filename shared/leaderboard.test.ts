import { describe, expect, it } from "vitest";
import { buildView, cleanTeam, compareRounds, rankOf, validateSubmission, type RoundSubmission, type StoredRound } from "./leaderboard.ts";

const base: RoundSubmission = {
  team: "A",
  mode: "camera",
  playedAt: "2026-10-24T20:00:00Z",
  durationS: 60,
  height: 10,
  inSyncShare: 0.5,
  meanSync: 0.5,
  bestStreakS: 3,
  medianLagMs: null,
  lead: { left: 0, right: 0, unison: 0 },
  bestExpression: null,
  sync: [],
};

describe("leaderboard contract", () => {
  it("cleans team names", () => {
    expect(cleanTeam("   ")).toBe("Anonymous");
    expect(cleanTeam(42)).toBe("Anonymous");
    expect(cleanTeam("a".repeat(40))).toHaveLength(24);
  });

  it("validates fields", () => {
    expect(validateSubmission(base).ok).toBe(true);
    const bad = validateSubmission({ ...base, inSyncShare: 2, sync: [0.5, 7] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe("invalid field(s): inSyncShare, sync");
    expect(validateSubmission({ ...base, sync: Array(400).fill(0.5) }).ok).toBe(false);
  });

  it("ranks by height, then in-sync share, then earlier play", () => {
    const r = (id: string, height: number, inSyncShare: number, playedAt: string): StoredRound => ({
      ...base,
      id,
      height,
      inSyncShare,
      playedAt,
      receivedAt: playedAt,
    });
    const rounds = [
      r("late", 20, 0.5, "2026-10-24T21:00:00Z"),
      r("early", 20, 0.5, "2026-10-24T20:00:00Z"),
      r("tall", 30, 0.1, "2026-10-24T22:00:00Z"),
      r("synced", 20, 0.9, "2026-10-24T23:00:00Z"),
    ];
    expect([...rounds].sort(compareRounds).map((x) => x.id)).toEqual(["tall", "synced", "early", "late"]);
    expect(rankOf(rounds, "early")).toBe(3);
    expect(buildView(rounds).recent[0].id).toBe("synced");
  });
});
