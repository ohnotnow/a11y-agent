import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serveFixtures, type FixtureServer } from "./helpers/server";
import { withPage } from "../src/browser";
import { runVsr } from "../src/checks/vsr";

let server: FixtureServer;

beforeAll(async () => {
  server = await serveFixtures();
});

afterAll(async () => {
  await server.close();
});

describe("vsr check", () => {
  it.each(["good.html", "broken.html"])("produces a transcript for %s", async (fixture) => {
    const result = await withPage(`${server.url}/${fixture}`, {}, runVsr);
    const transcript = result.transcript as string[];
    expect(Array.isArray(transcript)).toBe(true);
    expect(transcript.length).toBeGreaterThan(0);
    for (const phrase of transcript) {
      expect(typeof phrase).toBe("string");
    }
  });

  it("flags bare (unnamed) controls on broken.html", async () => {
    const result = await withPage(`${server.url}/broken.html`, {}, runVsr);
    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain("bare-control");
  });

  it("announces every control with a name on good.html", async () => {
    const result = await withPage(`${server.url}/good.html`, {}, runVsr);
    const ids = result.findings.map((f) => f.id);
    expect(ids).not.toContain("bare-control");

    // The skip link is genuinely part of the announced experience.
    const transcript = result.transcript as string[];
    expect(transcript.some((phrase) => phrase.includes("Skip to main content"))).toBe(true);
  });
});
