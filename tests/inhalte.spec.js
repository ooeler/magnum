// Inhalte: Reisen, Löschen, Kasse, Prost-Wand, Fahrangebote und Fotos.
const fs = require("fs");
const path = require("path");
const { test, expect, login, tab, BEAT } = require("./fixtures");

const BILD = path.join(__dirname, "..", "app", "icon-192.png");
const PNG = fs.readFileSync(BILD);
const card = (page, label) => page.locator(`[aria-label="${label}"]`);
const event = (page, title) => page.locator("article.ev", { hasText: title });
const toast = (page) => page.locator("#toast");
const details = (page, title) => event(page, title).getByRole("button", { name: "Details" }).click();

test.describe("Reisen", () => {
  test("erfassen: gespeichert, Meldung auf der Prost-Wand", async ({ page }) => {
    await login(page);
    await tab(page, "Reisen");
    await page.getByRole("button", { name: "+ Reise erfassen" }).click();
    await page.fill("[data-k=trTitle]", "Elsass");
    await page.fill("[data-k=trFrom]", "2027-05-14");
    await page.fill("[data-k=trTo]", "2027-05-16");
    await page.fill("[data-k=trProg]", "Riesling, Flammkuchen");
    await page.fill("[data-k=trSeats]", "999");
    await page.click("form[data-s=trip] .btn.grow");
    await expect(page.locator("form[data-s=trip]"), "mehr als 50 Plätze lässt das Formular nicht zu").toBeVisible();
    await page.fill("[data-k=trSeats]", "30");
    await page.click("form[data-s=trip] .btn.grow");
    await expect(toast(page)).toContainText("Reise erfasst");
    await expect(page.locator(".trip", { hasText: "Elsass" })).toBeVisible();
    await expect(page.locator("form[data-s=trip]")).toHaveCount(0);
    const t = await page.evaluate(() => window.__mg.db().trips.find((x) => x.title == "Elsass"));
    expect(t).toMatchObject({ starts_on: "2027-05-14", ends_on: "2027-05-16", seats: 30, created_by: "u-ot" });
    await tab(page, "Termine");
    await expect(page.locator("body")).toContainText("hat die Reise nach Elsass eröffnet");
  });

  test("abbrechen verwirft das Formular", async ({ page }) => {
    await login(page);
    await tab(page, "Reisen");
    await page.getByRole("button", { name: "+ Reise erfassen" }).click();
    await page.locator("form[data-s=trip]").getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.locator("form[data-s=trip]")).toHaveCount(0);
  });

  test("abmelden und wieder mitreisen", async ({ page }) => {
    await login(page);
    await tab(page, "Reisen");
    await page.locator(".trip", { hasText: "Wallis" }).click();
    const b = page.locator("#ov [data-a=tripjoin]");
    await b.click();
    await expect(toast(page)).toContainText("Von Wallis abgemeldet");
    await expect(b).toContainText("Mitreisen");
    await b.click();
    await expect(toast(page)).toContainText("Dabei in Wallis");
    await expect(b).toContainText("Angemeldet");
  });

  test("Bilder hochladen zählt mit", async ({ page }) => {
    await login(page);
    await tab(page, "Reisen");
    await page.locator(".trip", { hasText: "Bordeaux" }).click();
    await page.locator("#ov input[data-c=tripphotos]").setInputFiles([{ name: "a.png", mimeType: "image/png", buffer: PNG }, { name: "b.png", mimeType: "image/png", buffer: PNG }]);
    await expect(toast(page)).toContainText("2 Bilder hochgeladen");
    await expect(page.locator("#ov")).toContainText("8 hochgeladen · 3 sichtbar");
  });
});

test.describe("Löschen", () => {
  test("Reise: Admin löscht, sie verschwindet", async ({ page }) => {
    await login(page);
    await tab(page, "Reisen");
    await page.locator(".trip", { hasText: "Wallis" }).click();
    await page.getByRole("button", { name: "Reise löschen" }).click();
    await expect(toast(page)).toContainText("Reise gelöscht");
    await expect(page.locator(".trip", { hasText: "Wallis" })).toHaveCount(0);
  });

  test("Anlass: Admin löscht, er verschwindet", async ({ page }) => {
    await login(page);
    await details(page, "Chlaus-Magnum");
    await page.getByRole("button", { name: "Anlass löschen" }).click();
    await expect(toast(page)).toContainText("Anlass gelöscht");
    await expect(event(page, "Chlaus-Magnum")).toHaveCount(0);
  });

  test("Abbrechen im Dialog löscht nichts", async ({ browser }) => {
    const { setup, login: anmelden } = require("./fixtures");
    const page = await (await browser.newContext()).newPage();
    await setup(page);
    page.removeAllListeners("dialog");
    page.on("dialog", (d) => d.dismiss());
    await anmelden(page);
    await details(page, "Chlaus-Magnum");
    await page.getByRole("button", { name: "Anlass löschen" }).click();
    expect(await page.evaluate(() => window.__mg.db().events.some((e) => e.title == "Chlaus-Magnum"))).toBe(true);
    await page.context().close();
  });

  test("Mitglieder löschen nichts Fremdes", async ({ page }) => {
    await login(page, BEAT);
    await details(page, "Chlaus-Magnum");
    await expect(page.getByRole("button", { name: "Anlass löschen" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await tab(page, "Reisen");
    await page.locator(".trip", { hasText: "Wallis" }).click();
    await expect(page.getByRole("button", { name: "Reise löschen" })).toHaveCount(0);
    const r = await page.evaluate(() => window.magnumDb.createClient().from("events").delete().eq("id", "e-2"));
    expect(r.error).toBeNull();
    expect(await page.evaluate(() => window.__mg.db().events.some((e) => e.id == "e-2"))).toBe(true);
  });

  test("eigene Karte löschen", async ({ page }) => {
    await login(page);
    await tab(page, "Karten");
    await page.getByRole("button", { name: /Sammelkarte erstellen/ }).click();
    await page.fill("[data-k=cdTitle]", "Kurz und schmerzlos");
    await page.locator("input[data-c=cardphoto]").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator("form[data-s=card]")).toContainText("Foto gewählt ✓");
    await page.getByRole("button", { name: "Karte erstellen" }).click();
    const k = page.locator(".kc", { hasText: "Kurz und schmerzlos" });
    await k.click();
    expect(await page.evaluate(() => window.__mg.db().cards.find((c) => c.title == "Kurz und schmerzlos").photo_path)).toBeTruthy();
    await page.getByRole("button", { name: "Karte löschen" }).click();
    await expect(toast(page)).toContainText("Karte gelöscht");
    await expect(k).toHaveCount(0);
  });
});

test.describe("Termine", () => {
  test("Admin öffnet die Magnum-Kasse", async ({ page }) => {
    await login(page);
    const k = card(page, "Magnum-Kasse");
    await expect(k.locator("[data-test=kasse]")).toHaveText("1 Magnum");
    await k.getByRole("button", { name: "Kasse öffnen (Admin)" }).click();
    await expect(toast(page)).toContainText("Kasse geöffnet. Prost!");
    await expect(k.locator("[data-test=kasse]")).toHaveText("0 Magnums");
    await expect(k.getByRole("button", { name: "Kasse öffnen (Admin)" })).toHaveCount(0);
  });

  test("Mitglieder öffnen die Kasse nicht", async ({ page }) => {
    await login(page, BEAT);
    await expect(card(page, "Magnum-Kasse").getByRole("button", { name: "Kasse öffnen (Admin)" })).toHaveCount(0);
    const r = await page.evaluate(() => window.magnumDb.createClient().rpc("open_magnum_kasse"));
    expect(r.error.message).toContain("Nur der Administrator");
  });

  test("Nächster Spruch", async ({ page }) => {
    await login(page);
    const box = page.locator("section, div", { has: page.locator("> [data-a=spnext]") }).last();
    const vorher = await box.textContent();
    await page.locator("[data-a=spnext]").click();
    await expect.poll(() => page.locator("body").textContent()).not.toContain(vorher);
  });

  test("Prost-Wand: anstossen und zurücknehmen", async ({ page }) => {
    await login(page);
    const b = page.locator("[data-a=pprost][data-id=po-2]");
    await expect(b).toHaveText("Prost 1");
    await b.click();
    await expect(b).toHaveText("Prost 2");
    await expect(b).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(300); // der Live-Sync zeichnet neu: sonst trifft der Klick einen ersetzten Knopf
    await b.click();
    await expect(b).toHaveText("Prost 1");
    await expect(b).toHaveAttribute("aria-pressed", "false");
  });

  test("Escape schliesst die Details", async ({ page }) => {
    await login(page);
    await details(page, "Herbst-Stamm");
    await expect(page.locator("#ov")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ov")).toHaveCount(0);
  });
});

test.describe("Fahrservice", () => {
  test("Fahrt anbieten und zurückziehen", async ({ page }) => {
    await login(page);
    await details(page, "Herbst-Stamm");
    const r = card(page, "Heimweg · Fahrservice");
    await r.getByRole("button", { name: "Ich fahre · Plätze anbieten" }).click();
    await page.fill("[data-k=rdDir]", "Richtung Gossau");
    await page.fill("[data-k=rdSeats]", "4");
    await r.locator("form[data-s=ride] button:not([type=button])").click();
    await expect(toast(page)).toContainText("Du bist als Fahrer eingetragen");
    await expect(r).toContainText("Richtung Gossau");
    expect(await page.evaluate(() => window.__mg.db().rides.find((x) => x.driver_id == "u-ot").seats)).toBe(4);
    await r.getByRole("button", { name: "Zurückziehen" }).click();
    await expect(toast(page)).toContainText("Angebot zurückgezogen");
    await expect(r).not.toContainText("Richtung Gossau");
  });

  test("Mitfahrt absagen", async ({ page }) => {
    await login(page);
    await details(page, "Herbst-Stamm");
    const r = card(page, "Heimweg · Fahrservice");
    await r.getByRole("button", { name: "Mitfahren" }).click();
    await r.getByRole("button", { name: "Mitfahrt absagen" }).click();
    await expect(toast(page)).toContainText("Mitfahrt abgesagt");
    await expect(r.getByRole("button", { name: "Mitfahren" })).toBeVisible();
  });
});

test.describe("Beiz erfassen", () => {
  const offen = async (page) => {
    await login(page);
    await tab(page, "Statistik");
    await page.getByRole("button", { name: /Beiz erfassen/ }).click();
  };

  test("Quittung auswählen", async ({ page }) => {
    await offen(page);
    await page.locator("input[data-c=receipt]").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator("form[data-s=visit]")).toContainText("Quittung gewählt ✓");
  });

  test("Standort übernehmen", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: (ok) => ok({ coords: { latitude: 47.4, longitude: 9.4 } }) } }));
    await offen(page);
    await page.getByRole("button", { name: /Standort/ }).click();
    await expect(page.getByRole("button", { name: "Standort übernommen ✓" })).toBeVisible();
  });

  test("Standort verweigert wird gemeldet", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: (ok, nein) => nein({}) } }));
    await offen(page);
    await page.getByRole("button", { name: /Standort/ }).click();
    await expect(toast(page)).toContainText("Standort nicht freigegeben");
  });
});
