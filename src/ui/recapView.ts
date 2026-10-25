// Recap screen: what happened in the round, using measured numbers only. The
// framing is feedback on one round of a game, never a verdict on the pair.
import { ROUND_SCRIPT, scriptTime } from "../game/prompts";
import { IN_SYNC, type Recap } from "../game/recap";
import type { RoundSample } from "../game/round";
import { reachedSentence } from "./scene";
import { PLAYER_COLORS } from "./hud";

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function renderRecap(host: HTMLElement, recap: Recap, samples: RoundSample[]) {
  const lag = recap.medianLagMs === null ? "–" : `${Math.round(recap.medianLagMs)} ms`;
  const fams = recap.families.slice(0, 3);
  const segs = recap.leaderSegments;
  const segLine =
    segs.left !== null && segs.right !== null
      ? `Sync while <b class="p0">Left</b> led: <b>${pct(segs.left)}</b> · while <b class="p1">Right</b> led: <b>${pct(segs.right)}</b>`
      : "";

  host.innerHTML = `
    <div class="recap">
      <h2>Jack climbed <span class="big">${recap.height.toFixed(1)} m</span></h2>
      <p class="sub">${reachedSentence(recap.height)}</p>
      <div class="tiles">
        <div class="tile"><span class="tile-v">${pct(recap.inSyncShare)}</span><span class="tile-k">of the round in sync</span></div>
        <div class="tile"><span class="tile-v">${recap.bestStreakS.toFixed(1)} s</span><span class="tile-k">longest sync streak</span></div>
        <div class="tile"><span class="tile-v">${lag}</span><span class="tile-k">typical follow lag</span></div>
        <div class="tile"><span class="tile-v">${pct(recap.meanSync)}</span><span class="tile-k">average sync while moving</span></div>
      </div>
      <h3>Sync over the round</h3>
      <div class="chart-wrap"><canvas class="sync-chart" aria-label="Sync over time"></canvas><div class="tip" hidden></div></div>
      <h3>Who led while you were in sync</h3>
      ${leadBar(recap)}
      <p class="seg">${segLine}</p>
      <h3>Best-matched expressions</h3>
      <ol class="best">${
        fams.length
          ? fams.map((f) => `<li><span>${f.label}</span><b>${pct(f.score)}</b><span class="muted">${f.seconds.toFixed(0)} s together</span></li>`).join("")
          : `<li class="muted">Not enough shared expressions to rank</li>`
      }</ol>
      <p class="disclaimer">This is feedback on one round of a game, not on your relationship. Play again and see what changes.</p>
      <div class="actions">
        <button class="primary" data-action="again">Play again <kbd>Space</kbd></button>
        <button data-action="download">Download round data</button>
      </div>
    </div>`;

  drawSyncChart(host.querySelector(".chart-wrap")!, samples, recap.durationS * 1000);
}

function leadBar(r: Recap) {
  const total = r.lead.left + r.lead.right + r.lead.unison;
  if (total === 0) return `<p class="muted">You weren't in sync long enough to tell.</p>`;
  const segs = [
    { k: "Left led", v: r.lead.left, cls: "p0" },
    { k: "Unison", v: r.lead.unison, cls: "unison" },
    { k: "Right led", v: r.lead.right, cls: "p1" },
  ];
  return `
    <div class="leadbar" role="img" aria-label="${segs.map((s) => `${s.k} ${pct(s.v)}`).join(", ")}">
      ${segs.filter((s) => s.v > 0).map((s) => `<span class="seg-${s.cls}" style="flex:${s.v}"></span>`).join("")}
    </div>
    <div class="legend">${segs.map((s) => `<span><i class="sw seg-${s.cls}"></i>${s.k} <b>${pct(s.v)}</b></span>`).join("")}</div>`;
}

/** Shortens `text` with an ellipsis until it fits `maxW`, so narrow bands don't cut a word in half. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (maxW <= 0) return "";
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return s.length > 1 ? `${s.trimEnd()}…` : "";
}

function drawSyncChart(wrap: HTMLElement, samples: RoundSample[], durationMs: number) {
  const canvas = wrap.querySelector("canvas")!;
  const tip = wrap.querySelector<HTMLElement>(".tip")!;
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();

  const draw = (hoverX: number | null) => {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d")!;
    const w = canvas.width;
    const h = canvas.height;
    const pad = { l: 36 * dpr, r: 8 * dpr, t: 22 * dpr, b: 20 * dpr };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;
    const xOf = (t: number) => pad.l + (t / durationMs) * pw;
    const yOf = (s: number) => pad.t + (1 - s) * ph;

    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    // Prompt segments as alternating bands, leader segments tinted.
    ROUND_SCRIPT.forEach((card, i) => {
      const start = scriptTime(card.at, durationMs);
      if (start >= durationMs) return;
      const next = ROUND_SCRIPT[i + 1];
      const end = Math.min(next ? scriptTime(next.at, durationMs) : durationMs, durationMs);
      const x0 = xOf(start);
      const x1 = xOf(end);
      ctx.fillStyle =
        card.lead === "left" ? `${PLAYER_COLORS[0]}22` : card.lead === "right" ? `${PLAYER_COLORS[1]}22` : i % 2 ? v("--grid") : "transparent";
      ctx.fillRect(x0, pad.t, x1 - x0, ph);
      ctx.fillStyle = v("--muted");
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(ellipsize(ctx, card.title, x1 - x0 - 8 * dpr), x0 + 3 * dpr, pad.t - 6 * dpr);
    });

    // Axis + in-sync threshold
    ctx.strokeStyle = v("--grid");
    ctx.lineWidth = dpr;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const s of [0, 0.5, 1]) {
      ctx.beginPath();
      ctx.moveTo(pad.l, yOf(s));
      ctx.lineTo(w - pad.r, yOf(s));
      ctx.stroke();
      ctx.fillStyle = v("--muted");
      ctx.fillText(pct(s), pad.l - 6 * dpr, yOf(s));
    }
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(pad.l, yOf(IN_SYNC));
    ctx.lineTo(w - pad.r, yOf(IN_SYNC));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let s = 0; s <= durationMs / 1000; s += 10) ctx.fillText(`${s}s`, xOf(s * 1000), h - pad.b + 4 * dpr);

    // Sync line
    ctx.strokeStyle = v("--accent");
    ctx.lineWidth = 2 * dpr;
    ctx.lineJoin = "round";
    ctx.beginPath();
    samples.forEach((s, i) => (i ? ctx.lineTo(xOf(s.t), yOf(s.sync)) : ctx.moveTo(xOf(s.t), yOf(s.sync))));
    ctx.stroke();

    if (hoverX !== null && samples.length) {
      const t = ((hoverX * dpr - pad.l) / pw) * durationMs;
      let best = samples[0];
      for (const s of samples) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
      const x = xOf(best.t);
      ctx.strokeStyle = v("--muted");
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + ph);
      ctx.stroke();
      ctx.fillStyle = v("--accent");
      ctx.strokeStyle = v("--panel");
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(x, yOf(best.sync), 5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const leader = best.leader === 0 ? "Left led" : best.leader === 1 ? "Right led" : best.active ? "Unison" : "Not moving";
      tip.hidden = false;
      tip.innerHTML = `<b>${(best.t / 1000).toFixed(1)} s</b> · sync ${pct(best.sync)}<br>${leader}${best.active && best.sync > 0 ? ` · lag ${Math.round(Math.abs(best.lagMs))} ms` : ""}<br><span class="muted">${ROUND_SCRIPT[best.promptIndex].title}</span>`;
      const left = Math.min(x / dpr + 12, canvas.clientWidth - tip.offsetWidth - 4);
      tip.style.left = `${left}px`;
      tip.style.top = `${yOf(best.sync) / dpr - 20}px`;
    } else {
      tip.hidden = true;
    }
  };

  draw(null);
  canvas.addEventListener("pointermove", (e) => draw(e.offsetX));
  canvas.addEventListener("pointerleave", () => draw(null));
}
