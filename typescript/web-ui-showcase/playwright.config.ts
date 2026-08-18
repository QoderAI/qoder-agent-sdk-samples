import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: false,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4178",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && ../node_modules/.bin/tsx test/e2e/fixture-server.ts",
    url: "http://127.0.0.1:4178/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
