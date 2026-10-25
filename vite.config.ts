import { existsSync } from "node:fs";
import { defineConfig } from "vite";

// Dev-server proxies, so the browser only ever talks to one origin (this also
// works for other devices on the LAN, like the leaderboard laptop):
//   /ollama -> local Ollama, for the Llama coach's note
//   /api    -> leaderboard server (npm run server)
const proxy = {
  "/ollama": { target: "http://localhost:11434", changeOrigin: true, rewrite: (p: string) => p.replace(/^\/ollama/, "") },
  "/api": { target: "http://localhost:8787", changeOrigin: true },
};

export default defineConfig({
  server: { port: 5173, host: true, proxy },
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
});
