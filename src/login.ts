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
  /** The verification verdict: the form submitted and no password field remained visible. */
  loggedIn: boolean;
  /** Where the session state was written; null when login failed (nothing is saved). */
  savedTo: string | null;
  finalUrl: string;
  /** Corroborating evidence, not a verdict: false alongside loggedIn true deserves suspicion. */
  urlChanged: boolean;
  /** Present when loggedIn is false. */
  reason?: string;
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

    const finalUrl = page.url();
    const urlChanged = finalUrl !== loginUrl;

    // A verified failure is a result, not a crash: no state is saved (a dead
    // session file would silently poison every later check), and the CLI turns
    // loggedIn: false into a non-zero exit.
    if (passwordStillVisible) {
      return {
        loggedIn: false,
        savedTo: null,
        finalUrl,
        urlChanged,
        reason: "a password field is still visible after submitting — wrong credentials or a selector mismatch",
      };
    }

    await context.storageState({ path: opts.save });
    return { loggedIn: true, savedTo: opts.save, finalUrl, urlChanged };
  } finally {
    await browser.close();
  }
}
