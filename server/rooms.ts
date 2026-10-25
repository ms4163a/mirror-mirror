// Remote-play relay: two browsers join a room by code, one per seat, and every
// message from one seat is forwarded to the other. The relay never sees video;
// clients only send face-channel numbers and game state.
//   ws(s)://host/api/room?code=ABCD&seat=left|right
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

export type Seat = "left" | "right";
const CODE_RE = /^[A-Z]{4}$/;
const MAX_ROOMS = 200;

interface Room {
  left?: WebSocket;
  right?: WebSocket;
}

export function attachRooms(server: Server, log: (msg: string) => void = () => {}) {
  const rooms = new Map<string, Room>();
  // 1 MB: a 60 s recap with its 10 Hz samples is about 150 KB.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  const other = (seat: Seat): Seat => (seat === "left" ? "right" : "left");
  const send = (ws: WebSocket | undefined, msg: unknown) => {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname !== "/api/room") return; // let other upgrade handlers (none today) run
    const code = (url.searchParams.get("code") ?? "").toUpperCase();
    const seat = url.searchParams.get("seat") as Seat;
    if (!CODE_RE.test(code) || (seat !== "left" && seat !== "right")) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let room = rooms.get(code);
      if (!room) {
        if (rooms.size >= MAX_ROOMS) {
          ws.close(4003, "too many rooms");
          return;
        }
        room = {};
        rooms.set(code, room);
      }
      if (room[seat]) {
        ws.close(4001, "seat taken");
        return;
      }
      room[seat] = ws;
      const peer = room[other(seat)];
      log(`room ${code}: ${seat} joined${peer ? " (both here)" : ""}`);
      send(ws, { type: "hello", seat, peer: !!peer });
      send(peer, { type: "peer", connected: true });

      ws.on("message", (data, isBinary) => {
        const target = rooms.get(code)?.[other(seat)];
        if (target && target.readyState === target.OPEN) target.send(data, { binary: isBinary });
      });
      ws.on("close", () => {
        const r = rooms.get(code);
        if (!r || r[seat] !== ws) return;
        delete r[seat];
        send(r[other(seat)], { type: "peer", connected: false });
        if (!r.left && !r.right) rooms.delete(code);
        log(`room ${code}: ${seat} left`);
      });
    });
  });

  server.on("close", () => wss.close());
  return { rooms };
}
