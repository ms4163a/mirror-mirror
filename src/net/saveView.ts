// "Save to leaderboard" box on the recap. Inserted into the rendered recap
// like the coach's note, so recapView.ts stays unaware of the network.
// Nothing is sent unless the players press Save.
import type { RoundMode } from "../../shared/leaderboard";
import type { Recap } from "../game/recap";
import type { RoundSample } from "../game/round";
import "./save.css";
import { rememberTeam, rememberedTeam, submitRound, toSubmission } from "./leaderboardClient";

export function showSaveBox(recapHost: HTMLElement, recap: Recap, samples: RoundSample[], mode: RoundMode) {
  const box = document.createElement("form");
  box.className = "save-box";
  box.innerHTML = `
    <label for="save-team">Put this round on the leaderboard</label>
    <div class="save-row">
      <input id="save-team" name="team" maxlength="24" autocomplete="off" placeholder="Team name (optional)" />
      <button type="submit">Save</button>
    </div>
    <p class="save-status" aria-live="polite">Only your team name and these numbers are saved. No images.${
      mode === "camera" ? "" : " (Test round: hidden from the main board.)"
    }</p>`;
  const input = box.querySelector<HTMLInputElement>("input")!;
  const button = box.querySelector<HTMLButtonElement>("button")!;
  const status = box.querySelector<HTMLElement>(".save-status")!;
  input.value = rememberedTeam();
  // A remembered name is a suggestion: selecting it lets the next team just type over it.
  input.addEventListener("focus", () => input.select());

  box.addEventListener("submit", async (e) => {
    e.preventDefault();
    button.disabled = true;
    input.disabled = true;
    status.textContent = "Saving…";
    const team = input.value.trim();
    rememberTeam(team);
    const result = await submitRound(toSubmission(recap, samples, team, mode));
    if (result) {
      box.classList.add("saved");
      status.textContent = result.rank ? `Saved! You're #${result.rank} of ${result.total}.` : "Saved!";
    } else {
      status.textContent = "Leaderboard is offline. This round is queued and will upload automatically.";
    }
    input.blur();
  });

  const anchor = recapHost.querySelector(".disclaimer");
  if (anchor) anchor.before(box);
  else recapHost.querySelector(".recap")?.append(box);
}
