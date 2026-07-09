# a11y-agent

Accessibility checks for a running web page, in one command. Point it at a URL and it runs an axe-core scan, a keyboard tab-order walk and a virtual screen reader pass, then gives you one structured report.

## Why

Automated scanners (Lighthouse, the axe browser extension) catch roughly 30–40% of WCAG issues. The misses are the things that actually wreck the experience for keyboard and screen-reader users: no skip-to-content link, broken tab order, landmark soup, controls announced as a bare "button" with nothing to identify them. Checking those by hand is gruelling, so it rarely happens.

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
npm install
npx playwright install chromium
npm run build
```

Requires Node 20+.

## Usage

Run against any reachable page — typically your local dev server:

```
npm run a11y -- quick http://localhost:8000            # all three checks, one report
npm run a11y -- axe http://localhost:8000              # axe-core scan only
npm run a11y -- tabwalk http://localhost:8000          # tab-order / structural walk only
npm run a11y -- vsr http://localhost:8000              # virtual screen reader only
```

Flags:

| Flag | Applies to | Meaning |
|------|-----------|---------|
| `--human` | all | Render the report as markdown instead of JSON |
| `--timeout <ms>` | all | Navigation timeout (default 30000) |
| `--settle <ms>` | all | Extra settle time after load before checking (default 1000). Livewire/Alpine pages re-wire focus during hydration, and measuring too early produces false findings |
| `--tags <list>` | `axe` | Override the default WCAG tag set, e.g. `--tags wcag2a,wcag2aa` for strict 2.0/2.1-only runs |

The default axe tags are `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`.

## Pages behind a login

Most real pages are. Log in once, then reuse the session for as many checks as you like:

```
npm run a11y -- login http://localhost:8000/login --save .a11y-state.json
npm run a11y -- quick http://localhost:8000/dashboard --storage-state .a11y-state.json
```

`a11y login` drives the actual login form (CSRF is handled for free, since it genuinely submits the form), verifies a password field is no longer visible afterwards, and saves the session cookies. It defaults to our seeded-admin convention (`--user admin2x --pass secret`); override those, and `--user-field` / `--pass-field` / `--submit` selectors for forms that differ from the Laravel norm.

Two rules:

- **Seeded local-dev credentials only.** Never point this at anything production-shaped.
- The state file holds a live session cookie. It is gitignored (`.a11y-state.json`) — keep it that way.

Local HTTPS with self-signed or local-CA certificates (Lando's `*.lndo.site`, Valet, etc.) works out of the box: certificate errors are ignored, as befits a local checking tool.

One tip for Laravel apps: run checks with debug overlays disabled (e.g. Laravel Debugbar), otherwise axe dutifully reports contrast violations in the debug toolbar rather than your app.

## Sweeping a whole app

`sweep` runs all three checks over a list of URLs in one browser session and adds a cross-page summary, which is where per-page findings turn into app-wide patterns:

```
npm run a11y -- login http://localhost:8000/login --save .a11y-state.json
npm run a11y -- sweep --urls pages.txt --storage-state .a11y-state.json
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
  "version": "0.1.0",
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
          "nodes": ["p", ".hero"],
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

- **`findings`** are the problems each check detected, each with a stable `id`, an `impact` (critical / serious / moderate / minor), and the affected `nodes` as CSS selectors. Tabwalk's finding ids: `no-skip-link`, `positive-tabindex`, `unreachable-interactive`, `focus-trap`. Vsr's: `bare-control`.
- **`focusOrder`, `ariaSnapshot`, `landmarks`, `transcript`** are raw material, not verdicts. A tab order can be technically valid but still insane, and only something (or someone) reading the transcript can judge "would I want to navigate this page blind?". They're in the report so a human or an agent can make those judgement calls.

Exit codes mean tool health, not page quality: **0** when the checks ran (however bad the findings), non-zero only when the tool itself failed (unreachable URL, crash).

## Quick mode vs full-fat mode

Everything above is **quick mode**: simulated, deterministic, background-safe. It answers *"did we build the semantics correctly per spec?"*.

**Full-fat mode** (`a11y sr`) drives the *real* VoiceOver via [Guidepup](https://www.guidepup.dev/) and captures what it actually speaks, as text. Real screen readers are quirky and spec-divergent, and those quirks are what users experience: the real transcript announces landmark boundaries, list positions and field types that the virtual reader doesn't. So it stays the final confirmation, run deliberately in the foreground, never in the background. None of this replaces testing with real screen readers and real users; it just makes sure their time isn't wasted on problems a machine could have caught.

### One-off macOS setup

VoiceOver automation needs a one-time permission dance (macOS only, WebKit by default):

```
npm install                       # includes @guidepup/guidepup + @guidepup/playwright
npx playwright install webkit
npx @guidepup/setup               # then follow the linked manual guide it prints
```

`@guidepup/setup` (0.23.0, verified July 2026 on macOS 26.5) no longer needs your password. It enables VoiceOver's AppleScript control and points you at https://www.guidepup.dev/docs/guides/manual-voiceover-setup for the remaining VoiceOver Utility toggles. Your terminal application also needs **System Settings → Privacy & Security → Accessibility** permission (whichever app hosts your shell: Terminal, iTerm, Ghostty, …).

**Known first-run gotcha**: the very first VoiceOver launch on a machine can show a Welcome/Quick Start dialog and fail the first automated run with "Timed out waiting for VoiceOver to be running". Launch VoiceOver once by hand (⌘F5), dismiss the dialog, quit it, and subsequent `a11y sr` runs work.

### Running it

```
npm run a11y -- sr http://localhost:8000/dashboard --foreground
```

`--foreground` is required and deliberate: the command takes over VoiceOver, speech and keyboard focus on your Mac for the duration (put the kettle on). Without it the command refuses to run. `--browser chromium` switches from the default WebKit; `--storage-state` works exactly as for the other checks. The report carries the VoiceOver transcript under `checks.sr.transcript`.

## Using it from Claude Code

`claude/` contains a skill (`claude/skills/a11y-check/`) and a background sub-agent definition (`claude/agents/a11y-checker.md`) documenting how agent sessions should invoke this tool and read its reports. Copy them into `~/.claude/skills/` and `~/.claude/agents/` respectively.

## Development

```
npm test          # vitest against two local fixture pages (deliberately good / deliberately broken)
npm run build     # tsc + bundle the virtual screen reader for in-page injection
```

The fixtures in `tests/fixtures/` are the contract: `broken.html` seeds one of every defect the checks must catch, `good.html` must stay clean, including against WCAG 2.2's newer rules (its nav links needed 24px touch targets for 2.5.8 Target Size, which the default rule set caught immediately).

CI (GitHub Actions, ubuntu) runs the full build and test suite on every push. The virtual screen reader is a pure simulator, so even the screen-reader tier runs happily headless on Linux.
