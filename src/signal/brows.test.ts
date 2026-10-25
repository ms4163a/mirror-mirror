import { describe, expect, it } from "vitest";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { rng } from "../sync/synthetic";
import { BrowGeometry, browRaw } from "./brows";

/** A minimal 468-point face. `drop` lowers the inner brows, `pinch` pulls them together. */
function face(drop = 0, roll = 0, pinch = 0, jitter?: () => number): NormalizedLandmark[] {
  const lm: NormalizedLandmark[] = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const j = () => (jitter ? jitter() : 0);
  const set = (i: number, x: number, y: number) => {
    const cx = 0.5, cy = 0.4, c = Math.cos(roll), s = Math.sin(roll);
    const X = x + j(), Y = y + j();
    lm[i] = { x: cx + (X - cx) * c - (Y - cy) * s, y: cy + (X - cx) * s + (Y - cy) * c, z: 0, visibility: 1 };
  };
  set(33, 0.4, 0.4); set(263, 0.6, 0.4);
  set(159, 0.44, 0.385); set(386, 0.56, 0.385);
  set(55, 0.47 + pinch, 0.35 + drop); set(285, 0.53 - pinch, 0.35 + drop);
  set(46, 0.41, 0.345); set(276, 0.59, 0.345);
  return lm;
}

describe("BrowGeometry", () => {
  it("shows even a small scowl clearly when tracking is steady", () => {
    const g = new BrowGeometry();
    const r = rng(1);
    const noise = () => (r() - 0.5) * 0.0004;
    let v = 0;
    for (let i = 0; i < 150; i++) v = g.update(face(0, 0, 0, noise), 1);
    expect(v).toBeLessThan(0.15); // jitter alone stays low
    for (let i = 0; i < 10; i++) v = g.update(face(0.008, 0, 0.004, noise), 1); // a clear real scowl
    expect(v).toBeGreaterThan(0.3);
  });

  it("does not turn heavy jitter into a scowl", () => {
    const g = new BrowGeometry();
    const r = rng(2);
    const noise = () => (r() - 0.5) * 0.006;
    let max = 0;
    for (let i = 0; i < 300; i++) max = Math.max(max, i > 50 ? g.update(face(0, 0, 0, noise), 1) : (g.update(face(0, 0, 0, noise), 1), 0));
    expect(max).toBeLessThan(0.35);
  });

  it("ignores head roll", () => {
    expect(Math.abs(browRaw(face(0.01), 1)! - browRaw(face(0.01, 0.3), 1)!)).toBeLessThan(1e-9);
  });

  it("returns 0 without landmarks", () => {
    expect(new BrowGeometry().update(null, 1)).toBe(0);
  });
});
