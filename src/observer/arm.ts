import type { AnnouncementKind, ObserverState } from "./types.js";

// Serialised whole via Function.prototype.toString() by scripts/bundle-observer.mjs
// into assets/observer-arm.js, then injected into a live page just before a user
// interaction (`playwright-cli eval "$(cat …)"`, or page.evaluate). Everything the
// function needs must live inside it: no imports at runtime, no captured module
// scope. Its counterpart read.ts collects what the watchers saw.
export const arm = (): string => {
  const describe = (target: unknown): string => {
    const el = target as Element | null;
    if (!el || !el.tagName) return String(target);
    const id = el.id ? "#" + el.id : "";
    const rawClass = typeof el.className === "string" ? el.className : "";
    const cls = rawClass.trim() ? "." + rawClass.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const name = ((el.getAttribute("aria-label") ?? el.textContent) ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 50);
    return el.tagName.toLowerCase() + id + cls + (name ? ' "' + name + '"' : "");
  };

  const S: ObserverState = {
    t0: performance.now(),
    announcements: [],
    regionEls: [],
    focusTrail: [],
    added: [],
    revealed: [],
    liveRegionsAtArm: [],
    describe,
    mo: undefined as unknown as MutationObserver,
    onFocus: undefined as unknown as (e: FocusEvent) => void,
  };

  const liveSel =
    '[aria-live]:not([aria-live="off"]), [role="alert"], [role="status"], [role="log"], output';
  S.liveRegionsAtArm = Array.from(document.querySelectorAll(liveSel)).map(describe);

  const record = (kind: AnnouncementKind, text: string | null, el: Element): void => {
    const t = Math.round(performance.now() - S.t0);
    const clean = (text ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
    const region = describe(el);
    // One visual update fires childList AND characterData; report it once.
    if (S.announcements.some((a) => a.region === region && a.text === clean && t - a.t < 500)) {
      return;
    }
    S.announcements.push({ t, kind, text: clean, region, regionIndex: S.regionEls.push(el) - 1 });
  };

  const trackedReveals = new WeakSet<Element>();
  const visible = (el: Element): boolean =>
    el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

  S.mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes") {
        // Pre-rendered content shown by an attribute flip — dialog.showModal()
        // setting `open`, hidden/class/style toggles — is invisible to childList
        // watching. Class/style churn on already-visible elements lands here too,
        // so `revealed` is raw material for a judgement pass, not a verdict.
        const el = m.target as Element;
        if (!trackedReveals.has(el) && visible(el)) {
          trackedReveals.add(el);
          S.revealed.push(el);
        }
        continue;
      }
      const targetEl =
        m.target.nodeType === 1 ? (m.target as Element) : (m.target.parentElement as Element | null);
      const inLive = targetEl?.closest?.(liveSel) ?? null;
      if (inLive) record("live-region-update", inLive.textContent, inLive);
      for (const n of Array.from(m.addedNodes)) {
        if (n.nodeType !== 1) continue;
        const el = n as Element;
        S.added.push(el);
        if (el.matches(liveSel)) record("live-region-added", el.textContent, el);
        for (const nested of Array.from(el.querySelectorAll(liveSel))) {
          record("live-region-inserted", nested.textContent, nested);
        }
      }
    }
  });
  S.mo.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["open", "hidden", "aria-hidden", "aria-expanded", "style", "class"],
  });

  S.onFocus = (e: FocusEvent) => {
    S.focusTrail.push({ t: Math.round(performance.now() - S.t0), el: describe(e.target) });
  };
  document.addEventListener("focusin", S.onFocus, true);

  (window as unknown as { __a11yObs?: ObserverState }).__a11yObs = S;
  return "armed with " + S.liveRegionsAtArm.length + " live region(s) present";
};
