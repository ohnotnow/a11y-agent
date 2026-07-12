import type { Page } from "playwright";
import type { CheckResult, Finding } from "../report.js";

export interface TabStop {
  role: string;
  name: string;
  tag: string;
  selector: string;
  href: string;
  tabbable: boolean;
  /** Role of the closest roving-tabindex composite ancestor (tablist, menu, …), or "". */
  composite: string;
  /** Set by active(): true when this exact element was focused earlier in the walk. */
  alreadySeen?: boolean;
}

export interface Landmark {
  tag: string;
  role: string;
  label: string;
}

interface PageSnapshot {
  interactive: TabStop[];
  positiveTabindex: TabStop[];
  namedByPlaceholder: TabStop[];
  landmarks: Landmark[];
}

const MAX_TAB_PRESSES = 100;

// Human-ish pacing. Pressing Tab with no gap measures mid-transition focus
// behaviour (Alpine tooltips, focus restoration) rather than what a real
// keyboard user experiences.
const INTER_PRESS_DELAY_MS = 100;

// Injected once per page. Defines the selector/role/name helpers in ONE place so the
// per-press "describe the active element" and the whole-page snapshot can't drift apart.
const HELPER_SCRIPT = `
(() => {
  if (window.__a11yTabwalk) return;

  const buildSelector = (el) => {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  };

  const accessibleName = (el, includePlaceholder = true) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const text = labelledby
        .split(/\\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .trim();
      if (text) return text;
    }
    if (el.labels && el.labels.length > 0) {
      const text = Array.from(el.labels)
        .map((label) => label.textContent ?? "")
        .join(" ")
        .trim();
      if (text) return text;
    }
    if (el.tagName === "IMG" && el.alt) return el.alt.trim();
    const text = (el.textContent ?? "").trim();
    if (text) return text;
    const title = (el.getAttribute("title") ?? "").trim();
    if (title) return title;
    // Spec last resort (HTML-AAM): a text field's placeholder names it. Keeps
    // focusOrder names consistent with what axe passes and vsr announces;
    // includePlaceholder=false reveals fields with no sturdier name than that.
    if (includePlaceholder && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
      return (el.getAttribute("placeholder") ?? "").trim();
    }
    return "";
  };

  const inputRoles = {
    checkbox: "checkbox", radio: "radio", button: "button", submit: "button",
    reset: "button", range: "slider", search: "searchbox",
  };

  const role = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      return inputRoles[type] ?? "textbox";
    }
    if (tag === "nav") return "navigation";
    if (tag === "main") return "main";
    if (tag === "header") return "banner";
    if (tag === "footer") return "contentinfo";
    if (tag === "aside") return "complementary";
    return tag;
  };

  const visible = (el) =>
    el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

  // Composite widgets that manage focus themselves (WAI-ARIA APG): only one item
  // sits in the Tab order and the rest are reached with arrow keys, so their items
  // must not be accused of being keyboard-unreachable. Ancestors only — a composite
  // container that is itself unreachable is still a real finding.
  const compositeContainer = (el) => {
    const container = el.parentElement?.closest(
      '[role="tablist"], [role="menu"], [role="menubar"], [role="radiogroup"], ' +
        '[role="toolbar"], [role="tree"], [role="treegrid"], [role="grid"], [role="listbox"]',
    );
    return container ? container.getAttribute("role") : "";
  };

  const describe = (el) => ({
    role: role(el),
    name: accessibleName(el),
    tag: el.tagName.toLowerCase(),
    selector: buildSelector(el),
    href: el.getAttribute("href") ?? "",
    tabbable: el.tabIndex >= 0,
    composite: compositeContainer(el),
  });

  // Cycle detection must use element IDENTITY, not selectors: duplicate ids or
  // look-alike siblings can give two elements the same computed selector, which
  // previously truncated the walk (seen on a real Flux sidebar).
  const seenElements = new WeakSet();

  window.__a11yTabwalk = {
    active() {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      const alreadySeen = seenElements.has(el);
      seenElements.add(el);
      return { ...describe(el), alreadySeen };
    },
    snapshot() {
      const interactive = Array.from(
        document.querySelectorAll(
          'a[href], button, input:not([type="hidden"]), select, textarea, [onclick], ' +
            '[tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="checkbox"], ' +
            '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]',
        ),
      ).filter((el) => visible(el) && !el.disabled);
      const positiveTabindex = Array.from(document.querySelectorAll("[tabindex]")).filter(
        (el) => Number(el.getAttribute("tabindex")) > 0,
      );
      const namedByPlaceholder = interactive.filter(
        (el) =>
          (el.getAttribute("placeholder") ?? "").trim() !== "" &&
          accessibleName(el, false) === "",
      );
      const landmarks = Array.from(
        document.querySelectorAll(
          'header, nav, main, aside, footer, [role="banner"], [role="navigation"], ' +
            '[role="main"], [role="complementary"], [role="contentinfo"], [role="region"], [role="search"]',
        ),
      ).map((el) => ({
        tag: el.tagName.toLowerCase(),
        role: role(el),
        label: el.getAttribute("aria-label") ?? "",
      }));
      return {
        interactive: interactive.map(describe),
        positiveTabindex: positiveTabindex.map(describe),
        namedByPlaceholder: namedByPlaceholder.map(describe),
        landmarks,
      };
    },
  };
})();
`;

function isSkipLink(stop: TabStop | undefined): boolean {
  if (!stop) return false;
  return (
    stop.tag === "a" &&
    stop.href.startsWith("#") &&
    /skip|content|main/i.test(`${stop.name} ${stop.href}`)
  );
}

export async function runTabwalk(page: Page): Promise<CheckResult> {
  await page.addScriptTag({ content: HELPER_SCRIPT });

  const snapshot = (await page.evaluate("window.__a11yTabwalk.snapshot()")) as PageSnapshot;

  const focusOrder: TabStop[] = [];
  const seenSelectors = new Set<string>();
  let cycled = false;

  // Revisits mark a cycle but do NOT end the walk: pages with broken focus
  // management (e.g. a sidebar yanking focus back) revisit elements while other
  // elements are still reachable further on. Walking the full press budget keeps
  // focusOrder representative; the cap bounds the loop.
  for (let i = 0; i < MAX_TAB_PRESSES; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(INTER_PRESS_DELAY_MS);
    const stop = (await page.evaluate("window.__a11yTabwalk.active()")) as TabStop | null;
    if (!stop) break; // focus left the page's elements: the natural end of the walk
    if (stop.alreadySeen) {
      cycled = true;
      continue;
    }
    delete stop.alreadySeen;
    seenSelectors.add(stop.selector);
    focusOrder.push(stop);
  }

  // Selector-based diff is fine here: a collision only merges identical-looking
  // siblings in the report, it cannot terminate the walk.
  const unreached = snapshot.interactive.filter((el) => !seenSelectors.has(el.selector));

  // A bare role="tab" is treated as composite even without a tablist ancestor:
  // axe's aria-required-parent already owns that markup error.
  const isCompositeItem = (el: TabStop) => el.composite !== "" || el.role === "tab";
  const unreachedComposite = unreached.filter(isCompositeItem);
  const unreachedPlain = unreached.filter((el) => !isCompositeItem(el));

  const findings: Finding[] = [];
  const first = focusOrder[0];

  if (!isSkipLink(first)) {
    findings.push({
      id: "no-skip-link",
      impact: "serious",
      summary: "The first Tab stop is not a skip-to-content link",
      detail: first
        ? `The first Tab stop is <${first.tag}> "${first.name}" (${first.selector}). Keyboard and screen-reader users must tab through everything before it to reach the content.`
        : "Pressing Tab focused nothing on the page.",
      nodes: first ? [{ selector: first.selector }] : [],
    });
  }

  if (snapshot.positiveTabindex.length > 0) {
    findings.push({
      id: "positive-tabindex",
      impact: "moderate",
      summary: "Elements use positive tabindex values, overriding the natural tab order",
      detail:
        "Positive tabindex forces a bespoke tab order that is fragile and usually diverges from the visual order. Use tabindex=\"0\" (or natural order) instead.",
      nodes: snapshot.positiveTabindex.map((el) => ({ selector: el.selector })),
    });
  }

  if (unreachedPlain.length > 0) {
    findings.push({
      id: "unreachable-interactive",
      impact: "serious",
      summary: "Interactive elements are never reached by Tab",
      detail:
        "These elements look interactive (links, controls, click handlers or interactive roles) but keyboard focus never lands on them during a full tab walk.",
      nodes: unreachedPlain.map((el) => ({ selector: el.selector })),
    });
  }

  if (unreachedComposite.length > 0) {
    findings.push({
      id: "unreachable-composite-item",
      impact: "minor",
      summary: "Composite-widget items are not in the Tab order (likely roving tabindex)",
      detail:
        "These elements sit inside a roving-tabindex composite (tablist, menu, listbox, …) where only " +
        "the active item is tabbable and the rest are reached with arrow keys — usually correct per the " +
        "WAI-ARIA APG. Verify by focusing the active item and pressing the arrow keys; if focus does not " +
        "move between items, treat this as unreachable-interactive.",
      nodes: unreachedComposite.map((el) => ({ selector: el.selector })),
    });
  }

  if (snapshot.namedByPlaceholder.length > 0) {
    findings.push({
      id: "named-by-placeholder-only",
      impact: "minor",
      summary: "Form fields are named only by their placeholder",
      detail:
        "Placeholder is a legal last resort in the accessible-name computation, so axe passes these — " +
        "but the name disappears the moment the field has content, and placeholder text is usually " +
        "low-contrast. Give each field a real <label>, aria-label, or aria-labelledby.",
      nodes: snapshot.namedByPlaceholder.map((el) => ({ selector: el.selector })),
    });
  }

  if (cycled && unreached.some((el) => el.tabbable)) {
    findings.push({
      id: "focus-trap",
      impact: "critical",
      summary: "Tab order cycles without ever reaching some tabbable elements",
      detail:
        "Focus revisited an earlier element while tabbable elements remained unvisited — keyboard users are trapped in a loop.",
      nodes: unreached.filter((el) => el.tabbable).map((el) => ({ selector: el.selector })),
    });
  }

  const ariaSnapshot = await page.locator("body").ariaSnapshot();

  return {
    findings,
    focusOrder,
    ariaSnapshot,
    landmarks: snapshot.landmarks,
  };
}
