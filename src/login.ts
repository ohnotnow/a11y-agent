import { chromium } from "playwright";

export interface LoginOptions {
  user: string;
  pass: string;
  userField?: string;
  passField?: string;
  submit?: string;
  save: string;
  timeout?: number;
}

export interface LoginResult {
  savedTo: string;
  finalUrl: string;
}

// Laravel-friendly defaults; override flags exist for apps that differ.
const DEFAULT_USER_FIELD = 'input[name="email"], input[name="username"], input[type="email"]';
const DEFAULT_PASS_FIELD = 'input[name="password"], input[type="password"]';
const DEFAULT_SUBMIT = 'button[type="submit"], input[type="submit"]';

export async function runLogin(loginUrl: string, opts: LoginOptions): Promise<LoginResult> {
  const timeout = opts.timeout ?? 30_000;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ bypassCSP: true, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(loginUrl, { timeout, waitUntil: "load" });

    await page.locator(opts.userField ?? DEFAULT_USER_FIELD).first().fill(opts.user, { timeout });
    await page.locator(opts.passField ?? DEFAULT_PASS_FIELD).first().fill(opts.pass, { timeout });
    await page.locator(opts.submit ?? DEFAULT_SUBMIT).first().click({ timeout });

    // Livewire apps may keep background requests going, so a networkidle wait can
    // time out even after a successful login — settle best-effort, then verify.
    await page.waitForLoadState("networkidle", { timeout }).catch(() => {});

    const passwordStillVisible = await page
      .locator(opts.passField ?? DEFAULT_PASS_FIELD)
      .first()
      .isVisible()
      .catch(() => false);
    if (passwordStillVisible) {
      throw new Error(
        `login appears to have failed: a password field is still visible after submitting (${page.url()})`,
      );
    }

    await context.storageState({ path: opts.save });
    return { savedTo: opts.save, finalUrl: page.url() };
  } finally {
    await browser.close();
  }
}
