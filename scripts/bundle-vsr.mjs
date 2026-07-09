// Bundles @guidepup/virtual-screen-reader into a single IIFE that exposes the
// `virtual` instance as window.__a11yVsr, for injection into checked pages via
// page.addScriptTag({ path: "assets/vsr-bundle.js" }).
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

await mkdir(new URL("../assets", import.meta.url), { recursive: true });

await build({
  stdin: {
    contents: `
      import { virtual } from "@guidepup/virtual-screen-reader";
      window.__a11yVsr = virtual;
    `,
    resolveDir: repoRoot,
    loader: "js",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  minify: true,
  outfile: new URL("../assets/vsr-bundle.js", import.meta.url).pathname,
});

console.log("bundle-vsr: wrote assets/vsr-bundle.js");
