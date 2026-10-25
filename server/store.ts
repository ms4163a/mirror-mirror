// Round storage. The file store keeps the leaderboard working with no internet
// (it lives on the game PC). A Tiger Data (Postgres/Timescale) store can be added
// behind the same interface for the Vultr deployment.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { RoundSubmission, StoredRound } from "../shared/leaderboard.ts";

export interface RoundStore {
  readonly name: string;
  add(round: RoundSubmission): Promise<StoredRound>;
  all(): Promise<StoredRound[]>;
}

/** Append-only JSON Lines file, loaded into memory at startup. */
export class FileStore implements RoundStore {
  readonly name = "file";
  private readonly path: string;
  private rounds: StoredRound[] = [];
  private loaded: Promise<void> | null = null;

  constructor(path: string) {
    this.path = path;
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const text = await readFile(this.path, "utf8");
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            this.rounds.push(JSON.parse(line));
          } catch {
            // Skip a torn last line from a crash mid-write.
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    })();
    return this.loaded;
  }

  async add(round: RoundSubmission): Promise<StoredRound> {
    await this.load();
    const stored: StoredRound = { ...round, id: randomUUID(), receivedAt: new Date().toISOString() };
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(stored) + "\n", "utf8");
    this.rounds.push(stored);
    return stored;
  }

  async all(): Promise<StoredRound[]> {
    await this.load();
    return this.rounds;
  }
}

/** In-memory store for tests. */
export class MemoryStore implements RoundStore {
  readonly name = "memory";
  private rounds: StoredRound[] = [];
  async add(round: RoundSubmission): Promise<StoredRound> {
    const stored: StoredRound = { ...round, id: randomUUID(), receivedAt: new Date().toISOString() };
    this.rounds.push(stored);
    return stored;
  }
  async all(): Promise<StoredRound[]> {
    return this.rounds;
  }
}
