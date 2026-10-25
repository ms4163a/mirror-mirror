// Leaderboard HTTP server (plain node:http, no framework).
//   POST /api/rounds          save a round (validated), returns { id, rank, total }
//   GET  /api/leaderboard     { top, recent, total }; ?test=1 includes sim/replay rounds
//   GET  /api/events          Server-Sent Events: "round" with the stored round
//   GET  /api/health          { ok, store }
//   anything else             static files from `staticDir` (the built app), if given
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { buildView, rankOf, validateSubmission } from "../shared/leaderboard.ts";
import type { RoundStore } from "./store.ts";

const MAX_BODY = 64 * 1024;
const RATE_LIMIT = { windowMs: 60_000, max: 20 };

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

/** IPv4 addresses other machines might reach: LAN first, then Tailscale (which also works across networks). */
export function networkAddresses(): { address: string; label: string }[] {
  const out: { address: string; label: string; rank: number }[] = [];
  for (const [name, infos] of Object.entries(networkInterfaces())) {
    for (const i of infos ?? []) {
      if (i.family !== "IPv4" || i.internal || i.address.startsWith("169.254.")) continue; // skip loopback and link-local
      const tailscale = i.address.startsWith("100.") || /tailscale/i.test(name);
      out.push({ address: i.address, label: tailscale ? `Tailscale (${name})` : name, rank: tailscale ? 1 : 0 });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map(({ address, label }) => ({ address, label }));
}

export interface AppOptions {
  store: RoundStore;
  staticDir?: string;
  log?: (msg: string) => void;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

export function createApp({ store, staticDir, log = () => {} }: AppOptions): Server {
  const clients = new Set<ServerResponse>();
  const hits = new Map<string, number[]>();

  const limited = (ip: string) => {
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
    recent.push(now);
    hits.set(ip, recent);
    return recent.length > RATE_LIMIT.max;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        return res.end();
      }

      if (url.pathname === "/api/health") return send(res, 200, { ok: true, store: store.name });

      // This machine's network addresses, so a host on localhost can show the guest a reachable link.
      if (url.pathname === "/api/addresses" && req.method === "GET") return send(res, 200, { addresses: networkAddresses() });

      if (url.pathname === "/api/leaderboard" && req.method === "GET") {
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 10));
        return send(res, 200, buildView(await store.all(), { limit, includeTest: url.searchParams.get("test") === "1" }));
      }

      if (url.pathname === "/api/rounds" && req.method === "POST") {
        if (limited(req.socket.remoteAddress ?? "?")) return send(res, 429, { error: "slow down" });
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { error: "invalid JSON or body too large" });
        }
        const v = validateSubmission(parsed);
        if (!v.ok) return send(res, 400, { error: v.error });
        const stored = await store.add(v.value);
        const all = await store.all();
        const isTest = stored.mode !== "camera";
        const rank = rankOf(all, stored.id, isTest);
        log(`round ${stored.id} "${stored.team}" ${stored.height.toFixed(1)} m (${stored.mode}) rank ${rank}`);
        const event = `event: round\ndata: ${JSON.stringify(stored)}\n\n`;
        for (const c of clients) c.write(event);
        return send(res, 201, { id: stored.id, rank, total: buildView(all, { includeTest: isTest }).total });
      }

      if (url.pathname === "/api/events" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });
        res.write("retry: 2000\n\n");
        clients.add(res);
        const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
        req.on("close", () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }

      if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "not found" });

      if (staticDir && req.method === "GET") {
        const root = resolve(staticDir);
        const rel = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
        const file = normalize(join(root, rel));
        if (!file.startsWith(root)) return send(res, 403, { error: "forbidden" });
        try {
          if ((await stat(file)).isFile()) {
            res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
            return res.end(await readFile(file));
          }
        } catch {
          // fall through to 404
        }
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      log(`error: ${(err as Error).message}`);
      if (!res.headersSent) send(res, 500, { error: "server error" });
      else res.end();
    }
  });

  server.on("close", () => {
    for (const c of clients) c.end();
    clients.clear();
  });
  return server;
}
