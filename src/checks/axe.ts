import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import type { CheckResult, Finding } from "../report.js";

// WCAG 2.1 AA + 2.2 AA: the org is UK public sector (.ac.uk), and PSBAR monitoring
// audits against WCAG 2.2 AA (since late 2024). 2.1 AA retained for continuity.
export const DEFAULT_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export interface AxeOptions {
  tags?: string[];
}

export async function runAxe(page: Page, opts: AxeOptions = {}): Promise<CheckResult> {
  const tags = opts.tags && opts.tags.length > 0 ? opts.tags : DEFAULT_TAGS;
  const results = await new AxeBuilder({ page }).withTags(tags).analyze();

  const findings: Finding[] = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? undefined,
    summary: violation.help,
    detail: `${violation.description} (${violation.helpUrl})`,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
    tags: violation.tags,
  }));

  return { findings };
}
