import { describe, expect, it } from "vitest";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { BrowGeometry, browRaw } from "./brows";

/** A minimal 468-point face: only the points browRaw uses are placed; brows lowered by `drop`. */
function face(drop = 0, roll = 0): NormalizedLandmark[] {
  const lm: NormalizedLandmark[] = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const set = (i: number, x: number, y: number) => {
    // Rotate around the face centre to simulate head roll.
    const cx = 0.5, cy = 0.4, c = Math.cos(roll), s = Math.sin(roll);
    lm[i] = { x: cx + (x - cx) * c - (y - cy) * s, y: cy + (x - cx) * s + (y - cy) * c, z: 0, visibility: 1 };
  };
  set(33, 0.4, 0.4); set(263, 0.6, 0.4); // eye corners
  set(159, 0.44, 0.385); set(386, 0.56, 0.385); // upper lids
  set(55, 0.47, 0.35 + drop); set(285, 0.53, 0.35 + drop); // inner brows (drop when scowling)
  set(46, 0.41, 0.345); set(276, 0.59, 0.345); // outer brows
  return lm;
}

describe("BrowGeometry", () => {
  it("reads ~0 at rest and a clear value for a scowl", () => {
    const g = new BrowGeometry();
    let v = 0;
    for (let i = 0; i < 100; i++) v = g.update(face(), 1);
    expect(v).toBeLessThan(0.02);
    v = g.update(face(0.015), 1);
    expect(v).toBeGreaterThan(0.3);
  });

  it("ignores head roll", () => {
    const flat = browRaw(face(0.01), 1)!;
    const rolled = browRaw(face(0.01, 0.3), 1)!;
    expect(Math.abs(flat - rolled)).toBeLessThan(1e-9);
  });

  it("returns 0 without landmarks", () => {
    expect(new BrowGeometry().update(null, 1)).toBe(0);
  });
});
