// Hochladen: neue Versuche bei Netzproblemen, Fortschritt, ein schlechtes Bild hält die anderen nicht auf.
// Dazu das Zeitfenster fürs Ziehen nach Zürcher Zeit, auch wenn das Handy in einer anderen Zeitzone ist.
const base = require("@playwright/test");
const { test, expect, login, tab, BEAT } = require("./fixtures");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// Der echte Client (app/client.js) auf einer leeren Seite
async function client(page) {
  await page.route("**/leer.html", (r) => r.fulfill({ contentType: "text/html", body: '<!doctype html><body><script src="/client.js"></script><script>window.c = window.magnumDb.createClient({ data: location.origin + "/__daten", api: location.origin + "/__api" })</script>' }));
  await page.goto("/leer.html");
}
const hochladen = (page) => page.evaluate(() => {
  const teile = []; const blob = new Blob([new Uint8Array(200000)], { type: "image/jpeg" });
  return window.c.storage.from("photos").upload("drinks/x/a.jpg", blob, { contentType: "image/jpeg", onProgress: (x) => teile.push(x) })
    .then((r) => ({ r, teile }));
});

base.test.describe("Hochladen (Client)", () => {
  base.test("Server wacht gerade auf (503): die App versucht es nochmals", async ({ page }, info) => {
    base.test.skip(info.project.name != "desktop", "reine Client-Logik, einmal reicht");
    let n = 0;
    await page.route("**/__api/fotos?**", (r) => { n++; return n == 1 ? r.fulfill({ status: 503, json: { error: "schläft" } }) : r.fulfill({ json: { path: "drinks/x/a.jpg" } }) });
    await client(page);
    const { r } = await hochladen(page);
    base.expect(r.error).toBeNull();
    base.expect(r.data.path).toBe("drinks/x/a.jpg");
    base.expect(n).toBe(2);
  });

  base.test("Ohne Netz: drei Versuche, dann eine klare Meldung", async ({ page }, info) => {
    base.test.skip(info.project.name != "desktop", "reine Client-Logik, einmal reicht");
    let n = 0;
    await page.route("**/__api/fotos?**", (r) => { n++; return r.abort("internetdisconnected") });
    await client(page);
    const { r } = await hochladen(page);
    base.expect(n).toBe(3);
    base.expect(r.error.message).toContain("Keine Verbindung");
  });

  base.test("Abgelehntes Bild (400) wird nicht wiederholt", async ({ page }, info) => {
    base.test.skip(info.project.name != "desktop", "reine Client-Logik, einmal reicht");
    let n = 0;
    await page.route("**/__api/fotos?**", (r) => { n++; return r.fulfill({ status: 400, json: { error: "Nur JPEG-Bilder." } }) });
    await client(page);
    const { r } = await hochladen(page);
    base.expect(n).toBe(1);
    base.expect(r.error.message).toBe("Nur JPEG-Bilder.");
  });
});

test.describe("Hochladen (App)", () => {
  test("Reisefotos: ein unlesbares Bild hält die anderen nicht auf", async ({ page }) => {
    await login(page);
    await tab(page, "Reisen");
    await page.locator(".trip", { hasText: "Wallis" }).click();
    const vorher = await page.evaluate(() => window.__mg.db().trip_photos.length);
    await page.locator("input[data-c=tripphotos]").setInputFiles([
      { name: "kaputt.png", mimeType: "image/png", buffer: Buffer.from("kein Bild") },
      { name: "gut.png", mimeType: "image/png", buffer: PNG },
    ]);
    await expect(page.locator("#toast")).toContainText("1 von 2 Bildern hochgeladen");
    await expect(page.locator("#toast")).toContainText("kann das Gerät nicht umwandeln");
    expect(await page.evaluate(() => window.__mg.db().trip_photos.length)).toBe(vorher + 1);
  });

  test("Bild ohne Dateityp (z. B. aus manchen Galerien) wird erkannt", async ({ page }) => {
    await login(page);
    await page.locator("[aria-label='Mein Abend'] input[type=file]").setInputFiles({ name: "glas.png", mimeType: "", buffer: PNG });
    await expect(page.locator("[aria-label='Mein Abend']")).toContainText("1 Fotos");
  });

  test("Die App lädt neu, während jemand ein Foto auswählt: die Auswahl kommt trotzdem an", async ({ page }) => {
    await login(page);
    const feld = await page.locator("[aria-label='Mein Abend'] input[type=file]").elementHandle();
    await page.evaluate(() => render());                    // z. B. Live-Sync, während die Galerie offen ist
    expect(await feld.evaluate((el) => el.isConnected)).toBe(false);
    await feld.setInputFiles({ name: "glas.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator("[aria-label='Mein Abend']")).toContainText("1 Fotos");
  });
});

test.describe("Ziehfenster in einer anderen Zeitzone", () => {
  test.use({ timezoneId: "America/New_York" });
  async function abend(page, uhr) {
    await page.clock.setFixedTime(new Date(uhr));
    await page.goto("/");
    await page.evaluate(() => {
      const d = window.__mg.db();
      d.events.push({ id: "e-tz", title: "Oktober-Magnum", starts_at: "2026-10-30T18:00:00Z", location: "Pinte", organizer_id: null, created_by: "u-ot", created_at: "2026-10-01T10:00:00Z" });
      d.rsvps.push({ event_id: "e-tz", member_id: "u-beat", status: "in", redeemed: false, updated_at: "2026-10-01T10:00:00Z" });
      d.video_karten.push({ id: "v-1", title: "Korken", path: "videos/u-ot/1.webm", created_by: "u-ot", created_at: "2026-10-01T10:00:00Z" });
      localStorage.setItem("__mg_db", JSON.stringify(d));
    });
    await login(page, BEAT);
  }
  // Anlass 30.10. um 19 Uhr in Zürich: ziehen bis 31.10. um 12 Uhr Zürcher Zeit (in New York 7 Uhr)
  test("kurz vor 12 Uhr Zürcher Zeit: Karte ziehen geht", async ({ page }) => {
    await abend(page, "2026-10-31T11:30:00+01:00");
    await expect(page.locator("[aria-label='Karte ziehen']")).toContainText("Oktober-Magnum");
  });
  test("nach 12 Uhr Zürcher Zeit: vorbei, auch wenn es in New York noch Morgen ist", async ({ page }) => {
    await abend(page, "2026-10-31T12:30:00+01:00");
    await expect(page.locator("header h1")).toHaveText("Magnum");
    await expect(page.locator("[aria-label='Karte ziehen']")).toHaveCount(0);
  });
});
