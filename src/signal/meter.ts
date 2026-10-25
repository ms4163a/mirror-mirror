// "What the camera sees": how strongly each expression family currently reads
// for one player, 0..1, relative to that player's own resting face. Shown in
// the HUD next to the match score, so a player can tell when an expression of
// theirs isn't registering (e.g. a smile the camera reads only faintly).
import { CHANNELS, FAMILIES, type Family } from "./channels";

/** Roughly the value a clear, deliberate expression reaches (from playtest data). */
const FULL: Record<string, number> = {
  smile: 0.7, cheekSquint: 0.5, dimple: 0.3, mouthPress: 0.4, eyeSquint: 0.5,
  browInnerUp: 0.6, browOuterUp: 0.6, eyeWide: 0.4,
  // Lowered brows only reached ~0.3-0.5 in playtests, so a clear scowl is 0.35.
  browDown: 0.35, mouthFrown: 0.5, noseSneer: 0.5,
  jawOpen: 0.5, mouthLowerDown: 0.6, mouthUpperUp: 0.5,
  mouthPucker: 0.7, mouthFunnel: 0.5, cheekPuff: 0.5, headYaw: 0.6,
};

export type FamilyLevels = Record<Family, number>;

export class ExpressionMeter {
  /** Per-channel resting level: follows drops at once, rises only slowly. */
  private rest: Float64Array | null = null;
  readonly levels: FamilyLevels = Object.fromEntries(FAMILIES.map((f) => [f.id, 0])) as FamilyLevels;

  /** Call about 10 times a second with the player's latest channels (or null if no face). */
  update(channels: Float64Array | null) {
    if (!channels) {
      for (const f of FAMILIES) this.levels[f.id] *= 0.7; // fade out while the face is missing
      return;
    }
    if (!this.rest) this.rest = channels.slice();
    for (const f of FAMILIES) this.levels[f.id] = 0;
    CHANNELS.forEach((ch, c) => {
      const v = channels[c];
      const rest = this.rest!;
      // Resting level: a slow low-percentile tracker (about 20 s to adapt upward).
      rest[c] = v < rest[c] ? v : rest[c] + (v - rest[c]) * 0.005;
      const full = FULL[ch.name];
      if (!full || ch.weight <= 0) return;
      const level = Math.max(0, Math.min(1, (v - rest[c]) / full));
      if (level > this.levels[ch.family]) this.levels[ch.family] = level;
    });
  }

  reset() {
    this.rest = null;
  }
}
