// Geometric "angry brows" signal from face landmarks.
//
// MediaPipe's browDown blendshape barely responds for some faces (playtesters
// reported scowls not registering). This measures the brows directly from the
// face mesh: how far the inner brows drop toward the eyes, plus how much the
// inner ends sit lower than the outer ends (the "angle" of an angry brow).
// Everything is measured along the face's own up/down axis and in units of the
// distance between the eye corners, so head roll and face size don't matter.
// ChannelMapper feeds max(blendshape, this) into the browDown channel.
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// MediaPipe face-mesh indices: [eye outer corner, upper lid, inner brow, outer brow] per side.
const SIDES = [
  { lid: 159, inner: 55, outer: 46 },
  { lid: 386, inner: 285, outer: 276 },
];
const EYE_A = 33;
const EYE_B = 263;

/** Change (in eye-distance units) that counts as a full scowl. */
const FULL_CHANGE = 0.12;
/** Output for a full scowl, in browDown blendshape units (clear scowls read ~0.3-0.5). */
const OUTPUT_SCALE = 0.6;
/** Resting-level adaptation per frame (about 10 s at 30 fps). */
const REST_RATE = 0.003;

/** Raw anger measure: higher when the inner brows are lower (closer to the eyes, below the outer ends). */
export function browRaw(lm: NormalizedLandmark[], aspect: number): number | null {
  if (lm.length < 468) return null;
  const p = (i: number) => ({ x: lm[i].x * aspect, y: lm[i].y });
  const a = p(EYE_A);
  const b = p(EYE_B);
  const iod = Math.hypot(b.x - a.x, b.y - a.y);
  if (iod < 1e-6) return null;
  const ux = (b.x - a.x) / iod;
  const uy = (b.y - a.y) / iod;
  // Face "down" direction: eye axis rotated 90 degrees (image y points down).
  const vx = -uy;
  const vy = ux;
  const down = (i: number) => {
    const q = p(i);
    return ((q.x - a.x) * vx + (q.y - a.y) * vy) / iod;
  };
  let sum = 0;
  for (const s of SIDES) {
    const gap = down(s.lid) - down(s.inner); // brow-to-lid distance; shrinks when scowling
    const slope = down(s.inner) - down(s.outer); // inner end lower than outer end when angry
    sum += slope - gap;
  }
  return sum / SIDES.length;
}

export class BrowGeometry {
  private rest = NaN;

  /** Returns brow lowering in browDown units (0 at rest), or 0 if landmarks are missing. */
  update(lm: NormalizedLandmark[] | null | undefined, aspect: number): number {
    const raw = lm ? browRaw(lm, aspect) : null;
    if (raw === null) return 0;
    if (Number.isNaN(this.rest)) this.rest = raw;
    this.rest += (raw - this.rest) * REST_RATE;
    return OUTPUT_SCALE * Math.max(0, Math.min(1, (raw - this.rest) / FULL_CHANGE));
  }
}
