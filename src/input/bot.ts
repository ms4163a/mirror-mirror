// Single-player practice: the camera player is Left, a bot is Right.
//
// The bot behaves like a person leading a mirror game: it picks an expression
// that fits the current prompt card, eases into it, HOLDS it for about 3 s so
// the player has time to copy it, relaxes, and pauses before the next one. It
// blinks now and then. During "Left player leads" it follows the player instead,
// smoothly and a little late, like a human follower. Bot rounds count as test
// rounds, so they stay off the main leaderboard.
import type { PromptCard } from "../game/prompts";
import { CHANNELS, NUM_CHANNELS } from "../signal/channels";
import { rng } from "../sync/synthetic";
import type { PlayerFrame, TrackerFrame } from "../tracking/faceTracker";
import type { FrameSource } from "./sources";

const ATTACK_MS = 500;
const HOLD_MS = 3200;
const RELEASE_MS = 500;
const PAUSE_MS = 1300;
const CYCLE_MS = ATTACK_MS + HOLD_MS + RELEASE_MS + PAUSE_MS;
const FOLLOW_DELAY_MS = 600;
const FOLLOW_GAIN = 0.85;

type Pose = Partial<Record<string, number>>;

/** Clear, believable versions of each expression (typical playtest values). */
const POSES: Record<string, Pose> = {
  smile: { smile: 0.7, cheekSquint: 0.3, eyeSquint: 0.35, dimple: 0.15 },
  surprise: { browInnerUp: 0.6, browOuterUp: 0.6, eyeWide: 0.3, jawOpen: 0.4, mouthLowerDown: 0.3 },
  frown: { browDown: 0.45, mouthFrown: 0.45, noseSneer: 0.2, mouthPress: 0.2 },
  jaw: { jawOpen: 0.55, mouthLowerDown: 0.45, mouthUpperUp: 0.2 },
  pucker: { mouthPucker: 0.65, mouthFunnel: 0.3 },
};
const ROTATION: (keyof typeof POSES)[] = ["smile", "surprise", "frown", "jaw", "pucker"];

/** The expression a prompt card asks for, or null for "anything". */
function poseFor(card: PromptCard | null): keyof typeof POSES | null {
  const text = card ? `${card.title} ${card.hint}` : "";
  if (/smile/i.test(text)) return "smile";
  if (/surprise|eyebrows way up/i.test(text)) return "surprise";
  if (/grump|frown|scrunch/i.test(text)) return "frown";
  return null;
}

const idx = new Map(CHANNELS.map((c, i) => [c.name, i]));

export class BotSource implements FrameSource {
  readonly kind = "sim";
  private readonly past: { t: number; v: Float64Array | null }[] = [];
  private readonly follow = new Float64Array(NUM_CHANNELS);
  private lastT = NaN;
  /** Expression chosen for each hold cycle, fixed once chosen so it never switches mid-hold. */
  private readonly chosen = new Map<number, { pose: keyof typeof POSES; scale: number }>();
  private readonly r = rng(11);

  constructor(
    private readonly camera: FrameSource,
    /** Current prompt card during a round, or null in the lobby. */
    private readonly card: () => PromptCard | null,
  ) {}

  poll(now: number): TrackerFrame | null {
    const frame = this.camera.poll(now);
    if (!frame) return null;
    const me = frame.players.find((p) => p.present) ?? frame.players[0];
    this.past.push({ t: frame.t, v: me.present ? me.channels.slice() : null });
    while (this.past.length > 2 && this.past[1].t < frame.t - FOLLOW_DELAY_MS - 500) this.past.shift();
    return { t: frame.t, players: [me, this.botFace(frame.t)] };
  }

  /** The bot's face at time t. */
  botFace(t: number): PlayerFrame {
    const card = this.card();
    const v = new Float64Array(NUM_CHANNELS);
    const dt = Number.isNaN(this.lastT) ? 33 : Math.max(1, t - this.lastT);
    this.lastT = t;

    if (card === null || card.lead === "left") {
      // Follow the player: their face from FOLLOW_DELAY_MS ago, smoothed like a human follower.
      let seen: Float64Array | null = null;
      for (const s of this.past) if (s.t <= t - FOLLOW_DELAY_MS) seen = s.v;
      const k = 1 - Math.exp(-dt / 250);
      for (let c = 0; c < v.length; c++) {
        this.follow[c] += ((seen ? FOLLOW_GAIN * seen[c] : 0) - this.follow[c]) * k;
        v[c] = this.follow[c];
      }
    } else {
      // Lead: hold one expression per cycle.
      const cycle = Math.floor(t / CYCLE_MS);
      let pick = this.chosen.get(cycle);
      if (!pick) {
        const wanted = poseFor(card);
        pick = { pose: wanted ?? ROTATION[cycle % ROTATION.length], scale: 0.85 + 0.25 * this.r() };
        this.chosen.set(cycle, pick);
        if (this.chosen.size > 50) this.chosen.delete(Math.min(...this.chosen.keys()));
      }
      const u = t - cycle * CYCLE_MS;
      const env =
        u < ATTACK_MS ? u / ATTACK_MS
        : u < ATTACK_MS + HOLD_MS ? 1
        : u < ATTACK_MS + HOLD_MS + RELEASE_MS ? 1 - (u - ATTACK_MS - HOLD_MS) / RELEASE_MS
        : 0;
      const ease = env * env * (3 - 2 * env);
      for (const [name, amt] of Object.entries(POSES[pick.pose])) v[idx.get(name)!] = (amt ?? 0) * pick.scale * ease;
      // Keep the follow state in step so switching back to following isn't a jump.
      this.follow.set(v);
    }

    // Small signs of life: a blink about every 4 s and a slight head sway.
    const blink = (t % 4100) < 150 ? 1 : 0;
    v[idx.get("eyeBlink")!] = Math.max(v[idx.get("eyeBlink")!], blink);
    v[idx.get("headYaw")!] += 0.04 * (1 + Math.sin(t / 1700));
    return { present: true, channels: v, landmarks: null, blendshapes: null };
  }
}


