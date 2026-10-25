import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { WebSocket } from "ws";
import { createApp } from "./app.ts";
import { attachRooms } from "./rooms.ts";
import { MemoryStore } from "./store.ts";

let server: Server;
let base = "";
beforeAll(async () => {
  server = createApp({ store: new MemoryStore() });
  attachRooms(server);
  await new Promise<void>((r) => server.listen(0, r));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/room`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** Opens a socket and collects parsed messages. */
function join(code: string, seat: string) {
  const ws = new WebSocket(`${base}?code=${code}&seat=${seat}`);
  const msgs: { type: string; [k: string]: unknown }[] = [];
  ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
  const closed = new Promise<number>((r) => ws.on("close", (c) => r(c)));
  const until = async (pred: () => boolean) => {
    for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(pred()).toBe(true);
  };
  return { ws, msgs, closed, until, open: new Promise((r) => ws.on("open", r)) };
}

describe("remote rooms", () => {
  it("relays messages between the two seats and announces peers", async () => {
    const left = join("ABCD", "left");
    await left.until(() => left.msgs.some((m) => m.type === "hello"));
    expect(left.msgs[0]).toEqual({ type: "hello", seat: "left", peer: false });
    const right = join("ABCD", "right");
    await right.until(() => right.msgs.some((m) => m.type === "hello"));
    expect(right.msgs[0]).toMatchObject({ peer: true });
    await left.until(() => left.msgs.some((m) => m.type === "peer" && m.connected === true));
    right.ws.send(JSON.stringify({ type: "frame", t: 1, v: [0.5] }));
    await left.until(() => left.msgs.some((m) => m.type === "frame"));
    right.ws.close();
    await left.until(() => left.msgs.some((m) => m.type === "peer" && m.connected === false));
    left.ws.close();
  });

  it("refuses a second player in the same seat", async () => {
    const a = join("WXYZ", "left");
    await a.open;
    const b = join("WXYZ", "left");
    expect(await b.closed).toBe(4001);
    a.ws.close();
  });

  it("rejects bad codes", async () => {
    const bad = new WebSocket(`${base}?code=12&seat=left`);
    await expect(new Promise((ok, fail) => { bad.on("open", ok); bad.on("error", fail); })).rejects.toBeTruthy();
  });
});

describe("remote rooms: large messages", () => {
  it("relays a 60 s recap-sized message (~200 KB)", async () => {
    const left = join("BIGG", "left");
    const right = join("BIGG", "right");
    await Promise.all([left.open, right.open]);
    left.ws.send(JSON.stringify({ type: "recap", pad: "x".repeat(200_000) }));
    await right.until(() => right.msgs.some((m) => m.type === "recap"));
    left.ws.close();
    right.ws.close();
  });
});
