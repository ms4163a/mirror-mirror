// Estimates the offset between this page's clock and the host's clock with
// ping/pong round trips (NTP-style). The sample with the smallest round trip
// wins, because its timing is the least distorted by network queueing.

export interface ClockSample {
  rtt: number;
  offset: number;
}

export class ClockSync {
  private samples: ClockSample[] = [];

  constructor(private readonly keep = 20) {}

  /** t0: ping sent (local), th: host time when it answered, t1: pong received (local). */
  add(t0: number, th: number, t1: number) {
    const rtt = t1 - t0;
    if (rtt < 0) return;
    this.samples.push({ rtt, offset: th - (t0 + t1) / 2 });
    if (this.samples.length > this.keep) this.samples.shift();
  }

  get ready() {
    return this.samples.length >= 3;
  }

  private best(): ClockSample | null {
    let best: ClockSample | null = null;
    for (const s of this.samples) if (!best || s.rtt < best.rtt) best = s;
    return best;
  }

  /** host time = local time + offset */
  get offset(): number {
    return this.best()?.offset ?? 0;
  }

  /** Round trip of the best sample, ms (the offset is accurate to about half of it). */
  get rtt(): number {
    return this.best()?.rtt ?? NaN;
  }
}
