import { describe, expect, it } from "vitest";
import { ROUND_SCRIPT, type PromptCard } from "../game/prompts";
import { CHANNELS, NUM_CHANNELS } from "../signal/channels";
import { SyncEngine } from "../sync/syncEngine";
import { Performer } from "../sync/synthetic";
import type { TrackerFrame } from "../tracking/faceTracker";
import { BotSource } from "./bot";
import type { FrameSource } from "./sources";

class FakeCamera implements FrameSource {
  readonly kind = "camera";
  private p = new Performer(3, 120_000);
  poll(now: number): TrackerFrame {
    const me = { present: true, channels: this.p.value(now), landmarks: null, blendshapes: null };
    const none = { present: false, channels: new Float64Array(NUM_CHANNELS), landmarks: null, blendshapes: null };
    return { t: now, players: [me, none] };
  }
}
const ch = (name: string) => CHANNELS.findIndex((c) => c.name === name);
const card = (title: string) => ROUND_SCRIPT.find((c) => c.title === title)!;

describe("BotSource", () => {
  it("follows the player smoothly and a little late when the Left player leads", () => {
    const bot = new BotSource(new FakeCamera(), () => card("Left player leads"));
    const engine = new SyncEngine();
    let best = 0, lag = 0;
    for (let t = 0; t < 40_000; t += 33) {
      const f = bot.poll(t)!;
      engine.push(f.t, f.players[0].channels, f.players[1].channels);
      if (t % 990 === 0) {
        const s = engine.snapshot();
        if (s && s.sync > best) [best, lag] = [s.sync, s.lagMs];
      }
    }
    expect(best).toBeGreaterThan(0.5);
    expect(lag).toBeGreaterThan(300);
  });

  it("leads with the prompt's expression and holds it for seconds, not one", () => {
    let current: PromptCard = card("Big smiles");
    const bot = new BotSource(new FakeCamera(), () => current);
    const smile: number[] = [];
    for (let t = 0; t < 6000; t += 33) smile.push(bot.botFace(t).channels[ch("smile")]);
    const held = smile.filter((x) => x > 0.5).length * 33;
    expect(held).toBeGreaterThan(2500); // a smile held for about 3 s in one cycle
    current = card("Grumpy faces");
    // The current hold finishes as a smile (no mid-hold switch); the next cycle is a frown.
    const frown = bot.botFace(2 * 5500 + 2000).channels[ch("mouthFrown")];
    expect(frown).toBeGreaterThan(0.3);
  });
});
