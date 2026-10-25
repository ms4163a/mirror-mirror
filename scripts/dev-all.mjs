// Runs the game dev server and the leaderboard server together: `npm run dev:all`.
import { spawn } from "node:child_process";

const procs = [
  spawn("npx", ["vite"], { stdio: "inherit", shell: true }),
  spawn(process.execPath, ["server/index.ts"], { stdio: "inherit" }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", (code) => code && stop()));
