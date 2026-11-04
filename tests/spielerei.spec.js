// Spielerei: Rekord-Serie, Duell Android gegen iPhone, „Komm mal wieder“, Saison-Effekte und Weingläser.
const { test, expect, login, tab, as, OT, BEAT } = require("./fixtures");

const card = (page, label) => page.locator(`[aria-label="${label}"]`);
const toast = (page) => page.locator("#toast");
const fix = (page, wann) => page.clock.setFixedTime(new Date(wann));
const anmelden = (page, id, tage, status) => page.evaluate(([id, tage, status]) => {
  const d = window.__mg.db(), e = id + tage;
  d.events.push({ id: e, title: "Anlass " + tage, starts_at: new Date(Date.now() - tage * 864e5).toISOString(), location: null, organizer_id: null, created_by: "u-ot", created_at: new Date().toISOString() });
  if (status) d.rsvps.push({ event_id: e, member_id: id, status, redeemed: false, updated_at: new Date().toISOString() });
  localStorage.setItem("__mg_db", JSON.stringify(d));
}, [id, tage, status]);

test.describe("Rekord-Serie", () => {
  test("Serie reisst beim Fehlen, der Rekord bleibt", async ({ page }) => {
    await page.goto("/");
    await anmelden(page, "u-ot", 5, null);
    await login(page);
    await expect(page.locator("[data-test=streak]")).toHaveText("0");
    await expect(page.locator("[data-test=rekord]")).toHaveText("2");
  });

  test("Rekord steigt mit der Serie", async ({ page }) => {
    await page.goto("/");
    await anmelden(page, "u-ot", 5, "virtual");
    await login(page);
    await expect(page.locator("[data-test=streak]")).toHaveText("3");
    await expect(page.locator("[data-test=rekord]")).toHaveText("3");
  });
});

test.describe("Duell", () => {
  test("Prozent des Monats, Führung und Vormonat", async ({ page }) => {
    await login(page);
    const d = card(page, "Duell des Monats");
    await expect(d.locator("[data-test=duell-android]")).toHaveText("100 %");
    await expect(d.locator("[data-test=duell-iphone]")).toHaveText("75 %");
    await expect(d).toContainText("Android führt.");
    await expect(d.locator("[data-test=duell-vormonat]")).toHaveText("Letzten Monat: iPhone gewinnt, Android bringt die nächste Magnum.");
  });

  test("Monat ohne Anlass", async ({ page }) => {
    await fix(page, "2026-12-02T10:00:00+01:00");
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.events = d.events.filter((e) => e.id.startsWith("e-past")); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page);
    await expect(card(page, "Duell des Monats")).toContainText("noch keinen Anlass");
  });

  test("Ohne zweites Lager kein Duell", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.profiles.forEach((p) => { p.device = "iphone" }); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page);
    await expect(card(page, "Duell des Monats")).toHaveCount(0);
  });
});

test.describe("Komm mal wieder", () => {
  const KOMM = /komm mal wieder|wir vermissen dich|dein Glas bleibt leer/;

  test("nach drei verpassten Anlässen", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.rsvps = d.rsvps.filter((r) => r.member_id != "u-ot"); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await anmelden(page, "u-ot", 5, "out");
    await login(page);
    await expect(page.locator(".hello")).toHaveText(KOMM);
  });

  test("nicht, wer virtuell dabei war", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.rsvps = d.rsvps.filter((r) => r.member_id != "u-ot"); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await anmelden(page, "u-ot", 5, "virtual");
    await login(page);
    await expect(page.locator(".hello")).not.toHaveText(KOMM);
  });

  test("Abmelden ohne Streak: eigener Spruch", async ({ page }) => {
    await page.goto("/");
    await anmelden(page, "u-beat", 5, "out");
    await page.evaluate(() => { const d = window.__mg.db(); d.rsvps = d.rsvps.filter((r) => !(r.member_id == "u-beat" && r.status == "in")); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page, BEAT);
    const e = page.locator("article.ev", { hasText: "Chlaus-Magnum" });
    await e.getByRole("button", { name: "Abmelden" }).click();
    await page.getByRole("button", { name: "Nur abmelden" }).click();
    await expect(toast(page)).toContainText(/Abgemeldet · (Schade|Beim nächsten|Wir trinken)/);
  });
});

test.describe("Flasche oben rechts", () => {
  const stand = (page) => page.locator("header .flasche").getAttribute("data-fuellung").then(Number);

  test("füllt sich vom letzten Anlass bis zum nächsten Termin", async ({ page }) => {
    await login(page);
    const heute = await stand(page);
    expect(heute).toBeGreaterThan(0);
    expect(heute).toBeLessThan(100);
    await fix(page, "2026-11-07T17:00:00+01:00");
    await page.reload();
    await expect(page.locator("header .flasche")).toBeVisible();
    expect(await stand(page)).toBeGreaterThan(heute);
  });

  test("nach dem Anlass wieder leer, ohne nächsten Termin voll", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.events = d.events.filter((e) => e.id.startsWith("e-past")); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page);
    expect(await stand(page)).toBe(100);
  });
});

test.describe("Effekte", () => {
  const mittwoch = "2026-10-21T10:00:00+02:00";

  test("Halloween: Geist oder Kürbis fliegt und stört nicht", async ({ page }) => {
    await login(page);
    const f = page.locator(".fx[data-fx=tag] span");
    await expect(f.first()).toHaveText(/👻|🎃/, { timeout: 6000 });
    await expect(page.locator(".fx").first()).toHaveCSS("pointer-events", "none");
    await tab(page, "Club");
  });

  test("Samichlaus fliegt am 6. Dezember", async ({ page }) => {
    await fix(page, "2026-12-06T10:00:00+01:00");
    await login(page);
    await expect(page.locator(".fx[data-fx=tag] span").first()).toHaveText(/🎅|🎁/, { timeout: 6000 });
  });

  test("Ostern wandert mit dem Kalender", async ({ page }) => {
    await fix(page, "2027-03-28T10:00:00+02:00");
    await login(page);
    await expect(page.locator(".fx[data-fx=tag] span").first()).toHaveText(/🐰|🥚/, { timeout: 6000 });
  });

  test("Am Anlasstag fliegen gefüllte Weingläser", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.events.find((e) => e.id == "e-1").starts_at = new Date(Date.now() + 2 * 3600e3).toISOString(); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page);
    await expect(page.locator(".fx[data-fx=glas] svg").first()).toBeAttached({ timeout: 6000 });
    await expect.poll(() => page.locator(".fx[data-fx=glas]").count(), { timeout: 6000 }).toBeGreaterThan(1);
  });

  test("An normalen Tagen fliegt nichts", async ({ page }) => {
    await fix(page, mittwoch);
    await login(page);
    await page.waitForTimeout(3500);
    await expect(page.locator(".fx")).toHaveCount(0);
  });

  test("Advent: Mütze bis Heiligabend", async ({ page }) => {
    await fix(page, "2026-11-29T10:00:00+01:00");
    await login(page);
    await expect(page.locator("header .hat")).toBeVisible();
    await fix(page, "2026-11-28T10:00:00+01:00");
    await page.reload();
    await expect(page.locator("header .gl")).toBeVisible();
    await expect(page.locator("header .hat")).toHaveCount(0);
  });

  test("Schnee nur im Winter und nur an manchen Tagen", async ({ page }) => {
    // gleicher Zufall wie pick() in der App
    const schnee = (d) => { let x = 0; for (const c of d + "schnee") x = (x * 31 + c.charCodeAt(0)) % 9973; return x % 3 == 0 };
    const tage = Array.from({ length: 28 }, (_, i) => `2027-01-${String(i + 1).padStart(2, "0")}`);
    await fix(page, tage.find(schnee) + "T10:00:00+01:00");
    await login(page);
    await expect(page.locator("#snow i").first()).toBeAttached({ timeout: 4000 });
    await fix(page, tage.find((d) => !schnee(d) && d != "2027-01-01" && d != "2027-01-06") + "T10:00:00+01:00");
    await page.reload();
    await page.waitForTimeout(2500);
    await expect(page.locator("#snow")).toHaveCount(0);
  });

  test("Bewegung reduzieren: nichts fliegt, die Mütze bleibt", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fix(page, "2026-12-06T10:00:00+01:00");
    await login(page);
    await expect(page.locator("header .hat")).toBeVisible();
    await page.waitForTimeout(3500);
    await expect(page.locator(".fx")).toHaveCount(0);
  });
});

test.describe("Quittung auslesen", () => {
  const lesen = require("../app/quittung.js");

  test("erkennt Wein in allen Grössen, Mineral und Total", () => {
    const r = lesen(["Rest. Sonne", "2 x Cornalin 75cl 98.00", "1 Magnum Pinot Noir 1.5l 90.00", "3 Glas Fendant 1dl 15.00", "4 x Mineral 5dl 20.00", "2 Rösti 44.00", "Total CHF 267.00"].join("\n"));
    expect(r.wein_dl).toBe(33);
    expect(r.mineral).toBe(4);
    expect(r.total).toBe(267);
  });

  test("ohne Grösse: Flasche 7,5 dl, Magnum 15 dl, Glas 1 dl", () => {
    expect(lesen("Merlot 49.00").wein_dl).toBe(7.5);
    expect(lesen("Magnum Riesling 90.00").wein_dl).toBe(15);
    expect(lesen("2x Rotwein offen 8.00").wein_dl).toBe(2);
    expect(lesen("Spaghetti 22.50").zeilen).toEqual([]);
    expect(lesen("").wein_dl).toBe(0);
  });

  test("Wein der Quittung zählt für alle Anwesenden zu gleichen Teilen", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.drinks = []; d.restaurant_visits[1].event_id = "e-past2"; d.restaurant_visits[1].wein_dl = 36; localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page);
    await expect(page.locator("section", { hasText: "Trinkfestigkeit" }).first()).toContainText("Ø 4,0 Getränke pro Abend aus Quittungen an 1 Abend");
  });

  test("echte Texterkennung liest eine Quittung im Browser", async ({ page }, info) => {
    test.skip(info.project.name != "desktop", "dauert, einmal reicht");
    test.setTimeout(90000);
    await page.addInitScript(() => { window.__testBild = () => new Promise((ok) => { const c = document.createElement("canvas"); c.width = 900; c.height = 420; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 900, 420); g.fillStyle = "#000"; g.font = "42px monospace"; ["2 x Merlot 75cl 98.00", "3 x Mineral 5dl 15.00", "Total 113.00"].forEach((z, i) => g.fillText(z, 30, 90 + i * 110)); c.toBlob(ok, "image/png") }) });
    await login(page);
    await page.locator("article.ev", { hasText: "Herbst-Stamm" }).getByRole("button", { name: "Details" }).click();
    await page.getByRole("button", { name: /Beiz erfassen/ }).click();
    const buf = await page.evaluate(async () => Array.from(new Uint8Array(await (await window.__testBild()).arrayBuffer())));
    await page.locator("input[aria-label='Quittung fotografieren']").setInputFiles({ name: "q.png", mimeType: "image/png", buffer: Buffer.from(buf) });
    await page.getByRole("button", { name: "Quittung auslesen" }).click();
    await expect(page.locator("[data-test=ocr]")).toContainText("Ausgelesen", { timeout: 70000 });
    await expect(page.locator("[data-k=rsWein]")).toHaveValue("15");
    await expect(page.locator("[data-k=rsMin]")).toHaveValue("3");
    await expect(page.locator("[data-k=rsTotal]")).toHaveValue("113");
  });
});

test.describe("Push und Karte der Woche", () => {
  test("Erinnerung genau 7 Tage vorher, Karte nicht doppelt", async () => {
    const P = await import("../functions/push.mjs");
    const E = [{ id: "a", starts_at: "2026-11-27T18:00:00Z" }, { id: "b", starts_at: "2026-11-26T18:00:00Z" }, { id: "c", starts_at: "2026-11-27T23:30:00Z" }];
    expect(P.erinnerungen(E, "2026-11-20").map((e) => e.id)).toEqual(["a"]);
    expect(P.wochenStart("2026-11-04")).toBe("2026-11-02");
    expect(P.wochenStart("2026-11-02")).toBe("2026-11-02");
    expect(P.karteWaehlen(["x", "y", "z"], ["x", "y"], () => 0)).toBe("z");
    expect(P.karteWaehlen(["x"], ["x"], () => 0)).toBe("x");
    expect(P.karteWaehlen([], [], () => 0)).toBeNull();
    expect(() => P.checkAbo({ endpoint: "http://x", keys: {} })).toThrow();
    expect(P.checkAbo({ endpoint: "https://push.example.test/abc", keys: { p256dh: "B".repeat(40), auth: "a".repeat(16) } }).endpoint).toContain("https://");
  });

  test("Karte der Woche erscheint unter Termine", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.karte_der_woche.push({ woche: "2026-10-26", card_id: "c-2" }); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page);
    const k = page.locator("[aria-label='Karte der Woche']");
    await expect(k).toContainText("Sonnenaufgang im Rebberg");
    await k.click();
    await expect(page.locator("#ov")).toContainText("Sonnenaufgang im Rebberg");
  });

  test("ohne installierte App: Hinweis statt Knopf", async ({ page }) => {
    await login(page);
    await tab(page, "Club");
    await expect(page.locator("[data-test=push]")).toContainText("installierten App");
  });

  test("Krone für den Führenden, Icons beim Gerät", async ({ page }) => {
    await login(page);
    await tab(page, "Club");
    await expect(page.locator("[data-test=krone]")).toHaveCount(1);
    await expect(page.locator(".mem", { hasText: "Beat" }).locator("svg")).toHaveCount(1);
  });
});
