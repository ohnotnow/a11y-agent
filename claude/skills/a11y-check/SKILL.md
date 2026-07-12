---
name: a11y-check
description: Run automated accessibility checks (axe-core, tab-order walk, virtual screen reader) against a running page and read the report. Use when the user asks for an accessibility/a11y check, after building or changing UI (forms, modals, navigation, Livewire components), or before shipping user-facing pages. Requires a local clone of the a11y-agent repo and the app running locally.
---

# a11y-check — automated accessibility checks

Runs the `a11y` CLI from the a11y-agent repo against any running page: an axe-core
scan (WCAG 2.1 AA + 2.2 AA), a keyboard tab-order walk, and a virtual screen reader
pass, producing one JSON report.

## Prerequisites

- A local clone of the **a11y-agent** repo, set up per its README (`npm run setup`
  installs dependencies and chromium, builds, and puts an `a11y` wrapper on PATH).
- The app you're checking must be running and reachable (e.g. `http://localhost:8000`).

**Finding the tool**: try `command -v a11y` first — the wrapper has its clone's
location baked in, so if it's on PATH you need nothing else. Otherwise find the
clone (its path is `A11Y_DIR` below; ask the user if you can't find one) and run
every command as `npm --prefix "$A11Y_DIR" run a11y -- …` instead — the examples
below use the short `a11y …` form and substitute 1:1. One override: if the user
has explicitly given you a clone path, use it rather than the PATH wrapper — on
a machine with more than one clone, the stated path wins.

**First-time pre-flight**: if `a11y` isn't on PATH and `$A11Y_DIR/dist/cli.js`
doesn't exist either, the clone isn't set up — hand the user the one command
(`npm run setup`, in the clone) to run themselves (package installs and browser
downloads are the user's call, not yours) rather than running installs unasked.
A missing `assets/vsr-bundle.js` error means the same thing: the build step
hasn't run, and the same command fixes it.

## Running checks

**Pre-flight: debug overlays.** Check for a debug toolbar before spending a
run — on a page that actually renders one. The naive check has two
false-negative traps, both from a real run: on an auth-gated app an
unauthenticated `curl` greps a 302's empty body (with the toolbar fully active
behind the login), and local https (`*.lndo.site`, Valet) needs `-k` or the
cert failure silently reads as 0 as well. `curl -skL <login-url> | grep -c
phpdebugbar` covers Laravel Debugbar — login pages render the toolbar too.
Belt and braces: after any run, grep the report JSON itself for `phpdebugbar`;
that post-hoc tell is what catches a missed pre-flight. If a toolbar is
present, stop and ask the user to disable it — that's their move (config/.env
changes are theirs, not yours) — or agree to triage around it. An active
toolbar pollutes more than axe's contrast results: it also fills the tail of
the vsr transcript *and* the end of `tabwalk.focusOrder` — filter
`phpdebugbar` out of both before reading them.

All quick-mode checks, one merged report (the usual choice):

```bash
a11y quick http://localhost:8000/some/page > report.json
```

Always redirect to a file and extract selectively — a single page's report can
carry a 100+-line transcript plus a full aria snapshot, and running the
command bare dumps all of it into your context.

Individual tiers when you only need one:

```bash
a11y axe http://localhost:8000/some/page
a11y tabwalk http://localhost:8000/some/page
a11y vsr http://localhost:8000/some/page
```

Flags: `--human` (markdown instead of JSON — good for showing the user),
`--timeout <ms>` (default 30000), `--settle <ms>` (default 1000 — extra wait after
load; raise it for slow-hydrating pages before trusting a surprising tabwalk
finding), and on `axe`, `quick` and `sweep`: `--tags <list>` to override the
default WCAG 2.1 AA + 2.2 AA rule set for the axe tier (e.g. `--tags wcag2a,wcag2aa`).

A hard-won rule: if a tabwalk finding looks dramatic (focus trap, swathes of
unreachable elements), re-run with `--settle 3000` before believing it. Focus
behaviour during hydration is not what real users experience.

A second one, from a real run: items inside roving-tabindex composites
(tablists, menus, radiogroups, grids) are *correctly* out of the Tab order —
only the active item is tabbable. The tool knows the pattern and reports those
separately as `unreachable-composite-item` (minor) instead of
`unreachable-interactive` (serious). Treat the minor id as a verification
prompt, not a defect: focus the active item in a browser and arrow across —
only if focus doesn't move is it genuinely unreachable. `--settle` won't help
with either id; this isn't a hydration problem.

## Pages behind a login

Log in once, then pass the saved session to every check:

```bash
a11y login http://localhost:8000/login --save /tmp/a11y-state.json
a11y quick http://localhost:8000/dashboard --storage-state /tmp/a11y-state.json
```

- Defaults are the team's seeded-admin convention (`admin2x` / `secret`) — try them
  first, no flags needed. Override with `--user` / `--pass`.
- Check `loggedIn: true` in the login output before spending runs — a silently
  dead session surfaces later, confusingly, as a sweep full of login-redirect
  skips.
- If the user points you at a seeder ("credentials are in
  `database/seeds/TestDataSeeder.php`"), Read that file, extract the seeded
  email/password, and pass them explicitly.
- **Seeded local-dev credentials only.** These are deliberately-throwaway values
  already sitting in the app's own repo, so they may appear in commands. Anything
  production-shaped (real names, real domains, values from .env) must never be
  used or echoed — if that's all you can find, stop and ask the user.
- Save the state file to scratchpad/tmp, never into the app's repo — it holds a
  live session cookie.
- Unusual form? `--user-field` / `--pass-field` / `--submit` take CSS selectors.
- The saved state file is a standard Playwright storage state, so it plugs
  into playwright-cli when a finding needs hands-on verification — no second
  login needed. Sequence matters: `playwright-cli open about:blank`, then
  `state-load <file>`, then `goto <url>` — state loads into an already-open
  browser, so a bare `state-load` as the first call fails. Findings *will*
  need hands-on verification (see the roving-tabindex rule above).

Exit codes mean tool health, not page quality: 0 = checks ran (findings are in the
JSON); non-zero = the tool itself failed (app not running, bad URL). Report tool
failures honestly — don't retry into the void.

## Sweeping a whole app

For an app-wide pass (initial audits, pattern hunting), build a URL list and use `sweep` —
one browser session, one report with a cross-page `summary.findings` map (finding id →
count + pages), which is the input for spotting recurring patterns:

```bash
a11y sweep --urls /tmp/pages.txt --storage-state /tmp/a11y-state.json
```

Building the list for a Laravel app:

1. Enumerate: `lando artisan route:list --except-vendor --except-path=api --method=GET --json`
   (plain `php artisan` for non-lando apps).
2. Drop utility routes (login, logout, password/*, _debugbar/*, up, sanctum/*, livewire/*).
3. Static URIs: prefix with the app's base URL, one per line.
4. Parameterised URIs (`/admin/users/{user}`): ask the app, don't guess — materialise each
   named route with Laravel's own `route()` helper and seeded data, in ONE read-only
   tinker call, e.g.
   `lando artisan tinker --execute="echo route('admin.users.show', \App\Models\User::first());"`
   The helper handles slugs, custom route keys and scoped bindings. Read code only to
   resolve ambiguity (which model, nested bindings, unnamed routes). **Read-only tinker,
   seeded/local data only.** One sample per route is fine for a first pass.

Pages answering non-2xx or bouncing to a login page are auto-skipped with a reason in
`summary.skipped` — check that list to see what the sweep couldn't reach (expired
session, missing sample id) before drawing conclusions.

## Reading the report

The JSON has `checks.axe`, `checks.tabwalk`, `checks.vsr`, each with a `findings`
array: stable `id`, `impact` (critical / serious / moderate / minor), `summary`,
`detail`, and affected `nodes`. Node shape is the same on every tier: `selector`
(a CSS path — there is no `html` field), plus `failureSummary` on axe nodes
only, carrying the per-node evidence. Don't guess at other field names; that's
the whole schema.

**Findings are verdicts.** Triage by impact; the ids are stable:
- axe: rule ids like `color-contrast`, `label`, `button-name`, `target-size`
- tabwalk: `no-skip-link`, `positive-tabindex`, `unreachable-interactive`
  (serious — a control Tab genuinely never reaches), `unreachable-composite-item`
  (minor — likely roving tabindex; see the rule above), `named-by-placeholder-only`
  (minor — axe passes these, but the name vanishes once the field has content),
  `focus-trap`
- vsr: `bare-control` (a control announced as a bare role with no name)

For `color-contrast`, each node's `failureSummary` carries axe's measured ratio
and colours — quote those, never re-derive them from CSS.

But triage node-by-node, never finding-by-finding: a single axe finding can mix
vendor-overlay noise (`.phpdebugbar-*` badges) with genuine app nodes in one
`nodes` list, and dismissing the finding wholesale silently discards the real
ones.

Node selectors are good for this page load only: auto-generated ids
(`#lofi-tab-…`) change on every render, so the moment you open the page
yourself for hands-on verification, every selector in the report you're
triaging is already dead — query semantically instead (`[role=tab]`,
`[aria-selected=true]`). Same reason: never diff `nodes` between runs.
Transcripts are the diffable artefact. *Within* a single report, though,
correlate freely: matching selectors across findings identify the same
element — a node appearing in both a contrast finding and a composite-item
finding is one element with two stories, and that correlation is often what
makes an attribution click.

**The rest is raw material for YOUR judgement — this is the valuable part:**
- `tabwalk.focusOrder` — read it in order and ask: does this sequence make sense?
  A technically-valid-but-insane order is a finding the rule engine can't emit.
- `tabwalk.landmarks` — empty means screen-reader users have no structural
  waypoints at all. Look for a sensible header/nav/main/footer skeleton.
- `vsr.transcript` — read it top to bottom and ask: "would I want to navigate this
  page blind?" Repetitive announcements, mystery controls, and content that never
  gets announced are all real problems axe cannot see.
- `tabwalk.ariaSnapshot` — the accessibility tree as YAML, for digging into a
  specific oddity.

A clean `findings` array is not a clean page: vsr emitting zero findings is
common on pages with real structural problems (no headings, no landmarks at
all). Part of that is axe by design: its page-structure rules
(`landmark-one-main`, `page-has-heading-one`, `region`) are tagged
`best-practice`, outside the default WCAG set — verified in axe-core's rule
metadata. On a first audit, add it to the defaults for deterministic
structural coverage, in the one command:
`a11y quick <url> --tags wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa,best-practice`
(`--tags` reaches the axe tier from `quick` and `sweep` too). Either way, the
transcript and landmarks are the actual test.

## Whose bug is it? — attributing findings to component libraries

Before proposing any fix, work out who owns the offending markup. A finding six
divs deep inside a third-party date-picker is not something the user can fix
directly — telling them to re-plumb vendor internals is worse than noise, it's
an invitation to monkey-patch vendor markup. Attribution is a three-step, and
every step needs evidence, not vibes:

1. **Provenance — whose markup is this?** Component libraries usually stamp
   recognisable markers on their rendered output (data attributes, custom
   elements, class prefixes). Resolve the finding's node selector against the
   live page and walk its ancestors looking for markers — the report's selector
   string alone won't necessarily mention them. No marker evidence? Fall back
   to source: find the template that renders the page and check whether the
   element is hand-written or sits inside a component tag.
2. **Fault — misused or broken?** A finding on a component's node can still be
   the app's bug: an input announced as a bare textbox because nobody passed
   the label prop is the call site's fault, not the library's. Read the call
   site in the app's own template before blaming the component.
3. **Remedy — what's the actionable fix?** If the component's documented API
   offers a prop or forwarded attribute that fixes it, report that with
   file:line ("add `label="Filter jobs"` to the `<flux:input>` at
   `home-page.blade.php:18`"). If it doesn't, report an upstream component
   issue — keep it in the report in its own section, framed as "known /
   consider a workaround or an upstream report", never as a to-do for the user.

The question is "who should fix this?", not "whose directory is the file in" —
some libraries (shadcn/ui, for one) vendor their code into the app's repo, so
the user owns the file without having written it.

Stack-specific tells (marker formats, template and vendor-source locations,
docs tooling) live in `references/` — check for one matching the project's
stack before starting:

- Laravel + Livewire + Flux UI: [references/laravel-flux.md](references/laravel-flux.md)

A reference's *verified quirks* list is a fast path: a finding that matches a
documented quirk needs no DOM walk — the reference is the provenance evidence,
so go straight to the call site and the documented remedy.

No reference for the stack? Apply the general method above — and if you verify
the library's markers against a rendered page along the way, offer to write
those observations up as a new reference (using Django with some component
library? → `references/django-thing.md`). Reference docs are written from
verified observation only, never from memory: an unverified cheat sheet is a
horoscope with a filename.

## Feeding findings back

Correlate finding `nodes` selectors with the templates/components just edited in
the session, and propose concrete fixes (a `<label>`, a skip link, landmark
elements, removing positive tabindex). Diff transcripts before/after a fix to show
it worked — the vsr pass is deterministic.

For background checks mid-session, spawn the `a11y-checker` sub-agent rather than
blocking the conversation. Quick mode only — the real-VoiceOver tier has its own
rules, below.

## Full-fat mode: the real VoiceOver (`a11y sr`)

The final-confirmation tier. It drives the user's *actual* VoiceOver — speech,
focus, the lot — so it is a deliberate foreground act, never a background one and
never yours to spring on them:

```bash
a11y sr http://localhost:8000/dashboard --foreground
```

- **Before running**: tell the user their Mac is about to start speaking and take
  over keyboard focus, and get their explicit go-ahead. They should be at the
  keyboard with VoiceOver currently off.
- **One-off machine setup** (per the README): `npx @guidepup/setup`, the manual
  guide it links, and Accessibility permission for the app hosting the shell
  (Terminal/iTerm/Ghostty/…) in System Settings → Privacy & Security.
- **Known failure and its ranked causes** — if the run fails with
  `Timed out waiting for VoiceOver to be running`:
  1. *First-ever VoiceOver launch on this machine*: macOS shows a Welcome/Quick
     Start dialog that blocks automation. Have the user launch VoiceOver by hand
     (⌘F5), dismiss the dialog, quit it (⌘F5 again), then retry. This is the
     common one on a fresh machine.
  2. The hosting terminal app lacks Accessibility permission — check System
     Settings, and note the permission belongs to whatever app hosts THIS shell,
     which may not be the terminal the user ran setup in.
- **If a run dies midway**, VoiceOver may be left running and talking — tell the
  user ⌘F5 turns it off. Don't leave them to discover that alone.
- The report's `checks.sr.transcript` is judgement material, not findings: real
  VoiceOver announces landmark boundaries, list positions and field types the
  virtual reader doesn't. Read it and answer "would I want to navigate this blind?".
