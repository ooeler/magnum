// Live-Abgleich des echten Clients (app/client.js): fragt nur bei Bedienung oft nach, sonst selten.
const { test, expect } = require("@playwright/test");

test("ohne Bedienung nur noch alle 5 Minuten, bei Bedienung sofort", async ({ page }, info) => {
  test.skip(info.project.name != "desktop", "reine Zeitlogik, einmal reicht");
  let n = 0;
  await page.clock.install({ time: new Date("2026-11-06T10:00:00+01:00") });
  await page.route("**/__api/status", (r) => { n++; r.fulfill({ json: { maintenance: false } }) });
  await page.route("**/leer.html", (r) => r.fulfill({ contentType: "text/html", body: '<!doctype html><body><script src="/client.js"></script><script>window.magnumDb.createClient({ data: location.origin + "/__daten", api: location.origin + "/__api" }).channel("x").on("postgres_changes", {}, function () {}).subscribe()</script>' }));
  await page.goto("/leer.html");
  await expect.poll(() => n).toBe(1);
  await page.clock.runFor(30000);
  await expect.poll(() => n).toBe(2);
  await page.clock.runFor(150000);          // die ersten 3 Minuten: alle 30 Sekunden
  await expect.poll(() => n).toBeGreaterThanOrEqual(6);
  await page.clock.runFor(60000);           // ab 3 Minuten ohne Bedienung wird es ruhig
  await page.waitForTimeout(300);
  const ruhig = n;
  await page.clock.runFor(200000);          // nächste Abfrage erst 5 Minuten nach der letzten
  await page.waitForTimeout(300);
  expect(n).toBe(ruhig);
  const vorher = n;
  await page.mouse.click(10, 10);           // Bedienung: sofort nachfragen
  await expect.poll(() => n).toBe(vorher + 1);
  await page.clock.runFor(30000);
  await expect.poll(() => n).toBe(vorher + 2);
});
