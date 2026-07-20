/** A colour scheme actually rendered and checked (not the "both" request). */
export type Scheme = "light" | "dark";

/** Light before dark — keeps every schemes[] array in a stable, readable order. */
export const SCHEMES: Scheme[] = ["light", "dark"];

export interface FindingNode {
  selector: string;
  /** Per-node evidence, e.g. axe's measured contrast ratio and colours. */
  failureSummary?: string;
}

export interface Finding {
  id: string;
  impact?: string;
  summary: string;
  detail?: string;
  nodes?: FindingNode[];
  tags?: string[];
}

export interface CheckResult {
  findings: Finding[];
  [extra: string]: unknown;
}

export interface Report {
  tool: "a11y";
  version: string;
  url: string;
  generatedAt: string;
  /** Which single scheme was rendered, when the run pinned one. Absent on legacy callers. */
  colorScheme?: Scheme;
  checks: {
    axe?: CheckResult;
    tabwalk?: CheckResult;
    vsr?: CheckResult;
    sr?: CheckResult;
  };
}

/** finding-id -> which colour scheme(s) it appeared in (light before dark). */
export interface SchemeSummaryEntry {
  impact?: string;
  schemes: Scheme[];
}

/**
 * A single-page report run under both themes: each scheme's full checks kept
 * intact (lossless — no cross-scheme node diffing, whose selectors are per-render
 * anyway), plus a by-id summary answering "which theme(s) is this a problem in?".
 */
export interface MultiSchemeReport {
  tool: "a11y";
  version: string;
  url: string;
  generatedAt: string;
  colorScheme: "both";
  schemes: Partial<Record<Scheme, Report["checks"]>>;
  schemeSummary: Record<string, SchemeSummaryEntry>;
}

/** Collapse a page's per-scheme checks into a by-finding-id "which schemes?" map. */
export function summariseSchemeChecks(
  schemes: Partial<Record<Scheme, Report["checks"]>>,
): Record<string, SchemeSummaryEntry> {
  const summary: Record<string, SchemeSummaryEntry> = {};
  for (const scheme of SCHEMES) {
    const checks = schemes[scheme];
    if (!checks) continue;
    for (const check of Object.values(checks)) {
      for (const finding of check?.findings ?? []) {
        const entry = (summary[finding.id] ??= { impact: finding.impact, schemes: [] });
        if (!entry.schemes.includes(scheme)) entry.schemes.push(scheme);
      }
    }
  }
  return summary;
}

export interface SweepPage {
  url: string;
  finalUrl: string | null;
  status: number | null;
  skipped: string | null;
  checks: Report["checks"] | null;
}

export interface SweepSummaryEntry {
  impact?: string;
  count: number;
  pages: string[];
}

export interface SweepReport {
  tool: "a11y";
  version: string;
  generatedAt: string;
  pages: SweepPage[];
  summary: {
    findings: Record<string, SweepSummaryEntry>;
    skipped: Array<{ url: string; reason: string }>;
  };
}

export interface MultiSchemeSweepSummaryEntry {
  impact?: string;
  count: number;
  pages: string[];
  schemes: Scheme[];
}

/**
 * A sweep run under both themes: each scheme's full single-scheme sweep kept
 * intact, plus a combined summary keyed by finding-id carrying which theme(s)
 * and which pages each finding hit.
 */
export interface MultiSchemeSweepReport {
  tool: "a11y";
  version: string;
  generatedAt: string;
  colorScheme: "both";
  schemes: Partial<Record<Scheme, SweepReport>>;
  summary: {
    findings: Record<string, MultiSchemeSweepSummaryEntry>;
    skipped: Array<{ url: string; reason: string }>;
  };
}

/** Merge per-scheme sweep summaries into one by-id map tagged with schemes + pages. */
export function combineSweepSummaries(
  sweeps: Partial<Record<Scheme, SweepReport>>,
): MultiSchemeSweepReport["summary"] {
  const findings: Record<string, MultiSchemeSweepSummaryEntry> = {};
  for (const scheme of SCHEMES) {
    const sweep = sweeps[scheme];
    if (!sweep) continue;
    for (const [id, entry] of Object.entries(sweep.summary.findings)) {
      const combined = (findings[id] ??= { impact: entry.impact, count: 0, pages: [], schemes: [] });
      if (!combined.schemes.includes(scheme)) combined.schemes.push(scheme);
      for (const pageUrl of entry.pages) {
        if (!combined.pages.includes(pageUrl)) combined.pages.push(pageUrl);
      }
      combined.count = combined.pages.length;
    }
  }
  // The skip set is routing-driven and identical across schemes; take the first run's.
  const first = SCHEMES.map((scheme) => sweeps[scheme]).find(Boolean);
  return { findings, skipped: first ? first.summary.skipped : [] };
}

export function renderJson(
  report: Report | SweepReport | MultiSchemeReport | MultiSchemeSweepReport,
): string {
  return JSON.stringify(report, null, 2);
}

const CHECK_TITLES: Record<keyof Report["checks"], string> = {
  axe: "axe-core scan",
  tabwalk: "Tab-order walk",
  vsr: "Virtual screen reader",
  sr: "Real screen reader (VoiceOver)",
};

const IMPACT_ORDER = ["critical", "serious", "moderate", "minor"];

function impactRank(impact?: string): number {
  const index = IMPACT_ORDER.indexOf(impact ?? "");
  return index === -1 ? IMPACT_ORDER.length : index;
}

function byImpact(a: Finding, b: Finding): number {
  return impactRank(a.impact) - impactRank(b.impact);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

interface FocusStopLike {
  role?: string;
  name?: string;
  selector?: string;
}

interface LandmarkLike {
  tag?: string;
  role?: string;
  label?: string;
}

export function renderHuman(report: Report): string {
  const lines: string[] = [];
  lines.push(`# a11y report — ${report.url}`);
  lines.push("");
  lines.push(`Generated ${report.generatedAt} by a11y v${report.version}.`);

  for (const key of ["axe", "tabwalk", "vsr", "sr"] as const) {
    const check = report.checks[key];
    if (!check) continue;
    lines.push("", `## ${CHECK_TITLES[key]}`, "");
    if (check.findings.length === 0) {
      lines.push("No findings.");
      continue;
    }
    for (const finding of [...check.findings].sort(byImpact)) {
      lines.push(`- **${finding.id}** (${finding.impact ?? "info"}): ${finding.summary}`);
      if (finding.detail) lines.push(`  - ${finding.detail}`);
      if (finding.nodes && finding.nodes.length > 0) {
        // Per-node evidence (the measured contrast ratio, etc.) earns one line
        // per node; without it the compact comma list reads better.
        if (finding.nodes.some((n) => n.failureSummary)) {
          lines.push("  - Nodes:");
          for (const node of finding.nodes) {
            const evidence = node.failureSummary
              ? ` — ${node.failureSummary.split("\n").map((s) => s.trim()).filter(Boolean).join(" ")}`
              : "";
            lines.push(`    - \`${node.selector}\`${evidence}`);
          }
        } else {
          lines.push(`  - Nodes: ${finding.nodes.map((n) => `\`${n.selector}\``).join(", ")}`);
        }
      }
    }
  }

  const tabwalk = report.checks.tabwalk;
  if (tabwalk) {
    const focusOrder = asArray<FocusStopLike>(tabwalk.focusOrder);
    lines.push("", "## Appendix: focus order", "");
    if (focusOrder.length === 0) {
      lines.push("Nothing received focus.");
    } else {
      focusOrder.forEach((stop, i) => {
        lines.push(`${i + 1}. ${stop.role ?? "?"} "${stop.name ?? ""}" — \`${stop.selector ?? "?"}\``);
      });
    }

    const landmarks = asArray<LandmarkLike>(tabwalk.landmarks);
    lines.push("", "## Appendix: landmarks", "");
    if (landmarks.length === 0) {
      lines.push("None found — screen-reader users have no structural waypoints on this page.");
    } else {
      for (const landmark of landmarks) {
        const label = landmark.label ? ` "${landmark.label}"` : "";
        lines.push(`- <${landmark.tag ?? "?"}> (${landmark.role ?? "?"})${label}`);
      }
    }

    if (typeof tabwalk.ariaSnapshot === "string" && tabwalk.ariaSnapshot.length > 0) {
      lines.push("", "## Appendix: ARIA snapshot", "", "```yaml", tabwalk.ariaSnapshot, "```");
    }
  }

  const vsr = report.checks.vsr;
  if (vsr) {
    const transcript = asArray<string>(vsr.transcript);
    lines.push("", "## Appendix: screen reader transcript", "");
    if (transcript.length === 0) {
      lines.push("No announcements captured.");
    } else {
      for (const phrase of transcript) {
        lines.push(`> ${phrase}`);
      }
    }
  }

  const sr = report.checks.sr;
  if (sr) {
    const transcript = asArray<string>(sr.transcript);
    lines.push("", "## Appendix: VoiceOver transcript", "");
    if (transcript.length === 0) {
      lines.push("No announcements captured.");
    } else {
      for (const phrase of transcript) {
        lines.push(`> ${phrase}`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

// Sweep rendering: summary first (that's the pattern-mining view), then compact
// per-page findings. Full raw material stays in the JSON.
export function renderSweepHuman(sweep: SweepReport): string {
  const lines: string[] = [];
  const checkedCount = sweep.pages.filter((p) => !p.skipped).length;
  lines.push(`# a11y sweep — ${checkedCount} of ${sweep.pages.length} pages checked`);
  lines.push("");
  lines.push(`Generated ${sweep.generatedAt} by a11y v${sweep.version}.`);

  lines.push("", "## Summary", "");
  const entries = Object.entries(sweep.summary.findings).sort(
    ([, a], [, b]) => impactRank(a.impact) - impactRank(b.impact) || b.count - a.count,
  );
  if (entries.length === 0) {
    lines.push("No findings on any checked page.");
  } else {
    lines.push("| Finding | Impact | Pages |", "|---|---|---|");
    for (const [id, entry] of entries) {
      lines.push(`| ${id} | ${entry.impact ?? "info"} | ${entry.count} |`);
    }
  }

  if (sweep.summary.skipped.length > 0) {
    lines.push("", "## Skipped", "");
    for (const skip of sweep.summary.skipped) {
      lines.push(`- ${skip.url} — ${skip.reason}`);
    }
  }

  for (const page of sweep.pages) {
    if (page.skipped || !page.checks) continue;
    lines.push("", `## ${page.url}`, "");
    const findings = Object.values(page.checks)
      .flatMap((check) => check?.findings ?? [])
      .sort(byImpact);
    if (findings.length === 0) {
      lines.push("No findings.");
      continue;
    }
    for (const finding of findings) {
      lines.push(`- **${finding.id}** (${finding.impact ?? "info"}): ${finding.summary}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

// Both-themes single page: the scheme summary first (which theme is each problem
// in?), then each theme's full report via the single-scheme renderer.
export function renderSchemeHuman(report: MultiSchemeReport): string {
  const lines: string[] = [];
  lines.push(`# a11y report — ${report.url}`);
  lines.push("");
  lines.push(`Generated ${report.generatedAt} by a11y v${report.version}. Colour schemes: light + dark.`);

  lines.push("", "## Scheme summary", "");
  const entries = Object.entries(report.schemeSummary).sort(
    ([, a], [, b]) => impactRank(a.impact) - impactRank(b.impact),
  );
  if (entries.length === 0) {
    lines.push("No findings in either theme.");
  } else {
    lines.push("| Finding | Impact | Themes |", "|---|---|---|");
    for (const [id, entry] of entries) {
      lines.push(`| ${id} | ${entry.impact ?? "info"} | ${entry.schemes.join(", ")} |`);
    }
  }

  for (const scheme of SCHEMES) {
    const checks = report.schemes[scheme];
    if (!checks) continue;
    lines.push("", `# ${scheme} theme`);
    lines.push(
      renderHuman({
        tool: "a11y",
        version: report.version,
        url: report.url,
        generatedAt: report.generatedAt,
        colorScheme: scheme,
        checks,
      }),
    );
  }

  lines.push("");
  return lines.join("\n");
}

// Both-themes sweep: combined summary (finding-id -> impact, pages, themes)
// first, then each theme's full sweep via the single-scheme renderer.
export function renderMultiSweepHuman(sweep: MultiSchemeSweepReport): string {
  const lines: string[] = [];
  lines.push("# a11y sweep — light + dark");
  lines.push("");
  lines.push(`Generated ${sweep.generatedAt} by a11y v${sweep.version}.`);

  lines.push("", "## Summary", "");
  const entries = Object.entries(sweep.summary.findings).sort(
    ([, a], [, b]) => impactRank(a.impact) - impactRank(b.impact) || b.count - a.count,
  );
  if (entries.length === 0) {
    lines.push("No findings on any checked page, in either theme.");
  } else {
    lines.push("| Finding | Impact | Pages | Themes |", "|---|---|---|---|");
    for (const [id, entry] of entries) {
      lines.push(`| ${id} | ${entry.impact ?? "info"} | ${entry.count} | ${entry.schemes.join(", ")} |`);
    }
  }

  if (sweep.summary.skipped.length > 0) {
    lines.push("", "## Skipped", "");
    for (const skip of sweep.summary.skipped) {
      lines.push(`- ${skip.url} — ${skip.reason}`);
    }
  }

  for (const scheme of SCHEMES) {
    const schemeSweep = sweep.schemes[scheme];
    if (!schemeSweep) continue;
    lines.push("", `# ${scheme} theme`);
    lines.push(renderSweepHuman(schemeSweep));
  }

  lines.push("");
  return lines.join("\n");
}
