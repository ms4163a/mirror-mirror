// Reads the files a human drops on the tuner: either the full "Download round
// data" JSON ({ recap, samples, recording }) or a bare recording.
import { checkRecording, type Recording } from "../replay/recording";

export interface LoadedRound {
  name: string;
  recording: Recording;
  /** Result the live game showed for this round, when the file has one. */
  liveHeight: number | null;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isVec = (x: unknown) => x === null || (Array.isArray(x) && x.every(isNum));
/** A player's slot in a frame: absent (no sample this frame, as in remote play), null (face missing) or a vector. */
const isSlot = (x: unknown) => x === undefined || isVec(x);

/** Throws a message a human can act on if `x` isn't a usable recording. */
export function assertRecording(x: unknown): asserts x is Recording {
  if (!isObject(x)) throw new Error("Recording is not an object");
  if (x.version !== 1) throw new Error(`Unsupported recording version ${String(x.version)}`);
  if (!Array.isArray(x.channels) || !x.channels.every((c) => typeof c === "string")) {
    throw new Error("Recording has no channel list");
  }
  if (!isNum(x.roundMs) || x.roundMs <= 0) throw new Error("Recording has no valid round length");
  if (!isObject(x.marks) || !Object.values(x.marks).every(isNum)) throw new Error("Recording marks are malformed");
  if (!Array.isArray(x.frames) || x.frames.length === 0) throw new Error("Recording has no frames");
  const width = x.channels.length;
  for (const f of x.frames) {
    if (!isObject(f) || !isNum(f.t) || !isSlot(f.a) || !isSlot(f.b)) throw new Error("Recording has a malformed frame");
    // Remote games record one player per frame, so either side may be absent, but not both.
    if (f.a === undefined && f.b === undefined) throw new Error("Recording has a frame with no player data");
    for (const v of [f.a, f.b]) if (Array.isArray(v) && v.length !== width) throw new Error("Recording frame has the wrong width");
  }
}

/** Parses one dropped file's text. `name` is only used for labels and errors. */
export function parseRoundFile(name: string, text: string): LoadedRound {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${name}: not valid JSON`);
  }
  if (!isObject(data)) throw new Error(`${name}: expected a JSON object`);

  let candidate: unknown;
  let liveHeight: number | null = null;
  if ("frames" in data) {
    candidate = data;
  } else if ("recording" in data || "recap" in data || "samples" in data) {
    candidate = data.recording;
    if (candidate === undefined || candidate === null) {
      throw new Error(`${name}: this round was saved without a recording (it predates replay support)`);
    }
    const recap = data.recap;
    if (isObject(recap) && isNum(recap.height)) liveHeight = recap.height;
  } else {
    throw new Error(`${name}: no recording found (expected "recording" or "frames")`);
  }

  try {
    assertRecording(candidate);
    checkRecording(candidate); // same channel set as this build, or it can't be re-scored
  } catch (err) {
    throw new Error(`${name}: ${(err as Error).message}`);
  }
  return { name, recording: candidate, liveHeight };
}

/** Parses many files, keeping the ones that work and the errors for the rest. */
export function parseRoundFiles(files: { name: string; text: string }[]) {
  const loaded: LoadedRound[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try {
      loaded.push(parseRoundFile(f.name, f.text));
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  return { loaded, errors };
}
