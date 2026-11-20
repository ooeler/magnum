// Visuelle Regressionstests: Screenshot-Vergleich der wichtigsten Ansichten, Basis-Stand gegen neuen Stand.
// Sollen verhindern, dass Paket-Updates (Dependabot) unbemerkt optische Brüche live bringen.
//
// Keine Referenzbilder im Repo: scripts/visuell.sh baut zuerst den Basis-Stand (z. B. main), erzeugt daraus mit
// --update-snapshots die Referenzbilder in einem temporären Ordner (VISUELL_BILDER) und vergleicht dann den
// neuen Stand damit. Beide Durchläufe nutzen diese Datei, den Nachbau (mock-neon.js), dieselbe Playwright-Version
// und denselben Rechner. Nur die gebaute App wechselt. Darum passen die Bilder auch unter Windows zueinander.
//
// Läuft nur mit VISUELL=1 (playwright.config.js), nicht im normalen `npm test`.
// Lokal: bash scripts/visuell.sh [basis-ref] --project=android --project=desktop --workers=2
//
// Hinweis: Die App hat nur ein (dunkles) Design und reagiert nicht auf prefers-color-scheme,
// darum gibt es keine Variante hell/dunkel.
const { test, expect, login, tab, profil, OT, BEAT } = require("./fixtures");

// Keine Bewegung: Saison-Effekte (31.10. = Halloween), Karten-Wink und Wischübergänge stehen still
test.use({ reducedMotion: "reduce" });

// Ruhig stellen: Hinweise (Toast), Animationen und Übergänge (auch der Wink beim Öffnen einer Karte), Cursor
const RUHE = "#toast{visibility:hidden!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";

// Nur Inhalte aus dem Netz werden abgedeckt. Alles Zeitabhängige ist durch die feste Uhr (fixtures.js) und den
// festen Zufall (unten) in beiden Durchläufen gleich und wird darum mitverglichen.
function masken(page) {
  return [page.locator("#beizkarte")]; // Leaflet mit OpenStreetMap-Kacheln (blockiert)
}
// Offenes Fenster (#ov) deckt die Seite ganz ab: Masken der Seite dahinter lägen sonst über dem Fenster
const OFFEN = { mask: [] };
// Offenes Fenster ganz: #ov scrollt in sich, darum für das Bild in den Seitenfluss legen und die Seite dahinter ausblenden
const GANZ = { mask: [], fullPage: true, stil: "#app>:not(#ov){display:none!important}#ov{position:absolute!important;bottom:auto!important;overflow:visible!important;min-height:100vh}" };

// Kleine Toleranz: Kantenglättung darf minimal abweichen, verschobene Blöcke oder andere Farben nicht
async function bild(page, name, { stil, ...opt } = {}) {
  await page.addStyleTag({ content: RUHE + (stil || "") });
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(name + ".png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.002,
    mask: masken(page),
    timeout: 15000,
    ...opt,
  });
}

// Testdaten für Abstimmungen: Spitzname für Dani (unterstützt, Abstimmung offen) und Sacceri auf der Reise Wallis
async function mitAbstimmungen(page) {
  await page.goto("/");
  await page.evaluate(() => {
    const d = window.__mg.db(), t = "2026-10-30T18:00:00.000Z";
    d.proposals.push(
      { id: "p-nick", kind: "nickname", target_id: "u-dani", trip_id: null, value: "Kellerratte", proposed_by: "u-chris", seconded_by: "u-erich", status: "open", yes_weight: 0, total_weight: 0, created_at: t, decided_at: null },
      { id: "p-sac", kind: "sacceri", target_id: "u-chris", trip_id: "t-wallis", value: null, proposed_by: "u-dani", seconded_by: null, status: "open", yes_weight: 0, total_weight: 0, created_at: t, decided_at: null });
    d.ballots.push({ proposal_id: "p-nick", voter_id: "u-chris", vote: true, created_at: t }, { proposal_id: "p-nick", voter_id: "u-erich", vote: true, created_at: t },
      { proposal_id: "p-sac", voter_id: "u-dani", vote: true, created_at: t });
    // Eine Beiz mit Standort, damit die Leaflet-Karte (abgedeckt) mit ihrer Grösse im Bild ist
    Object.assign(d.restaurants[0], { lat: 47.42, lng: 9.37 });
    localStorage.setItem("__mg_db", JSON.stringify(d));
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Fester Zufall: Saisoneffekte, Positionen und Auswahl sind in beiden Durchläufen gleich
    let s = 42;
    Math.random = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 };
    // Hinweise, die sich der Browser merkt, immer gleich: kein «Als App»-Banner, kein schwebender Ansicht-Schalter
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

test.describe("Öffentlich", () => {
  test("Anmeldung und Passwort vergessen", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#login input[name=email]")).toBeVisible();
    await bild(page, "login");
    await page.getByRole("button", { name: "Passwort vergessen?" }).click();
    await expect(page.getByText("Link schicken")).toBeVisible();
    await bild(page, "passwort-vergessen");
  });
});

const TABS = [["Termine", "termine", "Anlässe & Abend"], ["Reisen", "reisen", "Unterwegs"], ["Club", "club", "Rangliste & Mitglieder"], ["Karten", "karten", "Sammlung"], ["Statistik", "statistik", "Zahlen & Beizen"]];

for (const [rolle, konto] of [["mitglied", BEAT], ["admin", OT]]) {
  test.describe(rolle == "admin" ? "Admin" : "Mitglied", () => {
    for (const [name, datei, sub] of TABS) {
      test(`Reiter ${name}`, async ({ page }) => {
        await mitAbstimmungen(page);
        await login(page, konto);
        await tab(page, name);
        await expect(page.locator("header .sub")).toHaveText(sub);
        if (datei == "statistik") await expect(page.locator("#beizkarte.leaflet-container")).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, 0));
        // Oberer Teil wie auf dem Gerät, mit der Navigation unten
        await bild(page, `${rolle}-${datei}-oben`);
        // Ganze Seite: die fixierte Navigation läge sonst mitten im Bild über dem Inhalt
        await page.addStyleTag({ content: "nav{visibility:hidden!important}" });
        await bild(page, `${rolle}-${datei}`, { fullPage: true });
      });
    }

    test("Profil und Einstellungen", async ({ page }) => {
      await login(page, konto);
      await profil(page);
      await expect(page.locator("#ov")).toContainText("Trinkfestigkeit");
      await bild(page, `${rolle}-profil`, GANZ);
    });

    test("Abstimmung Spitzname", async ({ page }) => {
      await mitAbstimmungen(page);
      await login(page, konto);
      await tab(page, "Club");
      await page.locator("[data-a=ov][data-t=member][data-id=u-dani]").first().click();
      await expect(page.locator("#ov [data-test=nickstatus]")).toContainText("Kellerratte");
      await bild(page, `${rolle}-abstimmung-spitzname`, GANZ);
    });
  });
}

test.describe("Mitglied", () => {
  test("Anlass geöffnet", async ({ page }) => {
    await login(page, BEAT);
    await tab(page, "Termine");
    await page.locator("article.ev").first().locator(".dt").click();
    await expect(page.locator("#ov")).toBeVisible();
    await bild(page, "mitglied-anlass", OFFEN);
  });

  // Hinweis iphone: Das WebKit von Playwright beachtet backface-visibility im Screenshot nicht, «karte-vorne» zeigt
  // dort die gespiegelte Rückseite. Das Bild bleibt trotzdem vergleichbar.
  test("Karte geöffnet: Vorder- und Rückseite", async ({ page }) => {
    await login(page, BEAT);
    await tab(page, "Karten");
    await page.locator(".kc:not(.lock)").first().click();
    const flip = page.locator("#ov .flip");
    await expect(flip).toBeVisible();
    await bild(page, "mitglied-karte-vorne", OFFEN);
    await flip.click();
    await expect(flip).toHaveClass(/gedreht/);
    await bild(page, "mitglied-karte-hinten", OFFEN);
  });

  test("Abstimmung Sacceri auf einer Reise", async ({ page }) => {
    await mitAbstimmungen(page);
    await login(page, BEAT);
    await tab(page, "Reisen");
    await page.locator("[data-a=ov][data-t=trip][data-id=t-wallis]").first().click();
    await expect(page.locator("#ov [data-test=tally]")).toBeVisible();
    await bild(page, "mitglied-abstimmung-sacceri", GANZ);
  });

  test("Design-Umfrage", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.design_umfrage = d.design_umfrage.filter((x) => x.member_id != "u-beat"); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page, BEAT);
    await expect(page.locator("#sh")).toContainText("Wie gefällt dir das Design?");
    await bild(page, "mitglied-umfrage");
  });
});
