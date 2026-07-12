# a11y-agent

Ask your coding agent for the accessibility audit you were never going to get round to by hand:

> *"Sweep every page of this app and tell me what's worth fixing first."*
>
> *"Check the screens we built today before I push."*

a11y-agent is what makes that a real request rather than a hallucination: a deterministic CLI that runs an axe-core scan, a keyboard tab-order walk and a screen reader pass — a fast, quiet virtual one by default, or the real VoiceOver for the final quality check — against any running page, and returns one structured report an agent (or a human) can read with judgement. A ready-made Claude Code skill and background sub-agent ship in `claude/`. No agent required — it's a perfectly good standalone CLI — but delegation is where it earns its name.

- [Why](#why)
- [Install](#install)
- [Using it from Claude Code](#using-it-from-claude-code)
- [Usage](#usage)
- [Pages behind a login](#pages-behind-a-login)
- [Sweeping a whole app](#sweeping-a-whole-app)
- [The report](#the-report)
- [Quick mode vs full-fat mode](#quick-mode-vs-full-fat-mode)
- [Development](#development)

## Why

Automated scanners (Lighthouse, the axe browser extension) catch roughly 30–40% of WCAG issues. The misses are the things that actually wreck the experience for keyboard and screen-reader users: no skip-to-content link, broken tab order, landmark soup, controls announced as a bare "button" with nothing to identify them. Checking those by hand is gruelling, so it rarely happens — the gap isn't tooling, it's labour.

This tool automates the grind:

| Tier | Check | What it catches |
|------|-------|-----------------|
| 1 | `axe` | Contrast, missing labels, ARIA misuse — the deterministic rule set |
| 2 | `tabwalk` | Skip link, tab order, focus traps, unreachable controls, landmarks |
| 3 | `vsr` | What a screen reader would actually announce, as a text transcript |

All three tiers are simulator/injection based; no real screen reader is touched. That makes them safe to run headless, in CI, or in the background while you work.

The axe tier defaults to **WCAG 2.1 AA + 2.2 AA** rules, since UK public sector bodies are monitored against WCAG 2.2 AA (Public Sector Bodies Accessibility Regulations; monitoring moved to 2.2 in late 2024).

## Install

Everything runs from a clone — there is no npm package.

```
git clone https://github.com/ohnotnow/a11y-agent.git
cd a11y-agent
npm run setup
```

`npm run setup` installs the dependencies and the Playwright Chromium build, compiles the tool, then puts an `a11y` command on your PATH: it writes a wrapper to `bin/a11y` (with this clone's absolute path baked in) and symlinks it into `/usr/local/bin` or `/opt/homebrew/bin`, whichever exists and is writable. If neither is — stock macOS wants sudo for `/usr/local/bin` — it prints the one `sudo ln -s` line for you to run yourself. Set `A11Y_BIN_DIR` to aim the symlink somewhere else (`A11Y_BIN_DIR=~/bin npm run setup`). Re-running setup is safe; it won't clobber anything already squatting on the `a11y` name.

Prefer the steps by hand? They are `npm install`, `npx playwright install chromium`, `npm run build` — and every `a11y …` command below can then be run from the clone as `npm run a11y -- …` instead.

Requires Node 20+.

## Using it from Claude Code

This is the headline mode: the jobs you'd never get round to — auditing every page of an app, re-checking everything a branch touched — become one sentence in a session:

> *"Run an a11y check on the dashboard and fix the worst of what it finds."*

Setup is three steps, once:

1. Set up a clone of this repo, per [Install](#install) above — anywhere you like. Claude runs the tool from that clone; your apps need nothing added to them.

2. Copy in the skill and the background sub-agent:

   ```
   cp -r claude/skills/a11y-check ~/.claude/skills/
   cp claude/agents/a11y-checker.md ~/.claude/agents/
   ```

3. Tell Claude where the clone lives, so it never has to ask — one line in your global `~/.claude/CLAUDE.md` (or a project's `CLAUDE.md`) does it:

   ```
   The a11y-agent accessibility checker lives at ~/code/a11y-agent.
   ```

   Skip this and the skill will still cope: it looks for the clone and asks you for the path if it can't find one.

What you've just installed:

- **The skill** (`claude/skills/a11y-check/`) teaches a session to run the checks, handle seeded-credential logins, build sweep URL lists from a Laravel router, and read the reports properly: triage the hard findings, then apply judgement to the raw material (tab order, landmarks, the screen-reader transcript) and propose concrete fixes. It also teaches *attribution* — working out whether an offending node is the app's own markup or the inside of a third-party UI component, so fixes land at the call site ("add `label` to this `<flux:input>`") and component-internal issues get reported upstream rather than monkey-patched. Stack-specific cheat sheets live in `claude/skills/a11y-check/references/` — Laravel + Livewire + Flux UI ships today; docs for other stacks are welcome, written from verified observation of a rendered page, never from memory.
- **The sub-agent** (`claude/agents/a11y-checker.md`) does the checking in the background while the main session carries on working, reporting back findings by impact with a ship / fix-first verdict per page. It is read-only towards your app, and it refuses the real-VoiceOver tier — that stays a deliberate foreground act for a human.

The quick checks are deterministic, headless and quiet by design, so an agent can run them mid-session without stealing your screen, your speech output or your keyboard focus.

## Usage

Run against any reachable page — typically your local dev server:

```
a11y quick http://localhost:8000            # all three checks, one report
a11y axe http://localhost:8000              # axe-core scan only
a11y tabwalk http://localhost:8000          # tab-order / structural walk only
a11y vsr http://localhost:8000              # virtual screen reader only
```

Flags:

| Flag | Applies to | Meaning |
|------|-----------|---------|
| `--human` | all | Render the report as markdown instead of JSON |
| `--timeout <ms>` | all | Navigation timeout (default 30000) |
| `--settle <ms>` | all | Extra settle time after load before checking (default 1000). Livewire/Alpine pages re-wire focus during hydration, and measuring too early produces false findings |
| `--tags <list>` | `axe`, `quick`, `sweep` | Override the default WCAG tag set for the axe tier, e.g. `--tags wcag2a,wcag2aa` for strict 2.0/2.1-only runs |

The default axe tags are `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`.

## Pages behind a login

Most real pages are. Log in once, then reuse the session for as many checks as you like:

```
a11y login http://localhost:8000/login --save .a11y-state.json
a11y quick http://localhost:8000/dashboard --storage-state .a11y-state.json
```

`a11y login` drives the actual login form (CSRF is handled for free, since it genuinely submits the form), verifies a password field is no longer visible afterwards, and saves the session cookies. It defaults to our seeded-admin convention (`--user admin2x --pass secret`); override those, and `--user-field` / `--pass-field` / `--submit` selectors for forms that differ from the Laravel norm.

The output says how it went, explicitly — no inferring from the final URL:

```json
{
  "loggedIn": true,
  "savedTo": ".a11y-state.json",
  "finalUrl": "http://localhost:8000/dashboard",
  "urlChanged": true
}
```

`loggedIn` is the password-field verification's verdict. A verified failure prints `loggedIn: false` with a `reason`, saves **no** state file (a dead session would silently poison every later check), and exits non-zero. `urlChanged` is corroborating evidence, not a verdict — `loggedIn: true` with `urlChanged: false` deserves a suspicious look at `finalUrl`.

Two rules:

- **Seeded local-dev credentials only.** Never point this at anything production-shaped.
- The state file holds a live session cookie. This clone gitignores `.a11y-state.json`, but now that `a11y` runs from anywhere, the file lands wherever you run it — if that's your app's directory, make sure it's ignored there too (or `--save` it somewhere outside the repo).

Local HTTPS with self-signed or local-CA certificates (Lando's `*.lndo.site`, Valet, etc.) works out of the box: certificate errors are ignored, as befits a local checking tool.

One tip for Laravel apps: run checks with debug overlays disabled (e.g. Laravel Debugbar), otherwise axe dutifully reports contrast violations in the debug toolbar rather than your app — and the toolbar's badges pollute the tail of the screen-reader transcript too.

## Sweeping a whole app

`sweep` runs all three checks over a list of URLs in one browser session and adds a cross-page summary, which is where per-page findings turn into app-wide patterns:

```
a11y login http://localhost:8000/login --save .a11y-state.json
a11y sweep --urls pages.txt --storage-state .a11y-state.json
```

`pages.txt` is one URL per line (`#` comments allowed; `--urls -` reads stdin). Pages that answer non-2xx (403, 404, 500) or bounce to a login page are recorded as skipped with a reason rather than polluting the findings. The report has a `summary.findings` map keyed by finding id (count and affected pages), plus per-page detail; `--human` renders the summary table first.

For a Laravel app, generate the list from the router (drop parameterised and utility routes, then prefix your base URL):

```
php artisan route:list --except-vendor --except-path=api --method=GET --json
```

For routes with parameters (`/admin/users/{user}`), let Laravel build real URLs from seeded data rather than guessing ids: `route('admin.users.show', \App\Models\User::first())` in tinker. Read-only calls, seeded local data only.

## The report

JSON to stdout by default (the `--human` markdown renders the same data):

```json
{
  "tool": "a11y",
  "version": "0.2.0",
  "url": "http://localhost:8000/",
  "generatedAt": "2026-07-09T12:00:00.000Z",
  "checks": {
    "axe": {
      "findings": [
        {
          "id": "color-contrast",
          "impact": "serious",
          "summary": "Elements must meet minimum color contrast ratio thresholds",
          "detail": "…rule description and help URL…",
          "nodes": [
            {
              "selector": "p.faint",
              "failureSummary": "…insufficient color contrast of 2.85 (foreground color: #777777, background color: #ffffff…). Expected contrast ratio of 4.5:1"
            }
          ],
          "tags": ["wcag2aa", "wcag143", "…"]
        }
      ]
    },
    "tabwalk": {
      "findings": [],
      "focusOrder": [{ "role": "link", "name": "Skip to main content", "tag": "a", "selector": "…" }],
      "ariaSnapshot": "…YAML accessibility tree…",
      "landmarks": [{ "tag": "nav", "role": "navigation", "label": "Main" }]
    },
    "vsr": {
      "findings": [],
      "transcript": ["document", "link, Skip to main content", "banner", "…"]
    }
  }
}
```

Reading it:

- **`findings`** are the problems each check detected, each with a stable `id`, an `impact` (critical / serious / moderate / minor), and the affected `nodes` — each a `{selector, failureSummary?}` object, where the selector locates the element and `failureSummary` carries axe's per-node evidence (for `color-contrast`, that's the measured ratio and colours: the number the fix has to beat). Tabwalk's finding ids: `no-skip-link`, `positive-tabindex`, `unreachable-interactive`, `unreachable-composite-item` (items inside a roving-tabindex composite such as a tablist or menu — usually correct per the ARIA APG, so it's a minor "verify with arrow keys" prompt rather than an accusation), `named-by-placeholder-only` (a field whose only name is its placeholder — legal per spec and passed by axe, but the name vanishes the moment the field has content), `focus-trap`. Vsr's: `bare-control`.
- **`focusOrder`, `ariaSnapshot`, `landmarks`, `transcript`** are raw material, not verdicts. A tab order can be technically valid but still insane, and only something (or someone) reading the transcript can judge "would I want to navigate this page blind?". They're in the report so a human or an agent can make those judgement calls.

Exit codes mean tool health, not page quality: **0** when the checks ran (however bad the findings), non-zero only when the tool itself failed (unreachable URL, crash).

## Quick mode vs full-fat mode

Everything above is **quick mode**: simulated, deterministic, background-safe. It answers *"did we build the semantics correctly per spec?"*.

**Full-fat mode** (`a11y sr`) drives the *real* VoiceOver via [Guidepup](https://www.guidepup.dev/) and captures what it actually speaks, as text. Real screen readers are quirky and spec-divergent, and those quirks are what users experience: the real transcript announces landmark boundaries, list positions and field types that the virtual reader doesn't. So it stays the final confirmation, run deliberately in the foreground, never in the background. None of this replaces testing with real screen readers and real users; it just makes sure their time isn't wasted on problems a machine could have caught.

### One-off macOS setup

VoiceOver automation needs a one-time permission dance (macOS only, WebKit by default):

```
npx playwright install webkit     # sr drives WebKit by default; Guidepup itself came with `npm run setup`
npx @guidepup/setup               # then follow the linked manual guide it prints
```

`@guidepup/setup` (0.23.0, verified July 2026 on macOS 26.5) no longer needs your password. It enables VoiceOver's AppleScript control and points you at https://www.guidepup.dev/docs/guides/manual-voiceover-setup for the remaining VoiceOver Utility toggles. Your terminal application also needs **System Settings → Privacy & Security → Accessibility** permission (whichever app hosts your shell: Terminal, iTerm, Ghostty, …).

**Known first-run gotcha**: the very first VoiceOver launch on a machine can show a Welcome/Quick Start dialog and fail the first automated run with "Timed out waiting for VoiceOver to be running". Launch VoiceOver once by hand (⌘F5), dismiss the dialog, quit it, and subsequent `a11y sr` runs work.

### Running it

```
a11y sr http://localhost:8000/dashboard --foreground
```

`--foreground` is required and deliberate: the command takes over VoiceOver, speech and keyboard focus on your Mac for the duration (put the kettle on). Without it the command refuses to run. `--browser chromium` switches from the default WebKit; `--storage-state` works exactly as for the other checks. The report carries the VoiceOver transcript under `checks.sr.transcript`.

## Development

```
npm test          # vitest against two local fixture pages (deliberately good / deliberately broken)
npm run build     # tsc + bundle the virtual screen reader for in-page injection
```

The fixtures in `tests/fixtures/` are the contract: `broken.html` seeds one of every defect the checks must catch, `good.html` must stay clean, including against WCAG 2.2's newer rules (its nav links needed 24px touch targets for 2.5.8 Target Size, which the default rule set caught immediately).

If you add, rename or re-tier a finding id, grep `claude/` (and this README) for the old one — the skill and sub-agent document ids in prose, and they go stale silently.

CI (GitHub Actions, ubuntu) runs the full build and test suite on every push. The virtual screen reader is a pure simulator, so even the screen-reader tier runs happily headless on Linux.
