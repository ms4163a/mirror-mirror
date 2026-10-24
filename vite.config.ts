import { defineConfig } from "vite";

// Local Ollama for the Llama coach's note. Going through the dev server avoids
// CORS and lets other devices on the LAN use it too.
const ollama = {
  "/ollama": { target: "http://localhost:11434", changeOrigin: true, rewrite: (p: string) => p.replace(/^\/ollama/, "") },
};

export default defineConfig({
  server: { port: 5173, host: true, proxy: ollama },
  preview: { proxy: ollama },
  build: {
    rollupOptions: {
      input: { main: "index.html", dev: "dev.html" },
    },
  },
});
