import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Recap } from "../game/recap";
import { DEFAULT_CLIMB } from "../game/round";
import type { Recording } from "../replay/recording";
import { CHANNELS } from "../signal/channels";
import { DEFAULT_SYNC_OPTIONS } from "../sync/syncEngine";
import { assertRecording, parseRoundFile, parseRoundFiles } from "./parse";
import {
  KNOBS,
  changedKnobs,
  clampSettings,
  cloneSettings,
  defaultSettings,
  getKnob,
  isDefault,
  settingsFromJson,
  settingsToJson,
  toRescoreOpts,
  withKnob,
} from "./settings";
import { debounce, deltaRow, formatDelta, meanRow, nearestIndex, summarize, type Row, type ScoredRound } from "./table";

const knob = (key: string) => KNOBS.find((k) => k.key === key)!;

const vec = (x: number) => CHANNELS.map(() => x);

function recording(over: Partial<Recording> = {}): Recording {
  return {
    version: 1,
    channels: CHANNELS.map((c) => c.name),
    roundMs: 20_000,
    marks: { calibrateStart: 0, calibrateEnd: 4000, roundStart: 4000 },
    frames: [
      { t: 0, a: vec(0), b: vec(0) },
      { t: 33.3, a: vec(0.1), b: null },
      { t: 66.7, a: vec(0.2), b: vec(0.2) },
    ],
    ...over,
  };
}

describe("parseRoundFile", () => {
  it("reads the full 'Download round data' shape", () => {
    const text = JSON.stringify({ recap: { height: 17.2 }, samples: [], recording: recording() });
    const r = parseRoundFile("a.json", text);
    expect(r.name).toBe("a.json");
    expect(r.liveHeight).toBe(17.2);
    expect(r.recording.frames).toHaveLength(3);
  });

  it("reads a bare recording", () => {
    const r = parseRoundFile("bare.json", JSON.stringify(recording()));
    expect(r.liveHeight).toBeNull();
    expect(r.recording.roundMs).toBe(20_000);
  });

  it("ignores a recap without a numeric height", () => {
    const text = JSON.stringify({ recap: { height: "tall" }, recording: recording() });
    expect(parseRoundFile("a.json", text).liveHeight).toBeNull();
  });

  it("explains a file saved before replay support", () => {
    const text = JSON.stringify({ recap: { height: 3 }, samples: [] });
    expect(() => parseRoundFile("old.json", text)).toThrow(/old\.json: .*predates replay/);
    expect(() => parseRoundFile("other.json", JSON.stringify({ hello: 1 }))).toThrow(/no recording found/);
    expect(() => parseRoundFile("old.json", JSON.stringify({ recap: {}, recording: null }))).toThrow(/predates replay/);
  });

  it("rejects bad JSON and non-objects with the file name", () => {
    expect(() => parseRoundFile("x.json", "{nope")).toThrow("x.json: not valid JSON");
    expect(() => parseRoundFile("x.json", "[1,2]")).toThrow("x.json: expected a JSON object");
  });

  it("rejects a recording made with a different channel set", () => {
    const other = recording({ channels: CHANNELS.map((c) => c.name).reverse() });
    expect(() => parseRoundFile("old-channels.json", JSON.stringify(other))).toThrow(/old-channels\.json: .*channels differ/);
  });

  it("names the file when the recording is malformed", () => {
    const bad = JSON.stringify({ recording: recording({ version: 2 as 1 }) });
    expect(() => parseRoundFile("v2.json", bad)).toThrow(/v2\.json: Unsupported recording version 2/);
  });
});

describe("assertRecording", () => {
  it("accepts frames with a missing face", () => {
    expect(() => assertRecording(recording())).not.toThrow();
  });

  it("rejects empty frames, bad length, bad marks and ragged frames", () => {
    expect(() => assertRecording(recording({ frames: [] }))).toThrow(/no frames/);
    expect(() => assertRecording(recording({ roundMs: 0 }))).toThrow(/round length/);
    expect(() => assertRecording(recording({ marks: { roundStart: NaN } }))).toThrow(/marks/);
    expect(() => assertRecording(recording({ frames: [{ t: 0, a: [0], b: null }] }))).toThrow(/wrong width/);
    expect(() => assertRecording(recording({ frames: [{ t: "0" as unknown as number, a: null, b: null }] }))).toThrow(/malformed frame/);
    expect(() => assertRecording(recording({ channels: [1] as unknown as string[] }))).toThrow(/channel list/);
  });
});

describe("parseRoundFiles", () => {
  it("keeps good files and reports the bad ones", () => {
    const good = JSON.stringify(recording());
    const { loaded, errors } = parseRoundFiles([
      { name: "a.json", text: good },
      { name: "b.json", text: "{" },
      { name: "c.json", text: good },
    ]);
    expect(loaded.map((l) => l.name)).toEqual(["a.json", "c.json"]);
    expect(errors).toEqual(["b.json: not valid JSON"]);
  });
});

describe("settings", () => {
  it("defaults match the shipped engine and climb defaults", () => {
    const d = defaultSettings();
    expect(d.sync.chanceR).toBe(DEFAULT_SYNC_OPTIONS.chanceR);
    expect(d.sync.windowMs).toBe(DEFAULT_SYNC_OPTIONS.windowMs);
    expect(d.climb).toEqual(DEFAULT_CLIMB);
    expect(isDefault(d)).toBe(true);
  });

  it("returns independent copies", () => {
    const d = defaultSettings();
    d.sync.chanceR = 0.5;
    d.climb.maxClimb = 9;
    expect(defaultSettings().sync.chanceR).toBe(DEFAULT_SYNC_OPTIONS.chanceR);
    expect(defaultSettings().climb.maxClimb).toBe(DEFAULT_CLIMB.maxClimb);
    const c = cloneSettings(d);
    c.sync.chanceR = 0.1;
    expect(d.sync.chanceR).toBe(0.5);
  });

  it("every knob's default sits inside its slider range", () => {
    const d = defaultSettings();
    for (const k of KNOBS) {
      expect(getKnob(d, k)).toBeGreaterThanOrEqual(k.min);
      expect(getKnob(d, k)).toBeLessThanOrEqual(k.max);
    }
  });

  it("withKnob sets one value without mutating the original", () => {
    const d = defaultSettings();
    const s = withKnob(d, knob("maxClimb"), 4);
    expect(s.climb.maxClimb).toBe(4);
    expect(d.climb.maxClimb).toBe(DEFAULT_CLIMB.maxClimb);
    expect(s.sync).toEqual(d.sync);
  });

  it("lists only the knobs that moved", () => {
    let s = defaultSettings();
    s = withKnob(s, knob("chanceR"), 0.4);
    s = withKnob(s, knob("stillSlip"), 1);
    expect(changedKnobs(s).map((k) => k.key)).toEqual(["chanceR", "stillSlip"]);
    expect(isDefault(s)).toBe(false);
  });

  it("clamps to slider ranges and replaces junk with defaults", () => {
    const wild = { sync: { chanceR: 9, windowMs: -5, maxLagMs: "x" }, climb: { maxClimb: NaN } };
    const c = clampSettings(wild as never);
    expect(c.sync.chanceR).toBe(knob("chanceR").max);
    expect(c.sync.windowMs).toBe(knob("windowMs").min);
    expect(c.sync.maxLagMs).toBe(DEFAULT_SYNC_OPTIONS.maxLagMs);
    expect(c.climb.maxClimb).toBe(DEFAULT_CLIMB.maxClimb);
    expect(c.sync.fullActivity).toBe(DEFAULT_SYNC_OPTIONS.fullActivity);
  });

  it("round-trips through the clipboard JSON and says what changed", () => {
    const s = withKnob(defaultSettings(), knob("chanceR"), 0.35);
    const text = settingsToJson(s);
    expect(JSON.parse(text).changedFromDefaults).toEqual(["sync.chanceR"]);
    expect(settingsFromJson(text)).toEqual(s);
    expect(JSON.parse(settingsToJson(defaultSettings())).changedFromDefaults).toEqual([]);
  });

  it("rejects clipboard text that isn't an object", () => {
    expect(() => settingsFromJson("3")).toThrow(/object/);
    expect(() => settingsFromJson("null")).toThrow(/object/);
    expect(() => settingsFromJson("not json")).toThrow();
  });

  it("builds rescore options with all sync knobs and the climb tuning", () => {
    const opts = toRescoreOpts(withKnob(defaultSettings(), knob("windowMs"), 3000));
    expect(opts.sync.windowMs).toBe(3000);
    expect(opts.sync.chanceR).toBe(DEFAULT_SYNC_OPTIONS.chanceR);
    expect(opts.climb).toEqual(DEFAULT_CLIMB);
  });
});

const row = (over: Partial<Row> = {}): Row => ({
  height: 20,
  inSync: 0.5,
  meanSync: 0.6,
  medianLagMs: 300,
  lead: { left: 0.6, right: 0.3, unison: 0.1 },
  ...over,
});

describe("table", () => {
  it("summarizes a scored round and copies the lead object", () => {
    const recap = { inSyncShare: 0.7, meanSync: 0.55, medianLagMs: 250, lead: { left: 1, right: 0, unison: 0 } } as Recap;
    const scored: ScoredRound = { height: 12.5, recap };
    const r = summarize(scored);
    expect(r).toEqual({ height: 12.5, inSync: 0.7, meanSync: 0.55, medianLagMs: 250, lead: { left: 1, right: 0, unison: 0 } });
    expect(r.lead).not.toBe(recap.lead);
  });

  it("computes deltas field by field", () => {
    const d = deltaRow(row({ height: 25, inSync: 0.4, medianLagMs: 350 }), row());
    expect(d.height).toBe(5);
    expect(d.inSync).toBeCloseTo(-0.1);
    expect(d.medianLagMs).toBe(50);
    expect(d.lead.left).toBe(0);
  });

  it("has no lag delta when either side has no lag", () => {
    expect(deltaRow(row({ medianLagMs: null }), row()).medianLagMs).toBeNull();
    expect(deltaRow(row(), row({ medianLagMs: null })).medianLagMs).toBeNull();
  });

  it("averages rows, skipping missing lag", () => {
    const m = meanRow([row({ height: 10, medianLagMs: 200 }), row({ height: 30, medianLagMs: null })])!;
    expect(m.height).toBe(20);
    expect(m.medianLagMs).toBe(200);
    expect(meanRow([row({ medianLagMs: null })])!.medianLagMs).toBeNull();
    expect(meanRow([])).toBeNull();
  });

  it("formats deltas with signs and treats tiny changes as no change", () => {
    expect(formatDelta(3.24)).toBe("+3.2");
    expect(formatDelta(-0.41)).toBe("-0.4");
    expect(formatDelta(0.04)).toBe("±0");
    expect(formatDelta(-0.04)).toBe("±0");
    expect(formatDelta(null)).toBe("–");
    expect(formatDelta(12.6, 0)).toBe("+13");
    expect(formatDelta(0.4, 0)).toBe("±0");
  });
});

describe("nearestIndex", () => {
  const at = (...ts: number[]) => ts.map((t) => ({ t }));

  it("finds the closest sample in time", () => {
    const s = at(0, 100, 200, 300);
    expect(nearestIndex(s, 0)).toBe(0);
    expect(nearestIndex(s, 140)).toBe(1);
    expect(nearestIndex(s, 160)).toBe(2);
    expect(nearestIndex(s, 300)).toBe(3);
  });

  it("clamps outside the range and prefers the earlier sample on a tie", () => {
    const s = at(100, 200);
    expect(nearestIndex(s, -50)).toBe(0);
    expect(nearestIndex(s, 9999)).toBe(1);
    expect(nearestIndex(s, 150)).toBe(0);
  });

  it("handles empty and single-sample input", () => {
    expect(nearestIndex([], 5)).toBe(-1);
    expect(nearestIndex(at(40), 5)).toBe(0);
  });
});

describe("debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs once with the last arguments after the delay", () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(1);
    vi.advanceTimersByTime(60);
    d(2);
    vi.advanceTimersByTime(60);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2);
  });

  it("can be cancelled", () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d();
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });
});
