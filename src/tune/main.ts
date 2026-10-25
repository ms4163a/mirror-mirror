// Sync tuner: load recorded rounds, move the sliders, and see how every round
// re-scores. Scoring is rescore() from src/replay, the same code path as the
// live game, so what you see here is what the game would have done.
import { rescore, type RescoreResult } from "../replay/rescore";
import { parseRoundFiles, type LoadedRound } from "./parse";
import {
  KNOBS,
  changedKnobs,
  defaultSettings,
  getKnob,
  isDefault,
  settingsToJson,
  toRescoreOpts,
  withKnob,
  type KnobSpec,
  type TuneSettings,
} from "./settings";
import { debounce, deltaRow, formatDelta, meanRow, nearestIndex, summarize, type Row } from "./table";

interface Entry {
  round: LoadedRound;
  /** Scored with the shipped defaults. */
  base: RescoreResult | null;
  /** Scored with the current sliders. */
  cur: RescoreResult | null;
  error: string | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmtKnob = (k: KnobSpec, v: number) => {
  const digits = k.step < 0.1 ? 2 : k.step < 1 ? 1 : 0;
  return `${v.toFixed(digits)}${k.unit ? ` ${k.unit}` : ""}`;
};

const entries: Entry[] = [];
let settings: TuneSettings = defaultSettings();
let runId = 0;
let redrawCharts: (() => void)[] = [];

// --- controls ---------------------------------------------------------------

const knobRows = new Map<string, { row: HTMLElement; input: HTMLInputElement; val: HTMLElement }>();

function buildControls() {
  const host = $("knobs");
  const titles = { sync: "Sync engine", climb: "Jack's climb" } as const;
  for (const group of ["sync", "climb"] as const) {
    const box = document.createElement("div");
    box.className = "group";
    box.innerHTML = `<h2>${titles[group]}</h2>`;
    for (const k of KNOBS.filter((x) => x.group === group)) {
      const def = getKnob(defaultSettings(), k);
      const f = (def - k.min) / (k.max - k.min);
      const row = document.createElement("div");
      row.className = "knob";
      row.innerHTML = `
        <div class="knob-head"><label class="knob-name" for="k-${k.key}">${k.label}</label><span class="knob-val"></span></div>
        <div class="knob-hint">${k.hint}</div>
        <div class="slider">
          <input id="k-${k.key}" type="range" min="${k.min}" max="${k.max}" step="${k.step}" />
          <i class="default-tick" style="left: calc(8px + (100% - 16px) * ${f})"></i>
        </div>
        <span class="default-label">default ${fmtKnob(k, def)}</span>`;
      const input = row.querySelector("input")!;
      const val = row.querySelector<HTMLElement>(".knob-val")!;
      input.addEventListener("input", () => {
        settings = withKnob(settings, k, Number(input.value));
        syncControls();
        schedule();
      });
      knobRows.set(k.key, { row, input, val });
      box.append(row);
    }
    host.append(box);
  }
  syncControls();
}

/** Pushes `settings` into the sliders, the "changed" badges and the JSON box. */
function syncControls() {
  const changed = new Set(changedKnobs(settings).map((k) => k.key));
  for (const k of KNOBS) {
    const { row, input, val } = knobRows.get(k.key)!;
    const v = getKnob(settings, k);
    if (Number(input.value) !== v) input.value = String(v);
    val.textContent = fmtKnob(k, v);
    row.classList.toggle("changed", changed.has(k.key));
  }
  $<HTMLTextAreaElement>("json").value = settingsToJson(settings);
  $<HTMLButtonElement>("reset").disabled = isDefault(settings);
}

// --- scoring ----------------------------------------------------------------

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function recompute() {
  const run = ++runId;
  if (!entries.length) {
    render();
    return;
  }
  $("status").textContent = `Scoring ${entries.length} round${entries.length === 1 ? "" : "s"}…`;
  const atDefaults = isDefault(settings);
  for (const e of entries) {
    try {
      e.base ??= rescore(e.round.recording);
      e.cur = atDefaults ? e.base : rescore(e.round.recording, toRescoreOpts(settings));
      e.error = null;
    } catch (err) {
      e.cur = null;
      e.error = (err as Error).message;
    }
    await tick(); // let the page stay responsive between rounds
    if (run !== runId) return; // a newer change superseded this run
  }
  render();
  const n = entries.filter((e) => e.cur).length;
  $("status").textContent = `${n} round${n === 1 ? "" : "s"} scored` + (atDefaults ? " · shipped defaults" : ` · ${changedKnobs(settings).length} setting(s) changed`);
}

const schedule = debounce(() => void recompute(), 150);

// --- loading files ----------------------------------------------------------

async function addFiles(files: FileList | File[]) {
  const read = await Promise.all([...files].map(async (f) => ({ name: f.name, text: await f.text() })));
  const { loaded, errors } = parseRoundFiles(read);
  const list = $("errors");
  list.replaceChildren(...errors.map((m) => Object.assign(document.createElement("li"), { textContent: m })));
  for (const round of loaded) {
    const same = entries.filter((e) => e.round.name.replace(/ \(\d+\)$/, "") === round.name).length;
    entries.push({ round: same ? { ...round, name: `${round.name} (${same + 1})` } : round, base: null, cur: null, error: null });
  }
  await recompute();
}

function wireDropZone() {
  const drop = $("drop");
  const input = $<HTMLInputElement>("file");
  input.addEventListener("change", () => {
    if (input.files?.length) void addFiles(input.files);
    input.value = "";
  });
  for (const ev of ["dragenter", "dragover"]) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
  }
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files.length) void addFiles(e.dataTransfer.files);
  });
}

// --- table ------------------------------------------------------------------

function metricCells(cur: Row, base: Row, same: boolean, live: number | null) {
  const d = deltaRow(cur, base);
  const note = (baseText: string, delta: string | null) =>
    same ? "= defaults" : delta === null ? `defaults ${baseText}` : `defaults ${baseText} · ${delta}`;
  const lead = (r: Row) => `L ${Math.round(r.lead.left * 100)} · R ${Math.round(r.lead.right * 100)} · U ${Math.round(r.lead.unison * 100)}`;
  const lag = (r: Row) => (r.medianLagMs === null ? "–" : `${Math.round(r.medianLagMs)} ms`);
  return `
    <td><b>${cur.height.toFixed(1)} m</b><small>${note(`${base.height.toFixed(1)} m`, `${formatDelta(d.height)} m`)}</small></td>
    <td><b>${pct(cur.inSync)}</b><small>${note(pct(base.inSync), `${formatDelta(d.inSync * 100, 0)} pts`)}</small></td>
    <td><b>${lag(cur)}</b><small>${note(lag(base), d.medianLagMs === null ? null : `${formatDelta(d.medianLagMs, 0)} ms`)}</small></td>
    <td><b>${lead(cur)}</b><small>${same ? "= defaults" : `defaults ${lead(base)}`}</small></td>
    <td>${live === null ? "–" : `${live.toFixed(1)} m`}</td>`;
}

function renderTable() {
  const wrap = $("table-wrap");
  $("empty").hidden = entries.length > 0;
  if (!entries.length) {
    wrap.replaceChildren();
    return;
  }
  const same = isDefault(settings);
  const scored = entries.filter((e) => e.cur && e.base);
  const rows = entries.map((e) => {
    if (!e.cur || !e.base) return `<tr class="err"><td class="name">${esc(e.round.name)}</td><td colspan="5">${esc(e.error ?? "Not scored yet")}</td></tr>`;
    return `<tr><td class="name">${esc(e.round.name)}</td>${metricCells(summarize(e.cur), summarize(e.base), same, e.round.liveHeight)}</tr>`;
  });
  const cur = meanRow(scored.map((e) => summarize(e.cur!)));
  const base = meanRow(scored.map((e) => summarize(e.base!)));
  if (cur && base && scored.length > 1) {
    rows.push(`<tr class="mean"><td class="name">Average of ${scored.length}</td>${metricCells(cur, base, same, null)}</tr>`);
  }
  wrap.innerHTML = `
    <div class="table-scroll"><table>
      <thead><tr><th>Round</th><th>Height</th><th>In sync</th><th>Median lag</th><th>Led (L · R · unison, %)</th><th>As played</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table></div>
    <p class="fine">"As played" is the height the live game showed. It can differ from the re-scored height by up to about 0.5 m because of live timing, so ignore smaller differences.</p>`;
}

// --- charts -----------------------------------------------------------------

const PAD = { l: 38, r: 10, t: 8, b: 22 };

function drawChart(canvas: HTMLCanvasElement, e: Entry, hoverT: number | null) {
  if (!e.cur || !e.base) return;
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width;
  const h = canvas.height;
  const pl = PAD.l * dpr, pr = PAD.r * dpr, pt = PAD.t * dpr, pb = PAD.b * dpr;
  const pw = w - pl - pr;
  const ph = h - pt - pb;
  const roundMs = e.round.recording.roundMs;
  const xOf = (t: number) => pl + (t / roundMs) * pw;
  const yOf = (s: number) => pt + (1 - s) * ph;

  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.lineWidth = dpr;
  ctx.strokeStyle = v("--grid");
  ctx.fillStyle = v("--muted");
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (const s of [0, 0.5, 1]) {
    ctx.beginPath();
    ctx.moveTo(pl, yOf(s));
    ctx.lineTo(w - pr, yOf(s));
    ctx.stroke();
    ctx.fillText(pct(s), pl - 6 * dpr, yOf(s));
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const stepS = roundMs <= 30_000 ? 5 : 10;
  for (let s = 0; s * 1000 <= roundMs; s += stepS) ctx.fillText(`${s}s`, xOf(s * 1000), h - 6 * dpr);

  // Where Jack starts to climb under the current setting.
  const thr = settings.climb.syncThreshold;
  ctx.save();
  ctx.setLineDash([2 * dpr, 4 * dpr]);
  ctx.strokeStyle = v("--muted");
  ctx.beginPath();
  ctx.moveTo(pl, yOf(thr));
  ctx.lineTo(w - pr, yOf(thr));
  ctx.stroke();
  ctx.restore();
  ctx.textAlign = "left";
  ctx.fillText("climbs above this", pl + 4 * dpr, yOf(thr) - 5 * dpr);

  const line = (samples: RescoreResult["samples"], color: string, dash: number[]) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * dpr;
    ctx.lineJoin = "round";
    ctx.setLineDash(dash.map((d) => d * dpr));
    ctx.beginPath();
    samples.forEach((s, i) => (i ? ctx.lineTo(xOf(s.t), yOf(s.sync)) : ctx.moveTo(xOf(s.t), yOf(s.sync))));
    ctx.stroke();
    ctx.restore();
  };
  const showBase = !isDefault(settings);
  if (showBase) line(e.base.samples, v("--muted"), [6, 4]);
  line(e.cur.samples, v("--accent"), []);

  if (hoverT !== null) {
    ctx.strokeStyle = v("--muted");
    ctx.beginPath();
    ctx.moveTo(xOf(hoverT), pt);
    ctx.lineTo(xOf(hoverT), pt + ph);
    ctx.stroke();
    const dot = (samples: RescoreResult["samples"], color: string) => {
      const i = nearestIndex(samples, hoverT);
      if (i < 0) return;
      ctx.beginPath();
      ctx.arc(xOf(samples[i].t), yOf(samples[i].sync), 4 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2 * dpr; // surface ring so overlapping dots stay distinct
      ctx.strokeStyle = v("--panel");
      ctx.stroke();
    };
    if (showBase) dot(e.base.samples, v("--muted"));
    dot(e.cur.samples, v("--accent"));
  }
}

function renderCharts() {
  const host = $("charts");
  host.replaceChildren();
  redrawCharts = [];
  const showBase = !isDefault(settings);
  for (const e of entries) {
    if (!e.cur || !e.base) continue;
    const card = document.createElement("div");
    card.className = "chart-card";
    card.innerHTML = `
      <div class="chart-head">
        <h3>${esc(e.round.name)}: sync over the round</h3>
        <div class="legend"><span><i></i>Current settings</span>${showBase ? '<span><i class="base"></i>Shipped defaults</span>' : ""}</div>
      </div>
      <div class="chart-wrap"><canvas class="chart" role="img"></canvas><div class="tip" hidden></div></div>`;
    host.append(card);
    const canvas = card.querySelector("canvas")!;
    const tip = card.querySelector<HTMLElement>(".tip")!;
    const mean = pct(e.cur.recap.meanSync);
    canvas.setAttribute("aria-label", `Sync over time for ${e.round.name}. Average sync while moving ${mean}. The table above has the numbers.`);

    let hover: number | null = null;
    const draw = () => drawChart(canvas, e, hover);
    redrawCharts.push(draw);
    draw();

    canvas.addEventListener("pointermove", (ev) => {
      const r = canvas.getBoundingClientRect();
      const plotW = r.width - PAD.l - PAD.r;
      const x = Math.min(plotW, Math.max(0, ev.clientX - r.left - PAD.l));
      hover = (x / plotW) * e.round.recording.roundMs;
      const ci = nearestIndex(e.cur!.samples, hover);
      const bi = nearestIndex(e.base!.samples, hover);
      const cs = e.cur!.samples[ci];
      tip.innerHTML =
        `<b>${(cs.t / 1000).toFixed(1)} s</b><br>current ${pct(cs.sync)}` +
        (showBase && bi >= 0 ? `<br>defaults ${pct(e.base!.samples[bi].sync)}` : "");
      tip.hidden = false;
      tip.style.left = `${Math.min(r.width - tip.offsetWidth - 4, PAD.l + x + 12)}px`;
      draw();
    });
    canvas.addEventListener("pointerleave", () => {
      hover = null;
      tip.hidden = true;
      draw();
    });
  }
}

function render() {
  renderTable();
  renderCharts();
}

// --- start ------------------------------------------------------------------

buildControls();
wireDropZone();
render();

$("reset").addEventListener("click", () => {
  settings = defaultSettings();
  syncControls();
  schedule.cancel();
  void recompute();
});

$("copy").addEventListener("click", async () => {
  const text = settingsToJson(settings);
  const note = $("copy-note");
  try {
    await navigator.clipboard.writeText(text);
    note.textContent = "Copied. Send it to Claude A.";
  } catch {
    // No clipboard API (e.g. page opened over plain http from another device).
    const box = $<HTMLTextAreaElement>("json");
    box.focus();
    box.select();
    note.textContent = "Couldn't reach the clipboard. The text is selected: press Ctrl+C.";
  }
});

window.addEventListener("resize", debounce(() => redrawCharts.forEach((d) => d()), 100));

// Read-only handle for headless checks.
(window as unknown as { __tune: unknown }).__tune = {
  get settings() { return settings; },
  get entries() { return entries.map((e) => ({ name: e.round.name, height: e.cur?.height ?? null, base: e.base?.height ?? null, error: e.error })); },
  addFiles,
};
