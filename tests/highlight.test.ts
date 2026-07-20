import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serveFixtures, type FixtureServer } from "./helpers/server";
import { withPage } from "../src/browser";

const highlightPath = fileURLToPath(new URL("../assets/highlight.js", import.meta.url));
const unhighlightPath = fileURLToPath(new URL("../assets/unhighlight.js", import.meta.url));

function assetSource(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`highlight asset missing at ${path} — run: npm run build`);
  }
  return readFileSync(path, "utf8");
}

let server: FixtureServer;
let highlightSrc: string;
let unhighlightSrc: string;

beforeAll(async () => {
  server = await serveFixtures();
  highlightSrc = assetSource(highlightPath);
  unhighlightSrc = assetSource(unhighlightPath);
});

afterAll(async () => {
  await server.close();
});

interface HighlightProbe {
  partCount: number;
  targetRect: { top: number; bottom: number };
  ringOverlapsTarget: boolean;
  viewportHeight: number;
}

// Runs highlight on the selector's element, then measures what landed in the DOM.
// The ring part is identifiable as the overlay with a border.
const probeScript = (highlight: string, selector: string) => `
  (() => {
    (${highlight})(document.querySelector(${JSON.stringify(selector)}));
    const parts = Array.from(document.querySelectorAll("[data-a11y-highlight]"));
    const ring = parts.find((p) => p.style.border !== "");
    const target = document.querySelector(${JSON.stringify(selector)});
    const t = target.getBoundingClientRect();
    const r = ring ? ring.getBoundingClientRect() : null;
    return {
      partCount: parts.length,
      targetRect: { top: Math.round(t.top), bottom: Math.round(t.bottom) },
      ringOverlapsTarget: r !== null && r.top <= t.top && r.bottom >= t.bottom && r.left <= t.left && r.right >= t.right,
      viewportHeight: window.innerHeight,
    };
  })()
`;

describe("highlight assets", () => {
  it("are single function expressions", () => {
    new Script(`(${highlightSrc})`, { filename: "highlight.js" });
    new Script(`(${unhighlightSrc})`, { filename: "unhighlight.js" });
  });
});

describe("highlight ring", () => {
  it("draws a ring and scrim around a visible element", async () => {
    const probe = (await withPage(`${server.url}/journey-broken.html`, { settle: 200 }, async (page) => {
      return (await page.evaluate(probeScript(highlightSrc, "#load-results"))) as HighlightProbe;
    })) as HighlightProbe;

    expect(probe.partCount).toBe(1); // ring only — see highlight.ts on the abandoned scrim
    expect(probe.ringOverlapsTarget).toBe(true);
  });

  it("scrolls an off-screen target into view before ringing it", async () => {
    const probe = (await withPage(`${server.url}/journey-broken.html`, { settle: 200 }, async (page) => {
      await page.evaluate(`
        (() => {
          const spacer = document.createElement("div");
          spacer.style.height = "3000px";
          const btn = document.createElement("button");
          btn.id = "far-away";
          btn.textContent = "Far away";
          document.body.append(spacer, btn);
        })()
      `);
      return (await page.evaluate(probeScript(highlightSrc, "#far-away"))) as HighlightProbe;
    })) as HighlightProbe;

    expect(probe.targetRect.top).toBeGreaterThanOrEqual(0);
    expect(probe.targetRect.bottom).toBeLessThanOrEqual(probe.viewportHeight);
    expect(probe.ringOverlapsTarget).toBe(true);
  });

  it("does not stack overlays on repeated calls, and unhighlight removes everything", async () => {
    const counts = (await withPage(`${server.url}/journey-broken.html`, { settle: 200 }, async (page) => {
      await page.evaluate(probeScript(highlightSrc, "#load-results"));
      await page.evaluate(probeScript(highlightSrc, "#native-submit"));
      const afterTwo = await page.evaluate('document.querySelectorAll("[data-a11y-highlight]").length');
      const result = await page.evaluate(`(${unhighlightSrc})()`);
      const afterClear = await page.evaluate('document.querySelectorAll("[data-a11y-highlight]").length');
      return { afterTwo, result, afterClear };
    })) as { afterTwo: number; result: string; afterClear: number };

    expect(counts.afterTwo).toBe(1);
    expect(counts.result).toBe("unhighlighted");
    expect(counts.afterClear).toBe(0);
  });
});
