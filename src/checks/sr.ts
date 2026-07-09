import { chromium, webkit } from "playwright";
import { settlePage } from "../browser.js";
import type { CheckResult } from "../report.js";

export type SrBrowser = "webkit" | "chromium";

export interface SrOptions {
  browser?: SrBrowser;
  timeout?: number;
  settle?: number;
  storageState?: string;
}

// VoiceOver reads a real, visible app window — headless is meaningless here.
// Map the Playwright browser to the macOS application name VoiceOver targets
// (names from @guidepup/playwright's applicationNameMap).
const APPLICATION_NAMES: Record<SrBrowser, string> = {
  webkit: "Playwright",
  chromium: "Google Chrome For Testing",
};

const MAX_STEPS = 200;

// The walk overshoots the end of the document by a step or two, logging empty
// announcements; drop those trailing blanks so the transcript ends cleanly.
function trimTrailingBlanks(transcript: string[]): string[] {
  let end = transcript.length;
  while (end > 0 && transcript[end - 1].trim() === "") end--;
  return transcript.slice(0, end);
}

// Unlike the quick-mode checks, sr owns its whole browser: it must be headed,
// and VoiceOver interacts with the window, not the page object.
export async function runSr(url: string, opts: SrOptions = {}): Promise<CheckResult> {
  if (process.platform !== "darwin") {
    throw new Error("a11y sr drives the real macOS VoiceOver and only runs on macOS");
  }

  // Imported lazily: guidepup constructs a ScreenReader at module scope, which
  // throws on any machine without one — a static import here would crash the
  // whole CLI at startup on Linux, before the --foreground gate can run.
  const { voiceOver, macOSActivate, MacOSKeyCodes } = await import("@guidepup/guidepup");

  const browserName = opts.browser ?? "webkit";
  const launcher = browserName === "webkit" ? webkit : chromium;
  const browser = await launcher.launch({ headless: false });
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      storageState: opts.storageState,
    });
    const page = await context.newPage();
    await page.goto(url, { timeout: opts.timeout ?? 30_000, waitUntil: "load" });
    await settlePage(page, opts.settle);

    // start() is inside the try so a failed start still hits stop() — otherwise a
    // half-started VoiceOver is left orphaned, talking, owning the user's focus.
    try {
      await voiceOver.start({ capture: "initial" });
      // Move VoiceOver's cursor into the browser's web content. This is the
      // recipe from @guidepup/playwright's voiceOverTest fixture
      // (lib/voiceOverTest.js) — reproduced here so we don't need the
      // @playwright/test runner.
      await macOSActivate(APPLICATION_NAMES[browserName]);
      await voiceOver.perform({ keyCode: MacOSKeyCodes.Control }); // cancel auto navigation
      await page.bringToFront();
      await page.locator("body").waitFor();
      await voiceOver.perform(voiceOver.keyboardCommands.openItemChooser);
      await voiceOver.type("web content");
      await voiceOver.perform({ keyCode: MacOSKeyCodes.Enter });
      await voiceOver.interact();
      await voiceOver.perform(voiceOver.keyboardCommands.moveToBeginningOfText);
      await voiceOver.perform({ keyCode: MacOSKeyCodes.Control });
      await voiceOver.clearItemTextLog();
      await voiceOver.clearSpokenPhraseLog();

      // Walk the page like the virtual reader does: next() until we wrap to
      // the first phrase, stall on the last one, or hit the cap.
      let first = "";
      let last = "";
      let stale = 0;
      for (let i = 0; i < MAX_STEPS; i++) {
        await voiceOver.next();
        const phrase = await voiceOver.lastSpokenPhrase();
        if (i === 0) {
          first = phrase;
        } else if (phrase === first) {
          break;
        }
        if (phrase === last) {
          stale += 1;
          if (stale >= 2) break;
        } else {
          stale = 0;
          last = phrase;
        }
      }

      const transcript = trimTrailingBlanks(await voiceOver.spokenPhraseLog());
      // No deterministic findings from the real reader (its phrasing varies by
      // macOS version): the transcript IS the deliverable — judgement material
      // answering "what does VoiceOver actually say?".
      return { findings: [], transcript };
    } finally {
      await voiceOver.stop().catch(() => {});
    }
  } finally {
    await browser.close();
  }
}
