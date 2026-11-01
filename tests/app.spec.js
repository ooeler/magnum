// Funktionstests der App gegen die nachgebaute Datenbank (Android, iPhone, Desktop).
const { test, expect, login, tab, as, BEAT } = require("./fixtures");

const card = (page, label) => page.locator(`[aria-label="${label}"]`);
const event = (page, title) => page.locator("article.ev", { hasText: title });

test.describe("Login", () => {
  test("ohne Login nur die Anmeldung, falsches Passwort wird gemeldet", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#login")).toBeVisible();
    await expect(page.locator("nav")).toHaveCount(0);
    await page.fill("#login input[name=email]", "ot@magnum.test");
    await page.fill("#login input[name=pw]", "falsch");
    await page.click("#login .btn");
    await expect(page.locator("#login [role=alert]")).toHaveText("Mail-Adresse oder Passwort stimmt nicht.");
  });

  test("Begrüssung, Rang, Punkte und Streak", async ({ page }) => {
    await login(page);
    await expect(page.locator(".hello")).toContainText("Ot");
    // 2 Anlässe dabei (2 × 50) + Reise Bordeaux (30) + eigene Sammelkarte (10)
    await expect(page.locator("[data-test=punkte]")).toHaveText("140");
    await expect(page.locator("[data-test=streak]")).toHaveText("2");
    await expect(card(page, "Dein Rang")).toContainText("Neuling");
    await expect(card(page, "Dein Rang")).toContainText("Noch 60 Punkte bis «Stammgast»");
    await expect(card(page, "Dein Rang")).toContainText("Ø 2,5 Getränke pro Abend aus 3 Fotos an 1 Abend");
  });
});

test.describe("Termine", () => {
  test("Abmelden bietet virtuelle Teilnahme mit Magnum an", async ({ page }) => {
    await login(page);
    await expect(page.locator("[data-test=kasse]")).toHaveText("1 Magnum");
    await event(page, "Herbst-Stamm").locator("[data-a=abmelden]").click();
    const sheet = page.locator("#sh [role=dialog]");
    await expect(sheet).toContainText("Schade, du fehlst!");
    await expect(sheet).toContainText("Streak von 2 Anlässen");
    await sheet.locator(".virt").click();
    await expect(event(page, "Herbst-Stamm")).toContainText("Virtuell dabei · 1 Magnum spendiert");
    await expect(page.locator("[data-test=kasse]")).toHaveText("2 Magnums");
    await expect(card(page, "Prost-Wand")).toContainText("spendiert aber eine Magnum");
    await expect(page.locator("#toast")).toContainText("+20 Punkte");
  });

  test("Nur abmelden und wieder anmelden", async ({ page }) => {
    await login(page);
    const ev = event(page, "Herbst-Stamm");
    await ev.locator("[data-a=abmelden]").click();
    await page.locator("#sh").getByRole("button", { name: "Nur abmelden" }).click();
    await expect(ev).toContainText("du bist abgemeldet");
    await ev.getByRole("button", { name: "Bin dabei" }).click();
    await expect(ev).toContainText("7 von 11 dabei · 1 Gasttrinker · du bist dabei");
  });

  test("Organisieren: nur wenn noch niemand organisiert", async ({ page }) => {
    await login(page);
    const ev = event(page, "Chlaus-Magnum");
    await expect(ev).toContainText("Organisator gesucht");
    await ev.getByRole("button", { name: /Ich organisiere/ }).click();
    await expect(ev).toContainText("Organisation: Ot (du)");
    await expect(ev).toContainText("du bist dabei");
    await expect(event(page, "Herbst-Stamm").getByRole("button", { name: /Ich organisiere/ })).toHaveCount(0);
  });

  test("Anlass erfassen", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "+ Anlass erfassen" }).click();
    await page.fill("[data-k=evTitle]", "Spargel-Abend");
    await page.fill("[data-k=evAt]", "2026-11-20T19:00");
    await page.fill("[data-k=evLoc]", "Wil");
    await page.getByRole("button", { name: "Anlass erfassen" }).click();
    await expect(event(page, "Spargel-Abend")).toContainText("Wil");
  });

  test("Gasttrinker werden pro Magnum erfasst", async ({ page }) => {
    await login(page);
    await event(page, "Herbst-Stamm").getByRole("button", { name: "Details" }).click();
    const m = card(page, "Magnums des Abends");
    await expect(m.locator("[data-test=magnums]")).toHaveText("1 Flaschen · 1 Gasttrinker");
    await m.locator("[data-k=mWine]").fill("Petite Arvine 2021");
    await m.getByRole("button", { name: "Erfassen" }).click();
    await m.locator("[data-k=gName]").fill("Hugo");
    await m.getByRole("button", { name: /Dazu/ }).click();
    await expect(m.locator("[data-test=magnums]")).toHaveText("2 Flaschen · 2 Gasttrinker");
    await expect(m.locator(".col", { hasText: "Petite Arvine 2021" }).locator(".chip.guest")).toHaveText("Gast: Hugo");
    await page.locator("#ov [data-a=close]").click();
    await expect(event(page, "Herbst-Stamm")).toContainText("2 Gasttrinker");
  });

  test("Fahrservice: mitfahren, Fahrer bewerten und Punkte verteilen", async ({ page }) => {
    await login(page);
    await event(page, "Herbst-Stamm").getByRole("button", { name: "Details" }).click();
    const r = card(page, "Heimweg · Fahrservice");
    await r.getByRole("button", { name: "Mitfahren" }).click();
    await expect(r).toContainText("Bewerten kannst du nach dem Anlass.");
    await page.clock.setFixedTime(new Date("2026-11-08T10:00:00+01:00"));
    await as(page, "beat@magnum.test", "sb.from('posts').insert({ text: 'Gut heimgekommen' })");
    await expect(r).toContainText("Wie war die Fahrt mit Jürg?");
    const send = r.getByRole("button", { name: /Bewertung senden/ });
    await expect(send).toBeDisabled();
    for (const k of ["Sicher & nüchtern gefahren", "Pünktlich & zuverlässig", "Stimmung im Auto"]) await r.getByRole("button", { name: `${k}: 5 von 5` }).click();
    await r.getByRole("button", { name: "+30" }).click();
    await send.click();
    await expect(r).toContainText("Du hast Jürg +30 Punkte gegeben");
    await expect(r).toContainText("+30 Punkte erhalten");
  });

  test("Phrasenschwein", async ({ page }) => {
    await login(page);
    const s = card(page, "Phrasenschwein");
    await expect(s.locator("[data-test=schwein]")).toHaveText("CHF 6");
    await s.locator("select[data-k=phWho]").selectOption({ label: "Beat" });
    await s.getByRole("button", { name: "Das nehmen wir mal so mit" }).click();
    await s.getByRole("button", { name: /Ab ins Schwein/ }).click();
    await expect(s.locator("[data-test=schwein]")).toHaveText("CHF 8");
    await expect(s).toContainText("Phrasenkönig: Beat (3)");
  });

  test("Spruch des Tages: Prost und einreichen", async ({ page }) => {
    await login(page);
    const s = card(page, "Spruch des Tages");
    const p = s.locator("[data-a=sprost]");
    const before = Number((await p.textContent()).replace(/\D/g, ""));
    await p.click();
    await expect(p).toHaveText(`Prost ${before + 1}`);
    await s.getByRole("button", { name: "+ Einreichen" }).click();
    await s.locator("[data-k=spText]").fill("In vino veritas, in Magnum noch mehr.");
    await s.getByRole("button", { name: "Senden" }).click();
    await expect(page.locator("#toast")).toContainText("Spruch eingereicht");
  });

  test("Magnum-Abend: Gläser hüpfen über den Bildschirm", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Magnum-Abend starten" }).click();
    await expect(page.locator("#party .prost")).toHaveText("Prost!");
    await expect(page.locator("#party .gx")).toHaveCount(10);
    await page.getByRole("button", { name: "Abend beenden" }).click();
    await expect(page.locator("#party")).toHaveCount(0);
  });

  test("Getränk fotografieren berechnet die Trinkfestigkeit", async ({ page }) => {
    await login(page);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await card(page, "Mein Abend").locator("input[type=file]").setInputFiles({ name: "glas.png", mimeType: "image/png", buffer: png });
    await expect(card(page, "Mein Abend")).toContainText("1 Fotos · 1 Einheiten");
    await card(page, "Mein Abend").getByRole("button", { name: "Wasser" }).click();
    await expect(card(page, "Mein Abend")).toContainText("1 Fotos · 0 Einheiten");
    await expect(card(page, "Dein Rang")).toContainText("aus 4 Fotos an 2 Abenden");
  });
});

test.describe("Reisen", () => {
  test("Sacceri: Antrag, ⅔-Mehrheit der Anwesenden, Android zählt doppelt", async ({ page }) => {
    await login(page);
    await tab(page, "Reisen");
    await page.locator(".trip", { hasText: "Wallis" }).click();
    const s = card(page, "Auszeichnung De Sacceri");
    // Mitreisende: Ot 1, Beat 2 (Android), Chris 1, Dani 1 → total 5, nötig 4
    await expect(s).toContainText("4 von 5 Stimmen");
    await s.locator("select[data-k=sacPick]").selectOption({ label: "Chris «Navi»" });
    await s.getByRole("button", { name: "Auszeichnung beantragen" }).click();
    await expect(s.locator("[data-test=tally]")).toHaveText("Ja 1 · Nein 0 · offen 4 · nötig 4");
    await expect(s).toContainText("Deine Stimme ist abgegeben");
    await as(page, BEAT.email, "sb.rpc('cast_ballot', { p_proposal: window.__mg.db().proposals.find(p => p.status == 'open').id, p_yes: true })");
    await expect(s.locator("[data-test=tally]")).toHaveText("Ja 3 · Nein 0 · offen 2 · nötig 4");
    await expect(s).toContainText("Beat ×2 · Ja");
    // Dani hat im Test kein Login – Stimme direkt über die ID
    await page.evaluate(() => window.__mg.asId("u-dani", (sb) => sb.rpc("cast_ballot", { p_proposal: window.__mg.db().proposals.find((p) => p.status == "open").id, p_yes: true })));
    await expect(s.locator("[data-test=sacceri]")).toHaveText("Chris");
    await expect(card(page, "Auszeichnung De Sacceri")).toContainText("mit 4 von 5 Stimmen");
  });

  test("OK und Kassier eintragen, mitreisen, Bilder: 3 sichtbar, Rest als Collage", async ({ page }) => {
    await login(page);
    await tab(page, "Reisen");
    await page.locator(".trip", { hasText: "Wallis" }).click();
    await page.locator("select[data-f=kassier_id]").selectOption({ label: "Beat" });
    await expect(page.locator("#toast")).toContainText("Gespeichert");
    await page.locator("#ov [data-a=close]").click();
    await expect(page.locator(".trip", { hasText: "Wallis" })).toContainText("Kassier: Beat");
    await page.locator(".trip", { hasText: "Bordeaux" }).click();
    await expect(page.locator("#ov")).toContainText("6 hochgeladen · 3 sichtbar");
    await expect(page.locator("#ov")).toContainText("Die übrigen 3 Bilder liegen als Collage-Karte");
    await expect(page.locator("#ov .ph img")).toHaveCount(3);
  });
});

test.describe("Club", () => {
  test("Spitzname: Vorschlag, zweite Unterstützung, dann ⅔-Mehrheit", async ({ page }) => {
    await login(page);
    await tab(page, "Club");
    await page.locator(".mem", { hasText: "Dani" }).click();
    const n = card(page, "Spitzname");
    await n.locator("[data-k^=nick]").fill("Kellerratte");
    await n.getByRole("button", { name: "Vorschlagen" }).click();
    await expect(n.locator("[data-test=nickstatus]")).toContainText("Braucht eine zweite Person");
    await as(page, BEAT.email, "sb.rpc('second_proposal', { p_proposal: window.__mg.db().proposals.find(p => p.kind == 'nickname' && p.status == 'open').id })");
    // Alle ausser Dani: 10 Personen, 3 mit Android → total 13, nötig 9; Ot 1 + Beat 2 = 3
    await expect(n.locator("[data-test=nickstatus]")).toContainText("unterstützt von Beat");
    await expect(n).toContainText("Ja 3 · Nein 0 · offen 10 · nötig 9");
  });

  test("Eigenen Spitznamen vergeben die anderen", async ({ page }) => {
    await login(page);
    await tab(page, "Club");
    await page.locator(".mem", { hasText: "Ot" }).first().click();
    await expect(card(page, "Spitzname")).toContainText("Deinen Spitznamen vergeben die anderen");
  });

  test("Admin passt den Gerätetyp an – mit Protokoll", async ({ page }) => {
    await login(page);
    await tab(page, "Club");
    await page.locator(".mem", { hasText: "Hans" }).click();
    await expect(page.locator("[data-test=geraet]")).toHaveText("iPhone");
    await card(page, "Admin").getByRole("button", { name: "Android ×2" }).click();
    await expect(page.locator("[data-test=geraet]")).toHaveText("Android (Stimme zählt doppelt)");
    await expect(page.locator("#ov")).toContainText("vom Admin bestätigt");
    await page.locator("#ov [data-a=close]").click();
    await expect(page.locator("section", { hasText: "Administration" })).toContainText("Hans: Gerätetyp iphone → android · durch Ot");
  });

  test("Nicht-Admin sieht keine Admin-Funktionen", async ({ page }) => {
    await login(page, BEAT);
    await tab(page, "Club");
    await expect(page.locator("section", { hasText: "Administration" })).toHaveCount(0);
    await page.locator(".mem", { hasText: "Hans" }).click();
    await expect(card(page, "Admin")).toHaveCount(0);
    const r = await page.evaluate(() => window.magnumDb.createClient().rpc("admin_set_device", { p_member: "u-hans", p_device: "android" }));
    expect(r.error.message).toContain("Nur der Administrator");
  });

  test("Verbesserungsvorschlag wird als GitHub-Issue erfasst", async ({ page }) => {
    await login(page);
    await tab(page, "Club");
    const f = card(page, "Verbesserungsvorschläge");
    await expect(f).toContainText("Phrasenschwein-Rangliste");
    await f.getByRole("button", { name: "+ Vorschlag machen" }).click();
    await f.getByRole("button", { name: "Wunsch" }).click();
    await f.locator("[data-k=fbTitle]").fill("Weinkarte pro Magnum");
    await f.locator("[data-k=fbText]").fill("Bei jeder Magnum Jahrgang und Winzer.");
    await f.getByRole("button", { name: "Als Issue erfassen" }).click();
    await expect(page.locator("#toast")).toContainText("GitHub-Issue");
    await expect(f.locator(".row", { hasText: "Weinkarte pro Magnum" })).toContainText("wird erfasst");
  });

  test("Rangliste: gleiche Punkte = gleicher Rang, Nummer nur beim ersten", async ({ page }) => {
    await login(page);
    await tab(page, "Club");
    const rows = page.locator("ol li");
    await expect(rows).toHaveCount(11);
    const nums = await rows.locator(".rk").allTextContents();
    expect(nums[0]).toBe("1");
    expect(nums.filter((x) => x != "").length).toBeLessThan(11); // es gibt Gleichstände
  });
});

test.describe("Einladung", () => {
  test("nur mit Einladungslink: Konto anlegen, Gerät wird erkannt, Club voll", async ({ page }, info) => {
    await login(page);
    await tab(page, "Club");
    const inv = card(page, "Einladungen");
    await expect(inv).toContainText("11 / 12 Mitglieder");
    await inv.getByRole("button", { name: "Einladungslink erstellen" }).click();
    const link = await inv.locator("[data-test=link]").textContent();
    expect(link).toMatch(/#einladung=[A-Za-z0-9_-]{43}$/);
    await expect(inv.getByRole("link", { name: "Per WhatsApp schicken" })).toHaveAttribute("href", /^https:\/\/wa\.me\//);
    await page.getByRole("button", { name: "Abmelden" }).click();
    await page.goto(link);
    await expect(page.locator(".auth")).toContainText("Du bist eingeladen!");
    await expect(page.locator(".auth")).toContainText("Eingeladen von Ot");
    const android = info.project.name == "android";
    await expect(page.locator("[data-device]")).toHaveText(android ? "Android" : "iPhone");
    await page.fill("#join input[name=name]", "Luca");
    await page.fill("#join input[name=email]", "luca@magnum.test");
    await page.fill("#join input[name=pw]", "kurz");
    await page.fill("#join input[name=pw]", "geheim1234");
    await page.click("#join .btn");
    await expect(page.locator("nav")).toBeVisible();
    await expect(page.locator(".hello")).toContainText("Luca");
    await tab(page, "Club");
    await expect(card(page, "Einladungen")).toContainText("Der Club ist voll (12 Mitglieder)");
    await page.locator(".mem", { hasText: "Luca" }).click();
    await expect(page.locator("[data-test=geraet]")).toHaveText(android ? "Android (noch nicht bestätigt)" : "iPhone");
    await expect(page.locator("#ov")).toContainText("Eingeladen von: Ot");
  });

  test("ein Link gilt nur einmal, ungültige Links werden abgewiesen", async ({ page }) => {
    await page.goto("/#einladung=" + "x".repeat(43));
    await expect(page.locator(".auth")).toContainText("Einladung ungültig");
    await expect(page.locator(".auth .err")).toContainText("ungültig, abgelaufen oder wurde schon verwendet");
  });
});

test.describe("Sammelkarten & Statistik", () => {
  test("Collage- und Sacceri-Karten unter Legendär, geheime Karten gesperrt", async ({ page }) => {
    await login(page);
    await tab(page, "Karten");
    await page.getByRole("button", { name: "Legendär", exact: true }).click();
    await expect(page.locator(".kc", { hasText: "Collage Bordeaux" })).toContainText("3 Bilder");
    await expect(page.locator(".kc", { hasText: "De Sacceri Bordeaux: Dani" })).toBeVisible();
    await page.getByRole("button", { name: "Geheim", exact: true }).click();
    await expect(page.locator(".kc.lock")).toHaveCount(3);
    await page.locator(".kc.lock").first().click();
    await expect(page.locator("#toast")).toContainText("7 Anlässe in Folge");
  });

  test("Sammelkarte erstellen", async ({ page }) => {
    await login(page);
    await tab(page, "Karten");
    await page.getByRole("button", { name: /Sammelkarte erstellen/ }).click();
    await page.locator("form[data-s=card]").getByRole("button", { name: "Klug war’s nicht, aber geil" }).click();
    await page.fill("[data-k=cdTitle]", "Letzter Zug verpasst");
    await page.fill("[data-k=cdStory]", "Übernachtung im Weinkeller.");
    await page.getByRole("button", { name: "Karte erstellen" }).click();
    await expect(page.locator(".kc", { hasText: "Letzter Zug verpasst" })).toBeVisible();
    await page.locator(".kc", { hasText: "Letzter Zug verpasst" }).click();
    await expect(page.locator("#ov")).toContainText("Übernachtung im Weinkeller.");
  });

  test("Restaurant bewerten: drei Kriterien, Google Maps", async ({ page }) => {
    await login(page);
    await tab(page, "Statistik");
    await page.locator("[aria-label='Unsere Beizen'] button", { hasText: "Rest. Sonne" }).click();
    await expect(page.locator("[data-test=score]")).toHaveText("4,3");
    for (const [k, n] of [["Preis-Leistung", 2], ["Geselligkeit", 3], ["Willkommen, auch wenn du betrunken bist", 4]]) await page.getByRole("button", { name: `${k}: ${n} von 5` }).click();
    await expect(page.locator("#toast")).toContainText("Danke für die Bewertung");
    await expect(page.locator("[data-test=score]")).toHaveText("3,7");
    await expect(page.getByRole("link", { name: "In Google Maps öffnen" })).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Rest\.%20Sonne/);
  });

  test("Beiz mit Quittung erfassen öffnet direkt die Bewertung", async ({ page }) => {
    await login(page);
    await tab(page, "Statistik");
    await page.getByRole("button", { name: /Quittung fotografieren \/ Beiz erfassen/ }).click();
    await page.fill("[data-k=rsName]", "Löwen");
    await page.fill("[data-k=rsPlace]", "Wilen");
    await page.fill("[data-k=rsTotal]", "480");
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.locator("#ov")).toContainText("Löwen");
    await expect(page.locator("#ov")).toContainText("CHF 60 p.P.");
    await expect(page.locator("#ov")).toContainText("Deine Bewertung");
  });
});

test.describe("Am Tag danach", () => {
  // Uhr der Tests: Samstag, 31.10.2026, 10:00
  async function anlass(page, tag, status) {
    await login(page);
    await as(page, "ot@magnum.test", "sb.from('events').insert({ id: 'e-kater', title: 'Grosse Nacht', starts_at: arg, location: 'Keller', created_by: 'u-ot' })", tag + "T19:00:00+01:00");
    await as(page, "ot@magnum.test", `sb.from('rsvps').upsert({ event_id: 'e-kater', member_id: 'u-ot', status: '${status}' })`);
    await page.reload();
    await expect(page.locator("nav")).toBeVisible();
  }
  const KATER = /Hast du Kopfweh, Ot?|Hallo Brummschädel Ot!/;

  test("wer dabei war, wird nach dem Kopf gefragt", async ({ page }) => {
    await anlass(page, "2026-10-30", "in");
    await expect(page.locator(".hello")).toHaveText(KATER);
  });

  test("beide Sprüche kommen vor, pro Tag bleibt es derselbe", async ({ page }) => {
    await anlass(page, "2026-10-30", "in");
    const vorher = await page.locator(".hello").textContent();
    await page.reload();
    await expect(page.locator(".hello")).toHaveText(vorher);
    const texte = await page.evaluate(() => {
      const f = window.first, t = new Set();
      for (const n of ["Ot", "Beat", "Chris", "Dani", "Erich", "Fritz"]) { window.first = () => n; t.add(hello().replace(n, "X")) }
      window.first = f;
      return [...t].sort();
    });
    expect(texte).toEqual(["Hallo Brummschädel X!", "Hast du Kopfweh, X?"]);
  });

  test("virtuell Dabeigewesene haben kein Kopfweh", async ({ page }) => {
    await anlass(page, "2026-10-30", "virtual");
    await expect(page.locator(".hello")).not.toHaveText(KATER);
  });

  test("Abgemeldete auch nicht", async ({ page }) => {
    await anlass(page, "2026-10-30", "out");
    await expect(page.locator(".hello")).not.toHaveText(KATER);
  });

  test("zwei Tage später ist es vorbei", async ({ page }) => {
    await anlass(page, "2026-10-29", "in");
    await expect(page.locator(".hello")).not.toHaveText(KATER);
  });
});

test.describe("App installieren", () => {
  const inst = (page) => page.locator(".inst");

  test("Anleitung passend zum Gerät", async ({ page }) => {
    await login(page);
    await tab(page, "Club");
    await expect(inst(page)).toContainText("Zum Home-Bildschirm");
  });

  test("Anleitung für Android", async ({ page }) => {
    await login(page, BEAT);
    await tab(page, "Club");
    await expect(inst(page)).toContainText("In Chrome");
  });

  test("Android/Chrome: Knopf öffnet den Installations-Dialog", async ({ page }) => {
    await login(page);
    await tab(page, "Club");
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt", { cancelable: true });
      e.prompt = () => { window.__prompted = true };
      window.dispatchEvent(e);
    });
    await inst(page).locator("[data-a=install]").click();
    expect(await page.evaluate(() => window.__prompted)).toBe(true);
    await expect(inst(page).locator("[data-a=install]")).toHaveCount(0);
  });

  test("schon installiert: keine Karte", async ({ page }) => {
    await page.addInitScript(() => { const mm = window.matchMedia; window.matchMedia = (q) => q.includes("standalone") ? { matches: true, addEventListener() {}, removeEventListener() {} } : mm.call(window, q) });
    await login(page);
    await tab(page, "Club");
    await expect(page.locator("[aria-label=Rangliste]")).toBeVisible();
    await expect(inst(page)).toHaveCount(0);
  });
});

test.describe("Darstellung", () => {
  test("kein seitliches Scrollen in allen Bereichen", async ({ page }) => {
    await login(page);
    for (const t of ["Termine", "Reisen", "Club", "Karten", "Statistik"]) {
      await tab(page, t);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over, t).toBeLessThanOrEqual(0);
    }
  });
});
