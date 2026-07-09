import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The checks launch a real chromium via Playwright; the vitest defaults are too tight.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
