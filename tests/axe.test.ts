import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serveFixtures, type FixtureServer } from "./helpers/server";
import { withPage } from "../src/browser";
import { runAxe } from "../src/checks/axe";

let server: FixtureServer;

beforeAll(async () => {
  server = await serveFixtures();
});

afterAll(async () => {
  await server.close();
});

describe("axe check", () => {
  it("finds the seeded violations on broken.html with default tags", async () => {
    const result = await withPage(`${server.url}/broken.html`, {}, (page) => runAxe(page));
    const ids = result.findings.map((f) => f.id);

    expect(ids).toContain("color-contrast");
    expect(ids).toContain("label");

    // The default WCAG 2.1 AA + 2.2 AA standard is actually being applied.
    const allTags = result.findings.flatMap((f) => f.tags ?? []);
    expect(allTags.some((tag) => ["wcag22aa", "wcag21aa", "wcag2aa"].includes(tag))).toBe(true);

    for (const finding of result.findings) {
      expect(finding.id).toBeTruthy();
      expect(finding.summary).toBeTruthy();
      expect(finding.impact).toBeTruthy();
      expect(Array.isArray(finding.nodes)).toBe(true);
      expect(finding.nodes!.length).toBeGreaterThan(0);
      for (const node of finding.nodes!) {
        expect(node.selector).toBeTruthy();
      }
      expect(Array.isArray(finding.tags)).toBe(true);
    }
  });

  it("carries the measured contrast ratio through to the report", async () => {
    const result = await withPage(`${server.url}/broken.html`, {}, (page) => runAxe(page));
    const contrast = result.findings.find((f) => f.id === "color-contrast")!;
    expect(contrast).toBeDefined();

    // The per-node failureSummary IS the finding for contrast: the measured
    // ratio and colours must survive the merge, not be flattened to a selector.
    for (const node of contrast.nodes!) {
      expect(node.failureSummary).toMatch(/contrast of \d/);
      expect(node.failureSummary).toMatch(/foreground color/);
    }
  });

  it("narrows the rule set when tags are overridden", async () => {
    const result = await withPage(`${server.url}/broken.html`, {}, (page) =>
      runAxe(page, { tags: ["wcag2a"] }),
    );
    expect(result.findings.length).toBeGreaterThan(0);
    for (const finding of result.findings) {
      expect(finding.tags).toContain("wcag2a");
    }
  });

  it("is clean on good.html with default tags", async () => {
    const result = await withPage(`${server.url}/good.html`, {}, (page) => runAxe(page));
    const ids = result.findings.map((f) => f.id);
    expect(ids).not.toContain("color-contrast");
    expect(ids).not.toContain("label");
  });
});
