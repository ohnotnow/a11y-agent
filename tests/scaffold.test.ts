import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serveFixtures, type FixtureServer } from "./helpers/server";
import { renderJson, type Report } from "../src/report";

describe("fixture server", () => {
  let server: FixtureServer;

  beforeAll(async () => {
    server = await serveFixtures();
  });

  afterAll(async () => {
    await server.close();
  });

  it.each(["good.html", "broken.html"])("serves %s", async (name) => {
    const res = await fetch(`${server.url}/${name}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  });
});

describe("report", () => {
  it("renderJson round-trips a minimal report", () => {
    const report: Report = {
      tool: "a11y",
      version: "0.1.0",
      url: "http://127.0.0.1:1/example.html",
      generatedAt: new Date().toISOString(),
      checks: {},
    };
    expect(JSON.parse(renderJson(report))).toEqual(report);
  });
});
