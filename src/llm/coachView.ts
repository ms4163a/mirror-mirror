// Shows the Llama coach's note on the recap screen. It's inserted into the
// rendered recap, so recapView.ts doesn't need to know about the LLM, and it
// disappears quietly if the model is unavailable.
import type { Recap } from "../game/recap";
import "./coach.css";
import { writeCoachNote } from "./coach";

let inflight: AbortController | null = null;

export function showCoachNote(recapHost: HTMLElement, recap: Recap) {
  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;

  const box = document.createElement("div");
  box.className = "coach loading";
  box.innerHTML = `<div class="coach-head">Coach's note</div><p class="coach-text">Reading your numbers…</p>
    <div class="coach-foot">Written by Llama 3.1 (running on this computer) using only the measurements above.</div>`;
  const anchor = recapHost.querySelector(".disclaimer");
  if (anchor) anchor.before(box);
  else recapHost.querySelector(".recap")?.append(box);

  writeCoachNote(recap, { signal: ctrl.signal }).then((note) => {
    if (ctrl.signal.aborted) return;
    if (!note) {
      box.remove();
      return;
    }
    box.classList.remove("loading");
    box.querySelector(".coach-text")!.textContent = note.text;
  });
}

export function cancelCoachNote() {
  inflight?.abort();
  inflight = null;
}
