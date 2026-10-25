// One round of play: turns sync snapshots into Jack's climb and logs every
// snapshot for the recap.
import type { Family } from "../signal/channels";
import type { SyncSnapshot } from "../sync/syncEngine";
import { ROUND_MS, ROUND_SCRIPT, promptAt, type PromptCard } from "./prompts";

export interface ClimbTuning {
  /** Sync below this does not move Jack. */
  syncThreshold: number;
  /** Climb speed (m/s) at sync = 1. */
  maxClimb: number;
  /** Slip speed (m/s) while players are still. */
  stillSlip: number;
}

export const DEFAULT_CLIMB: ClimbTuning = { syncThreshold: 0.2, maxClimb: 2.5, stillSlip: 0.4 };

export interface RoundSample {
  /** ms since round start */
  t: number;
  sync: number;
  lagMs: number;
  leader: 0 | 1 | null;
  active: boolean;
  height: number;
  families: Partial<Record<Family, number>>;
  promptIndex: number;
}

export class Round {
  elapsed = 0;
  height = 0;
  /** Smoothed sync for display and climbing, so Jack doesn't jitter. */
  sync = 0;
  readonly samples: RoundSample[] = [];
  last: SyncSnapshot | null = null;

  constructor(
    readonly durationMs = ROUND_MS,
    readonly tuning: ClimbTuning = DEFAULT_CLIMB,
  ) {}

  get done() {
    return this.elapsed >= this.durationMs;
  }

  get prompt(): { card: PromptCard; index: number } {
    return promptAt(this.elapsed, ROUND_SCRIPT, this.durationMs);
  }

  /** Advances the round clock and Jack. `snap` is the newest snapshot, if any. */
  update(dtMs: number, snap: SyncSnapshot | null) {
    if (this.done) return;
    dtMs = Math.min(dtMs, this.durationMs - this.elapsed);
    this.elapsed += dtMs;
    const target = snap?.sync ?? 0;
    const { syncThreshold, maxClimb, stillSlip } = this.tuning;
    const climbRate = (s: number) => (Math.max(0, s - syncThreshold) / (1 - syncThreshold)) * maxClimb;
    const before = this.sync;
    // Smooth over about 300 ms.
    this.sync += (target - this.sync) * (1 - Math.exp(-dtMs / 300));

    const dt = dtMs / 1000;
    if (snap && !snap.active) {
      this.height = Math.max(0, this.height - stillSlip * dt);
    } else {
      // Average the rate before and after smoothing (trapezoid), so the height
      // doesn't depend on how often update() is called (60 Hz live, 30 Hz replay).
      this.height += 0.5 * (climbRate(before) + climbRate(this.sync)) * dt;
    }
  }

  /** Records a snapshot. Call once per new engine snapshot (about 10 Hz). */
  record(snap: SyncSnapshot) {
    this.last = snap;
    const families: Partial<Record<Family, number>> = {};
    for (const f of snap.families) if (f.score !== null) families[f.family] = f.score;
    this.samples.push({
      t: this.elapsed,
      sync: snap.sync,
      lagMs: snap.lagMs,
      leader: snap.leader,
      active: snap.active,
      height: this.height,
      families,
      promptIndex: this.prompt.index,
    });
  }
}
