const path = require("path");
const base = require("@playwright/test");

const MOCK = path.join(__dirname, "mock-neon.js");
const OT = { email: "ot@magnum.test", password: "magnum123" };      // Admin, iPhone
const BEAT = { email: "beat@magnum.test", password: "magnum123" };  // Android
const CHRIS = { email: "chris@magnum.test", password: "magnum123" };

// Jede Seite: feste Zeit, Neon-Nachbau statt config.js, keine externen Requests.
async function setup(page) {
  await page.clock.setFixedTime(new Date("2026-10-31T10:00:00+01:00"));
  await page.addInitScript(() => { try { Object.defineProperty(navigator, "share", { value: undefined }) } catch (e) {} });
  await page.route("**/config.js", (r) => r.fulfill({ path: MOCK, contentType: "application/javascript" }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on("dialog", (d) => d.accept());
}

async function login(page, user = OT) {
  await page.goto("/");
  await page.fill("#login input[name=email]", user.email);
  await page.fill("#login input[name=pw]", user.password);
  await page.click("#login .btn");
  await base.expect(page.locator("header h1")).toHaveText("Magnum");
  await base.expect(page.locator("nav")).toBeVisible();
}

async function tab(page, name) {
  await page.locator("nav button", { hasText: name }).click();
}

// Als andere Person handeln (z. B. Stimme von Beat), danach lädt die App per Live-Sync neu
async function as(page, email, fn, arg) {
  return page.evaluate(([email, fn, arg]) => window.__mg.as(email, (sb) => new Function("sb", "arg", "return " + fn)(sb, arg)), [email, fn, arg]);
}

const test = base.test.extend({
  page: async ({ page }, use) => {
    await setup(page);
    await use(page);
  },
});

module.exports = { test, expect: base.expect, setup, login, tab, as, OT, BEAT, CHRIS };
