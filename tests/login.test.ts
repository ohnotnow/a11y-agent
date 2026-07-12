import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveFixtures, type FixtureServer } from "./helpers/server";
import { withPage } from "../src/browser";
import { runLogin } from "../src/login";

let server: FixtureServer;
const statePath = join(tmpdir(), `a11y-login-test-state-${process.pid}.json`);

beforeAll(async () => {
  server = await serveFixtures();
});

afterAll(async () => {
  await server.close();
  await rm(statePath, { force: true });
});

describe("login", () => {
  it("logs in with the convention defaults and saves the session", async () => {
    const result = await runLogin(`${server.url}/login.html`, {
      user: "admin2x",
      pass: "secret",
      save: statePath,
    });

    expect(result.loggedIn).toBe(true);
    expect(result.savedTo).toBe(statePath);
    expect(result.finalUrl).toContain("/secure.html");
    expect(result.urlChanged).toBe(true);

    const state = JSON.parse(await readFile(statePath, "utf8"));
    const cookieNames = (state.cookies as Array<{ name: string }>).map((c) => c.name);
    expect(cookieNames).toContain("a11y_session");
  });

  it("reports a verified failure and saves nothing when the credentials are wrong", async () => {
    const badPath = join(tmpdir(), `a11y-login-test-should-not-exist-${process.pid}.json`);
    const result = await runLogin(`${server.url}/login.html`, {
      user: "admin2x",
      pass: "wrong-password",
      save: badPath,
    });

    expect(result.loggedIn).toBe(false);
    expect(result.savedTo).toBeNull();
    expect(result.reason).toMatch(/password field is still visible/);

    // A dead session file must never be written for later checks to trip over.
    await expect(readFile(badPath, "utf8")).rejects.toThrow();
  });

  it("reaches the gated page with storage state, and is bounced without it", async () => {
    await runLogin(`${server.url}/login.html`, { user: "admin2x", pass: "secret", save: statePath });

    const withAuth = await withPage(`${server.url}/secure.html`, { storageState: statePath }, (page) =>
      page.locator("h1").innerText(),
    );
    expect(withAuth).toBe("Secure area");

    const withoutAuth = await withPage(`${server.url}/secure.html`, {}, (page) => page.url());
    expect(withoutAuth).toContain("/login.html");
  });
});
