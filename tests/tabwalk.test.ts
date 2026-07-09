import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serveFixtures, type FixtureServer } from "./helpers/server";
import { withPage } from "../src/browser";
import { runTabwalk, type TabStop, type Landmark } from "../src/checks/tabwalk";

let server: FixtureServer;

beforeAll(async () => {
  server = await serveFixtures();
});

afterAll(async () => {
  await server.close();
});

describe("tabwalk check", () => {
  it("flags the seeded structural problems on broken.html", async () => {
    const result = await withPage(`${server.url}/broken.html`, {}, runTabwalk);
    const ids = result.findings.map((f) => f.id);

    expect(ids).toContain("no-skip-link");
    expect(ids).toContain("positive-tabindex");
    expect(ids).toContain("unreachable-interactive"); // the div-soup "button"

    const focusOrder = result.focusOrder as TabStop[];
    expect(focusOrder.length).toBeGreaterThan(0);
  });

  it("does not truncate the walk when two elements share a selector (duplicate ids)", async () => {
    const result = await withPage(`${server.url}/broken.html`, {}, runTabwalk);
    const focusOrder = result.focusOrder as TabStop[];

    // Both twins are focused, in order, despite computing the identical #dup selector.
    const twins = focusOrder.filter((stop) => stop.selector === "#dup");
    expect(twins.map((t) => t.name)).toEqual(["Twin A", "Twin B"]);

    // And the walk carried on past them to the empty button.
    expect(focusOrder.some((stop) => stop.tag === "button" && stop.name === "")).toBe(true);
  });

  it("is clean on good.html", async () => {
    const result = await withPage(`${server.url}/good.html`, {}, runTabwalk);
    const ids = result.findings.map((f) => f.id);

    expect(ids).not.toContain("no-skip-link"); // its first Tab stop IS the skip link
    expect(ids).not.toContain("positive-tabindex");
    expect(ids).not.toContain("unreachable-interactive");
    expect(ids).not.toContain("focus-trap");
  });

  it("captures the raw material for agent judgement", async () => {
    const result = await withPage(`${server.url}/good.html`, {}, runTabwalk);

    const focusOrder = result.focusOrder as TabStop[];
    expect(focusOrder.length).toBeGreaterThan(0);
    for (const stop of focusOrder) {
      expect(stop.role).toBeTruthy();
      expect(typeof stop.name).toBe("string");
      expect(stop.tag).toBeTruthy();
      expect(stop.selector).toBeTruthy();
    }

    expect(typeof result.ariaSnapshot).toBe("string");
    expect((result.ariaSnapshot as string).length).toBeGreaterThan(0);

    const landmarkTags = (result.landmarks as Landmark[]).map((l) => l.tag);
    for (const tag of ["header", "nav", "main", "footer"]) {
      expect(landmarkTags).toContain(tag);
    }
  });
});
