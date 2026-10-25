// Starts the leaderboard server: `npm run server`.
//   PORT        default 8787
//   DATA_FILE   default server/data/rounds.jsonl (gitignored)
//   STATIC_DIR  or --static <dir>: also serve the built app (e.g. dist on Vultr); off in dev
import { join } from "node:path";
import { createApp } from "./app.ts";
import { FileStore } from "./store.ts";

const port = Number(process.env.PORT) || 8787;
const dataFile = process.env.DATA_FILE || join(import.meta.dirname, "data", "rounds.jsonl");
const staticArg = process.argv.indexOf("--static");
const staticDir = staticArg > 0 ? process.argv[staticArg + 1] : process.env.STATIC_DIR;
const store = new FileStore(dataFile);

createApp({ store, staticDir, log: (m) => console.log(`[leaderboard] ${m}`) }).listen(port, () => {
  console.log(`[leaderboard] listening on :${port}, store=${store.name} (${dataFile})`);
});
