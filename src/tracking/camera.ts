// Camera selection and opening.
//
// Laptops often list a virtual camera first (Phone Link's "Pixel 6a (Windows
// Virtual Camera)", OBS, Snap Camera…), and the browser's default can be one of
// them. We prefer a real camera, allow ?camera=<label text>, and remember the
// player's pick. A slow permission prompt calls `onSlow` instead of hanging silently.

const VIRTUAL_RE = /virtual|obs|snap camera|droidcam|epoccam|nvidia broadcast|xsplit|manycam|iriun|camo\b/i;
const SAVED_KEY = "mm.cameraId";

export interface CameraInfo {
  deviceId: string;
  label: string;
}

export async function listCameras(): Promise<CameraInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput").map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

export const isVirtualCamera = (label: string) => VIRTUAL_RE.test(label);

/**
 * Picks a camera: a label containing `prefer`, else the first real camera, else
 * the first. Returns undefined when labels aren't visible yet (no permission).
 */
export function pickCamera(cams: CameraInfo[], prefer?: string | null): string | undefined {
  const labeled = cams.filter((c) => c.label);
  if (!labeled.length) return undefined;
  if (prefer) {
    const m = labeled.find((c) => c.label.toLowerCase().includes(prefer.toLowerCase()));
    if (m) return m.deviceId;
  }
  return (labeled.find((c) => !isVirtualCamera(c.label)) ?? labeled[0]).deviceId;
}

function savedCamera(): string | null {
  try {
    return localStorage.getItem(SAVED_KEY);
  } catch {
    return null;
  }
}

export function rememberCamera(deviceId: string) {
  try {
    localStorage.setItem(SAVED_KEY, deviceId);
  } catch {
    // ignore
  }
}

const constraints = (deviceId?: string): MediaStreamConstraints => ({
  video: {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  },
  audio: false,
});

function stop(video: HTMLVideoElement) {
  const s = video.srcObject as MediaStream | null;
  s?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

export interface OpenCameraOptions {
  /** Open exactly this device (camera picker). */
  deviceId?: string;
  /** Label substring to prefer (?camera=). */
  prefer?: string | null;
  /** Called if the camera hasn't opened after `slowMs` (usually a pending permission prompt). */
  onSlow?: () => void;
  slowMs?: number;
}

/** Opens a camera into `video` and returns the one that was opened. */
export async function openCamera(video: HTMLVideoElement, opts: OpenCameraOptions = {}): Promise<CameraInfo> {
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error(
      "The camera only works on https:// or localhost. Open the https:// link, or use this computer's own browser.",
    );
    err.name = "InsecureContext";
    throw err;
  }
  stop(video);
  const get = (id?: string) => navigator.mediaDevices.getUserMedia(constraints(id));

  // With permission already granted, labels are visible and we can choose up front.
  const remembered = opts.prefer ? undefined : (savedCamera() ?? undefined);
  let target = opts.deviceId ?? remembered ?? pickCamera(await listCameras(), opts.prefer);
  const slow = window.setTimeout(() => opts.onSlow?.(), opts.slowMs ?? 5000);
  let stream: MediaStream;
  try {
    try {
      stream = await get(target);
    } catch (err) {
      // A remembered camera that's gone (unplugged) shouldn't block the game.
      if (target && !opts.deviceId && (err as Error).name === "OverconstrainedError") {
        target = undefined;
        stream = await get();
      } else throw err;
    }
  } finally {
    clearTimeout(slow);
  }

  // First visit: permission was just granted, so labels are visible now. If the
  // browser's default is a virtual camera, switch to a real one.
  if (!target) {
    const better = pickCamera(await listCameras(), opts.prefer);
    const current = stream.getVideoTracks()[0]?.getSettings().deviceId;
    if (better && current && better !== current) {
      stream.getTracks().forEach((t) => t.stop());
      stream = await get(better);
    }
  }

  video.srcObject = stream;
  await video.play();
  const track = stream.getVideoTracks()[0];
  return { deviceId: track?.getSettings().deviceId ?? "", label: track?.label ?? "" };
}

/** Plain-language explanation of a camera error, with what to do about it. */
export function cameraErrorMessage(err: unknown): string {
  const e = err as Error | undefined;
  switch (e?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission was blocked. Click the camera icon at the right end of the address bar, choose Allow, then reload.";
    case "NotReadableError":
    case "AbortError":
      return "The camera is busy or failed to start. Close other apps that might use it (Zoom, Teams, OBS, Phone Link, the Camera app), then reload.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found. Plug one in or enable it, then reload.";
    case "InsecureContext":
      return e.message;
    default:
      return `Couldn't start the camera (${e?.name || "unknown error"}: ${e?.message ?? String(err)}).`;
  }
}

/** Fills a <select> with the cameras and calls onPick when the player chooses one. Returns the count. */
export async function fillCameraPicker(select: HTMLSelectElement, currentId: string, onPick: (id: string) => void) {
  const cams = (await listCameras()).filter((c) => c.label);
  select.innerHTML = "";
  for (const c of cams) {
    const opt = document.createElement("option");
    opt.value = c.deviceId;
    opt.textContent = c.label + (isVirtualCamera(c.label) ? " (virtual)" : "");
    select.append(opt);
  }
  select.value = currentId;
  select.onchange = () => onPick(select.value);
  return cams.length;
}
