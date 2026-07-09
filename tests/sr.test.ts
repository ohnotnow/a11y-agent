import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

// The real-VoiceOver run itself can't execute in CI (or indeed anywhere without a
// human at the keyboard) — what MUST hold everywhere is the foreground gate.
describe("sr foreground gate", () => {
  it("refuses to run without --foreground, before touching VoiceOver or a browser", async () => {
    const result = await run("node", [cli, "sr", "http://127.0.0.1:1/never-reached.html"]).then(
      () => null,
      (err: { code?: number; stderr?: string }) => err,
    );

    expect(result).not.toBeNull();
    expect(result!.code).toBe(1);
    expect(result!.stderr).toContain("--foreground");
    expect(result!.stderr).toContain("never run in the background");
  });
});
