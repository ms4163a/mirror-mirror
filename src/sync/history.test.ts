import { describe, expect, it } from "vitest";
import { History } from "./history";
import { SyncEngine } from "./syncEngine";
import { Performer, runScenario } from "./synthetic";

const v = (x: number) => Float64Array.of(x);

describe("History with separate player streams (remote play)", () => {
  it("waits for the slower player before writing grid points", () => {
    const h = new History(1, 100, 30);
    h.pushPlayer(0, 0, v(0));
    h.pushPlayer(0, 100, v(100));
    expect(h.count).toBe(0); // player 1 has sent nothing yet
    h.pushPlayer(1, 0, v(0));
    h.pushPlayer(1, 50, v(-50));
    expect(h.count).toBe(2); // t = 0, 33.3; 66.7 needs player 1 data past 50
    h.pushPlayer(1, 100, v(-100));
    expect(h.count).toBe(4);
    expect(Array.from(h.window(0, 0, 4, new Float64Array(4))).map(Math.round)).toEqual([0, 33, 67, 100]);
    expect(Array.from(h.window(1, 0, 4, new Float64Array(4))).map(Math.round)).toEqual([0, -33, -67, -100]);
  });

  it("gives the same grid whether streams arrive together or one is late", () => {
    const together = new History(1, 200, 30);
    const late = new History(1, 200, 30);
    const queue: [number, number][] = []; // player 1 samples delayed by 5 frames
    for (let i = 0; i < 60; i++) {
      const t = i * 31 + (i % 3);
      together.push(t, v(Math.sin(t / 200)), v(Math.cos(t / 300)));
      late.pushPlayer(0, t, v(Math.sin(t / 200)));
      queue.push([t, Math.cos(t / 300)]);
      if (queue.length > 5) {
        const [tq, x] = queue.shift()!;
        late.pushPlayer(1, tq, v(x));
      }
    }
    for (const [tq, x] of queue) late.pushPlayer(1, tq, v(x));
    expect(late.count).toBe(together.count);
    const n = together.count;
    for (const p of [0, 1] as const) {
      expect(Array.from(late.window(p, 0, n, new Float64Array(n)))).toEqual(Array.from(together.window(p, 0, n, new Float64Array(n))));
    }
  });

  it("drops out-of-order samples", () => {
    const h = new History(1, 100, 30);
    h.pushPlayer(0, 100, v(1));
    h.pushPlayer(0, 50, v(9));
    expect(h.latest(0)).toBe(100);
  });
});

describe("SyncEngine with a network-delayed remote player", () => {
  it("measures the true lag from timestamps, not arrival time", () => {
    const p = new Performer(3, 20000);
    const engine = new SyncEngine();
    const inFlight: { arrive: number; t: number; b: Float64Array }[] = [];
    const lags: number[] = [];
    let nextSnap = 0;
    runScenario([{ source: p }, { source: p, delayMs: 250 }], 20000, (t, a, b) => {
      engine.pushPlayer(0, t, a);
      // Right player's frames reach the host 120-180 ms late, in order.
      inFlight.push({ arrive: t + 120 + (t % 60), t, b: b.slice() });
      while (inFlight.length && inFlight[0].arrive <= t) {
        const f = inFlight.shift()!;
        engine.pushPlayer(1, f.t, f.b);
      }
      if (t >= nextSnap) {
        nextSnap = t + 100;
        const s = engine.snapshot();
        if (s?.active && s.sync > 0) lags.push(s.lagMs);
      }
    });
    lags.sort((x, y) => x - y);
    expect(Math.abs(lags[lags.length >> 1] - 250)).toBeLessThan(40);
  });
});
