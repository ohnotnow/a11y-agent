---
name: a11y-check
description: Run automated accessibility checks (axe-core, tab-order walk, virtual screen reader) against a running page and read the report. Use when the user asks for an accessibility/a11y check, after building or changing UI (forms, modals, navigation, Livewire components), or before shipping user-facing pages. Requires a local clone of the a11y-agent repo and the app running locally.
---

# a11y-check — automated accessibility checks

Runs the `a11y` CLI from the a11y-agent repo against any running page: an axe-core
scan (WCAG 2.1 AA + 2.2 AA), a keyboard tab-order walk, and a virtual screen reader
pass, producing one JSON report.

## Prerequisites

- A local clone of the **a11y-agent** repo, set up per its README (dependencies
  installed, chromium installed, `npm run build` done). Its path is referred to
  as `A11Y_DIR` below — ask the user for it if you can't find the clone.
- The app you're checking must be running and reachable (e.g. `http://localhost:8000`).

**First-time pre-flight**: before running any check, confirm `$A11Y_DIR/dist/cli.js`
exists. If it doesn't, the clone isn't set up — hand the user the README's install
commands to run themselves (package installs and browser downloads are the user's
call, not yours) rather than running installs unasked. A missing
`assets/vsr-bundle.js` error means the same thing: the build step hasn't run.

## Running checks

All quick-mode checks, one merged report (the usual choice):

```bash
npm --prefix "$A11Y_DIR" run a11y -- quick http://localhost:8000/some/page
```

Individual tiers when you only need one:

```bash
npm --prefix "$A11Y_DIR" run a11y -- axe http://localhost:8000/some/page
npm --prefix "$A11Y_DIR" run a11y -- tabwalk http://localhost:8000/some/page
npm --prefix "$A11Y_DIR" run a11y -- vsr http://localhost:8000/some/page
```

Flags: `--human` (markdown instead of JSON — good for showing the user),
`--timeout <ms>` (default 30000), `--settle <ms>` (default 1000 — extra wait after
load; raise it for slow-hydrating pages before trusting a surprising tabwalk
finding), and on `axe` only: `--tags <list>` to override the default
WCAG 2.1 AA + 2.2 AA rule set (e.g. `--tags wcag2a,wcag2aa`).

A hard-won rule: if a tabwalk finding looks dramatic (focus trap, swathes of
unreachable elements), re-run with `--settle 3000` before believing it. Focus
behaviour during hydration is not what real users experience.

## Pages behind a login

Log in once, then pass the saved session to every check:

```bash
npm --prefix "$A11Y_DIR" run a11y -- login http://localhost:8000/login --save /tmp/a11y-state.json
npm --prefix "$A11Y_DIR" run a11y -- quick http://localhost:8000/dashboard --storage-state /tmp/a11y-state.json
```

- Defaults are the team's seeded-admin convention (`admin2x` / `secret`) — try them
  first, no flags needed. Override with `--user` / `--pass`.
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
- Tip: suggest the user disables debug overlays (Laravel Debugbar) for the run,
  or axe reports the toolbar's contrast instead of the app's.

Exit codes mean tool health, not page quality: 0 = checks ran (findings are in the
JSON); non-zero = the tool itself failed (app not running, bad URL). Report tool
failures honestly — don't retry into the void.

## Sweeping a whole app

For an app-wide pass (initial audits, pattern hunting), build a URL list and use `sweep` —
one browser session, one report with a cross-page `summary.findings` map (finding id →
count + pages), which is the input for spotting recurring patterns:

```bash
npm --prefix "$A11Y_DIR" run a11y -- sweep --urls /tmp/pages.txt --storage-state /tmp/a11y-state.json
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
`detail`, and affected `nodes` as CSS selectors.

**Findings are verdicts.** Triage by impact; the ids are stable:
- axe: rule ids like `color-contrast`, `label`, `button-name`, `target-size`
- tabwalk: `no-skip-link`, `positive-tabindex`, `unreachable-interactive`, `focus-trap`
- vsr: `bare-control` (a control announced as a bare role with no name)

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
npm --prefix "$A11Y_DIR" run a11y -- sr http://localhost:8000/dashboard --foreground
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
