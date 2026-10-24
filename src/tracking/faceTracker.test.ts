import { describe, expect, it } from "vitest";
import { PlayerAssigner } from "./faceTracker";

describe("PlayerAssigner", () => {
  it("puts the larger raw x on screen-left (player 0) because the view is mirrored", () => {
    const a = new PlayerAssigner();
    expect(a.assign([0.3, 0.7])).toEqual([1, 0]);
    expect(a.assign([0.7, 0.3])).toEqual([0, 1]);
  });

  it("keeps identity when one player leaves the frame", () => {
    const a = new PlayerAssigner();
    a.assign([0.75, 0.25]);
    // Right player (raw x 0.25) is gone; the remaining face is near 0.73.
    expect(a.assign([0.73])).toEqual([0, null]);
    // Left player gone; the remaining face is near the right player's spot.
    a.assign([0.75, 0.25]);
    expect(a.assign([0.28])).toEqual([null, 0]);
  });

  it("falls back to screen side when there is no history", () => {
    expect(new PlayerAssigner().assign([0.2])).toEqual([null, 0]);
    expect(new PlayerAssigner().assign([0.8])).toEqual([0, null]);
  });
});
