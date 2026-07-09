import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serveFixtures, type FixtureServer } from "./helpers/server";
import { withPage } from "../src/browser";
import { runAxe } from "../src/checks/axe";
import { runTabwalk } from "../src/checks/tabwalk";
import { runVsr } from "../src/checks/vsr";
import { renderHuman, type Report } from "../src/report";

let server: FixtureServer;

beforeAll(async () => {
  server = await serveFixtures();
});

afterAll(async () => {
  await server.close();
});

// Mirrors the CLI quick subcommand: one browser session, all three checks on the same page.
async function quickReport(url: string): Promise<Report> {
  const checks = await withPage(url, {}, async (page) => ({
    axe: await runAxe(page),
    tabwalk: await runTabwalk(page),
    vsr: await runVsr(page),
  }));
  return { tool: "a11y", version: "0.1.0", url, generatedAt: new Date().toISOString(), checks };
}

describe("quick composite", () => {
  it("populates all three checks from a single session on broken.html", async () => {
    const report = await quickReport(`${server.url}/broken.html`);

    expect(report.checks.axe!.findings.length).toBeGreaterThan(0);
    expect(report.checks.tabwalk!.findings.length).toBeGreaterThan(0);
    expect(report.checks.vsr!.findings.length).toBeGreaterThan(0);
    expect((report.checks.vsr!.transcript as string[]).length).toBeGreaterThan(0);
  });

  it("is clean or near-clean on good.html", async () => {
    const report = await quickReport(`${server.url}/good.html`);

    const allFindings = Object.values(report.checks).flatMap((check) => check?.findings ?? []);
    const seriousOrWorse = allFindings.filter((f) => f.impact === "critical" || f.impact === "serious");
    expect(seriousOrWorse).toEqual([]);

    const ids = allFindings.map((f) => f.id);
    for (const seeded of ["color-contrast", "label", "no-skip-link", "positive-tabindex", "bare-control"]) {
      expect(ids).not.toContain(seeded);
    }
  });

  it("renders the report as markdown via renderHuman", async () => {
    const report = await quickReport(`${server.url}/broken.html`);
    const markdown = renderHuman(report);

    expect(markdown.length).toBeGreaterThan(0);
    expect(markdown).toContain("## axe-core scan");
    expect(markdown).toContain("## Tab-order walk");
    expect(markdown).toContain("## Virtual screen reader");
    expect(markdown).toContain("## Appendix: focus order");
    expect(markdown).toContain("## Appendix: screen reader transcript");
  });
});
