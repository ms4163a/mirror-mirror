// The round script: timed prompt cards that keep players moving. Person B
// tunes the wording, order and timing here.

export type LeadMode = "free" | "left" | "right";

export interface PromptCard {
  /** Start time in ms from the round start. */
  at: number;
  title: string;
  hint: string;
  lead: LeadMode;
}

export const ROUND_MS = 60_000;

export const ROUND_SCRIPT: PromptCard[] = [
  { at: 0, title: "Mirror each other!", hint: "Copy every face your partner makes", lead: "free" },
  { at: 6_000, title: "Big smiles", hint: "Grow it slowly, together", lead: "free" },
  { at: 12_000, title: "Surprise!", hint: "Eyebrows way up, mouth open", lead: "free" },
  { at: 18_000, title: "Left player leads", hint: "Right player: be their mirror", lead: "left" },
  { at: 30_000, title: "Swap! Right player leads", hint: "Left player: follow closely", lead: "right" },
  { at: 42_000, title: "Grumpy faces", hint: "Frown, scrunch, pout", lead: "free" },
  { at: 48_000, title: "Freestyle", hint: "No leader — find the rhythm", lead: "free" },
  { at: 56_000, title: "Final push!", hint: "Biggest faces you've got", lead: "free" },
];

export function promptAt(elapsedMs: number, script = ROUND_SCRIPT): { card: PromptCard; index: number } {
  let index = 0;
  for (let i = 0; i < script.length; i++) if (script[i].at <= elapsedMs) index = i;
  return { card: script[index], index };
}
