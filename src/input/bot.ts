// Single-player practice: the camera player is Left, a bot is Right.
// The bot mirrors the player about 0.65 s late (imperfectly, so the score
// isn't free) and, when the prompt says "Right player leads", performs its own
// expressions for the player to copy. Bot rounds count as test rounds, so they
// stay off the main leaderboard.
import type { LeadMode } from "../game/prompts";
import { NUM_CHANNELS } from "../signal/channels";
import { Performer, rng } from "../sync/synthetic";
import type { PlayerFrame, TrackerFrame } from "../tracking/faceTracker";
import type { FrameSource } from "./sources";

const FOLLOW_DELAY_MS = 650;
const FOLLOW_GAIN = 0.8;
/** How much of the bot's own "mind" leaks into its mirroring, so it's never perfect. */
const DISTRACTION = 0.2;

export class BotSource implements FrameSource {
  readonly kind = "sim";
  private readonly past: { t: number; v: Float64Array | null }[] = [];
  private readonly mind = new Performer(42, 3_600_000);
  private readonly noise = rng(11);

  constructor(
    private readonly camera: FrameSource,
    /** Current prompt's lead mode; "right" means the bot leads. */
    private readonly leadMode: () => LeadMode,
  ) {}

  poll(now: number): TrackerFrame | null {
    const frame = this.camera.poll(now);
    if (!frame) return null;
    const me = frame.players.find((p) => p.present) ?? frame.players[0];
    this.past.push({ t: frame.t, v: me.present ? me.channels.slice() : null });
    while (this.past.length > 2 && this.past[1].t < frame.t - FOLLOW_DELAY_MS - 500) this.past.shift();
    return { t: frame.t, players: [me, this.botFace(frame.t)] };
  }

  /** The bot's face at time t. Exposed for tests. */
  botFace(t: number): PlayerFrame {
    const v = new Float64Array(NUM_CHANNELS);
    const own = this.mind.value(t);
    if (this.leadMode() === "right") {
      v.set(own);
    } else {
      // Mirror the player's face from FOLLOW_DELAY_MS ago.
      let seen: Float64Array | null = null;
      for (const s of this.past) if (s.t <= t - FOLLOW_DELAY_MS) seen = s.v;
      for (let c = 0; c < v.length; c++) v[c] = (seen ? FOLLOW_GAIN * seen[c] : 0) + DISTRACTION * own[c];
    }
    for (let c = 0; c < v.length; c++) v[c] = Math.max(0, v[c] + 0.01 * (this.noise() - 0.5));
    return { present: true, channels: v, landmarks: null, blendshapes: null };
  }
}
