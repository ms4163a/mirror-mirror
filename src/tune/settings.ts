// The knobs the tuner exposes, their ranges, and helpers to compare them with
// the shipped defaults and hand them back as JSON.
import { DEFAULT_CLIMB, type ClimbTuning } from "../game/round";
import { DEFAULT_SYNC_OPTIONS, type SyncOptions } from "../sync/syncEngine";

export type SyncKnob = "chanceR" | "fullActivity" | "windowMs" | "maxLagMs" | "leaderDeadZoneMs";

export interface TuneSettings {
  sync: Pick<SyncOptions, SyncKnob>;
  climb: ClimbTuning;
}

export interface KnobSpec {
  group: "sync" | "climb";
  key: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

export const KNOBS: KnobSpec[] = [
  { group: "sync", key: "chanceR", label: "Chance level", hint: "Correlation unrelated movement reaches; maps to sync 0", min: 0, max: 0.6, step: 0.01, unit: "" },
  { group: "sync", key: "fullActivity", label: "Full activity", hint: "How much both players must move for full credit", min: 0.5, max: 4, step: 0.1, unit: "" },
  { group: "sync", key: "windowMs", label: "Window", hint: "Length of the comparison window", min: 2000, max: 6000, step: 100, unit: "ms" },
  { group: "sync", key: "maxLagMs", label: "Max lag", hint: "Largest follow delay searched", min: 500, max: 1500, step: 50, unit: "ms" },
  { group: "sync", key: "leaderDeadZoneMs", label: "Leader dead zone", hint: "Lag below this counts as unison", min: 0, max: 200, step: 5, unit: "ms" },
  { group: "climb", key: "syncThreshold", label: "Climb threshold", hint: "Sync below this does not move Jack", min: 0, max: 0.6, step: 0.01, unit: "" },
  { group: "climb", key: "maxClimb", label: "Max climb", hint: "Climb speed at sync = 1", min: 0.5, max: 6, step: 0.1, unit: "m/s" },
  { group: "climb", key: "stillSlip", label: "Still slip", hint: "Slip speed while both players are still", min: 0, max: 2, step: 0.05, unit: "m/s" },
];

export function defaultSettings(): TuneSettings {
  const { chanceR, fullActivity, windowMs, maxLagMs, leaderDeadZoneMs } = DEFAULT_SYNC_OPTIONS;
  return { sync: { chanceR, fullActivity, windowMs, maxLagMs, leaderDeadZoneMs }, climb: { ...DEFAULT_CLIMB } };
}

export function cloneSettings(s: TuneSettings): TuneSettings {
  return { sync: { ...s.sync }, climb: { ...s.climb } };
}

export function getKnob(s: TuneSettings, k: KnobSpec): number {
  return (s[k.group] as unknown as Record<string, number>)[k.key];
}

/** Returns a copy of `s` with one knob set. */
export function withKnob(s: TuneSettings, k: KnobSpec, value: number): TuneSettings {
  const next = cloneSettings(s);
  (next[k.group] as unknown as Record<string, number>)[k.key] = value;
  return next;
}

/** Knobs whose value differs from the shipped default. */
export function changedKnobs(s: TuneSettings): KnobSpec[] {
  const d = defaultSettings();
  return KNOBS.filter((k) => Math.abs(getKnob(s, k) - getKnob(d, k)) > 1e-9);
}

export function isDefault(s: TuneSettings) {
  return changedKnobs(s).length === 0;
}

/** Pins every knob to its slider range. Non-numbers fall back to the default. */
export function clampSettings(s: TuneSettings): TuneSettings {
  const d = defaultSettings();
  let out = cloneSettings(d);
  for (const k of KNOBS) {
    const raw = (s?.[k.group] as unknown as Record<string, unknown> | undefined)?.[k.key];
    const v = typeof raw === "number" && Number.isFinite(raw) ? raw : getKnob(d, k);
    out = withKnob(out, k, Math.min(k.max, Math.max(k.min, v)));
  }
  return out;
}

/** Text for the clipboard: full values, plus which ones differ from the defaults. */
export function settingsToJson(s: TuneSettings): string {
  const changed = changedKnobs(s).map((k) => `${k.group}.${k.key}`);
  return JSON.stringify({ sync: s.sync, climb: s.climb, changedFromDefaults: changed }, null, 2);
}

/** Reads settings back from `settingsToJson` output. Throws on JSON that isn't an object. */
export function settingsFromJson(text: string): TuneSettings {
  const data = JSON.parse(text) as unknown;
  if (typeof data !== "object" || data === null) throw new Error("Settings JSON must be an object");
  return clampSettings(data as TuneSettings);
}

/** Options for `rescore()`. Every knob is passed; unmoved ones equal the defaults anyway. */
export function toRescoreOpts(s: TuneSettings): { sync: Partial<SyncOptions>; climb: ClimbTuning } {
  return { sync: { ...s.sync }, climb: { ...s.climb } };
}
