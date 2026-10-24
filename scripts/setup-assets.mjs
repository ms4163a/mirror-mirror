// Copies the MediaPipe wasm runtime out of node_modules and makes sure the face
// model is present, so the app runs fully offline (no CDN at runtime).
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDst = join(root, "public/mediapipe/wasm");
const modelPath = join(root, "public/models/face_landmarker.task");
const modelUrl =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

mkdirSync(wasmDst, { recursive: true });
cpSync(wasmSrc, wasmDst, { recursive: true });

if (!existsSync(modelPath)) {
  console.log(`Downloading face model -> ${modelPath}`);
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
  mkdirSync(dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
}
