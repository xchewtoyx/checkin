import { FEELINGS } from "./config";
import { isPromptUsable } from "./record-response";
import { PromptRow } from "./store";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderCheckinPage(prompt: PromptRow, now: Date): string {
  const usable = isPromptUsable(prompt, now);
  if (!usable) {
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>checkin</title></head>
<body><main><p>Link expired.</p></main></body>
</html>`;
  }

  const feelings = FEELINGS.map(
    (feeling) =>
      `<button type="button" data-feeling="${feeling}">${escapeHtml(feeling)}</button>`,
  ).join("");

  const intensities = Array.from({ length: 10 }, (_, index) => {
    const value = index + 1;
    return `<button type="button" data-intensity="${value}">${value}</button>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>checkin</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1rem; }
    main { max-width: 24rem; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
    .intensity { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    button { padding: 0.75rem; font-size: 1rem; }
    textarea { width: 100%; margin-top: 0.75rem; }
    #status { margin-top: 1rem; }
  </style>
</head>
<body>
  <main>
    <h1>How are you?</h1>
    <section class="grid" id="feelings">${feelings}</section>
    <label for="note">Optional note</label>
    <textarea id="note" rows="2" maxlength="200"></textarea>
    <h2>Intensity</h2>
    <section class="grid intensity" id="intensities">${intensities}</section>
    <p id="status"></p>
  </main>
  <script>
    let feeling = null;
    let intensity = null;
    const status = document.getElementById("status");
    document.getElementById("feelings").addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      feeling = target.dataset.feeling ?? null;
      maybeSubmit();
    });
    document.getElementById("intensities").addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      intensity = Number(target.dataset.intensity ?? "0");
      maybeSubmit();
    });
    async function maybeSubmit() {
      if (!feeling || !intensity) return;
      status.textContent = "Saving...";
      const note = document.getElementById("note").value;
      const response = await fetch(window.location.pathname, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feeling, intensity, note }),
      });
      if (!response.ok) {
        status.textContent = "Could not save.";
        return;
      }
      document.body.innerHTML = "<main><p>Recorded.</p></main>";
    }
  </script>
</body>
</html>`;
}

export function renderRecordedPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>checkin</title></head>
<body><main><p>Recorded.</p></main></body>
</html>`;
}
