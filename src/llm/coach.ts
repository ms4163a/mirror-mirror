// Llama "coach's note" for the recap, via local Ollama (llama3.1:8b).
//
// The model only INTERPRETS the measured round. It gets the recap numbers and
// nothing else, and its output is checked before it is shown:
//   - every number it writes must be one of the measured numbers
//   - no relationship or compatibility language
// If Ollama is unreachable, slow, or the check fails, no note is shown and the
// rest of the recap works exactly the same (offline core).
import type { Recap } from "../game/recap";

export const OLLAMA_URL = "/ollama"; // proxied to http://localhost:11434 by vite.config.ts
export const MODEL = "llama3.1:8b";
const TIMEOUT_MS = 12_000;

const BANNED = [
  /compatib/i, /relationship/i, /soul ?mate/i, /\blove\b/i, /chemistry/i, /couple/i,
  /personality/i, /\bdate\b/i, /dating/i, /partner(ship)?s? for life/i, /meant to be/i, /destiny/i,
];

/** The facts the model may use, as display strings. Also the allowed-number list. */
export function recapFacts(r: Recap) {
  const pct = (x: number) => Math.round(x * 100);
  const facts: Record<string, string | number> = {
    jack_climbed_m: Math.round(r.height * 10) / 10,
    round_length_s: r.durationS,
    percent_of_round_in_sync: pct(r.inSyncShare),
    longest_sync_streak_s: Math.round(r.bestStreakS * 10) / 10,
    average_sync_percent_while_moving: pct(r.meanSync),
  };
  if (r.medianLagMs !== null) facts.typical_follow_lag_ms = Math.round(r.medianLagMs);
  const lead = r.lead.left + r.lead.right + r.lead.unison;
  if (lead > 0) {
    facts.left_player_led_percent = pct(r.lead.left);
    facts.right_player_led_percent = pct(r.lead.right);
    facts.in_unison_percent = pct(r.lead.unison);
  }
  if (r.leaderSegments.left !== null) facts.sync_percent_when_left_was_told_to_lead = pct(r.leaderSegments.left);
  if (r.leaderSegments.right !== null) facts.sync_percent_when_right_was_told_to_lead = pct(r.leaderSegments.right);
  r.families.slice(0, 3).forEach((f, i) => {
    facts[`best_expression_${i + 1}`] = f.label;
    facts[`best_expression_${i + 1}_match_percent`] = pct(f.score);
  });
  const worst = r.families[r.families.length - 1];
  if (r.families.length > 3 && worst) {
    facts.weakest_expression = worst.label;
    facts.weakest_expression_match_percent = pct(worst.score);
  }
  return facts;
}

const SYSTEM = `You are the friendly coach of "Mirror, Mirror", a party game where two players sitting side by side try to mirror each other's facial expressions. A computer measured their round. You get ONLY the measured numbers as JSON.

What the keys mean:
- jack_climbed_m: how high the game character climbed (meters). Higher is better.
- percent_of_round_in_sync: share of the round where their faces matched well.
- longest_sync_streak_s: longest unbroken stretch in sync (seconds).
- average_sync_percent_while_moving: how closely they matched, on average, while both were moving.
- typical_follow_lag_ms: how far behind the follower usually was (milliseconds). Lower means tighter mirroring.
- left_player_led_percent / right_player_led_percent / in_unison_percent: of the in-sync time, who moved first.
- sync_percent_when_left_was_told_to_lead / ..._right_...: sync during the prompts that assigned a leader.
- best_expression_N / weakest_expression: expression types and how well they matched.

Write a coach's note of 2 or 3 short sentences (under 60 words total):
- name one thing they did well, using one or two of the numbers
- give one concrete, playful tip for the next round (for example: take turns leading, exaggerate expressions, slow down so the follower can keep up)

Reply as JSON: {"note": "<the note>", "facts_used": ["<key>", ...]} listing every key whose value appears in the note.

Strict rules:
- Use ONLY numbers that appear in the JSON, written exactly as given, and only with the meaning of their key. Never compute or invent numbers.
- This is feedback on one round of a game. Never comment on the players' relationship, compatibility, feelings, personalities or future together.
- Refer to the players only as "Left" and "Right" or "you two".
- No greetings, no emojis, no lists. Plain sentences only.`;

/**
 * Checks a draft note against the facts. Returns the reason it fails, or null if OK.
 * With `used`, every number must belong to one of those keys, which catches a
 * real number cited for the wrong thing more often than a global check does.
 */
export function validateNote(note: string, facts: Record<string, string | number>, used?: string[]): string | null {
  if (!note.trim()) return "empty";
  if (note.split(/\s+/).length > 80) return "too long";
  for (const re of BANNED) if (re.test(note)) return `banned phrase ${re}`;
  const allowed = new Set<string>();
  const keys = used ?? Object.keys(facts);
  for (const k of keys) {
    if (!(k in facts)) return `unknown fact ${k}`;
    if (typeof facts[k] === "number") allowed.add(String(facts[k]));
  }
  // Small counting words in a sentence ("one tip", "two of you") are fine; any digits must be measured.
  for (const m of note.matchAll(/\d+(?:\.\d+)?/g)) {
    if (!allowed.has(m[0]) && !allowed.has(String(Number(m[0])))) return `unmeasured number ${m[0]}`;
  }
  return null;
}

export interface CoachNote {
  text: string;
  model: string;
}

/** Asks Llama for a note. Resolves to null on any failure (never throws). */
export async function writeCoachNote(recap: Recap, opts: { url?: string; signal?: AbortSignal } = {}): Promise<CoachNote | null> {
  const facts = recapFacts(recap);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  opts.signal?.addEventListener("abort", () => ctrl.abort());
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${opts.url ?? OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: MODEL,
          stream: false,
          format: "json",
          options: { temperature: 0.3 + attempt * 0.2, num_predict: 160 },
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: JSON.stringify(facts) },
          ],
        }),
      });
      if (!res.ok) return null;
      let text = "";
      let used: string[] = [];
      try {
        const out = JSON.parse((await res.json())?.message?.content ?? "{}");
        text = String(out.note ?? "").trim();
        used = Array.isArray(out.facts_used) ? out.facts_used.map(String) : [];
      } catch {
        continue;
      }
      const problem = validateNote(text, facts, used);
      if (!problem) return { text, model: MODEL };
      console.warn(`Coach note rejected (${problem}):`, text);
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
