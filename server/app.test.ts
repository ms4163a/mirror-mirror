import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { LeaderboardView, RoundSubmission } from "../shared/leaderboard.ts";
import { createApp } from "./app.ts";
import { MemoryStore } from "./store.ts";

const round = (over: Partial<RoundSubmission> = {}): RoundSubmission => ({
  team: "Team Beans",
  mode: "camera",
  playedAt: new Date().toISOString(),
  durationS: 60,
  height: 40,
  inSyncShare: 0.5,
  meanSync: 0.6,
  bestStreakS: 6,
  medianLagMs: 250,
  lead: { left: 0.5, right: 0.4, unison: 0.1 },
  bestExpression: "Smile",
  sync: [0.1, 0.5, 0.9],
  ...over,
});

let server: Server;
let base = "";

beforeAll(async () => {
  server = createApp({ store: new MemoryStore() });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const getView = async (query = "") => (await (await fetch(`${base}/api/leaderboard${query}`)).json()) as LeaderboardView;

const post = (body: unknown) =>
  fetch(`${base}/api/rounds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("leaderboard server", () => {
  it("stores rounds and ranks them by height", async () => {
    expect((await post(round({ team: "Low", height: 10 }))).status).toBe(201);
    const res = await post(round({ team: "High", height: 50 }));
    expect(await res.json()).toMatchObject({ rank: 1, total: 2 });
    const view = await getView();
    expect(view.top.map((r) => r.team)).toEqual(["High", "Low"]);
  });

  it("keeps simulated rounds off the board unless asked", async () => {
    const res = await post(round({ team: "Bot", mode: "sim", height: 999 }));
    expect(res.status).toBe(201);
    const view = await getView();
    expect(view.top.some((r) => r.team === "Bot")).toBe(false);
    const test = await getView("?test=1");
    expect(test.top[0].team).toBe("Bot");
  });

  it("rejects invalid rounds and cleans team names", async () => {
    expect((await post(round({ height: -1 }))).status).toBe(400);
    expect((await post({ nonsense: true })).status).toBe(400);
    const res = await fetch(`${base}/api/rounds`, { method: "POST", body: "{not json" });
    expect(res.status).toBe(400);
    await post(round({ team: "  <b>Sneaky</b>\n Team  ", height: 5 }));
    const view = await getView("?limit=50");
    expect(view.top.some((r) => r.team === "bSneaky/b Team")).toBe(true);
  });

  it("pushes new rounds to event-stream listeners", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    await post(round({ team: "Live", height: 1 }));
    let text = "";
    while (!text.includes("event: round")) text += new TextDecoder().decode((await reader.read()).value);
    ctrl.abort();
    expect(text).toContain('"team":"Live"');
  });
});
