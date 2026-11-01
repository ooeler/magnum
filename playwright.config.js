const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
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
    reuseExistingServer: !process.env.CI,
  },
});
