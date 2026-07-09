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

    expect(result.savedTo).toBe(statePath);
    expect(result.finalUrl).toContain("/secure.html");

    const state = JSON.parse(await readFile(statePath, "utf8"));
    const cookieNames = (state.cookies as Array<{ name: string }>).map((c) => c.name);
    expect(cookieNames).toContain("a11y_session");
  });

  it("throws when the credentials are wrong", async () => {
    await expect(
      runLogin(`${server.url}/login.html`, {
        user: "admin2x",
        pass: "wrong-password",
        save: join(tmpdir(), "a11y-login-test-should-not-exist.json"),
      }),
    ).rejects.toThrow(/login appears to have failed/);
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
