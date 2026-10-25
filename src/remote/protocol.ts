// Messages between the two browsers in a remote game (relayed by the server).
// The host (left seat) runs the engine and the round; the guest (right seat)
// sends its face channels and displays the host's state.
import type { Recap } from "../game/recap";
import type { RoundSample } from "../game/round";
import type { SyncSnapshot } from "../sync/syncEngine";

export type ScreenName = "lobby" | "calibrate" | "countdown" | "round" | "recap" | "error";

export type RemoteMsg =
  // relay -> client
  | { type: "hello"; seat: "left" | "right"; peer: boolean }
  | { type: "peer"; connected: boolean }
  // both directions: one face sample. t is in HOST time; v is null when no face was found.
  | { type: "frame"; t: number; v: number[] | null }
  // guest -> host clock sync, and the host's answer
  | { type: "ping"; t0: number }
  | { type: "pong"; t0: number; th: number }
  // guest -> host: please start (Space on the guest's machine)
  | { type: "start" }
  // host -> guest, about 10 Hz
  | {
      type: "state";
      screen: ScreenName;
      screenElapsed: number;
      snap: SyncSnapshot | null;
      sync: number;
      height: number;
      roundElapsed: number;
      roundMs: number;
      presence: [boolean, boolean];
      /** Why Start is still locked ("" when ready), shown in the guest's lobby. */
      waiting: string;
    }
  // host -> guest, once per round
  | { type: "recap"; recap: Recap; samples: RoundSample[] };
