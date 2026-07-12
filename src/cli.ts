#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import type { Page } from "playwright";
import { withPage } from "./browser.js";
import { renderHuman, renderJson, renderSweepHuman, type Report } from "./report.js";
import { runSweep } from "./sweep.js";
import { runAxe } from "./checks/axe.js";
import { runLogin } from "./login.js";
import { runSr, type SrBrowser } from "./checks/sr.js";
import { runTabwalk } from "./checks/tabwalk.js";
import { runVsr } from "./checks/vsr.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

interface CommonOptions {
  human?: boolean;
  timeout: string;
  settle: string;
  storageState?: string;
}

async function emitReport(
  url: string,
  options: CommonOptions,
  collect: (page: Page) => Promise<Report["checks"]>,
): Promise<void> {
  const checks = await withPage(
    url,
    {
      timeout: Number(options.timeout),
      settle: Number(options.settle),
      storageState: options.storageState,
    },
    collect,
  );
  const report: Report = {
    tool: "a11y",
    version: pkg.version,
    url,
    generatedAt: new Date().toISOString(),
    checks,
  };
  console.log(options.human ? renderHuman(report) : renderJson(report));
}

function parseTags(list?: string): string[] | undefined {
  if (!list) return undefined;
  const tags = list
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

const program = new Command();

program
  .name("a11y")
  .description(
    "Accessibility checks against a running page: axe-core scan, tab-order walk, virtual screen reader",
  )
  .version(pkg.version);

function withCommonOptions(cmd: Command): Command {
  return cmd
    .argument("<url>", "URL of the running page to check")
    .option("--human", "render the report as markdown instead of JSON")
    .option("--timeout <ms>", "navigation timeout in milliseconds", "30000")
    .option("--settle <ms>", "extra settle time after load before checking (hydration)", "1000")
    .option("--storage-state <file>", "session state file saved by `a11y login`, for pages behind auth");
}

withCommonOptions(
  program.command("axe").description("axe-core scan (defaults to WCAG 2.1 AA + 2.2 AA rules)"),
)
  .option("--tags <list>", "comma-separated axe tags overriding the default WCAG set")
  .action(async (url: string, options: CommonOptions & { tags?: string }) => {
    await emitReport(url, options, async (page) => ({
      axe: await runAxe(page, { tags: parseTags(options.tags) }),
    }));
  });

withCommonOptions(
  program.command("tabwalk").description("tab-order, skip-link and landmark structural walk"),
).action(async (url: string, options: CommonOptions) => {
  await emitReport(url, options, async (page) => ({
    tabwalk: await runTabwalk(page),
  }));
});

withCommonOptions(
  program.command("vsr").description("virtual screen reader announcement transcript"),
).action(async (url: string, options: CommonOptions) => {
  await emitReport(url, options, async (page) => ({
    vsr: await runVsr(page),
  }));
});

withCommonOptions(
  program.command("quick").description("all quick-mode checks (axe + tabwalk + vsr) in one report"),
)
  .option("--tags <list>", "comma-separated axe tags overriding the default WCAG set")
  .action(async (url: string, options: CommonOptions & { tags?: string }) => {
    await emitReport(url, options, async (page) => ({
      axe: await runAxe(page, { tags: parseTags(options.tags) }),
      tabwalk: await runTabwalk(page),
      vsr: await runVsr(page),
    }));
  });

program
  .command("sweep")
  .description("run all quick-mode checks over a list of URLs, with a pattern summary")
  .requiredOption("--urls <file>", "file of URLs, one per line ('-' reads stdin; # comments allowed)")
  .option("--human", "render the report as markdown instead of JSON")
  .option("--timeout <ms>", "navigation timeout in milliseconds", "30000")
  .option("--settle <ms>", "extra settle time after load before checking (hydration)", "1000")
  .option("--storage-state <file>", "session state file saved by `a11y login`, for pages behind auth")
  .option("--tags <list>", "comma-separated axe tags overriding the default WCAG set")
  .action(async (options: CommonOptions & { urls: string; tags?: string }) => {
    const raw = options.urls === "-" ? readFileSync(0, "utf8") : readFileSync(options.urls, "utf8");
    const urls = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    if (urls.length === 0) {
      throw new Error("no URLs found in the list");
    }
    const report = await runSweep(urls, pkg.version, {
      timeout: Number(options.timeout),
      settle: Number(options.settle),
      storageState: options.storageState,
      tags: parseTags(options.tags),
    });
    console.log(options.human ? renderSweepHuman(report) : renderJson(report));
  });

program
  .command("sr")
  .description("REAL VoiceOver pass (macOS, foreground only) — this Mac will speak and lose focus")
  .argument("<url>", "URL of the running page to check")
  .option("--foreground", "acknowledge this run takes over VoiceOver, speech and focus on this Mac")
  .option("--browser <name>", "webkit (Safari-like, the canonical VoiceOver pairing) or chromium", "webkit")
  .option("--human", "render the report as markdown instead of JSON")
  .option("--timeout <ms>", "navigation timeout in milliseconds", "30000")
  .option("--settle <ms>", "extra settle time after load before checking (hydration)", "1000")
  .option("--storage-state <file>", "session state file saved by `a11y login`, for pages behind auth")
  .action(
    async (
      url: string,
      options: CommonOptions & { foreground?: boolean; browser: string },
    ) => {
      if (!options.foreground) {
        console.error(
          [
            "a11y sr drives the REAL VoiceOver: your Mac will start speaking, a browser",
            "window will appear, and keyboard focus will be taken over for the duration.",
            "It must never run in the background or on someone else's session.",
            "",
            "If you have the keyboard and you're ready for that, re-run with --foreground.",
          ].join("\n"),
        );
        process.exitCode = 1;
        return;
      }
      if (options.browser !== "webkit" && options.browser !== "chromium") {
        throw new Error(`unsupported --browser "${options.browser}" (use webkit or chromium)`);
      }
      const sr = await runSr(url, {
        browser: options.browser as SrBrowser,
        timeout: Number(options.timeout),
        settle: Number(options.settle),
        storageState: options.storageState,
      });
      const report: Report = {
        tool: "a11y",
        version: pkg.version,
        url,
        generatedAt: new Date().toISOString(),
        checks: { sr },
      };
      console.log(options.human ? renderHuman(report) : renderJson(report));
    },
  );

program
  .command("login")
  .description("log in via a form and save the session for later checks with --storage-state")
  .argument("<url>", "URL of the login page")
  .option("--user <value>", "login identifier (team seeded-admin convention by default)", "admin2x")
  .option("--pass <value>", "password (local seeded credentials only — never production)", "secret")
  .option("--user-field <selector>", "CSS selector for the identifier field")
  .option("--pass-field <selector>", "CSS selector for the password field")
  .option("--submit <selector>", "CSS selector for the submit control")
  .option("--save <file>", "where to write the session state", ".a11y-state.json")
  .option("--timeout <ms>", "navigation timeout in milliseconds", "30000")
  .action(
    async (
      url: string,
      options: {
        user: string;
        pass: string;
        userField?: string;
        passField?: string;
        submit?: string;
        save: string;
        timeout: string;
      },
    ) => {
      const result = await runLogin(url, {
        user: options.user,
        pass: options.pass,
        userField: options.userField,
        passField: options.passField,
        submit: options.submit,
        save: options.save,
        timeout: Number(options.timeout),
      });
      console.log(JSON.stringify(result, null, 2));
      // A verified login failure means every downstream check would run on a
      // dead session — that's a tool-health failure, hence non-zero.
      if (!result.loggedIn) process.exitCode = 1;
    },
  );

try {
  await program.parseAsync();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
