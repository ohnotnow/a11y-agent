import { chromium } from "playwright";
import { settlePage } from "./browser.js";
import { runAxe } from "./checks/axe.js";
import { runTabwalk } from "./checks/tabwalk.js";
import { runVsr } from "./checks/vsr.js";
import type { Report, SweepPage, SweepReport, SweepSummaryEntry } from "./report.js";

export interface SweepOptions {
  timeout?: number;
  settle?: number;
  storageState?: string;
}

export async function runSweep(
  urls: string[],
  version: string,
  opts: SweepOptions = {},
): Promise<SweepReport> {
  const timeout = opts.timeout ?? 30_000;
  const pages: SweepPage[] = [];

  // ONE browser + context for the whole sweep; a fresh page per URL.
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      bypassCSP: true,
      ignoreHTTPSErrors: true,
      storageState: opts.storageState,
    });

    for (const url of urls) {
      const page = await context.newPage();
      try {
        let response;
        try {
          response = await page.goto(url, { timeout, waitUntil: "load" });
        } catch (err) {
          const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
          pages.push({ url, finalUrl: null, status: null, skipped: `error: ${reason}`, checks: null });
          continue;
        }

        const status = response?.status() ?? null;
        const finalUrl = page.url();

        // A sweep without a session must not dutifully report the login form
        // for every gated page.
        const requestedPath = new URL(url).pathname;
        const finalPath = new URL(finalUrl).pathname;
        if (finalPath !== requestedPath && /login/i.test(finalPath)) {
          pages.push({ url, finalUrl, status, skipped: "auth-redirect", checks: null });
          continue;
        }

        // Error pages would pollute the pattern summary.
        if (status !== null && (status < 200 || status >= 300)) {
          pages.push({ url, finalUrl, status, skipped: `http-${status}`, checks: null });
          continue;
        }

        await settlePage(page, opts.settle);
        const checks: Report["checks"] = {
          axe: await runAxe(page),
          tabwalk: await runTabwalk(page),
          vsr: await runVsr(page),
        };
        pages.push({ url, finalUrl, status, skipped: null, checks });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  return {
    tool: "a11y",
    version,
    generatedAt: new Date().toISOString(),
    pages,
    summary: summarise(pages),
  };
}

function summarise(pages: SweepPage[]): SweepReport["summary"] {
  const findings: Record<string, SweepSummaryEntry> = {};
  for (const page of pages) {
    if (!page.checks) continue;
    for (const check of Object.values(page.checks)) {
      for (const finding of check?.findings ?? []) {
        const entry = (findings[finding.id] ??= { impact: finding.impact, count: 0, pages: [] });
        if (!entry.pages.includes(page.url)) {
          entry.pages.push(page.url);
          entry.count = entry.pages.length;
        }
      }
    }
  }
  return {
    findings,
    skipped: pages
      .filter((page) => page.skipped !== null)
      .map((page) => ({ url: page.url, reason: page.skipped! })),
  };
}
