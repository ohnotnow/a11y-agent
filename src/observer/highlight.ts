// Serialised whole via Function.prototype.toString() by scripts/bundle-observer.mjs
// into assets/highlight.js and assets/unhighlight.js — see arm.ts for the
// injection contract. highlight() is evaluated ON a target element
// (`playwright-cli eval "$(cat assets/highlight.js)" <ref>` passes the element),
// draws a "big obvious look here" ring around it, and scrolls the target into
// view first — a screenshot of an off-screen ring helps nobody. unhighlight()
// removes every trace so the page is clean for the next stage.
//
// Deliberately ring-only. A dimming scrim over the rest of the page was built
// and abandoned: large translucent overlays reliably rendered in the live DOM
// but were MISSING from playwright-cli screenshots (headless Chromium, July
// 2026) across every variant tried — background vs box-shadow, opaque worked,
// translucent didn't, yet identical probe elements rendered fine. Root cause
// undiagnosed; the ring alone renders dependably in every capture, does the
// job, and is not worth shipping a rendering mystery for.
export const highlight = (target: unknown): string => {
  const el = target as Element | null;
  if (!el || !el.getBoundingClientRect) return "highlight: no target element";

  // Idempotent by sweep, not bookkeeping: stale overlays from any earlier call
  // (even one whose state was lost) are found by attribute and removed.
  for (const stale of Array.from(document.querySelectorAll("[data-a11y-highlight]"))) {
    stale.remove();
  }

  el.scrollIntoView({ block: "center", inline: "nearest" });
  const r = el.getBoundingClientRect();
  const pad = 4;

  // Saturated ring with a white halo inside and out: reads in light AND dark
  // themes, over any app palette.
  const ring = document.createElement("div");
  ring.setAttribute("data-a11y-highlight", "");
  ring.setAttribute("aria-hidden", "true");
  ring.style.cssText =
    "position: fixed; z-index: 2147483000; pointer-events: none; margin: 0;" +
    ` top: ${r.top - pad}px; left: ${r.left - pad}px;` +
    ` width: ${r.width + pad * 2}px; height: ${r.height + pad * 2}px;` +
    " border: 4px solid #e4003b;" +
    " box-shadow: 0 0 0 3px #ffffff, inset 0 0 0 3px #ffffff;" +
    " border-radius: 6px; box-sizing: border-box;";
  document.body.appendChild(ring);

  return "highlighted " + (el.tagName ? el.tagName.toLowerCase() : "element");
};

export const unhighlight = (): string => {
  const parts = Array.from(document.querySelectorAll("[data-a11y-highlight]"));
  for (const part of parts) part.remove();
  return parts.length > 0 ? "unhighlighted" : "nothing highlighted";
};
