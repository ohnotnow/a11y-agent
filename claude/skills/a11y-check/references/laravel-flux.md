# Laravel + Livewire + Flux UI — attribution cheat sheet

Everything here was verified against a rendered Flux v2 / Livewire 4 app
(July 2026) by inspecting the live DOM with playwright-cli. If Flux has had a
major version bump since, spot-check the tells before leaning on them.

## Provenance: two independent tells in the rendered DOM

- **`data-flux-*` attributes.** Every Flux component stamps its rendered root,
  and usually its internals too: `<flux:tab.group>` → `data-flux-tab-group`,
  `<flux:input>` → `data-flux-input`, plus internals like `data-flux-field`,
  `data-flux-label`, `data-flux-control`, `data-flux-error`,
  `data-flux-clear-button`. One real homepage showed 46 distinct names. This is
  a documented contract, not an implementation accident — the Flux component
  docs list the attribute per component ("applied to the root element for
  styling and identification").
- **`ui-*` custom elements.** Interactive components render as web components:
  `ui-tab-group`, `ui-select`, `ui-modal`, `ui-checkbox`, `ui-field`,
  `ui-toast`, …

**The provenance rule:** the nearest ancestor carrying a `data-flux-*`
attribute owns the node. No flux-marked ancestor between the node and
`<body>` means hand-written markup — the app's to fix. Hand-written layout
divs sit cleanly in between flux-marked subtrees with no markers of their own,
so the walk doesn't false-positive on them.

The a11y report's node selectors won't reliably mention these markers, so
resolve the selector against the running page and walk up. One-liner
(playwright-cli, with the page open):

```bash
playwright-cli --raw eval "JSON.stringify((() => {
  let el = document.querySelector('SELECTOR-FROM-FINDING');
  const chain = [];
  while (el && el !== document.body) {
    const flux = [...el.attributes].filter(a => a.name.startsWith('data-flux')).map(a => a.name);
    if (flux.length || el.tagName.includes('-')) chain.push(el.tagName.toLowerCase() + ' [' + flux.join(',') + ']');
    el = el.parentElement;
  }
  return chain;
})())"
```

## Fault: read the call site

App templates live in `resources/views/`. Grep for the component tag
(`<flux:input`, `<flux:date-picker`) to find the call site, then ask: is the
problem a prop nobody passed (missing `label`, no accessible name on an
icon-only button), or is it inside markup the component generates with no
call-site control? The first is the app's bug even though the node is
flux-stamped. Only the second is the component's.

## Remedy: props first, vendor blades for ground truth

- **Laravel Boost's `search-docs`** (scoped to `livewire/flux` +
  `livewire/flux-pro`) returns the full per-component prop tables — the raw
  material for an actionable "add `label="…"` to the `<flux:x>` at
  file:line" fix. Boost is an MCP tool, so this path is only available in the
  main session — the background a11y-checker sub-agent has Bash and Read only,
  and falls back to reading vendor blades and the app's templates.
- **Arbitrary attributes forward onto components** — the Flux docs' own
  examples pass `aria-label` straight to `flux:button` — so proposing an
  `aria-*` attribute on the component tag is legitimate. But on composed
  components a forwarded attribute may land on the wrapper rather than the
  element that needs it; some components route with prefixes instead (e.g.
  `flux:input` plucks `input:`-prefixed attributes through to the inner
  `<input>`).
- **Ground truth for where an attribute lands** is the component's own blade:
  free components in `vendor/livewire/flux/stubs/resources/views/flux/`, pro
  components (date-picker, autocomplete, calendar, …) in
  `vendor/livewire/flux-pro/stubs/resources/views/flux/`. One blade (or
  directory) per component, and they're short enough to just read.
- **Final proof is a re-run**: apply the fix, re-run the check, diff the vsr
  transcript — per the main skill, it's deterministic.

## Verified Flux quirks (free/pro v2, July 2026)

Recurring, app-agnostic facts that every Flux app's audit would otherwise
rediscover the slow way. All verified against the vendor blades and a live
audit run; upstream may fix any of them, so re-check on major version bumps.

- **`flux:main` renders `<div data-flux-main>`** — no `<main>` element, no
  role, no landmark. Call-site fix: `<flux:main role="main">` (attributes
  merge onto the root div). Also upstream-report material: a component named
  "main" that doesn't produce a main landmark is a trap.
- **`flux:heading` renders a `<div>` unless you pass `level`** (1–4 emit real
  `<h1>`–`<h4>`, per the vendor `heading.blade.php`). A page built from bare
  `flux:heading`s has no headings at all — and vsr won't flag it as a finding;
  only the transcript shows it.
- **flux-pro's unselected tabs are `text-zinc-400`**
  (`tab/index.blade.php`) — roughly 2.8:1 on white (computed from the zinc-400
  hex, not read from axe output) against the 4.5:1 AA requirement, and stock
  call sites add no classes. If your conventions forbid restyling vendor
  component internals, this is an upstream report / accepted known-issue, not
  an app edit.

## Checked vs guessed (July 2026)

Checked on a real app: the `data-flux-*` survey and ancestor walk, the `ui-*`
element list, the boost prop-table lookup, the `input:` attribute routing in
the flux:input vendor blade, and both vendor blade paths. Not checked: whether
*every* Flux component (especially pro ones like date-picker) stamps a marker
on its root — the sample was one app's pages. If a walk comes back empty on a
node you'd swear is Flux, check the vendor blade before concluding it's
hand-written.
