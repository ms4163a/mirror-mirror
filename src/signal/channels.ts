// Turns one face's raw MediaPipe output into the conditioned channel vector the
// sync engine compares.
//
// Left/right blendshape pairs are averaged ("folded"). When you mirror someone,
// your left brow answers their right brow, so folding makes the score the same
// whether players mirror or copy. Head yaw and roll use absolute values for the
// same reason. Gaze channels are dropped: both players look at the screen, so
// gaze says nothing about mirroring.
import type { Category, Matrix } from "@mediapipe/tasks-vision";

export type Family = "smile" | "surprise" | "frown" | "jaw" | "pucker" | "eyes" | "puff" | "head";

export const FAMILIES: { id: Family; label: string }[] = [
  { id: "smile", label: "Smile" },
  { id: "surprise", label: "Brows up" },
  { id: "frown", label: "Frown" },
  { id: "jaw", label: "Mouth open" },
  { id: "pucker", label: "Pucker" },
  { id: "eyes", label: "Eyes" },
  { id: "puff", label: "Puff & press" },
  { id: "head", label: "Head moves" },
];

export interface ChannelDef {
  name: string;
  family: Family;
  /** Blendshape names averaged into this channel (empty for head pose). */
  sources: string[];
  /** Std over the window above which the channel counts as "moving". */
  floor: number;
  /** Weight in the aggregate. Blinks are frequent and involuntary, so they count less. */
  weight: number;
  /** Whether this channel can satisfy the anti-stillness gate. */
  countsAsActivity: boolean;
}

const bs = (name: string, family: Family, sources: string[], weight = 1, countsAsActivity = true): ChannelDef => ({
  name,
  family,
  sources,
  floor: 0.03,
  weight,
  countsAsActivity,
});
const pair = (base: string) => [`${base}Left`, `${base}Right`];

export const CHANNELS: ChannelDef[] = [
  bs("smile", "smile", pair("mouthSmile")),
  bs("cheekSquint", "smile", pair("cheekSquint")),
  bs("dimple", "smile", pair("mouthDimple")),
  // Brows, eyes and head pose carried little mirroring signal in real play
  // (they correlated about as well by chance), so they count for less. The
  // mouth channels separated real mirroring from chance best.
  bs("browInnerUp", "surprise", ["browInnerUp"], 0.5),
  bs("browOuterUp", "surprise", pair("browOuterUp"), 0.5),
  bs("eyeWide", "surprise", pair("eyeWide")),
  bs("browDown", "frown", pair("browDown"), 0.5),
  bs("mouthFrown", "frown", pair("mouthFrown")),
  bs("noseSneer", "frown", pair("noseSneer")),
  bs("jawOpen", "jaw", ["jawOpen"]),
  bs("mouthLowerDown", "jaw", pair("mouthLowerDown")),
  bs("mouthUpperUp", "jaw", pair("mouthUpperUp")),
  bs("mouthPucker", "pucker", ["mouthPucker"]),
  bs("mouthFunnel", "pucker", ["mouthFunnel"]),
  bs("eyeBlink", "eyes", pair("eyeBlink"), 0, false),
  bs("eyeSquint", "eyes", pair("eyeSquint"), 0.25),
  bs("cheekPuff", "puff", ["cheekPuff"]),
  bs("mouthPress", "puff", pair("mouthPress")),
  // Pitch and roll depend on where each camera sits, so two players' values differ
  // even when they mirror. Only yaw (turning) carries signal.
  { name: "headYaw", family: "head", sources: [], floor: 0.03, weight: 0.5, countsAsActivity: true },
  { name: "headPitch", family: "head", sources: [], floor: 0.03, weight: 0, countsAsActivity: true },
  { name: "headRoll", family: "head", sources: [], floor: 0.03, weight: 0, countsAsActivity: true },
];

export const NUM_CHANNELS = CHANNELS.length;
const HEAD_YAW = CHANNELS.findIndex((c) => c.name === "headYaw");

/** Head angles in radians are divided by these so a big head move is about 1. */
const YAW_SCALE = 0.5;
const PITCH_SCALE = 0.4;
const ROLL_SCALE = 0.4;

/** Yaw/pitch/roll (radians) from MediaPipe's column-major 4x4 facial transform. */
export function headAngles(m: Matrix): { yaw: number; pitch: number; roll: number } {
  const d = m.data;
  const r = (row: number, col: number) => d[col * 4 + row];
  const yaw = Math.asin(Math.max(-1, Math.min(1, -r(2, 0))));
  const pitch = Math.atan2(r(2, 1), r(2, 2));
  const roll = Math.atan2(r(1, 0), r(0, 0));
  return { yaw, pitch, roll };
}

/**
 * Builds the conditioned vector for one face. The name-to-index map is built
 * from the first result, so a change in model category order is harmless.
 */
export class ChannelMapper {
  private sourceIdx: number[][] | null = null;

  map(categories: Category[], matrix?: Matrix, out: Float64Array = new Float64Array(NUM_CHANNELS)): Float64Array {
    if (!this.sourceIdx) {
      const index = new Map(categories.map((c, i) => [c.categoryName, i]));
      this.sourceIdx = CHANNELS.map((ch) =>
        ch.sources.map((s) => {
          const i = index.get(s);
          if (i === undefined) throw new Error(`Blendshape ${s} missing from model output`);
          return i;
        }),
      );
    }
    for (let c = 0; c < HEAD_YAW; c++) {
      const idx = this.sourceIdx[c];
      let sum = 0;
      for (const i of idx) sum += categories[i].score;
      out[c] = sum / idx.length;
    }
    if (matrix) {
      const { yaw, pitch, roll } = headAngles(matrix);
      out[HEAD_YAW] = Math.abs(yaw) / YAW_SCALE;
      out[HEAD_YAW + 1] = pitch / PITCH_SCALE;
      out[HEAD_YAW + 2] = Math.abs(roll) / ROLL_SCALE;
    } else {
      out[HEAD_YAW] = out[HEAD_YAW + 1] = out[HEAD_YAW + 2] = 0;
    }
    return out;
  }
}
