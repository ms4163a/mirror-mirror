import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173, host: true },
  build: {
    rollupOptions: {
      input: { main: "index.html", dev: "dev.html" },
    },
  },
});
