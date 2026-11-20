// Visuelle Regressionstests: Screenshot-Vergleich der wichtigsten Ansichten je Gerät (desktop, android, iphone).
// Fangen Layoutbrüche nach Paket-Updates (Dependabot, Playwright, Leaflet …) ab, die die Funktionstests nicht sehen.
//
// Referenzbilder liegen in tests/visuell.spec.js-snapshots/ als <name>-<gerät>-linux.png und entstehen auf Linux,
// genau wie in der CI (ubuntu-latest). Aktualisieren nach einer gewollten Design-Änderung: GitHub-Workflow
// «Visuelle Referenzbilder» (visuell-referenz.yml) für den eigenen Branch starten, er committet die neuen Bilder.
//
// Warum unter Windows/macOS übersprungen: Schriftglättung und Systemschriften unterscheiden sich je Betriebssystem,
// Bilder von Windows würden in der CI nie passen (und umgekehrt). Statt zweier Bildsätze, die auseinanderlaufen,
// gibt es nur Linux-Referenzen; lokal läuft der Test nur mit VISUELL=1 (erzeugt dann *-win32.png zum Anschauen,
// die per .gitignore nicht eingecheckt werden). In der CI (Linux) läuft er immer mit und blockiert den Merge.
const { test, expect, login, tab, profil } = require("./fixtures");

test.skip(process.platform != "linux" && !process.env.VISUELL, "Referenzbilder gibt es nur für Linux (CI), lokal mit VISUELL=1");

// Keine Bewegung: Saison-Effekte (31.10. = Halloween-Emojis), Kartendrehen und Wischübergänge stehen still
test.use({ reducedMotion: "reduce" });

// Wechselnde oder zeitabhängige Inhalte werden abgedeckt, damit nur echte Layoutänderungen auffallen
function masken(page) {
  return [
    page.locator("header .hello"),                              // Begrüssung je Uhrzeit, Wochentag und Person
    page.locator("header .flasche"),                            // Füllstand bis zum nächsten Magnum-Abend
    page.locator("[aria-label='Spruch des Tages']"),            // wechselt täglich und mit den Prosts
    page.locator("[aria-label='Karte der Woche']"),             // wechselt wöchentlich
    page.locator("#beizkarte"),                                 // Leaflet mit OpenStreetMap-Kacheln aus dem Netz
  ];
}
// Offenes Fenster (#ov) deckt die Seite ganz ab: Masken der Seite dahinter würden sonst über dem Fenster liegen
const OFFEN = { mask: [] };

// Moderate Toleranz: Kantenglättung darf abweichen, verschobene Blöcke oder fehlende Elemente nicht
async function bild(page, name, opt = {}) {
  // Gemeldete Hinweise (Toast) verschwinden nach 3,5 s, je nach Tempo des Runners sind sie noch da
  await page.addStyleTag({ content: "#toast{visibility:hidden!important}" });
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(name + ".png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.01,
    mask: masken(page),
    ...opt,
  });
}

test.beforeEach(async ({ page }) => {
  // Hinweise, die sich der Browser merkt, immer gleich: kein «Als App»-Banner, kein schwebender Ansicht-Schalter
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mg_als_app_zu", "1");
      localStorage.setItem("mg_sicht_zu", "1");
      localStorage.setItem("mg_als_mitglied", "0");
      localStorage.setItem("mg_push", "0");
      localStorage.removeItem("mg_fb_dank");
    } catch (e) {}
  });
  // Kartenkacheln nie aus dem Netz laden (abgedeckt, aber so bleibt der Test offline und schnell)
  await page.route(/tile\.openstreetmap\.org/, (r) => r.abort());
});

test("Anmeldung", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#login input[name=email]")).toBeVisible();
  await bild(page, "login");
});

for (const [name, datei, sub] of [["Termine", "termine", "Anlässe & Abend"], ["Reisen", "reisen", "Unterwegs"], ["Club", "club", "Rangliste & Mitglieder"], ["Karten", "karten", "Sammlung"], ["Statistik", "statistik", "Zahlen & Beizen"]]) {
  test(`Tab ${name}`, async ({ page }) => {
    if (datei == "statistik") {
      // Eine Beiz mit Standort, damit die Leaflet-Karte (abgedeckt) mit ihrer Grösse im Bild ist
      await page.goto("/");
      await page.evaluate(() => { const d = window.__mg.db(); Object.assign(d.restaurants[0], { lat: 47.42, lng: 9.37 }); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    }
    await login(page);
    await tab(page, name);
    await expect(page.locator("header .sub")).toHaveText(sub);
    if (datei == "statistik") await expect(page.locator("#beizkarte.leaflet-container")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    // Oberer Teil wie auf dem Gerät, mit der Navigation unten
    await bild(page, "tab-" + datei + "-oben");
    // Ganze Seite: die fixierte Navigation läge sonst mitten im Bild über dem Inhalt
    await page.addStyleTag({ content: "nav{visibility:hidden!important}" });
    await bild(page, "tab-" + datei, { fullPage: true });
  });
}

test("Anlass geöffnet", async ({ page }) => {
  await login(page);
  await tab(page, "Termine");
  await page.locator("article.ev").first().locator(".dt").click();
  await expect(page.locator("#ov")).toBeVisible();
  await bild(page, "anlass", OFFEN);
});

// Hinweis iphone: Das WebKit von Playwright beachtet backface-visibility im Screenshot nicht, «karte-vorne» zeigt
// dort die gespiegelte Rückseite. Das Bild bleibt trotzdem stabil und fängt Layoutänderungen der Karte ab.
test("Karte geöffnet: Vorder- und Rückseite", async ({ page }) => {
  await login(page);
  await tab(page, "Karten");
  await page.locator(".kc:not(.lock)").first().click();
  const flip = page.locator("#ov .flip");
  await expect(flip).toBeVisible();
  await bild(page, "karte-vorne", OFFEN);
  await flip.click();
  await expect(flip).toHaveClass(/gedreht/);
  await bild(page, "karte-hinten", OFFEN);
});

test("Profil", async ({ page }) => {
  await login(page);
  await profil(page);
  await expect(page.locator("#ov")).toContainText("Trinkfestigkeit");
  await bild(page, "profil", OFFEN);
});

test("Design-Umfrage", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { const d = window.__mg.db(); d.design_umfrage = d.design_umfrage.filter((x) => x.member_id != "u-ot"); localStorage.setItem("__mg_db", JSON.stringify(d)) });
  await login(page);
  await expect(page.locator("#sh")).toContainText("Wie gefällt dir das Design?");
  await bild(page, "umfrage");
});
