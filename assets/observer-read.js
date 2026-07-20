() => {
    const w = window;
    const S = w.__a11yObs;
    if (!S)
        return { error: "observer was not armed" };
    S.mo.disconnect();
    document.removeEventListener("focusin", S.onFocus, true);
    delete w.__a11yObs; // a journey re-arms per stage; stale state must not leak across stages
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rectOf = (el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const inViewport = (el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    };
    const appearedVisible = [];
    const seen = new Set();
    const collect = (list, via) => {
        for (const el of list) {
            if (!el.isConnected || seen.has(el))
                continue;
            seen.add(el);
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0)
                continue;
            appearedVisible.push({ el: S.describe(el), via, rect: rectOf(el), inViewport: inViewport(el) });
        }
    };
    collect(S.added, "added");
    collect(S.revealed, "revealed");
    // Where each announcing region sits NOW: an announced error that is not in the
    // viewport is the "told once, then stranded" finding this instrument exists for.
    const announcements = S.announcements.map((a) => {
        const el = S.regionEls[a.regionIndex];
        const connected = el ? el.isConnected : false;
        return {
            t: a.t,
            kind: a.kind,
            text: a.text,
            region: a.region,
            rect: connected ? rectOf(el) : null,
            inViewport: connected ? inViewport(el) : null,
        };
    });
    // Native constraint validation is invisible to the DOM watchers: a blocked
    // submit mutates nothing — the browser focuses the first invalid field and
    // shows a bubble that never enters the DOM. Probe for it explicitly.
    const invalidFields = Array.from(document.querySelectorAll("input, select, textarea"))
        .filter((f) => f.matches(":invalid"))
        .map((f) => {
        const field = f;
        return {
            el: S.describe(field),
            validationMessage: field.validationMessage,
            isActive: field === document.activeElement,
        };
    });
    const dialog = document.querySelector('dialog[open], [role="dialog"]:not([hidden])');
    return {
        announcements,
        focusTrail: S.focusTrail,
        appearedVisible: appearedVisible.slice(0, 20),
        appearedVisibleTotal: appearedVisible.length,
        liveRegionsAtArm: S.liveRegionsAtArm,
        activeElementNow: S.describe(document.activeElement),
        openDialog: dialog
            ? { el: S.describe(dialog), isModal: dialog instanceof HTMLDialogElement && dialog.matches(":modal") }
            : null,
        invalidFields,
        viewport: { w: vw, h: vh },
    };
}
