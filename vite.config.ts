import { existsSync } from "node:fs";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

// Dev-server proxies, so the browser only ever talks to one origin (this also
// works for other devices on the LAN, like the leaderboard laptop):
//   /ollama -> local Ollama, for the Llama coach's note
//   /api    -> leaderboard server (npm run server), including remote-play WebSockets
const proxy = {
  "/ollama": { target: "http://localhost:11434", changeOrigin: true, rewrite: (p: string) => p.replace(/^\/ollama/, "") },
  "/api": { target: "http://localhost:8787", changeOrigin: true, ws: true },
};

// `vite --mode https` (npm run dev:https) serves over HTTPS with a self-signed
// certificate. Browsers only allow the camera on https:// or localhost, so a
// second computer on the LAN needs this for remote play.
export default defineConfig(({ mode }) => ({
  plugins: mode === "https" ? [basicSsl()] : [],
  server: {
    port: 5173,
    host: true,
    proxy,
    // Public tunnels for remote play between networks (Cloudflare quick tunnel, Tailscale Funnel).
    allowedHosts: [".trycloudflare.com", ".ts.net"],
  },
  preview: { proxy },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        dev: "dev.html",
        leaderboard: "leaderboard.html",
        // Claude B's tuning page; only added once its file is in this clone.
        ...(existsSync("tune.html") ? { tune: "tune.html" } : {}),
      },
    },
  },
}));
