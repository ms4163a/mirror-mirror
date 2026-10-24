import { describe, expect, it } from "vitest";
import type { Recap } from "../game/recap";
import { recapFacts, validateNote } from "./coach";

const recap: Recap = {
  durationS: 60,
  height: 42.37,
  meanSync: 0.613,
  activeShare: 0.9,
  inSyncShare: 0.55,
  bestStreakS: 7.62,
  medianLagMs: 241.6,
  lead: { left: 0.6, right: 0.3, unison: 0.1 },
  families: [
    { family: "smile", label: "Smile", score: 0.81, seconds: 20 },
    { family: "jaw", label: "Mouth open", score: 0.7, seconds: 12 },
    { family: "head", label: "Head moves", score: 0.5, seconds: 9 },
    { family: "frown", label: "Frown", score: 0.2, seconds: 4 },
  ],
  leaderSegments: { left: 0.66, right: 0.48 },
};

describe("coach note grounding", () => {
  const facts = recapFacts(recap);

  it("exposes rounded measured numbers only", () => {
    expect(facts.jack_climbed_m).toBe(42.4);
    expect(facts.typical_follow_lag_ms).toBe(242);
    expect(facts.percent_of_round_in_sync).toBe(55);
    expect(facts.weakest_expression).toBe("Frown");
  });

  it("accepts a note that uses measured numbers", () => {
    expect(
      validateNote("Your smiles matched 81% of the time and Jack climbed 42.4 m. Next round, let Right lead more.", facts),
    ).toBeNull();
  });

  it("rejects invented numbers", () => {
    expect(validateNote("You were in sync 73% of the round.", facts)).toMatch(/unmeasured number 73/);
  });

  it("rejects a real number cited under the wrong key", () => {
    const note = "Right led 60% of the time.";
    expect(validateNote(note, facts, ["left_player_led_percent"])).toBeNull();
    expect(validateNote(note, facts, ["right_player_led_percent"])).toMatch(/unmeasured number 60/);
    expect(validateNote(note, facts, ["made_up_key"])).toMatch(/unknown fact/);
  });

  it("rejects relationship verdicts", () => {
    expect(validateNote("You two are very compatible!", facts)).toMatch(/banned/);
    expect(validateNote("Great chemistry between you.", facts)).toMatch(/banned/);
  });

  it("omits lead facts when nobody was in sync", () => {
    const f = recapFacts({ ...recap, lead: { left: 0, right: 0, unison: 0 }, medianLagMs: null });
    expect(f.left_player_led_percent).toBeUndefined();
    expect(f.typical_follow_lag_ms).toBeUndefined();
  });
});
