// Serialises the compiled observer functions into eval-ready asset files: each
// file's entire content is a single JavaScript function expression, because
// that is exactly what `playwright-cli eval "$(cat file)"` (and page.evaluate)
// accept. Runs after tsc, importing the compiled dist/ modules.
import { writeFile, mkdir } from "node:fs/promises";
import { Script } from "node:vm";

const entries = [
  ["arm", "../dist/observer/arm.js", "observer-arm.js"],
  ["read", "../dist/observer/read.js", "observer-read.js"],
  ["highlight", "../dist/observer/highlight.js", "highlight.js"],
  ["unhighlight", "../dist/observer/highlight.js", "unhighlight.js"],
];

await mkdir(new URL("../assets", import.meta.url), { recursive: true });

for (const [exportName, modulePath, outName] of entries) {
  const mod = await import(new URL(modulePath, import.meta.url).href);
  const source = mod[exportName].toString();
  // Parse-only sanity check (never executed): the file must be one function
  // expression, because `playwright-cli eval "$(cat file)"` accepts exactly that.
  new Script(`(${source})`, { filename: outName });
  await writeFile(new URL(`../assets/${outName}`, import.meta.url), source + "\n");
  console.log(`bundle-observer: wrote assets/${outName}`);
}
