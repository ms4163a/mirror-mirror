import { describe, expect, it } from "vitest";
import { ClockSync } from "./clock";

describe("ClockSync", () => {
  it("recovers the host offset from the fastest round trip", () => {
    const c = new ClockSync();
    const trueOffset = 5000; // host clock is 5 s ahead
    // [send time, outbound delay, return delay]
    const trips: [number, number, number][] = [
      [0, 80, 20], // slow and lopsided: offset error 30 ms
      [100, 12, 10], // fast and nearly symmetric: error 1 ms
      [200, 40, 45],
      [300, 60, 30],
    ];
    for (const [t0, out, back] of trips) c.add(t0, t0 + out + trueOffset, t0 + out + back);
    expect(c.ready).toBe(true);
    expect(c.rtt).toBe(22);
    expect(Math.abs(c.offset - trueOffset)).toBeLessThanOrEqual(1);
  });

  it("is not ready until three samples arrive", () => {
    const c = new ClockSync();
    c.add(0, 10, 20);
    c.add(0, 10, 20);
    expect(c.ready).toBe(false);
  });
});
