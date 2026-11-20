const path = require("path");
const { defineConfig, devices } = require("@playwright/test");

const CI = !!process.env.CI;
// Visuelle Tests (tests/visuell.spec.js) laufen nur mit VISUELL=1 (scripts/visuell.sh): Die Referenzbilder
// entstehen jedes Mal neu aus dem Basis-Stand in VISUELL_BILDER, im Repo liegen keine Bilder.
const VISUELL = !!process.env.VISUELL;
const PORT = Number(process.env.PW_PORT || 4183);
// Bereits gebaute App ausliefern statt neu bauen (Basis-Stand für die Referenzbilder)
const DIST = process.env.VISUELL_DIST;

module.exports = defineConfig({
  testDir: "tests",
  testIgnore: VISUELL ? [] : ["visuell.spec.js"],
  ...(VISUELL && { snapshotPathTemplate: path.join(path.resolve(process.env.VISUELL_BILDER || "visuell-referenz"), "{projectName}", "{arg}{ext}") }),
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // CI (ubuntu-latest, öffentliches Repo: 4 vCPU): Playwright nimmt sonst nur die Hälfte der Kerne = 2 Worker.
  // Lokal bleibt es bei 4: gemessen mit 6 Workern langsamer (595 s statt 555 s) und 2 lastbedingte Fehlschläge.
  // Überschreibbar: npx playwright test --workers=3
  workers: 4,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
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
    command: DIST ? `node scripts/serve.mjs "${DIST}" ${PORT}` : `node scripts/build.mjs && node scripts/serve.mjs dist ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Visuell nie einen laufenden Server übernehmen: er könnte einen anderen Stand ausliefern
    reuseExistingServer: !CI && !VISUELL,
  },
});
