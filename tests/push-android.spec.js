// Push auf Android: Test-Benachrichtigung mit Rückmeldung, Abo beim Öffnen abgleichen.
const { test, expect, login, tab } = require("./fixtures");

const KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

// Wie in der installierten App: Service Worker, PushManager, Erlaubnis. Das Abo merkt sich der Test.
async function pushGeraet(page, { erlaubt = "granted", abo = false } = {}) {
  await page.addInitScript(([erlaubt, abo]) => {
    const neu = (key) => ({ endpoint: "https://fcm.googleapis.com/fcm/send/test", options: { applicationServerKey: key },
      toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "B".repeat(40), auth: "a".repeat(16) } } }, unsubscribe() { window.__abo = null; return Promise.resolve(true) } });
    window.__abo = abo ? neu(new Uint8Array([1, 2, 3]).buffer) : null;    // altes Abo mit anderem Schlüssel
    const reg = { pushManager: { getSubscription: () => Promise.resolve(window.__abo), subscribe: (o) => { window.__neu = (window.__neu || 0) + 1; window.__abo = neu(o.applicationServerKey.buffer || o.applicationServerKey); return Promise.resolve(window.__abo) } } };
    Object.defineProperty(navigator, "serviceWorker", { value: { ready: Promise.resolve(reg), register: () => Promise.resolve(reg) }, configurable: true });
    window.PushManager = function () {};
    window.Notification = { permission: erlaubt, requestPermission: () => Promise.resolve(erlaubt) };
    // Öffentlicher Push-Schlüssel des Servers (die Testseite darf nur das Test-Backend erreichen)
    const f0 = window.fetch;
    window.fetch = (u, o) => String(u).endsWith("/push/key") ? Promise.resolve(new Response(JSON.stringify({ key: window.__KEY }), { headers: { "content-type": "application/json" } })) : f0(u, o);
  }, [erlaubt, abo]);
  await page.addInitScript((k) => { window.__KEY = k }, KEY);
}
// Die Testseite läuft über http: Push-Unterstützung wie in der App freischalten und abgleichen
const abgleichen = (page) => page.evaluate(() => { window.pushMoeglich = () => true; ABGLEICH = false; pushAbgleich() });

test.describe("Push auf Android", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name == "iphone", "WebKit: navigator.serviceWorker lässt sich nicht ersetzen"));

  test("Eingeschaltet, aber das Abo fehlt: die App meldet sich neu an", async ({ page }) => {
    await pushGeraet(page);
    await page.addInitScript(() => localStorage.setItem("mg_push", "1"));
    await login(page);
    await abgleichen(page);
    await expect.poll(() => page.evaluate(() => (window.__mg_abos || []).length)).toBe(1);
    expect(await page.evaluate(() => [window.__neu, PUSH])).toEqual([1, true]);
  });

  test("Abo mit altem Schlüssel wird ersetzt", async ({ page }) => {
    await pushGeraet(page, { abo: true });
    await page.addInitScript(() => localStorage.setItem("mg_push", "1"));
    await login(page);
    await abgleichen(page);
    await expect.poll(() => page.evaluate(() => window.__neu || 0)).toBe(1);
    await expect.poll(() => page.evaluate(() => (window.__mg_abos || []).length)).toBe(1);
  });

  test("Erlaubnis im Handy entzogen: die App zeigt «aus»", async ({ page }) => {
    await pushGeraet(page, { erlaubt: "denied" });
    await page.addInitScript(() => localStorage.setItem("mg_push", "1"));
    await login(page);
    await abgleichen(page);
    await expect.poll(() => page.evaluate(() => PUSH)).toBe(false);
    expect(await page.evaluate(() => window.__mg_abos)).toBeUndefined();
  });

  test("Nie eingeschaltet: nichts passiert", async ({ page }) => {
    await pushGeraet(page);
    await login(page);
    await abgleichen(page);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [window.__neu, window.__mg_abos, PUSH])).toEqual([null, null, false].map((x) => x === null ? undefined : x));
  });

  test("Test-Benachrichtigung meldet, an wie viele Geräte, und erkennt fehlende Anmeldung", async ({ page }) => {
    await login(page);
    await tab(page, "Statistik");
    await page.evaluate(() => { window.pushMoeglich = () => true; PUSH = true; render() });
    await page.getByRole("button", { name: "Test-Benachrichtigung an mich senden" }).click();
    await expect(page.locator("#toast")).toContainText("Test gesendet an 1 Gerät");
    await page.evaluate(() => { window.__mg_testpush = { geraete: 0, abos: 0 } });
    await page.getByRole("button", { name: "Test-Benachrichtigung an mich senden" }).click();
    await expect(page.locator("#toast")).toContainText("nicht angemeldet");
    await expect(page.getByRole("button", { name: "Benachrichtigungen an mich senden" })).toBeVisible();
  });
});
