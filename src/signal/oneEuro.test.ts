import { describe, expect, it } from "vitest";
import { rng } from "../sync/synthetic";
import { OneEuroVector } from "./oneEuro";

describe("OneEuroVector", () => {
  it("removes most frame-to-frame jitter from a held expression", () => {
    const f = new OneEuroVector(1);
    const r = rng(1);
    let prev = NaN;
    const jumps: number[] = [];
    for (let i = 0; i < 300; i++) {
      const v = f.filter(i * 33, Float64Array.of(0.4 + (r() - 0.5) * 0.2))[0];
      if (i > 30) jumps.push(Math.abs(v - prev));
      prev = v;
    }
    const mean = jumps.reduce((s, x) => s + x, 0) / jumps.length;
    expect(mean).toBeLessThan(0.02); // raw jumps average about 0.067
  });

  it("still follows a quick expression change", () => {
    const f = new OneEuroVector(1);
    for (let i = 0; i < 30; i++) f.filter(i * 33, Float64Array.of(0));
    let v = 0;
    // A smile snaps from 0 to 0.8; check where the output is 200 ms later.
    for (let i = 30; i <= 36; i++) v = f.filter(i * 33, Float64Array.of(0.8))[0];
    expect(v).toBeGreaterThan(0.6);
  });

  it("restarts after a long gap instead of smoothing across it", () => {
    const f = new OneEuroVector(1);
    f.filter(0, Float64Array.of(0));
    expect(f.filter(1000, Float64Array.of(0.9))[0]).toBe(0.9);
  });
});
