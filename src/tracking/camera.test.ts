import { describe, expect, it } from "vitest";
import { cameraErrorMessage, isVirtualCamera, pickCamera } from "./camera";

const cams = [
  { deviceId: "v", label: "Pixel 6a (Windows Virtual Camera)" },
  { deviceId: "u", label: "USB2.0 HD UVC WebCam" },
  { deviceId: "o", label: "OBS Virtual Camera" },
];

describe("camera choice", () => {
  it("skips virtual cameras listed first (the demo laptop's case)", () => {
    expect(pickCamera(cams)).toBe("u");
  });

  it("honours ?camera= label text, even for a virtual camera", () => {
    expect(pickCamera(cams, "pixel")).toBe("v");
    expect(pickCamera(cams, "no such cam")).toBe("u");
  });

  it("returns undefined before permission (no labels yet)", () => {
    expect(pickCamera([{ deviceId: "", label: "" }])).toBeUndefined();
  });

  it("recognises common virtual cameras", () => {
    expect(isVirtualCamera("OBS Virtual Camera")).toBe(true);
    expect(isVirtualCamera("Integrated Webcam")).toBe(false);
  });

  it("explains errors in plain language", () => {
    const e = (name: string) => Object.assign(new Error("x"), { name });
    expect(cameraErrorMessage(e("NotAllowedError"))).toMatch(/address bar/);
    expect(cameraErrorMessage(e("NotReadableError"))).toMatch(/Close other apps/);
  });
});
