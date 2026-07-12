import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveFixtures, type FixtureServer } from "./helpers/server";
import { runLogin } from "../src/login";
import { runSweep } from "../src/sweep";
import { renderSweepHuman } from "../src/report";

let server: FixtureServer;
const statePath = join(tmpdir(), `a11y-sweep-test-state-${process.pid}.json`);

// Static fixtures don't hydrate; keep the sweep tests fast.
const FAST = { settle: 0 };

beforeAll(async () => {
  server = await serveFixtures();
});

afterAll(async () => {
  await server.close();
  await rm(statePath, { force: true });
});

function urlsFor(...names: string[]): string[] {
  return names.map((name) => `${server.url}/${name}`);
}

describe("sweep", () => {
  it("checks reachable pages and skips gated and error pages, without auth", async () => {
    const report = await runSweep(
      urlsFor("good.html", "broken.html", "secure.html", "forbidden.html"),
      "0.1.0",
      FAST,
    );

    const byUrl = Object.fromEntries(report.pages.map((p) => [p.url, p]));
    expect(byUrl[`${server.url}/good.html`].skipped).toBeNull();
    expect(byUrl[`${server.url}/broken.html`].skipped).toBeNull();
    expect(byUrl[`${server.url}/secure.html`].skipped).toBe("auth-redirect");
    expect(byUrl[`${server.url}/forbidden.html`].skipped).toBe("http-403");

    // Skipped pages carry no checks and appear in summary.skipped, not findings.
    expect(byUrl[`${server.url}/secure.html`].checks).toBeNull();
    expect(report.summary.skipped).toEqual([
      { url: `${server.url}/secure.html`, reason: "auth-redirect" },
      { url: `${server.url}/forbidden.html`, reason: "http-403" },
    ]);

    // The broken page's seeded defects surface in the summary.
    expect(report.summary.findings["no-skip-link"]).toBeTruthy();
    expect(report.summary.findings["color-contrast"]).toBeTruthy();
  });

  it("checks gated pages when given a session", async () => {
    await runLogin(`${server.url}/login.html`, { user: "admin2x", pass: "secret", save: statePath });
    const report = await runSweep(
      urlsFor("good.html", "secure.html"),
      "0.1.0",
      { ...FAST, storageState: statePath },
    );

    expect(report.pages.every((p) => p.skipped === null)).toBe(true);
    expect(report.summary.skipped).toEqual([]);
  });

  it("keeps the summary consistent with per-page findings", async () => {
    const report = await runSweep(urlsFor("good.html", "broken.html"), "0.1.0", FAST);

    for (const [id, entry] of Object.entries(report.summary.findings)) {
      expect(entry.count).toBe(entry.pages.length);
      for (const pageUrl of entry.pages) {
        const page = report.pages.find((p) => p.url === pageUrl)!;
        const ids = Object.values(page.checks!).flatMap((check) => check?.findings ?? []).map((f) => f.id);
        expect(ids).toContain(id);
      }
    }
  });

  it("forwards --tags to the axe tier", async () => {
    // axe's page-structure rules live behind the best-practice tag; broken.html
    // has no main landmark and no heading, so they only fire when tags reach axe.
    const report = await runSweep(urlsFor("broken.html"), "0.1.0", {
      ...FAST,
      tags: ["best-practice"],
    });
    expect(report.summary.findings["landmark-one-main"]).toBeTruthy();
    expect(report.summary.findings["page-has-heading-one"]).toBeTruthy();

    // And without the override, the default WCAG set stays structural-rule-free.
    const defaultReport = await runSweep(urlsFor("broken.html"), "0.1.0", FAST);
    expect(defaultReport.summary.findings["landmark-one-main"]).toBeUndefined();
    expect(defaultReport.summary.findings["page-has-heading-one"]).toBeUndefined();
  });

  it("renders a summary-first human report", async () => {
    const report = await runSweep(urlsFor("broken.html", "forbidden.html"), "0.1.0", FAST);
    const markdown = renderSweepHuman(report);

    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("| no-skip-link |");
    expect(markdown).toContain("## Skipped");
    expect(markdown).toContain("http-403");
    // Summary comes before the per-page sections.
    expect(markdown.indexOf("## Summary")).toBeLessThan(markdown.indexOf(`## ${server.url}/broken.html`));
  });
});
