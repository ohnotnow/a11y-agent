import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import type { CheckResult, Finding } from "../report.js";

// Resolves to <repo>/assets/vsr-bundle.js from both src/ (tests via vitest) and dist/ (CLI).
const BUNDLE_PATH = fileURLToPath(new URL("../../assets/vsr-bundle.js", import.meta.url));

const MAX_STEPS = 200;

// Announced alone (no accessible name after the role), these mean a control the user
// cannot identify: "button", "link", "textbox"...
const BARE_ROLES = new Set([
  "button", "link", "checkbox", "radio", "combobox", "textbox", "searchbox",
  "slider", "spinbutton", "switch", "menuitem", "menuitemcheckbox", "menuitemradio", "tab",
]);

const WALK_SCRIPT = `(async () => {
  const vsr = window.__a11yVsr;
  if (!vsr) throw new Error("virtual screen reader bundle not injected");
  await vsr.start({ container: document.body });
  let last = "";
  let stale = 0;
  let first = "";
  for (let i = 0; i < ${MAX_STEPS}; i++) {
    await vsr.next();
    const phrase = await vsr.lastSpokenPhrase();
    if (i === 0) first = phrase;
    else if (phrase === first) break;      // wrapped back to the start of the document
    if (phrase === last) {
      stale += 1;
      if (stale >= 2) break;               // pinned at the end of the document
    } else {
      stale = 0;
      last = phrase;
    }
  }
  const log = await vsr.spokenPhraseLog();
  await vsr.stop();
  return log;
})()`;

function detectBareControls(transcript: string[]): Finding[] {
  const bare = transcript.map((phrase) => phrase.trim()).filter((phrase) => BARE_ROLES.has(phrase));
  if (bare.length === 0) return [];
  const unique = [...new Set(bare)];
  return [
    {
      id: "bare-control",
      impact: "serious",
      summary: "Interactive elements are announced with no accessible name",
      detail:
        `A screen reader announces these controls as a bare role with nothing to identify them: ` +
        `${unique.join(", ")} (${bare.length} announcement(s) during the walk). ` +
        `Each needs a label, aria-label, or visible text.`,
      nodes: [],
    },
  ];
}

export async function runVsr(page: Page): Promise<CheckResult> {
  if (!existsSync(BUNDLE_PATH)) {
    throw new Error(`virtual screen reader bundle missing at ${BUNDLE_PATH} — run: npm run build`);
  }
  await page.addScriptTag({ path: BUNDLE_PATH });
  const transcript = (await page.evaluate(WALK_SCRIPT)) as string[];
  return { findings: detectBareControls(transcript), transcript };
}
