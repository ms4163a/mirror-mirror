// Runs the game dev server and the leaderboard server together: `npm run dev:all`.
// Pass --https to serve the game over HTTPS (needed for cameras on other LAN devices).
import { spawn } from "node:child_process";

const viteArgs = ["vite", ...(process.argv.includes("--https") ? ["--mode", "https"] : [])];
const procs = [
  spawn("npx", viteArgs, { stdio: "inherit", shell: true }),
  spawn(process.execPath, ["server/index.ts"], { stdio: "inherit" }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", (code) => code && stop()));
