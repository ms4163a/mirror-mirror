// Geometric "angry brows" signal from face landmarks.
//
// MediaPipe's browDown blendshape barely responds for some faces (playtesters
// reported scowls not registering). This measures the brows directly from the
// face mesh:
//   - how far the inner brows drop toward the eyes,
//   - how much the inner ends sit lower than the outer ends (the brow "angle"),
//   - how close the inner brows pull together (the furrow).
// Distances are measured along the face's own axes, in units of the eye-corner
// distance, so head roll and face size don't matter.
//
// The mesh moves the brows only a little for some faces, so sensitivity is
// self-calibrating: the output is scaled by this player's own frame-to-frame
// jitter, which makes any real brow movement well above noise clearly visible.
// ChannelMapper feeds max(blendshape, this) into the browDown channel.
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// MediaPipe face-mesh indices per side: upper lid, inner brow, outer brow.
const SIDES = [
  { lid: 159, inner: 55, outer: 46 },
  { lid: 386, inner: 285, outer: 276 },
];
const EYE_A = 33;
const EYE_B = 263;

/** Smallest change (eye-distance units) that counts as a full scowl, however quiet the tracking. */
const MIN_FULL = 0.012;
/** A full scowl is this many times the player's typical frame-to-frame jitter. */
const JITTER_MULT = 10;
/** Output for a full scowl, in browDown blendshape units (clear scowls read ~0.3-0.5). */
const OUTPUT_SCALE = 0.6;
/** Resting-level adaptation per frame (about 10 s at 30 fps). */
const REST_RATE = 0.003;

/** Raw anger measure: higher when the inner brows are lower, angled down, and pulled together. */
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
  const across = (i: number) => {
    const q = p(i);
    return ((q.x - a.x) * ux + (q.y - a.y) * uy) / iod;
  };
  let sum = 0;
  for (const s of SIDES) {
    const gap = down(s.lid) - down(s.inner); // brow-to-lid distance; shrinks when scowling
    const slope = down(s.inner) - down(s.outer); // inner end lower than outer end when angry
    sum += slope - gap;
  }
  const innerDist = Math.abs(across(SIDES[1].inner) - across(SIDES[0].inner)); // shrinks in a furrow
  return sum / SIDES.length - innerDist;
}

export class BrowGeometry {
  private rest = NaN;
  private prev = NaN;
  private jitter = 0;

  /** Returns brow lowering in browDown units (0 at rest), or 0 if landmarks are missing. */
  update(lm: NormalizedLandmark[] | null | undefined, aspect: number): number {
    const raw = lm ? browRaw(lm, aspect) : null;
    if (raw === null) return 0;
    if (Number.isNaN(this.rest)) {
      this.rest = raw;
      this.prev = raw;
    }
    this.jitter += (Math.abs(raw - this.prev) - this.jitter) * 0.05;
    this.prev = raw;
    this.rest += (raw - this.rest) * REST_RATE;
    const full = Math.max(MIN_FULL, JITTER_MULT * this.jitter);
    return OUTPUT_SCALE * Math.max(0, Math.min(1, (raw - this.rest) / full));
  }
}
