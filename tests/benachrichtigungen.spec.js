// Statistik: Unten steht, wann Push-Nachrichten kommen (Spiegel des täglichen Laufs, neon.ts «0 9 * * *» UTC).
const { test, expect, login, tab } = require("./fixtures");

const plan = (page) => page.locator("[aria-label=Benachrichtigungen]");

test.describe("Benachrichtigungen in der Statistik", () => {
  test("Regeln und die nächsten Push-Nachrichten (Winterzeit: 10 Uhr)", async ({ page }) => {
    // Testuhr: Samstag, 31.10.2026, 10:00 – die Erinnerung für den Herbst-Stamm (7.11.) ist eben gesendet
    await login(page);
    await tab(page, "Statistik");
    await expect(plan(page)).toContainText("einmal am Tag um 10 Uhr");
    await expect(plan(page)).toContainText("7 Tage vor jedem Anlass");
    await expect(plan(page)).toContainText("Montags");
    const z = plan(page).locator("[data-test=push-plan] > div");
    await expect(z.nth(0)).toContainText("Karte der Woche");
    await expect(z.nth(0)).toContainText("Mo., 2.11. · 10 Uhr");
    await expect(z.nth(1)).toContainText("«Chlaus-Magnum»");
    await expect(z.nth(1)).toContainText("Sa., 28.11. · 10 Uhr");
    await expect(plan(page)).not.toContainText("Herbst-Stamm");
    await expect(plan(page).locator("[data-test=push-status]")).toContainText("aus");
  });

  test("Knöpfe: auf dem Startbildschirm speichern und Benachrichtigungen", async ({ page }) => {
    await login(page);
    await tab(page, "Statistik");
    // Ohne Installations-Dialog (Safari): Anleitung passend zum Gerät (Ot: iPhone)
    await plan(page).getByRole("button", { name: "Auf dem Startbildschirm speichern" }).click();
    await expect(plan(page).locator("[data-test=start-hilfe]")).toContainText("Zum Home-Bildschirm");
    // Push geht nur in der App vom Startbildschirm (hier: http im Test)
    await expect(plan(page).locator("[data-test=push-hinweis]")).toContainText("Zuerst dort speichern");
    // Mit Installations-Dialog (Chrome/Android): der Knopf öffnet ihn
    await page.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => { window.__gefragt = 1 }; window.dispatchEvent(e) });
    await plan(page).getByRole("button", { name: "Auf dem Startbildschirm speichern" }).click();
    expect(await page.evaluate(() => window.__gefragt)).toBe(1);
  });

  test("In der App vom Startbildschirm: Benachrichtigungen einschalten, Test senden", async ({ page }) => {
    await login(page);
    await tab(page, "Statistik");
    // Wie in der installierten App (https, Service Worker): Push ist möglich
    await page.evaluate(() => { window.pushMoeglich = () => true; window.isApp = () => true; render() });
    await expect(plan(page).getByRole("button", { name: "Auf dem Startbildschirm speichern" })).toHaveCount(0);
    await expect(plan(page).getByRole("button", { name: "Benachrichtigungen an mich senden" })).toBeVisible();
    await expect(plan(page).getByRole("button", { name: "Test-Benachrichtigung an mich senden" })).toHaveCount(0);
    await page.evaluate(() => { PUSH = true; render() });
    await expect(plan(page).getByRole("button", { name: "Benachrichtigungen ausschalten" })).toBeVisible();
    await expect(plan(page).getByRole("button", { name: "Test-Benachrichtigung an mich senden" })).toBeVisible();
    await expect(plan(page).locator("[data-test=push-status]")).toContainText("eingeschaltet");
  });

  test("Neuer Anlass, Organisieren, An- und Abmelden stossen die Push-Warteschlange an", async ({ page }) => {
    await login(page);
    const anstoesse = () => page.evaluate(() => window.__mg_anstoesse || 0);
    const ev = page.locator("article.ev", { hasText: "Chlaus-Magnum" });
    await ev.getByRole("button", { name: /Ich organisiere/ }).click();
    await expect(ev).toContainText("Organisation: Ot (du)");
    await expect.poll(anstoesse).toBe(1);
    const h = page.locator("article.ev", { hasText: "Herbst-Stamm" });
    await h.getByRole("button", { name: "Bin dabei" }).click();
    await expect.poll(anstoesse).toBe(2);
    await h.locator("[data-a=abmelden]").click();
    await page.locator("#sh").getByRole("button", { name: "Nur abmelden" }).click();
    await expect.poll(anstoesse).toBe(3);
    await page.getByRole("button", { name: "+ Anlass erfassen" }).click();
    await page.fill("[data-k=evTitle]", "Push-Probe");
    await page.locator("form[data-s=event] .btn").first().click();
    await expect(page.locator("#toast")).toContainText("Anlass erfasst");
    await expect.poll(anstoesse).toBe(4);
    await tab(page, "Statistik");
    await expect(plan(page)).toContainText("An- und Abmeldungen");
  });

  test("Scheitert die Aktion, wird nichts angestossen", async ({ page }) => {
    await login(page);
    // Abend ist schon vergeben: Organisieren ohne Rückfrage scheitert
    const r = await page.evaluate(() => pushAnstoss(sb.rpc("claim_organizer", { p_event: "e-1" })).then((x) => !!x.error));
    expect(r).toBe(true);
    expect(await page.evaluate(() => window.__mg_anstoesse || 0)).toBe(0);
  });

  test("Sommerzeit: 11 Uhr", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2027-06-01T08:00:00+02:00"));
    await login(page);
    await tab(page, "Statistik");
    await expect(plan(page)).toContainText("einmal am Tag um 11 Uhr");
  });
});
