(target) => {
    const el = target;
    if (!el || !el.getBoundingClientRect)
        return "highlight: no target element";
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
}
