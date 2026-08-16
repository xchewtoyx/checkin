import { WHEEL } from "./feelings-wheel";
import { getLondonParts } from "./london-time";
import { isPromptUsable } from "./record-response";
import { PromptRow } from "./store";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Safe to embed inside a <script> block: escapes "</" so a taxonomy word
// can never prematurely close the tag (defense in depth — WHEEL is
// developer-authored data, not user input).
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("</", "<\\/");
}

const STYLE = `
  :root {
    --ground: #faf9f7;
    --surface: #ffffff;
    --ink: #1f2328;
    --muted: #6b6f76;
    --line: #e4e1db;
    --focus: #4a6fdc;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #15171a;
      --surface: #1d2025;
      --ink: #e8eaed;
      --muted: #9aa0a8;
      --line: #2b2f36;
      --focus: #7c96e8;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }
  main {
    max-width: 26rem;
    margin: 0 auto;
    padding: 1.1rem 1.1rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  .eyebrow {
    font-size: 0.72rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0;
  }
  h1 {
    font-size: 1.55rem;
    font-weight: 800;
    margin: 0.1rem 0 0;
    text-wrap: balance;
  }
  .group-label {
    font-size: 0.72rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0 0 0.45rem;
  }
  .ladder-row { display: none; }
  .ladder-row.visible { display: block; }
  .chips {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.4rem;
  }
  .chip {
    --h: #888888;
    appearance: none;
    border: 1px solid color-mix(in oklab, var(--h) 38%, var(--line));
    background: color-mix(in oklab, var(--h) 11%, var(--surface));
    color: color-mix(in oklab, var(--h) 52%, var(--ink));
    border-radius: 999px;
    padding: 0.4rem 0.55rem;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    line-height: 1.15;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    cursor: pointer;
  }
  .chip[aria-pressed="true"] {
    background: color-mix(in oklab, var(--h) 26%, var(--surface));
    border-color: var(--h);
    box-shadow: inset 0 0 0 1.5px var(--h);
    color: color-mix(in oklab, var(--h) 62%, var(--ink));
    font-weight: 800;
  }
  .note input {
    width: 100%;
    font: inherit;
    font-size: 1rem;
    padding: 0.7rem 0.85rem;
    border-radius: 0.7rem;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    min-height: 44px;
  }
  .note input::placeholder { color: var(--muted); }
  .confidence-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .confidence-row .toggle { display: flex; gap: 0.4rem; }
  .confidence-row button {
    appearance: none;
    font: inherit;
    font-weight: 700;
    font-size: 0.85rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--muted);
    padding: 0.4rem 0.75rem;
    min-height: 44px;
    cursor: pointer;
  }
  .confidence-row button[aria-pressed="true"] {
    border-color: var(--focus);
    color: var(--ink);
    background: color-mix(in oklab, var(--focus) 14%, var(--surface));
    font-weight: 800;
  }
  .intensity-head { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.45rem; }
  .intensity-head .hint { color: var(--muted); font-size: 0.82rem; }
  .intensity {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.4rem;
    font-variant-numeric: tabular-nums;
  }
  .intensity button {
    appearance: none;
    font: inherit;
    font-weight: 700;
    min-height: 44px;
    border-radius: 0.6rem;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
  }
  .intensity.active button {
    color: color-mix(in oklab, var(--h) 55%, var(--ink));
    border-color: color-mix(in oklab, var(--h) 40%, var(--line));
    background: color-mix(in oklab, var(--h) calc(4% + var(--i) * 5.5%), var(--surface));
  }
  .intensity button:disabled { cursor: not-allowed; }
  .recorded {
    display: none;
    flex-direction: column;
    gap: 0.9rem;
    align-items: flex-start;
    border: 1px solid color-mix(in oklab, var(--h, #888888) 40%, var(--line));
    background: color-mix(in oklab, var(--h, #888888) 8%, var(--surface));
    border-radius: 1rem;
    padding: 1.1rem;
  }
  .recorded.open { display: flex; }
  .recorded .word {
    font-size: 1.5rem;
    font-weight: 800;
    color: color-mix(in oklab, var(--h) 60%, var(--ink));
  }
  .recorded .meta { color: var(--muted); font-size: 0.92rem; margin: 0; }
  .recorded .change {
    appearance: none;
    font: inherit;
    font-weight: 700;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    padding: 0.5rem 1rem;
    min-height: 44px;
    cursor: pointer;
  }
  .meta-text { color: var(--muted); margin: 0; }
  #status { color: var(--muted); margin: 0; min-height: 1.2em; }
  :is(button, input):focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .hidden { display: none !important; }
`;

function pageShell(body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>checkin</title>
  <style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function londonMoment(now: Date): string {
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
  })
    .format(now)
    .toLowerCase();
  const { hour } = getLondonParts(now);
  const period = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `${weekday} ${period}`;
}

export function renderExpiredPage(): string {
  return pageShell(`  <main>
    <header>
      <p class="eyebrow">check-in</p>
      <h1>This link has expired</h1>
    </header>
    <p class="meta-text">Check-in links only last a few hours. The next prompt will bring a fresh one.</p>
  </main>`);
}

export function renderCheckinPage(prompt: PromptRow, now: Date): string {
  if (!isPromptUsable(prompt, now)) {
    return renderExpiredPage();
  }

  const coreChips = WHEEL.map(
    (sector) =>
      `<button type="button" class="chip" style="--h:${sector.hue}" aria-pressed="false" data-word="${escapeHtml(sector.core)}">${escapeHtml(sector.core)}</button>`,
  ).join("");

  const intensities = Array.from({ length: 10 }, (_, index) => {
    const value = index + 1;
    return `<button type="button" style="--i:${value}" data-intensity="${value}" disabled>${value}</button>`;
  }).join("");

  return pageShell(`  <main>
    <header>
      <p class="eyebrow">check-in · ${escapeHtml(londonMoment(now))}</p>
      <h1>How are you?</h1>
    </header>
    <section id="row-0" class="ladder-row visible">
      <p class="group-label">what feels closest?</p>
      <div class="chips" id="chips-0" role="group" aria-label="Core feelings">${coreChips}</div>
    </section>
    <section id="row-1" class="ladder-row">
      <p class="group-label">narrow it down</p>
      <div class="chips" id="chips-1" role="group" aria-label="More specific feelings"></div>
    </section>
    <section id="row-2" class="ladder-row">
      <p class="group-label">narrower still (optional)</p>
      <div class="chips" id="chips-2" role="group" aria-label="Most specific feelings"></div>
    </section>
    <section class="note" id="form-note">
      <input id="note" type="text" maxlength="200" placeholder="Add a note (optional)" aria-label="Optional note">
    </section>
    <section id="form-confidence">
      <div class="confidence-row">
        <p class="eyebrow" style="margin:0">confidence</p>
        <div class="toggle" id="confidence-toggle" role="group" aria-label="Confidence (optional)">
          <button type="button" data-confidence="weak" aria-pressed="false">weak</button>
          <button type="button" data-confidence="strong" aria-pressed="false">strong</button>
        </div>
      </div>
    </section>
    <section id="form-intensity">
      <div class="intensity-head">
        <p class="eyebrow">intensity</p>
        <span class="hint" id="intensity-hint">pick a feeling first</span>
      </div>
      <div class="intensity" id="intensity" role="group" aria-label="Intensity from 1 to 10">${intensities}</div>
    </section>
    <section class="recorded" id="recorded">
      <span class="word" id="recorded-word"></span>
      <p class="meta" id="recorded-meta"></p>
      <button class="change" id="recorded-change" type="button">Change answer</button>
    </section>
    <p id="status" role="status"></p>
  </main>
  <script>
    var WHEEL = ${jsonForScript(WHEEL)};
    (function () {
      var depth = [null, null, null]; // selected word at [core, middle, outer]
      var hueByDepth = ["#888888", "#888888", "#888888"];
      var confidence = null;
      var saving = false;

      var rowEls = [document.getElementById("row-0"), document.getElementById("row-1"), document.getElementById("row-2")];
      var chipEls = [document.getElementById("chips-0"), document.getElementById("chips-1"), document.getElementById("chips-2")];
      var intensityWrap = document.getElementById("intensity");
      var hint = document.getElementById("intensity-hint");
      var statusEl = document.getElementById("status");
      var confidenceToggle = document.getElementById("confidence-toggle");
      var intensityButtons = intensityWrap.querySelectorAll("button");
      var formIds = ["row-0", "row-1", "row-2", "form-note", "form-confidence", "form-intensity"];

      function coreSector(word) {
        for (var i = 0; i < WHEEL.length; i++) {
          if (WHEEL[i].core === word) return WHEEL[i];
        }
        return null;
      }

      function middleFeeling(sector, word) {
        for (var i = 0; i < sector.feelings.length; i++) {
          if (sector.feelings[i].word === word) return sector.feelings[i];
        }
        return null;
      }

      function deepestWord() {
        return depth[2] || depth[1] || depth[0];
      }

      function renderRow(rowIndex, words, hue) {
        var container = chipEls[rowIndex];
        container.innerHTML = "";
        for (var i = 0; i < words.length; i++) {
          var button = document.createElement("button");
          button.type = "button";
          button.className = "chip";
          button.style.setProperty("--h", hue);
          button.setAttribute("aria-pressed", "false");
          button.setAttribute("data-word", words[i]);
          button.textContent = words[i];
          container.appendChild(button);
        }
      }

      function clearRow(rowIndex) {
        chipEls[rowIndex].innerHTML = "";
        rowEls[rowIndex].classList.remove("visible");
        depth[rowIndex] = null;
      }

      function updateIntensityState() {
        var word = deepestWord();
        var active = word !== null;
        intensityWrap.classList.toggle("active", active);
        if (active) {
          var activeDepth = depth[2] ? 2 : depth[1] ? 1 : 0;
          intensityWrap.style.setProperty("--h", hueByDepth[activeDepth]);
        }
        hint.textContent = active ? "how strongly " + word + "?" : "pick a feeling first";
        for (var j = 0; j < intensityButtons.length; j++) intensityButtons[j].disabled = !active;
      }

      chipEls[0].addEventListener("click", function (event) {
        var target = event.target;
        if (!(target instanceof HTMLButtonElement)) return;
        var word = target.getAttribute("data-word");
        var sector = coreSector(word);
        if (!sector) return;

        hueByDepth[0] = sector.hue;
        hueByDepth[1] = sector.hue;
        hueByDepth[2] = sector.hue;
        clearRow(1);
        clearRow(2);
        depth[0] = word;

        var all = chipEls[0].querySelectorAll(".chip");
        for (var i = 0; i < all.length; i++) {
          all[i].setAttribute("aria-pressed", String(all[i].getAttribute("data-word") === word));
        }

        var middleWords = [];
        for (var m = 0; m < sector.feelings.length; m++) middleWords.push(sector.feelings[m].word);
        renderRow(1, middleWords, sector.hue);
        rowEls[1].classList.add("visible");
        updateIntensityState();
      });

      chipEls[1].addEventListener("click", function (event) {
        var target = event.target;
        if (!(target instanceof HTMLButtonElement)) return;
        var word = target.getAttribute("data-word");
        var sector = coreSector(depth[0]);
        if (!sector) return;
        var feeling = middleFeeling(sector, word);
        if (!feeling) return;

        clearRow(2);
        depth[1] = word;

        var all = chipEls[1].querySelectorAll(".chip");
        for (var i = 0; i < all.length; i++) {
          all[i].setAttribute("aria-pressed", String(all[i].getAttribute("data-word") === word));
        }

        renderRow(2, feeling.finer, sector.hue);
        rowEls[2].classList.add("visible");
        updateIntensityState();
      });

      chipEls[2].addEventListener("click", function (event) {
        var target = event.target;
        if (!(target instanceof HTMLButtonElement)) return;
        var word = target.getAttribute("data-word");

        depth[2] = word;

        var all = chipEls[2].querySelectorAll(".chip");
        for (var i = 0; i < all.length; i++) {
          all[i].setAttribute("aria-pressed", String(all[i].getAttribute("data-word") === word));
        }
        updateIntensityState();
      });

      confidenceToggle.addEventListener("click", function (event) {
        var target = event.target;
        if (!(target instanceof HTMLButtonElement)) return;
        var value = target.getAttribute("data-confidence");
        confidence = confidence === value ? null : value;
        var all = confidenceToggle.querySelectorAll("button");
        for (var i = 0; i < all.length; i++) {
          all[i].setAttribute("aria-pressed", String(all[i].getAttribute("data-confidence") === confidence));
        }
      });

      intensityWrap.addEventListener("click", function (event) {
        var target = event.target;
        var word = deepestWord();
        if (!(target instanceof HTMLButtonElement) || !word || saving) return;
        var hue = intensityWrap.style.getPropertyValue("--h");
        submit(Number(target.getAttribute("data-intensity")), word, confidence, hue);
      });

      function setRecorded(recorded) {
        for (var i = 0; i < formIds.length; i++) {
          document.getElementById(formIds[i]).classList.toggle("hidden", recorded);
        }
        document.getElementById("recorded").classList.toggle("open", recorded);
      }

      function submit(intensity, feeling, submittedConfidence, hue) {
        saving = true;
        statusEl.textContent = "Saving…";
        var note = document.getElementById("note").value;
        var body = { feeling: feeling, intensity: intensity, note: note };
        if (submittedConfidence) body.confidence = submittedConfidence;
        fetch(window.location.pathname, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }).then(function (response) {
          saving = false;
          if (!response.ok) {
            statusEl.textContent = "Could not save — please try again.";
            return;
          }
          statusEl.textContent = "";
          var recorded = document.getElementById("recorded");
          recorded.style.setProperty("--h", hue);
          document.getElementById("recorded-word").textContent = feeling;
          var meta = "Recorded · intensity " + intensity + " of 10";
          if (submittedConfidence) meta += " · " + submittedConfidence + " confidence";
          if (note.trim()) meta += " · \\u201c" + note.trim() + "\\u201d";
          document.getElementById("recorded-meta").textContent = meta;
          setRecorded(true);
        }).catch(function () {
          saving = false;
          statusEl.textContent = "Could not save — please try again.";
        });
      }

      document.getElementById("recorded-change").addEventListener("click", function () {
        setRecorded(false);
      });
    })();
  </script>`);
}

export function renderRecordedPage(): string {
  return pageShell(`  <main>
    <header>
      <p class="eyebrow">check-in</p>
      <h1>Recorded</h1>
    </header>
    <p class="meta-text">Thanks — this check-in has been saved.</p>
  </main>`);
}
