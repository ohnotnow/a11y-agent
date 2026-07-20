import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serveFixtures, type FixtureServer } from "./helpers/server";
import { withPage } from "../src/browser";
import { runAxe } from "../src/checks/axe";
import { runSweepBoth } from "../src/sweep";
import { summariseSchemeChecks, type Report } from "../src/report";

let server: FixtureServer;

// Static fixtures don't hydrate; skip the settle wait to keep these fast.
const FAST = { settle: 0 };

beforeAll(async () => {
  server = await serveFixtures();
});

afterAll(async () => {
  await server.close();
});

describe("colour-scheme emulation", () => {
  it("drives prefers-color-scheme via the colorScheme option", async () => {
    // theme.html's muted text fails contrast in light and passes in dark.
    const light = await withPage(
      `${server.url}/theme.html`,
      { ...FAST, colorScheme: "light" },
      (page) => runAxe(page),
    );
    const dark = await withPage(
      `${server.url}/theme.html`,
      { ...FAST, colorScheme: "dark" },
      (page) => runAxe(page),
    );

    expect(light.findings.map((f) => f.id)).toContain("color-contrast");
    expect(dark.findings.map((f) => f.id)).not.toContain("color-contrast");
  });
});

describe("summariseSchemeChecks", () => {
  it("labels each finding with the schemes it appeared in, light before dark", () => {
    const lightChecks: Report["checks"] = {
      axe: {
        findings: [
          { id: "color-contrast", impact: "serious", summary: "contrast" },
          { id: "label", impact: "critical", summary: "label" },
        ],
      },
    };
    const darkChecks: Report["checks"] = {
      axe: { findings: [{ id: "label", impact: "critical", summary: "label" }] },
    };

    const summary = summariseSchemeChecks({ light: lightChecks, dark: darkChecks });

    expect(summary["color-contrast"].schemes).toEqual(["light"]); // light-only
    expect(summary["label"].schemes).toEqual(["light", "dark"]); // both
    expect(summary["color-contrast"].impact).toBe("serious");
  });
});

describe("runSweepBoth", () => {
  it("runs each theme and marks theme-specific findings in the combined summary", async () => {
    const report = await runSweepBoth([`${server.url}/theme.html`], "0.1.0", FAST);

    expect(report.colorScheme).toBe("both");
    expect(report.schemes.light).toBeTruthy();
    expect(report.schemes.dark).toBeTruthy();

    // The muted-text contrast failure exists in light only.
    expect(report.summary.findings["color-contrast"]).toBeTruthy();
    expect(report.summary.findings["color-contrast"].schemes).toEqual(["light"]);
    expect(report.summary.findings["color-contrast"].pages).toEqual([`${server.url}/theme.html`]);
  });
});
