import { describe, expect, it } from "vitest";
import { CHANNELS, NUM_CHANNELS } from "./channels";
import { ExpressionMeter } from "./meter";

const idx = (n: string) => CHANNELS.findIndex((c) => c.name === n);
const face = (vals: Record<string, number>) => {
  const v = new Float64Array(NUM_CHANNELS);
  for (const [k, x] of Object.entries(vals)) v[idx(k)] = x;
  return v;
};

describe("ExpressionMeter", () => {
  it("reads a smile relative to the player's resting face", () => {
    const m = new ExpressionMeter();
    // Resting face with a constant squint of 0.3 (common in playtests).
    for (let i = 0; i < 50; i++) m.update(face({ eyeSquint: 0.3 }));
    expect(m.levels.smile).toBeLessThan(0.1);
    m.update(face({ eyeSquint: 0.3, smile: 0.7 }));
    expect(m.levels.smile).toBeGreaterThan(0.9);
  });

  it("counts a dimple-and-press smile as a smile", () => {
    const m = new ExpressionMeter();
    for (let i = 0; i < 20; i++) m.update(face({}));
    m.update(face({ dimple: 0.25, mouthPress: 0.3 }));
    expect(m.levels.smile).toBeGreaterThan(0.7);
  });

  it("shows a small mouth opening as small", () => {
    const m = new ExpressionMeter();
    for (let i = 0; i < 20; i++) m.update(face({}));
    m.update(face({ jawOpen: 0.05 }));
    expect(m.levels.jaw).toBeCloseTo(0.1, 2);
  });

  it("fades out when the face is lost", () => {
    const m = new ExpressionMeter();
    m.update(face({}));
    m.update(face({ jawOpen: 0.5 }));
    m.update(null);
    expect(m.levels.jaw).toBeLessThan(1);
  });
});
