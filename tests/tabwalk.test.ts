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

    // A composite-item role with no composite ancestor (the orphan
    // menuitemcheckbox) is NOT excused as roving tabindex.
    expect(ids).not.toContain("unreachable-composite-item");
    const unreachable = result.findings.find((f) => f.id === "unreachable-interactive")!;
    expect(unreachable.impact).toBe("serious");
    expect(unreachable.nodes!.map((n) => n.selector)).toContain("span");

    const focusOrder = result.focusOrder as TabStop[];
    expect(focusOrder.length).toBeGreaterThan(0);
  });

  it("names placeholder-only fields per spec AND flags their fragility", async () => {
    const result = await withPage(`${server.url}/broken.html`, {}, runTabwalk);

    // The accname computation agrees with axe and vsr: placeholder is a legal
    // last resort, so the focusOrder name is "Postcode", not "".
    const focusOrder = result.focusOrder as TabStop[];
    const postcode = focusOrder.find((stop) => stop.selector === "#postcode")!;
    expect(postcode).toBeDefined();
    expect(postcode.name).toBe("Postcode");

    // …but the divergence signal isn't swallowed: naming a field only by its
    // placeholder is a deliberate low-severity finding.
    const finding = result.findings.find((f) => f.id === "named-by-placeholder-only")!;
    expect(finding).toBeDefined();
    expect(finding.impact).toBe("minor");
    expect(finding.nodes!.map((n) => n.selector)).toEqual(["#postcode"]);
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
    expect(ids).not.toContain("named-by-placeholder-only"); // its fields have real labels
  });

  it("annotates roving-tabindex composite items instead of accusing them", async () => {
    const result = await withPage(`${server.url}/good.html`, {}, runTabwalk);

    // The unselected tab is out of the Tab order by design (APG roving
    // tabindex) — a hint to verify with arrow keys, never a serious accusation.
    const composite = result.findings.find((f) => f.id === "unreachable-composite-item")!;
    expect(composite).toBeDefined();
    expect(composite.impact).toBe("minor");
    expect(composite.nodes!.map((n) => n.selector)).toEqual(["#tab-month"]);

    // The selected tab and its panel are in the normal Tab order.
    const focusOrder = result.focusOrder as TabStop[];
    const selectors = focusOrder.map((stop) => stop.selector);
    expect(selectors).toContain("#tab-week");
    expect(selectors).toContain("#panel-week");
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
