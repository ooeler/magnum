// Karten liken: statt Daumen ein volles Weinglas. Pro Person und Karte ein Glas, wieder zurücknehmbar.
const { test, expect, login, tab, as, BEAT } = require("./fixtures");

const glas = (page) => page.locator("#ov button.glas");
const toast = (page) => page.locator("#toast");

test.describe("Volle Gläser für Karten", () => {
  test("Sammelkarte: Glas geben, Zahl und Namen, auf der Kachel sichtbar, wieder zurücknehmen", async ({ page }) => {
    await login(page);
    await tab(page, "Karten");
    await page.locator(".kc", { hasText: "Die 6-Liter-Nacht" }).click();
    await expect(glas(page)).toHaveAttribute("aria-pressed", "false");
    await expect(glas(page)).toContainText("0");
    await glas(page).click();
    await expect(toast(page)).toContainText("volles Glas");
    await expect(glas(page)).toHaveAttribute("aria-pressed", "true");
    await expect(glas(page)).toContainText("1 volles Glas");
    await expect(page.locator("[data-test=glas-von]")).toHaveText("Prost von Ot");
    // Beat gibt auch eins
    await as(page, BEAT.email, "sb.from('karten_glaeser').insert({ karte: 'karte-c-1', member_id: 'u-beat' })");
    await expect(glas(page)).toContainText("2 volle Gläser");
    await expect(page.locator("[data-test=glas-von]")).toContainText("Beat");
    await page.locator("#ov .back").click();
    await expect(page.locator(".kc", { hasText: "Die 6-Liter-Nacht" }).locator("[data-test=glaeser]")).toHaveAttribute("aria-label", "2 volle Gläser");
    // Zurücknehmen
    await page.locator(".kc", { hasText: "Die 6-Liter-Nacht" }).click();
    await glas(page).click();
    await expect(glas(page)).toHaveAttribute("aria-pressed", "false");
    await expect(glas(page)).toContainText("1 volles Glas");
  });

  test("4 volle Gläser geben eine Flasche", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const d = window.__mg.db();
      ["u-beat", "u-chris", "u-dani", "u-erich", "u-fritz", "u-gabi", "u-hans", "u-ivo", "u-jurg"].forEach((m) => d.karten_glaeser.push({ karte: "karte-c-1", member_id: m, created_at: new Date().toISOString() }));
      ["u-beat", "u-chris", "u-dani", "u-erich"].forEach((m) => d.karten_glaeser.push({ karte: "karte-c-2", member_id: m, created_at: new Date().toISOString() }));
      localStorage.setItem("__mg_db", JSON.stringify(d));
    });
    await login(page);
    await tab(page, "Karten");
    const k1 = page.locator(".kc", { hasText: "Die 6-Liter-Nacht" }), k2 = page.locator(".kc", { hasText: "Sonnenaufgang im Rebberg" });
    await expect(k1.locator("[data-test=glaeser]")).toHaveAttribute("aria-label", "2 Flaschen und 1 volles Glas");
    await expect(k1.locator("[data-test=flaschen]")).toHaveText("2");
    await expect(k2.locator("[data-test=glaeser]")).toHaveAttribute("aria-label", "1 Flasche");
    await k1.click();
    await expect(page.locator("[data-test=glas-menge]")).toHaveText("2 Flaschen und 1 volles Glas");
    await glas(page).click();                               // das zehnte Glas
    await expect(page.locator("[data-test=glas-menge]")).toHaveText("2 Flaschen und 2 volle Gläser");
    await expect(page.locator("[data-test=regal] svg")).toHaveCount(4);    // 2 Flaschen + 2 Gläser
  });

  test("Nur ein Glas pro Person, nicht im Namen anderer, nicht für erfundene Karten", async ({ page }) => {
    await page.goto("/");
    await as(page, BEAT.email, "sb.from('karten_glaeser').insert({ karte: 'karte-c-2', member_id: 'u-beat' })");
    const zweimal = await as(page, BEAT.email, "sb.from('karten_glaeser').insert({ karte: 'karte-c-2', member_id: 'u-beat' })");
    expect(zweimal.error).toBeTruthy();
    const fremd = await as(page, BEAT.email, "sb.from('karten_glaeser').insert({ karte: 'karte-c-2', member_id: 'u-chris' })");
    expect(fremd.error).toBeTruthy();
    const erfunden = await as(page, BEAT.email, "sb.from('karten_glaeser').insert({ karte: 'karte-gibtsnicht', member_id: 'u-beat' })");
    expect(erfunden.error.message).toContain("gibt es nicht");
    expect(await page.evaluate(() => window.__mg.db().karten_glaeser.length)).toBe(1);
  });

  test("Gelöschte Karte nimmt ihre Gläser mit", async ({ page }) => {
    await page.goto("/");
    await as(page, BEAT.email, "sb.from('karten_glaeser').insert({ karte: 'karte-c-3', member_id: 'u-beat' })");
    await as(page, BEAT.email, "sb.from('cards').delete().eq('id', 'c-3')");
    expect(await page.evaluate(() => window.__mg.db().karten_glaeser.length)).toBe(0);
  });

  test("Geheime Karten haben kein Glas", async ({ page }) => {
    await login(page);
    await tab(page, "Karten");
    await page.getByRole("button", { name: "Geheim", exact: true }).click();
    const offen = page.locator(".kc:not(.lock)").first();
    if (await offen.count()) { await offen.click(); await expect(glas(page)).toHaveCount(0) }
    await expect(page.locator(".kc [data-test=glaeser]")).toHaveCount(0);
  });

  test("Videokarte: Glas nach dem Ziehen, verdeckte Karten bekommen keins", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const d = window.__mg.db(), jetzt = Date.now();
      d.events.push({ id: "e-jetzt", title: "Oktober-Magnum", starts_at: new Date(jetzt - 3600e3).toISOString(), location: "Pinte", organizer_id: null, created_by: "u-ot", created_at: new Date(jetzt - 864e5).toISOString() });
      d.rsvps.push({ event_id: "e-jetzt", member_id: "u-beat", status: "in", redeemed: false, updated_at: new Date(jetzt - 864e5).toISOString() });
      d.video_karten.push({ id: "v-1", title: "Korken knallt", path: "videos/u-ot/1.webm", created_by: "u-ot", created_at: new Date(jetzt - 5e6).toISOString() });
      localStorage.setItem("__mg_db", JSON.stringify(d));
    });
    const vorher = await as(page, BEAT.email, "sb.from('karten_glaeser').insert({ karte: 'video-v-1', member_id: 'u-beat' })");
    expect(vorher.error.message).toContain("gibt es nicht");
    await login(page, BEAT);
    await page.locator("[aria-label='Karte ziehen']").getByRole("button", { name: "Karte ziehen" }).click();
    await expect(page.locator("#ov video")).toHaveCount(1);
    await glas(page).click();
    await expect(glas(page)).toHaveAttribute("aria-pressed", "true");
    await page.locator("#ov .back").click();
    await tab(page, "Karten");
    await expect(page.locator("[aria-label=Videokarten] .kc [data-test=glaeser]")).toHaveText("1");
  });
});

test.describe("Karte: Wink zum Umdrehen", () => {
  test("beim Öffnen kippt die Karte kurz an, nach dem Drehen nicht mehr; bei «Bewegung reduzieren» ohne Animation", async ({ page }) => {
    await login(page);
    await tab(page, "Karten");
    await page.locator(".kc", { hasText: "Die 6-Liter-Nacht" }).click();
    const flip = page.locator("#ov .flip");
    await expect(flip).toHaveClass(/wink/);
    // unter Last kann das Neuzeichnen kurz dazwischenkommen: abwarten statt einmal messen
    await expect.poll(() => flip.locator(".innen").evaluate((el) => getComputedStyle(el).animationName), { timeout: 2000 }).toBe("wink");
    await flip.click();
    await expect(flip).not.toHaveClass(/wink/);
    await expect(flip).toHaveClass(/gedreht/);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#ov .back").click();
    await page.locator(".kc", { hasText: "Die 6-Liter-Nacht" }).click();
    await expect(page.locator("#ov .flip")).not.toHaveClass(/gedreht/);       // wieder geöffnet: Vorderseite
    await expect(page.locator("#ov .flip")).toHaveClass(/wink/);
    expect(await page.locator("#ov .flip .innen").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });
});
