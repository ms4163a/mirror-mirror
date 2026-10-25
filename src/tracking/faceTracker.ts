// Wraps MediaPipe FaceLandmarker: runs it on new camera frames, keeps each
// player's identity stable, and turns each face into the sync channel vector.
import {
  FaceLandmarker,
  FilesetResolver,
  type Category,
  type FaceLandmarkerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { ChannelMapper, NUM_CHANNELS } from "../signal/channels";
import { OneEuroVector } from "../signal/oneEuro";

export type Delegate = "GPU" | "CPU";

export async function createLandmarker(preferred?: Delegate): Promise<{ landmarker: FaceLandmarker; delegate: Delegate }> {
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  const order: Delegate[] = preferred === "CPU" ? ["CPU"] : ["GPU", "CPU"];
  for (const delegate of order) {
    try {
      const landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate },
        runningMode: "VIDEO",
        numFaces: 2,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      return { landmarker, delegate };
    } catch (err) {
      console.warn(`FaceLandmarker ${delegate} delegate failed`, err);
    }
  }
  throw new Error("Could not create FaceLandmarker with any delegate");
}

export { openCamera } from "./camera";

export interface PlayerFrame {
  present: boolean;
  channels: Float64Array;
  landmarks: NormalizedLandmark[] | null;
  blendshapes: Category[] | null;
}

export interface TrackerFrame {
  t: number;
  /** [left player, right player] as seen on the mirrored screen. */
  players: [PlayerFrame, PlayerFrame];
}

/**
 * Assigns detected faces to players 0 (screen left) and 1 (screen right). The
 * display is mirrored, so screen-left is the larger raw x. With one face it
 * goes to the player whose last position is closest, so players don't swap
 * when someone ducks out of frame.
 */
export class PlayerAssigner {
  private lastX: [number | null, number | null] = [null, null];

  assign(centroids: number[]): [number | null, number | null] {
    if (centroids.length >= 2) {
      const [i, j] = centroids[0] > centroids[1] ? [0, 1] : [1, 0];
      this.lastX = [centroids[i], centroids[j]];
      return [i, j];
    }
    if (centroids.length === 1) {
      const x = centroids[0];
      const d = this.lastX.map((lx) => (lx === null ? null : Math.abs(lx - x)));
      let p: 0 | 1;
      if (d[0] !== null && d[1] !== null) p = d[0] <= d[1] ? 0 : 1;
      else if (d[0] !== null) p = d[0] < 0.25 ? 0 : 1;
      else if (d[1] !== null) p = d[1] < 0.25 ? 1 : 0;
      else p = x > 0.5 ? 0 : 1;
      this.lastX[p] = x;
      return p === 0 ? [0, null] : [null, 0];
    }
    return [null, null];
  }

  reset() {
    this.lastX = [null, null];
  }
}

export class FaceTracker {
  private lastVideoTime = -1;
  private lastTs = -1;
  private readonly assigner = new PlayerAssigner();
  // ?brows=geo turns on the experimental geometric angry-brow measurement. It is
  // off by default: it works on the 2D image, so head nods and tilts read as scowls.
  private readonly mappers = (() => {
    const browGeometry = new URLSearchParams(location.search).get("brows") === "geo";
    return [new ChannelMapper({ browGeometry }), new ChannelMapper({ browGeometry })];
  })();
  // Smooths webcam jitter per player (see signal/oneEuro.ts). Disable with ?filter=off.
  private readonly filters = new URLSearchParams(location.search).get("filter") === "off"
    ? null
    : [new OneEuroVector(NUM_CHANNELS), new OneEuroVector(NUM_CHANNELS)];
  lastResult: FaceLandmarkerResult | null = null;

  constructor(
    readonly landmarker: FaceLandmarker,
    readonly source: HTMLVideoElement | HTMLCanvasElement,
  ) {}

  /** Runs detection if the camera has a new frame; otherwise returns null. */
  poll(now = performance.now()): TrackerFrame | null {
    const src = this.source;
    if (src instanceof HTMLVideoElement) {
      if (src.readyState < 2 || src.currentTime === this.lastVideoTime) return null;
      this.lastVideoTime = src.currentTime;
    }
    const ts = now <= this.lastTs ? this.lastTs + 0.001 : now;
    this.lastTs = ts;
    const result = this.landmarker.detectForVideo(src, ts);
    this.lastResult = result;
    return this.toFrame(ts, result);
  }

  /** Width / height of the camera image (landmarks are normalized per axis). */
  private aspect(): number {
    const s = this.source;
    const w = s instanceof HTMLVideoElement ? s.videoWidth : s.width;
    const h = s instanceof HTMLVideoElement ? s.videoHeight : s.height;
    return w > 0 && h > 0 ? w / h : 16 / 9;
  }

  private smooth(p: number, t: number, v: Float64Array): Float64Array {
    return this.filters ? this.filters[p].filter(t, v) : v;
  }

  private toFrame(t: number, r: FaceLandmarkerResult): TrackerFrame {
    const centroids = r.faceLandmarks.map((lms) => lms.reduce((s, p) => s + p.x, 0) / lms.length);
    const slots = this.assigner.assign(centroids);
    const players = slots.map((faceIdx, p): PlayerFrame => {
      const shapes = faceIdx === null ? undefined : r.faceBlendshapes?.[faceIdx];
      if (faceIdx === null || !shapes) {
        return { present: false, channels: new Float64Array(NUM_CHANNELS), landmarks: null, blendshapes: null };
      }
      return {
        present: true,
        channels: this.smooth(
          p,
          t,
          this.mappers[p].map(shapes.categories, r.facialTransformationMatrixes?.[faceIdx], r.faceLandmarks[faceIdx], this.aspect()),
        ),
        landmarks: r.faceLandmarks[faceIdx],
        blendshapes: shapes.categories,
      };
    }) as [PlayerFrame, PlayerFrame];
    return { t, players };
  }
}
