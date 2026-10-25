// WebSocket link to the other player via the relay, with automatic reconnect
// and (for the guest) clock sync against the host.
import { ClockSync } from "./clock";
import type { RemoteMsg } from "./protocol";

export type Seat = "left" | "right";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O, easy to read aloud

export function newRoomCode() {
  return Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
}

export class RemoteLink {
  readonly clock = new ClockSync();
  peerConnected = false;
  connected = false;
  /** Set when the relay refuses us for good (e.g. seat taken). */
  fatal: string | null = null;

  private ws: WebSocket | null = null;
  private pingTimer = 0;
  private handlers: ((m: RemoteMsg) => void)[] = [];

  constructor(
    readonly code: string,
    readonly seat: Seat,
    private readonly base = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`,
  ) {
    this.open();
  }

  get isHost() {
    return this.seat === "left";
  }

  /** Converts a local timestamp to host time (identity on the host). */
  toHost(t: number) {
    return this.isHost ? t : t + this.clock.offset;
  }

  /** The guest may only send frames once its clock is synced to the host's. */
  get ready() {
    return this.connected && this.peerConnected && (this.isHost || this.clock.ready);
  }

  onMessage(h: (m: RemoteMsg) => void) {
    this.handlers.push(h);
  }

  send(msg: RemoteMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private open() {
    const ws = new WebSocket(`${this.base}/api/room?code=${this.code}&seat=${this.seat}`);
    this.ws = ws;
    ws.onopen = () => (this.connected = true);
    ws.onmessage = (e) => {
      let msg: RemoteMsg;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.type === "hello") this.peerConnected = msg.peer;
      if (msg.type === "peer") this.peerConnected = msg.connected;
      if (msg.type === "ping" && this.isHost) this.send({ type: "pong", t0: msg.t0, th: performance.now() });
      if (msg.type === "pong" && !this.isHost) this.clock.add(msg.t0, msg.th, performance.now());
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = (e) => {
      this.connected = false;
      this.peerConnected = false;
      clearInterval(this.pingTimer);
      if (e.code === 4001) this.fatal = `The ${this.seat} seat in room ${this.code} is already taken.`;
      else if (e.code === 4003) this.fatal = "The server is full. Try again later.";
      else setTimeout(() => this.open(), 1000);
    };
    if (!this.isHost) {
      // Ping often at first so the clock syncs quickly, then once a second.
      let n = 0;
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        if (this.peerConnected && (n++ < 10 || n % 4 === 0)) this.send({ type: "ping", t0: performance.now() });
      }, 250);
    }
  }
}
