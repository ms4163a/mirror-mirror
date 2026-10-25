import { describe, expect, it } from "vitest";
import { ROUND_MS, ROUND_SCRIPT, promptAt, scriptTime } from "./prompts";
import { Round } from "./round";

/** Every card index seen when stepping through a round of `durationMs`. */
function cardsSeen(durationMs: number, stepMs = 50) {
  const seen = new Set<number>();
  for (let t = 0; t < durationMs; t += stepMs) seen.add(promptAt(t, ROUND_SCRIPT, durationMs).index);
  return seen;
}

describe("scriptTime", () => {
  it("is the identity for a full-length round", () => {
    for (const card of ROUND_SCRIPT) expect(scriptTime(card.at)).toBe(card.at);
  });

  it("compresses card times proportionally", () => {
    expect(scriptTime(30_000, 20_000)).toBeCloseTo(10_000);
    expect(scriptTime(ROUND_MS, 20_000)).toBeCloseTo(20_000);
  });
});

describe("promptAt", () => {
  it("keeps the unscaled behaviour when called the old way", () => {
    expect(promptAt(0).index).toBe(0);
    expect(promptAt(5_999).index).toBe(0);
    expect(promptAt(6_000).index).toBe(1);
    expect(promptAt(ROUND_MS - 1).index).toBe(ROUND_SCRIPT.length - 1);
  });

  it("shows every card, including both leader segments, in a 20 s round", () => {
    const seen = cardsSeen(20_000);
    expect(seen.size).toBe(ROUND_SCRIPT.length);
    const leads = new Set([...seen].map((i) => ROUND_SCRIPT[i].lead));
    expect(leads.has("left")).toBe(true);
    expect(leads.has("right")).toBe(true);
  });

  it("shows every card at other round lengths", () => {
    for (const ms of [10_000, 30_000, 90_000]) expect(cardsSeen(ms).size).toBe(ROUND_SCRIPT.length);
  });

  it("switches at the scaled time", () => {
    // The 2nd card starts at 6 s of 60, so 2 s of 20.
    expect(promptAt(1_999, ROUND_SCRIPT, 20_000).index).toBe(0);
    expect(promptAt(2_000, ROUND_SCRIPT, 20_000).index).toBe(1);
  });
});

describe("Round.prompt", () => {
  it("follows the round's own duration", () => {
    const round = new Round(20_000);
    round.update(2_000, null);
    expect(round.prompt.index).toBe(1);
    round.update(8_000, null); // 10 s of 20 = 30 s of 60: the "right leads" card
    expect(round.prompt.card.lead).toBe("right");
  });

  it("matches the old timing for a default-length round", () => {
    const round = new Round();
    round.update(6_000, null);
    expect(round.prompt.index).toBe(1);
  });
});
