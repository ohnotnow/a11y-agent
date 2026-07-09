import { chromium, type Page } from "playwright";

export interface PageOptions {
  timeout?: number;
  /** Path to a Playwright storage-state file saved by `a11y login`. */
  storageState?: string;
  /**
   * Extra settle time (ms) after load before checks run. Livewire/Alpine pages
   * re-wire focus behaviour during hydration; measuring during that window
   * produces false findings (learned the hard way against a real Flux app).
   */
  settle?: number;
}

// Best-effort quiet-network wait (Livewire polling can keep this from ever
// settling, hence the short timeout and the catch), then the settle delay.
// Checks must never measure a page mid-hydration — see the tabwalk saga.
export async function settlePage(page: Page, settle?: number): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(settle ?? 1_000);
}

export async function withPage<T>(
  url: string,
  opts: PageOptions,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    // @axe-core/playwright requires a page from an explicit context, not browser.newPage().
    // bypassCSP: the tabwalk/vsr checks inject script tags, which a strict CSP on the
    // target app would otherwise block. ignoreHTTPSErrors: local dev servers (e.g. Lando's
    // *.lndo.site) use self-signed/local-CA certificates.
    const context = await browser.newContext({
      bypassCSP: true,
      ignoreHTTPSErrors: true,
      storageState: opts.storageState,
    });
    const page = await context.newPage();
    await page.goto(url, { timeout: opts.timeout ?? 30_000, waitUntil: "load" });
    await settlePage(page, opts.settle);
    return await fn(page);
  } finally {
    await browser.close();
  }
}
