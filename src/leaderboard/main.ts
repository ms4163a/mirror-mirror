// Leaderboard display (Person B's laptop): live top climbs plus the latest
// round, updated over Server-Sent Events.
//   ?api=http://host:8787   server (default: same origin, proxied by Vite)
//   ?test=1                 include simulated/replayed rounds
import type { LeaderboardView, StoredRound } from "../../shared/leaderboard";
import "./leaderboard.css";

const params = new URLSearchParams(location.search);
const API = params.get("api") ?? "";
const TEST = params.get("test") === "1" ? "&test=1" : "";
const $ = (id: string) => document.getElementById(id)!;

let highlightId: string | null = null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (x: number) => `${Math.round(x * 100)}%`;

function setConn(state: "live" | "down" | "connecting") {
  const el = $("conn");
  el.className = `conn ${state}`;
  el.querySelector("span")!.textContent =
    state === "live" ? "Live" : state === "down" ? "Leaderboard server offline, retrying…" : "Connecting…";
}

function sparkline(sync: number[]): string {
  if (sync.length < 2) return "";
  const w = 320;
  const h = 64;
  const pts = sync.map((s, i) => `${((i / (sync.length - 1)) * w).toFixed(1)},${(h - 2 - s * (h - 4)).toFixed(1)}`).join(" ");
  const yIn = (h - 2 - 0.4 * (h - 4)).toFixed(1);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Sync over the round">
    <line x1="0" x2="${w}" y1="${yIn}" y2="${yIn}" class="spark-ref" />
    <polyline points="${pts}" class="spark-line" vector-effect="non-scaling-stroke" />
  </svg>`;
}

function render(view: LeaderboardView) {
  $("empty").hidden = view.top.length > 0;
  $("rows").innerHTML = view.top
    .map(
      (r, i) => `<tr class="${r.id === highlightId ? "fresh" : ""}">
        <td class="rank">${i + 1}</td>
        <td class="team">${esc(r.team)}</td>
        <td class="num strong">${r.height.toFixed(1)} m</td>
        <td class="num">${pct(r.inSyncShare)}</td>
        <td class="num">${r.medianLagMs === null ? "–" : `${r.medianLagMs} ms`}</td>
        <td>${r.bestExpression ? esc(r.bestExpression) : "–"}</td>
      </tr>`,
    )
    .join("");
  const latest = view.recent[0];
  if (latest) renderLatest(latest, view);
}

function renderLatest(r: StoredRound, view: LeaderboardView) {
  const rank = [...view.top].findIndex((x) => x.id === r.id);
  const led =
    r.lead.left + r.lead.right + r.lead.unison > 0
      ? `Left led ${pct(r.lead.left)} · Right led ${pct(r.lead.right)} · Unison ${pct(r.lead.unison)}`
      : "Not in sync long enough to tell who led";
  $("latest").innerHTML = `
    <div class="latest-team">${esc(r.team)}</div>
    <div class="latest-height">${r.height.toFixed(1)} m${rank >= 0 ? ` <span class="badge">#${rank + 1}</span>` : ""}</div>
    ${sparkline(r.sync)}
    <div class="tiles">
      <div><b>${pct(r.inSyncShare)}</b><span>in sync</span></div>
      <div><b>${r.bestStreakS.toFixed(1)} s</b><span>best streak</span></div>
      <div><b>${r.medianLagMs === null ? "–" : `${r.medianLagMs} ms`}</b><span>typical lag</span></div>
    </div>
    <p class="led">${led}</p>`;
}

async function refresh() {
  try {
    const res = await fetch(`${API}/api/leaderboard?limit=10${TEST}`);
    if (!res.ok) throw new Error(String(res.status));
    render(await res.json());
    return true;
  } catch {
    setConn("down");
    return false;
  }
}

function connect() {
  setConn("connecting");
  const es = new EventSource(`${API}/api/events`);
  es.onopen = () => {
    setConn("live");
    void refresh();
  };
  es.addEventListener("round", (e) => {
    highlightId = (JSON.parse((e as MessageEvent).data) as StoredRound).id;
    void refresh();
  });
  es.onerror = () => setConn("down"); // EventSource reconnects by itself
}

void refresh();
connect();
// Belt and braces: refresh every 30 s in case an event was missed.
setInterval(refresh, 30_000);
