import { describe, expect, it } from "vitest";
import { MILESTONES, reachedSentence } from "./scene";

describe("reachedSentence", () => {
  it("says Jack is still in the garden below the first milestone", () => {
    expect(reachedSentence(0)).toBe("He's still down in the garden.");
    expect(reachedSentence(24.9)).toBe("He's still down in the garden.");
  });

  it("names the highest milestone passed, starting exactly at it", () => {
    expect(reachedSentence(25)).toBe("He reached the treetops.");
    expect(reachedSentence(49.9)).toBe("He reached the treetops.");
    expect(reachedSentence(50)).toBe("He climbed above the clouds.");
    expect(reachedSentence(75)).toBe("He reached the jet stream.");
    expect(reachedSentence(100)).toBe("He made it to the giant's castle.");
    expect(reachedSentence(250)).toBe("He made it to the giant's castle.");
  });

  it("gives every milestone a full sentence ending in a period", () => {
    for (const m of MILESTONES) expect(m.reached).toMatch(/^He .+\.$/);
  });

  it("keeps the milestones in rising order so the highest one wins", () => {
    const heights = MILESTONES.map((m) => m.m);
    expect([...heights].sort((a, b) => a - b)).toEqual(heights);
  });
});
