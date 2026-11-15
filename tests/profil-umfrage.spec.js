// Profil oben rechts, Wischen durch Profile und Karten, Kartentext nach Tipp, Flasche am Magnum-Abend,
// Design-Umfrage, Beiz-Standort nachträglich.
const base = require("@playwright/test");
const { test, expect, login, tab, profil, BEAT } = require("./fixtures");

function wisch(page, sel, x1, x2) {
  return page.evaluate(([sel, x1, x2]) => {
    const el = document.querySelector(sel);
    const tp = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 });
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [tp(x1)], changedTouches: [tp(x1)] }));
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [tp(x2)] }));
  }, [sel, x1, x2]);
}

test.describe("Profil oben rechts", () => {
  test("Profil ansehen, bearbeiten, abmelden; Admin wählt die Ansicht", async ({ page }) => {
    await login(page);
    await expect(page.locator("header .kopf")).toHaveText("O");
    await profil(page);
    const ov = page.locator("#ov");
    await expect(ov).toContainText("Trinkfestigkeit");                  // wie unter Club
    await expect(ov.locator("[data-s=profile]")).toHaveCount(0);
    await ov.getByRole("button", { name: "Bearbeiten" }).click();
    await expect(ov.locator("[data-k=pfName]")).toHaveValue("Ot");
    await expect(ov.getByRole("button", { name: "Abmelden" })).toBeVisible();
    const ansicht = ov.locator("[aria-label=Ansicht]");
    await expect(ansicht.getByRole("button", { name: "Administrator" })).toHaveAttribute("aria-pressed", "true");
    await ansicht.getByRole("button", { name: "Mitglied" }).click();
    await expect(page.locator("[data-test=sicht]")).toBeVisible();
    await expect(ansicht.getByRole("button", { name: "Mitglied" })).toHaveAttribute("aria-pressed", "true");
    await ansicht.getByRole("button", { name: "Administrator" }).click();
    await expect(page.locator("[data-test=sicht]")).toHaveCount(0);
  });

  test("Mitglieder sehen keinen Ansicht-Schalter; im Club kein Profil-Formular mehr", async ({ page }) => {
    await login(page, BEAT);
    await tab(page, "Club");
    await expect(page.locator("main [data-s=profile]")).toHaveCount(0);
    await page.getByRole("button", { name: "Mein Profil ansehen und bearbeiten" }).click();
    await expect(page.locator("#ov [aria-label=Ansicht]")).toHaveCount(0);
    await expect(page.locator("#ov")).toContainText("Mein Profil");
  });
});

test.describe("Wischen in Profilen und Karten", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name == "iphone", "new Touch in WebKit nicht möglich"));

  test("Profile: nach links die nächste Person wie in der Mitgliederliste", async ({ page }) => {
    await login(page);
    await tab(page, "Club");
    await page.locator(".mem", { hasText: "Beat" }).click();
    await expect(page.locator("#ov .top")).toContainText("Beat");
    await wisch(page, "#ov main", 300, 100);
    await expect(page.locator("#ov .top")).toContainText("Chris");
    await wisch(page, "#ov main", 100, 300);
    await expect(page.locator("#ov .top")).toContainText("Beat");
  });

  test("Karten: blättern, gesperrte überspringen, Text wieder zu", async ({ page }) => {
    await login(page);
    await tab(page, "Karten");
    const titel = await page.evaluate(() => allCards().filter((c) => !c.locked).map((c) => c.title));
    await page.locator(".kc:not(.lock)").first().click();
    await expect(page.locator("#ov")).toContainText(titel[0]);
    await page.locator("#ov .flip").click();
    await expect(page.locator("#ov .flip")).toHaveClass(/gedreht/);
    await wisch(page, "#ov main", 300, 100);
    await expect(page.locator("#ov")).toContainText(titel[1]);
    await expect(page.locator("#ov .flip")).not.toHaveClass(/gedreht/);
  });
});

test.describe("Flasche oben rechts", () => {
  test("am Magnum-Abend voll, am Tag danach leer", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-07T21:00:00+01:00"));
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.events.push({ id: "e-heute", title: "November-Magnum", starts_at: "2026-11-07T18:00:00Z", location: null, organizer_id: null, created_by: "u-ot", created_at: "2026-10-01T10:00:00Z" }); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page);
    await expect(page.locator("header .flasche")).toHaveAttribute("data-fuellung", "100");
    await page.clock.setFixedTime(new Date("2026-11-08T09:00:00+01:00"));
    await page.reload();
    await expect(page.locator("header .flasche")).toHaveAttribute("data-fuellung", /^[0-9]$/);   // seit Mitternacht leer, füllt sich wieder
  });
});

test.describe("Design-Umfrage", () => {
  test("einmal beim Öffnen: Schieber, unter 8 ein Textfeld, Ergebnis für den Admin", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.design_umfrage = d.design_umfrage.filter((x) => x.member_id != "u-ot"); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page);
    const sh = page.locator("#sh");
    await expect(sh).toContainText("Wie gefällt dir das Design?");
    const schieber = sh.locator("input[type=range]");
    await schieber.fill("9");
    await expect(sh.locator("[data-wert=umWert]")).toHaveText("9");
    await expect(sh.locator("[data-unter8]")).toBeHidden();
    await schieber.fill("5");
    await expect(sh.locator("[data-unter8]")).toBeVisible();
    await sh.locator("[data-k=umText]").fill("Grössere Schrift");
    await sh.getByRole("button", { name: "Senden" }).click();
    await expect(page.locator("#toast")).toContainText("Danke für deine Meinung");
    await expect(sh).toHaveCount(0);
    await page.reload();
    await expect(page.locator("header h1")).toHaveText("Magnum");
    await expect(page.locator("#sh")).toHaveCount(0);
    await tab(page, "Club");
    await expect(page.locator("[data-test=umfrage-ergebnis]")).toContainText("Ø 6,3 von 10 · 3 Antworten");
    await expect(page.locator("[data-test=umfrage-ergebnis]")).toContainText("Grössere Schrift");
  });

  test("«Später» fragt beim nächsten Öffnen wieder; Mitglieder sehen keine Ergebnisse", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.design_umfrage = d.design_umfrage.filter((x) => x.member_id != "u-beat"); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page, BEAT);
    await page.locator("#sh").getByRole("button", { name: "Später" }).click();
    await expect(page.locator("#sh")).toHaveCount(0);
    await page.reload();
    await expect(page.locator("#sh")).toContainText("Wie gefällt dir das Design?");
    await page.locator("#sh").getByRole("button", { name: "Später" }).click();
    await tab(page, "Club");
    await expect(page.locator("[data-test=umfrage-ergebnis]")).toHaveCount(0);
    expect(await page.evaluate(() => D.design_umfrage.length)).toBe(0);
  });
});

test.describe("Beiz ohne Standort", () => {
  test("«Hier bin ich» setzt den Standort, danach erscheint sie auf der Karte", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 47.415, longitude: 9.25 });
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.restaurants.forEach((r) => { r.lat = null; r.lng = null }); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page);
    await tab(page, "Statistik");
    await expect(page.locator("[aria-label='Karte der Beizen']")).toContainText("Noch keine Beiz mit Standort");
    await page.locator("[data-a=ov][data-t=resto]").first().click();
    await page.locator("#ov [aria-label=Standort]").getByRole("button", { name: "Hier bin ich" }).click();
    await expect(page.locator("#toast")).toContainText("Standort gespeichert");
    await expect(page.locator("#ov [aria-label=Standort]")).toHaveCount(0);
    await page.locator("#ov .back").click();
    await expect(page.locator("#beizkarte")).toBeVisible();
  });
});

base.test("Magnum-Abend: Stunde in Zürich (immer 18 Uhr, Sommer wie Winter)", async () => {
  const P = await import("../functions/push.mjs");
  base.expect(P.stundeZuerich("2026-12-01T17:00:00Z")).toBe(18);   // Winter: 17 Uhr UTC
  base.expect(P.stundeZuerich("2026-12-01T16:00:00Z")).toBe(17);
  base.expect(P.stundeZuerich("2026-07-01T16:00:00Z")).toBe(18);   // Sommer: 16 Uhr UTC
  base.expect(P.stundeZuerich("2026-07-01T17:00:00Z")).toBe(19);
});

base.test("Am 3. des Monats: Text je nach Anmeldung und Organisator", async () => {
  const P = await import("../functions/push.mjs");
  base.expect(P.monatsNachricht("November-Magnum", 24, false, false)).toEqual({ titel: "Nur noch 24 Tage bis zum November-Magnum", text: "Melde dich an! Organisiere den Abend, noch niemand ist eingetragen." });
  base.expect(P.monatsNachricht("November-Magnum", 24, true, false).text).toBe("Organisiere den Abend, noch niemand ist eingetragen.");
  base.expect(P.monatsNachricht("November-Magnum", 24, false, true).text).toBe("Melde dich an!");
  base.expect(P.monatsNachricht("November-Magnum", 24, true, true).text).toBe("Du bist angemeldet. Bis bald! 🍷");
  base.expect(P.monatsNachricht("November-Magnum", 1, true, true).titel).toBe("Morgen ist November-Magnum");
});

test.describe("Schalter Admin- / Mitglied-Ansicht", () => {
  test("bleibt für Admins in beiden Ansichten, auch über offenen Fenstern, bis ✕; Ansichtswechsel holt ihn zurück", async ({ page }) => {
    await login(page);
    await expect(page.locator("[data-test=sicht-admin]")).toBeVisible();          // Admin-Ansicht: Schalter da
    await page.locator("[data-a=ov][data-t=event]").first().click();
    await page.getByRole("button", { name: "App als Mitglied ansehen" }).click(); // im offenen Fenster umschalten
    await expect(page.locator("[data-test=sicht]")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.locator("[data-test=sicht]")).toBeVisible();                // bleibt nach dem Neuladen
    await page.getByRole("button", { name: "Schalter ausblenden" }).click();
    await expect(page.locator(".sicht")).toHaveCount(0);
    await page.reload();
    await expect(page.locator("header h1")).toHaveText("Magnum");
    await expect(page.locator(".sicht")).toHaveCount(0);                          // ausgeblendet bleibt ausgeblendet
    await profil(page);
    await page.locator("#ov [aria-label=Ansicht]").getByRole("button", { name: "Administrator" }).click();
    await expect(page.locator("[data-test=sicht-admin]")).toBeVisible();          // Wechsel im Profil holt ihn zurück
  });
  test("Mitglieder sehen keinen Schalter", async ({ page }) => {
    await login(page, BEAT);
    await expect(page.locator(".sicht")).toHaveCount(0);
  });
});
