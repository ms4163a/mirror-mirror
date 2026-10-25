import { describe, expect, it } from "vitest";
import { NUM_CHANNELS } from "../signal/channels";
import { SyncEngine } from "../sync/syncEngine";
import { Performer } from "../sync/synthetic";
import type { TrackerFrame } from "../tracking/faceTracker";
import { BotSource } from "./bot";
import type { FrameSource } from "./sources";

/** A fake camera whose single player makes synthetic expressions. */
class FakeCamera implements FrameSource {
  readonly kind = "camera";
  private p = new Performer(3, 120_000);
  poll(now: number): TrackerFrame {
    const me = { present: true, channels: this.p.value(now), landmarks: null, blendshapes: null };
    const none = { present: false, channels: new Float64Array(NUM_CHANNELS), landmarks: null, blendshapes: null };
    return { t: now, players: [me, none] };
  }
}

describe("BotSource", () => {
  it("follows the player with a delay, so a real sync builds up with the bot leading-lagging", () => {
    let lead: "free" | "left" | "right" = "free";
    const bot = new BotSource(new FakeCamera(), () => lead);
    const engine = new SyncEngine();
    let best = 0;
    let lag = 0;
    for (let t = 0; t < 40_000; t += 33) {
      const f = bot.poll(t)!;
      engine.push(f.t, f.players[0].channels, f.players[1].channels);
      if (t % 990 === 0) {
        const s = engine.snapshot();
        if (s && s.sync > best) [best, lag] = [s.sync, s.lagMs];
      }
    }
    expect(best).toBeGreaterThan(0.5);
    expect(lag).toBeGreaterThan(300); // Left (the player) leads, bot follows
    lead = "right";
    const a = bot.botFace(50_000).channels;
    const b = bot.botFace(50_000).channels;
    expect(a.some((x, i) => Math.abs(x - b[i]) < 0.02)).toBe(true); // leading = its own deterministic expressions
  });
});
