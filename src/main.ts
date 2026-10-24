// Phase 2 feasibility test: track two faces from one webcam and show fps plus
// live blendshape values. Everything is served locally, so it works offline.
//
// URL options:
//   ?delegate=CPU        force the CPU delegate (default tries GPU, falls back to CPU)
//   ?bench=<image url>   benchmark without a camera: the image is drawn twice side
//                        by side and fed to the tracker every animation frame
import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from "@mediapipe/tasks-vision";

const params = new URLSearchParams(location.search);
const benchUrl = params.get("bench");

const video = document.getElementById("video") as HTMLVideoElement;
const overlay = document.getElementById("overlay") as HTMLCanvasElement;
const octx = overlay.getContext("2d")!;
const $ = (id: string) => document.getElementById(id)!;

type Stats = { status: string; delegate: string; faces: number; fps: number; fps2: number; inferMs: number };
const stats: Stats = { status: "loading", delegate: "-", faces: 0, fps: 0, fps2: 0, inferMs: 0 };
(window as unknown as { __mm: Stats }).__mm = stats;

function setStatus(s: string) {
  stats.status = s;
  $("status").textContent = s;
}

async function createLandmarker(delegate: "GPU" | "CPU") {
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate },
    runningMode: "VIDEO",
    numFaces: 2,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
}

async function initLandmarker(): Promise<FaceLandmarker> {
  const forced = params.get("delegate")?.toUpperCase();
  const order: ("GPU" | "CPU")[] = forced === "CPU" ? ["CPU"] : ["GPU", "CPU"];
  for (const d of order) {
    try {
      const lm = await createLandmarker(d);
      stats.delegate = d;
      $("delegate").textContent = d;
      return lm;
    } catch (err) {
      console.warn(`FaceLandmarker ${d} delegate failed`, err);
    }
  }
  throw new Error("Could not create FaceLandmarker with any delegate");
}

// Returns the element the tracker reads from, sized like the video it stands for.
async function initSource(): Promise<HTMLVideoElement | HTMLCanvasElement> {
  if (benchUrl) {
    const img = new Image();
    img.src = benchUrl;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width * 2;
    canvas.height = img.height;
    const c = canvas.getContext("2d")!;
    c.drawImage(img, 0, 0);
    c.drawImage(img, img.width, 0);
    canvas.id = "video";
    video.replaceWith(canvas);
    return canvas;
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return video;
}

// --- blendshape panels -----------------------------------------------------
const panelBars: HTMLElement[][] = [[], []];

function buildPanels(names: string[]) {
  for (let p = 0; p < 2; p++) {
    const host = document.querySelector(`#panel-${p} .bars`)!;
    host.innerHTML = "";
    panelBars[p] = names.map((name) => {
      const row = document.createElement("div");
      row.className = "bar";
      row.innerHTML = `<label>${name}</label><div class="track"><div class="fill"></div></div><output>0.00</output>`;
      host.appendChild(row);
      return row;
    });
  }
}

// Faces come back in arbitrary order. Display is mirrored (selfie view), so the
// player on the left of the screen has the larger raw x.
function orderFaces(result: FaceLandmarkerResult): number[] {
  const cx = result.faceLandmarks.map((lms) => lms.reduce((s, p) => s + p.x, 0) / lms.length);
  return cx.map((_, i) => i).sort((a, b) => cx[b] - cx[a]);
}

function updatePanels(result: FaceLandmarkerResult, order: number[]) {
  const shapes = result.faceBlendshapes ?? [];
  if (shapes.length && panelBars[0].length === 0) buildPanels(shapes[0].categories.map((c) => c.categoryName));
  for (let p = 0; p < 2; p++) {
    const face = order[p] !== undefined ? shapes[order[p]] : undefined;
    document.getElementById(`panel-${p}`)!.classList.toggle("missing", !face);
    panelBars[p].forEach((row, i) => {
      const v = face?.categories[i]?.score ?? 0;
      (row.children[1].firstElementChild as HTMLElement).style.width = `${(v * 100).toFixed(1)}%`;
      (row.children[2] as HTMLOutputElement).value = v.toFixed(2);
      row.classList.toggle("hot", v > 0.3);
    });
  }
}

// --- overlay ----------------------------------------------------------------
const COLORS = ["#ff7a59", "#4fc3f7"];

function drawOverlay(result: FaceLandmarkerResult, order: number[], w: number, h: number) {
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w;
    overlay.height = h;
  }
  octx.clearRect(0, 0, w, h);
  order.forEach((faceIdx, player) => {
    const lms = result.faceLandmarks[faceIdx];
    octx.beginPath();
    for (const { start, end } of FaceLandmarker.FACE_LANDMARKS_FACE_OVAL) {
      octx.moveTo(lms[start].x * w, lms[start].y * h);
      octx.lineTo(lms[end].x * w, lms[end].y * h);
    }
    // Dark under-stroke keeps the colored outline visible against skin tones.
    octx.lineWidth = 6;
    octx.strokeStyle = "rgba(0,0,0,0.6)";
    octx.stroke();
    octx.lineWidth = 3;
    octx.strokeStyle = COLORS[player];
    octx.stroke();
  });
}

// --- main loop --------------------------------------------------------------
async function main() {
  try {
    setStatus("starting camera");
    const source = await initSource();
    setStatus("loading model");
    const landmarker = await initLandmarker();
    setStatus("running");

    let lastTs = -1;
    let frames = 0;
    let twoFaceFrames = 0;
    let inferSum = 0;
    let windowStart = performance.now();
    let lastVideoTime = -1;
    let lastPanelUpdate = 0;

    const tick = () => {
      requestAnimationFrame(tick);
      // Only run inference on new camera frames; the bench canvas always counts as new.
      if (source instanceof HTMLVideoElement) {
        if (source.currentTime === lastVideoTime) return;
        lastVideoTime = source.currentTime;
      }
      let ts = performance.now();
      if (ts <= lastTs) ts = lastTs + 0.001;
      lastTs = ts;

      const t0 = performance.now();
      const result = landmarker.detectForVideo(source, ts);
      inferSum += performance.now() - t0;
      frames++;
      const n = result.faceLandmarks.length;
      if (n === 2) twoFaceFrames++;

      const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
      const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
      const order = orderFaces(result);
      drawOverlay(result, order, w, h);

      const now = performance.now();
      if (now - lastPanelUpdate > 66) {
        lastPanelUpdate = now;
        updatePanels(result, order);
        stats.faces = n;
        $("faces").textContent = String(n);
      }
      if (now - windowStart >= 1000) {
        const secs = (now - windowStart) / 1000;
        stats.fps = +(frames / secs).toFixed(1);
        stats.fps2 = +(twoFaceFrames / secs).toFixed(1);
        stats.inferMs = +(inferSum / Math.max(frames, 1)).toFixed(1);
        $("fps").textContent = String(stats.fps);
        $("fps2").textContent = String(stats.fps2);
        $("ms").textContent = String(stats.inferMs);
        $("fps2").className = stats.fps2 >= 20 ? "ok" : "bad";
        frames = twoFaceFrames = inferSum = 0;
        windowStart = now;
      }
    };
    requestAnimationFrame(tick);
  } catch (err) {
    console.error(err);
    setStatus(`error: ${(err as Error).message}`);
  }
}

main();
