const { defineConfig, devices } = require("@playwright/test");

const CI = !!process.env.CI;

module.exports = defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // CI (ubuntu-latest, öffentliches Repo: 4 vCPU): Playwright nimmt sonst nur die Hälfte der Kerne = 2 Worker.
  // Lokal bleibt es bei 4: gemessen mit 6 Workern langsamer (595 s statt 555 s) und 2 lastbedingte Fehlschläge.
  // Überschreibbar: npx playwright test --workers=3
  workers: 4,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4183",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
  },
  projects: [
    { name: "android", use: { ...devices["Pixel 7"] } },
    { name: "iphone", use: { ...devices["iPhone 14"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Getestet wird die gebaute App (inkl. Content-Security-Policy) – genau das, was ausgeliefert wird
    command: "node scripts/build.mjs && node scripts/serve.mjs dist 4183",
    url: "http://localhost:4183",
    reuseExistingServer: !CI,
  },
});
