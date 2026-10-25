// The beanstalk scene, drawn with Canvas 2D. Jack and the scenery are simple
// vector shapes for now. Person B can drop hand-made art into
// public/assets/ (jack.png first), and it replaces the placeholder automatically.

export const MILESTONES = [
  { m: 25, label: "Treetops", reached: "He reached the treetops." },
  { m: 50, label: "Above the clouds", reached: "He climbed above the clouds." },
  { m: 75, label: "Jet stream", reached: "He reached the jet stream." },
  { m: 100, label: "Giant's castle", reached: "He made it to the giant's castle." },
];

/** The sentence the recap shows under the height: the highest milestone Jack passed. */
export function reachedSentence(height: number): string {
  let sentence = "He's still down in the garden.";
  for (const m of MILESTONES) if (height >= m.m) sentence = m.reached;
  return sentence;
}

/** Meters of world visible top to bottom. */
const VIEW_M = 14;
/** Where Jack sits vertically, as a fraction of the canvas height. */
const JACK_Y = 0.62;

// Sky colors by altitude (m).
const SKY: [number, [number, number, number]][] = [
  [0, [150, 214, 255]],
  [40, [92, 160, 235]],
  [90, [40, 70, 160]],
  [140, [16, 24, 70]],
  [220, [6, 8, 26]],
];

function skyAt(m: number) {
  if (m <= SKY[0][0]) return SKY[0][1];
  for (let i = 1; i < SKY.length; i++) {
    if (m <= SKY[i][0]) {
      const [m0, c0] = SKY[i - 1];
      const [m1, c1] = SKY[i];
      const f = (m - m0) / (m1 - m0);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * f)) as [number, number, number];
    }
  }
  return SKY[SKY.length - 1][1];
}
const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** Deterministic 0..1 hash so clouds and stars stay put. */
function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export interface SceneState {
  height: number;
  sync: number;
  /** True while players are still and Jack slips. */
  slipping: boolean;
}

export class Scene {
  private readonly ctx: CanvasRenderingContext2D;
  private camM = 0;
  private climbPhase = 0;
  private lastHeight = 0;
  private jackSprite: HTMLImageElement | null = null;
  private w = 0;
  private h = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    loadImage("/assets/jack.png").then((img) => (this.jackSprite = img));
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.w = w;
    this.h = h;
  }

  reset() {
    this.camM = 0;
    this.lastHeight = 0;
  }

  render(dtMs: number, s: SceneState) {
    this.resize();
    const { ctx, w, h } = this;
    const ppm = h / VIEW_M;
    // Camera eases toward Jack.
    this.camM += (s.height - this.camM) * (1 - Math.exp(-dtMs / 250));
    this.climbPhase += Math.max(0, s.height - this.lastHeight) * 3;
    this.lastHeight = s.height;

    const yOf = (m: number) => h * JACK_Y - (m - this.camM) * ppm;
    const topM = this.camM + (h * JACK_Y) / ppm;
    const botM = this.camM - (h * (1 - JACK_Y)) / ppm;

    // Sky
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgb(skyAt(topM)));
    g.addColorStop(1, rgb(skyAt(botM)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Stars fade in high up
    const starAlpha = Math.max(0, Math.min(1, (topM - 100) / 60));
    if (starAlpha > 0) {
      ctx.fillStyle = `rgba(255,255,240,${starAlpha})`;
      for (let i = Math.floor(botM); i < topM; i++) {
        for (let k = 0; k < 3; k++) {
          const x = hash(i * 3 + k) * w;
          const y = yOf(i + hash(i * 7 + k));
          ctx.fillRect(x, y, 2, 2);
        }
      }
    }

    // Clouds every ~9 m
    for (let i = Math.max(1, Math.floor(botM / 9) - 1); i * 9 < topM + 9; i++) {
      const m = i * 9 + hash(i) * 4;
      this.cloud(hash(i + 50) * w, yOf(m), (0.6 + hash(i + 9) * 0.6) * ppm * 1.4);
    }

    // Ground
    const groundY = yOf(0);
    if (groundY < h) {
      ctx.fillStyle = "#4f8f3a";
      ctx.beginPath();
      ctx.moveTo(0, groundY + ppm * 0.3);
      ctx.quadraticCurveTo(w / 2, groundY - ppm * 0.6, w, groundY + ppm * 0.3);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.fill();
      ctx.fillStyle = "#6b4a2b";
      ctx.fillRect(0, groundY + ppm * 1.2, w, h);
    }

    // Milestones (castle at the last one)
    for (const ms of MILESTONES) {
      const y = yOf(ms.m);
      if (y < -ppm * 4 || y > h + ppm) continue;
      if (ms.m === 100) this.castle(w * 0.72, y, ppm);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.setLineDash([8, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = `600 ${Math.round(ppm * 0.45)}px system-ui, sans-serif`;
      ctx.textAlign = "right";
      this.text(`${ms.label} · ${ms.m} m`, w - ppm * 0.4, y - ppm * 0.2);
    }

    // Height ruler on the left
    ctx.textAlign = "left";
    ctx.font = `${Math.round(ppm * 0.32)}px system-ui, sans-serif`;
    for (let m = Math.max(0, Math.ceil(botM / 5) * 5); m < topM; m += 5) {
      const y = yOf(m);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillRect(0, y, m % 10 === 0 ? ppm * 0.5 : ppm * 0.25, 2);
      if (m % 10 === 0) this.text(`${m} m`, ppm * 0.6, y + ppm * 0.12);
    }

    // Beanstalk
    const stalkX = (m: number) => w * 0.42 + Math.sin(m * 0.45) * ppm * 0.6;
    const from = Math.max(0, botM - 1);
    for (const [phase, width, color] of [
      [0, 0.32, "#2f7a2a"],
      [Math.PI, 0.18, "#3fa036"],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width * ppm;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let m = from; m <= topM + 1; m += 0.1) {
        const x = stalkX(m) + Math.sin(m * 1.3 + phase) * ppm * 0.15;
        if (m === from) ctx.moveTo(x, yOf(m));
        else ctx.lineTo(x, yOf(m));
      }
      ctx.stroke();
    }
    for (let i = Math.max(1, Math.floor(from / 1.4)); i * 1.4 < topM + 1; i++) {
      const m = i * 1.4;
      this.leaf(stalkX(m), yOf(m), i % 2 ? 1 : -1, ppm);
    }

    // Jack
    const jackX = stalkX(s.height) + ppm * 0.35;
    this.jack(jackX, yOf(s.height), ppm, s);

    if (s.slipping) {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `700 ${Math.round(ppm * 0.5)}px system-ui, sans-serif`;
      ctx.textAlign = "left";
      this.text("Move! I'm slipping…", jackX + ppm * 0.9, yOf(s.height) - ppm * 1.4);
    }
  }

  /** Fills text with a soft dark shadow so white labels stay readable on the pale low sky. */
  private text(str: string, x: number, y: number) {
    const { ctx } = this;
    ctx.save();
    ctx.shadowColor = "rgba(10, 20, 50, 0.7)";
    ctx.shadowBlur = 5;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  private cloud(x: number, y: number, r: number) {
    const { ctx } = this;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.4, r * 0.5, 0, 0, Math.PI * 2);
    ctx.ellipse(x - r * 0.6, y - r * 0.25, r * 0.6, r * 0.45, 0, 0, Math.PI * 2);
    ctx.ellipse(x + r * 0.4, y - r * 0.35, r * 0.7, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private leaf(x: number, y: number, side: number, ppm: number) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(side * -0.5);
    ctx.fillStyle = "#4cb043";
    ctx.beginPath();
    ctx.ellipse(side * ppm * 0.55, 0, ppm * 0.55, ppm * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2f7a2a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(side * ppm * 1.0, 0);
    ctx.stroke();
    ctx.restore();
  }

  private castle(x: number, y: number, ppm: number) {
    const { ctx } = this;
    this.cloud(x, y + ppm * 0.3, ppm * 2.2);
    ctx.fillStyle = "#c9c3d6";
    const bw = ppm * 3;
    const bh = ppm * 2.2;
    ctx.fillRect(x - bw / 2, y - bh, bw, bh);
    for (const tx of [-bw / 2, bw / 2 - ppm * 0.8]) {
      ctx.fillRect(x + tx, y - bh - ppm * 1.2, ppm * 0.8, ppm * 1.2);
      ctx.fillStyle = "#8a5fbf";
      ctx.beginPath();
      ctx.moveTo(x + tx - ppm * 0.1, y - bh - ppm * 1.2);
      ctx.lineTo(x + tx + ppm * 0.4, y - bh - ppm * 2);
      ctx.lineTo(x + tx + ppm * 0.9, y - bh - ppm * 1.2);
      ctx.fill();
      ctx.fillStyle = "#c9c3d6";
    }
    ctx.fillStyle = "#5a4a3a";
    ctx.beginPath();
    ctx.ellipse(x, y - ppm * 0.6, ppm * 0.45, ppm * 0.6, 0, Math.PI, 0);
    ctx.lineTo(x + ppm * 0.45, y);
    ctx.lineTo(x - ppm * 0.45, y);
    ctx.fill();
  }

  private jack(x: number, y: number, ppm: number, s: SceneState) {
    const { ctx } = this;
    const size = ppm * 1.3; // Jack is about 1.3 m tall on screen
    if (this.jackSprite) {
      const img = this.jackSprite;
      const sh = size;
      const sw = (img.width / img.height) * sh;
      ctx.drawImage(img, x - sw / 2, y - sh, sw, sh);
      return;
    }
    const swing = Math.sin(this.climbPhase);
    const u = size / 10;
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = "round";
    // legs
    ctx.strokeStyle = "#3b5ba5";
    ctx.lineWidth = u * 1.2;
    ctx.beginPath();
    ctx.moveTo(-u, -u * 4);
    ctx.lineTo(-u * 1.5, -u * (0.5 + swing));
    ctx.moveTo(u, -u * 4);
    ctx.lineTo(u * 1.5, -u * (0.5 - swing));
    ctx.stroke();
    // body
    ctx.fillStyle = "#c8432b";
    ctx.beginPath();
    ctx.roundRect(-u * 2, -u * 7.5, u * 4, u * 4, u);
    ctx.fill();
    // arms reach up toward the stalk
    ctx.strokeStyle = "#f2c79b";
    ctx.lineWidth = u;
    ctx.beginPath();
    ctx.moveTo(-u * 1.8, -u * 7);
    ctx.lineTo(-u * 3.5, -u * (9.5 + swing));
    ctx.moveTo(u * 1.8, -u * 7);
    ctx.lineTo(-u * 2.5, -u * (9.5 - swing));
    ctx.stroke();
    // head
    ctx.fillStyle = "#f2c79b";
    ctx.beginPath();
    ctx.arc(0, -u * 8.8, u * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7a4a1e";
    ctx.beginPath();
    ctx.arc(0, -u * 9.3, u * 1.5, Math.PI, 0);
    ctx.fill();
    // glow while in sync
    if (s.sync > 0.4) {
      ctx.strokeStyle = `rgba(255,236,140,${Math.min(1, (s.sync - 0.4) * 2)})`;
      ctx.lineWidth = u * 0.5;
      ctx.beginPath();
      ctx.arc(0, -u * 5.5, u * 5.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
