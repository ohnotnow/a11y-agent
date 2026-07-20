import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Page } from "playwright";
import { serveFixtures, type FixtureServer } from "./helpers/server";
import { withPage } from "../src/browser";
import type { ObserverReadback } from "../src/observer/types";

// playwright-cli's `eval` invokes a function-expression string; raw
// page.evaluate treats it as an expression and returns the (unserialisable)
// function itself. Calling it explicitly mirrors what the CLI does.
function callInPage(page: Page, fnSource: string): Promise<unknown> {
  return page.evaluate(`(${fnSource})()`);
}

const armPath = fileURLToPath(new URL("../assets/observer-arm.js", import.meta.url));
const readPath = fileURLToPath(new URL("../assets/observer-read.js", import.meta.url));

function assetSource(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`observer asset missing at ${path} — run: npm run build`);
  }
  return readFileSync(path, "utf8");
}

let server: FixtureServer;
let armSrc: string;
let readSrc: string;

beforeAll(async () => {
  server = await serveFixtures();
  armSrc = assetSource(armPath);
  readSrc = assetSource(readPath);
});

afterAll(async () => {
  await server.close();
});

// The whole contract of the assets: `playwright-cli eval "$(cat file)"` takes a
// single function expression, so each file must parse as exactly that.
describe("observer assets", () => {
  it("are single function expressions", () => {
    new Script(`(${armSrc})`, { filename: "observer-arm.js" });
    new Script(`(${readSrc})`, { filename: "observer-read.js" });
  });
});

describe("observer on journey-broken.html", () => {
  it("sees a silent update: content appears, nothing announced", async () => {
    const result = (await withPage(`${server.url}/journey-broken.html`, { settle: 200 }, async (page) => {
      const armed = await callInPage(page, armSrc);
      await page.click("#load-results");
      await page.waitForTimeout(250);
      return { armed, readback: (await callInPage(page, readSrc)) as ObserverReadback };
    })) as { armed: string; readback: ObserverReadback };

    expect(result.armed).toContain("armed");
    expect(result.readback.announcements).toEqual([]);
    const appeared = result.readback.appearedVisible.find((a) => a.el.includes("3 results found"));
    expect(appeared).toBeDefined();
    expect(appeared?.via).toBe("added");
    expect(appeared?.inViewport).toBe(true);
    expect(result.readback.focusTrail.length).toBeGreaterThan(0);
    for (const stop of result.readback.focusTrail) {
      expect(stop.t).toBeGreaterThanOrEqual(0);
    }
  });

  it("sees a revealed modal that dropped focus to body", async () => {
    const readback = (await withPage(`${server.url}/journey-broken.html`, { settle: 200 }, async (page) => {
      await callInPage(page, armSrc);
      await page.click("#open-dialog");
      await page.waitForTimeout(250);
      return (await callInPage(page, readSrc)) as ObserverReadback;
    })) as ObserverReadback;

    // The dialog was pre-rendered and shown via the `open` attribute flip —
    // this is the attribute-mutation path, invisible to childList watching.
    const revealed = readback.appearedVisible.find((a) => a.via === "revealed" && a.el.startsWith("dialog#dlg"));
    expect(revealed).toBeDefined();
    expect(readback.openDialog).not.toBeNull();
    expect(readback.openDialog?.isModal).toBe(true);
    expect(readback.activeElementNow.startsWith("body")).toBe(true);
    expect(readback.announcements).toEqual([]);
  });

  it("sees both validation errors once each, one off-screen", async () => {
    const readback = (await withPage(`${server.url}/journey-broken.html`, { settle: 200 }, async (page) => {
      await page.click("#open-dialog");
      await callInPage(page, armSrc);
      await page.click("#dlg-submit");
      await page.waitForTimeout(250);
      return (await callInPage(page, readSrc)) as ObserverReadback;
    })) as ObserverReadback;

    const titleErrors = readback.announcements.filter((a) => a.text === "The title has already been taken.");
    const ownerErrors = readback.announcements.filter((a) => a.text === "The owner field is required.");
    expect(titleErrors).toHaveLength(1);
    expect(ownerErrors).toHaveLength(1);
    // Clicking Create scrolled the dialog form to the bottom, so the title
    // error at the top of the form renders above the fold.
    expect(titleErrors[0].inViewport).toBe(false);
    expect(ownerErrors[0].inViewport).toBe(true);
    expect(readback.focusTrail.some((f) => f.el.includes("Create"))).toBe(true);
  });

  it("probes native constraint validation the DOM never shows", async () => {
    const readback = (await withPage(`${server.url}/journey-broken.html`, { settle: 200 }, async (page) => {
      await callInPage(page, armSrc);
      await page.click("#native-submit");
      await page.waitForTimeout(250);
      return (await callInPage(page, readSrc)) as ObserverReadback;
    })) as ObserverReadback;

    expect(readback.announcements).toEqual([]);
    expect(readback.invalidFields).toHaveLength(1);
    expect(readback.invalidFields[0].el).toContain("#native-name");
    expect(readback.invalidFields[0].validationMessage.length).toBeGreaterThan(0);
    expect(readback.invalidFields[0].isActive).toBe(true);
  });
});

describe("observer on good.html", () => {
  it("reads back clean after a well-behaved interaction", async () => {
    const readback = (await withPage(`${server.url}/good.html`, { settle: 200 }, async (page) => {
      await callInPage(page, armSrc);
      // Tab from the top of the document lands on the skip link — a real,
      // trusted keyboard interaction with no browser fragment-navigation quirks.
      await page.keyboard.press("Tab");
      await page.waitForTimeout(250);
      return (await callInPage(page, readSrc)) as ObserverReadback;
    })) as ObserverReadback;

    expect(readback.announcements).toEqual([]);
    expect(readback.appearedVisible).toEqual([]);
    expect(readback.invalidFields).toEqual([]);
    expect(readback.focusTrail.some((f) => f.el.includes("Skip to main content"))).toBe(true);
    expect(readback.activeElementNow).toContain("Skip to main content");
  });

  it("re-arms cleanly after a read (per-stage lifecycle)", async () => {
    const readbacks = (await withPage(`${server.url}/good.html`, { settle: 200 }, async (page) => {
      await callInPage(page, armSrc);
      const first = (await callInPage(page, readSrc)) as ObserverReadback;
      await callInPage(page, armSrc);
      const second = (await callInPage(page, readSrc)) as ObserverReadback;
      const third = await callInPage(page, readSrc);
      return { first, second, third };
    })) as { first: ObserverReadback; second: ObserverReadback; third: { error?: string } };

    expect(readbacks.first.viewport.w).toBeGreaterThan(0);
    expect(readbacks.second.viewport.w).toBeGreaterThan(0);
    // Reading without re-arming reports honestly instead of returning stale data.
    expect(readbacks.third.error).toBe("observer was not armed");
  });
});
