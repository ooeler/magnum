// Durchlauf gegen ein echtes Neon-Backend (tests-e2e/neon.spec.js). Läuft nicht in npm test.
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests-e2e",
  workers: 1,
  timeout: 60000,
  reporter: "line",
  use: { baseURL: "http://localhost:4183", ...devices["Desktop Chrome"] },
  webServer: { command: "node scripts/serve.mjs", port: 4183, reuseExistingServer: false },
});
