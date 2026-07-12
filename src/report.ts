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
  checks: {
    axe?: CheckResult;
    tabwalk?: CheckResult;
    vsr?: CheckResult;
    sr?: CheckResult;
  };
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

export function renderJson(report: Report | SweepReport): string {
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
