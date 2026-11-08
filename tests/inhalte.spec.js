// Inhalte: Reisen, Löschen, Kasse, Prost-Wand, Fahrangebote und Fotos.
const fs = require("fs");
const path = require("path");
const { test, expect, login, tab, as, BEAT, CHRIS } = require("./fixtures");

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
    await page.click("form[data-s=trip] .btn.grow");
    await expect(toast(page)).toContainText("Reise erfasst");
    await expect(page.locator(".trip", { hasText: "Elsass" })).toBeVisible();
    await expect(page.locator("form[data-s=trip]")).toHaveCount(0);
    const t = await page.evaluate(() => window.__mg.db().trips.find((x) => x.title == "Elsass"));
    expect(t).toMatchObject({ starts_on: "2027-05-14", ends_on: "2027-05-16", created_by: "u-ot" });
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
    await details(page, "Herbst-Stamm");
    await page.getByRole("button", { name: /Beiz erfassen/ }).click();
  };

  test("Quittung auswählen", async ({ page }) => {
    await offen(page);
    await page.locator("input[aria-label='Quittung fotografieren']").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG });
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

test.describe("Anlässe anpassen", () => {
  const anpassen = (page) => page.locator("summary", { hasText: "Anlass anpassen" }).click();

  test("Organisator ändert Name und Datum", async ({ page }) => {
    await login(page);
    await details(page, "Chlaus-Magnum");
    await page.keyboard.press("Escape");
    await event(page, "Chlaus-Magnum").getByRole("button", { name: /Ich organisiere/ }).click();
    await details(page, "Chlaus-Magnum");
    await anpassen(page);
    await page.fill("[data-k=edTitle]", "Chlaus-Abend");
    await page.fill("[data-k=edDate]", "2026-12-04");
    await page.fill("[data-k=edTime]", "18:30");
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(toast(page)).toContainText("Anlass angepasst");
    await page.keyboard.press("Escape");
    await expect(event(page, "Chlaus-Abend")).toBeVisible();
  });

  test("Automatischer Name wandert mit dem Datum", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.events.push({ id: "e-serie", title: "Dezember-Magnum", starts_at: "2026-12-25T18:00:00.000Z", location: null, organizer_id: null, created_by: null, created_at: new Date().toISOString() }); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page);
    await details(page, "Dezember-Magnum");
    await anpassen(page);
    await page.fill("[data-k=edDate]", "2027-01-08");
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(toast(page)).toContainText("Anlass angepasst");
    await page.keyboard.press("Escape");
    await expect(event(page, "Januar-Magnum")).toBeVisible();
  });

  test("Aufgeklappt bleibt aufgeklappt, auch wenn die App sofort neu lädt", async ({ page }) => {
    await login(page);
    await details(page, "Herbst-Stamm");
    await page.evaluate(() => { document.querySelector("#ov details[data-offen=evEditOpen] summary").click(); render() });
    await expect(page.getByRole("button", { name: "Speichern" })).toBeVisible();
  });

  test("Andere Mitglieder passen fremde Anlässe nicht an", async ({ page }) => {
    await login(page, BEAT);
    await details(page, "Herbst-Stamm");
    await expect(page.locator("summary", { hasText: "Anlass anpassen" })).toHaveCount(0);
    await page.evaluate(() => window.magnumDb.createClient().from("events").update({ title: "Fremd" }).eq("id", "e-1"));
    expect(await page.evaluate(() => window.__mg.db().events.find((e) => e.id == "e-1").title)).toBe("Herbst-Stamm");
  });

  test("Admin erfasst vergangenen Anlass und trägt Anwesenheit nach", async ({ page }) => {
    await login(page);
    await page.locator("summary", { hasText: "Vergangene Anlässe" }).click();
    await page.getByRole("button", { name: "+ Vergangenen Anlass erfassen" }).click();
    await page.fill("[data-k=paTitle]", "Gründungsfeier");
    await page.fill("[data-k=paDate]", "2026-03-27");
    await page.locator("form[data-s=pastevent] .btn.grow").click();
    await expect(toast(page)).toContainText("Anlass erfasst");
    await page.getByRole("button", { name: /Gründungsfeier/ }).click();
    const a = card(page, "Anwesenheit nachtragen");
    await a.locator(".row", { hasText: "Beat" }).first().getByRole("button", { name: "Dabei" }).click();
    await expect(toast(page)).toContainText("Anwesenheit von Beat gespeichert");
    const e = await page.evaluate(() => { const d = window.__mg.db(), x = d.events.find((v) => v.title == "Gründungsfeier"); return d.rsvps.find((r) => r.event_id == x.id && r.member_id == "u-beat").status });
    expect(e).toBe("in");
  });

  test("Datum in der Zukunft ist kein vergangener Anlass", async ({ page }) => {
    await login(page);
    await page.locator("summary", { hasText: "Vergangene Anlässe" }).click();
    await page.getByRole("button", { name: "+ Vergangenen Anlass erfassen" }).click();
    await page.fill("[data-k=paTitle]", "Zukunft");
    await page.fill("[data-k=paDate]", "2030-01-01");
    await page.locator("form[data-s=pastevent] .btn.grow").click();
    await expect(toast(page)).toContainText("Vergangenheit");
  });

  test("Mitglieder sehen keine Nachtrag-Funktionen", async ({ page }) => {
    await login(page, BEAT);
    await page.locator("summary", { hasText: "Vergangene Anlässe" }).click();
    await expect(page.getByRole("button", { name: "+ Vergangenen Anlass erfassen" })).toHaveCount(0);
    const r = await page.evaluate(() => window.magnumDb.createClient().rpc("admin_set_rsvp", { p_event: "e-past1", p_member: "u-beat", p_status: "in" }));
    expect(r.error.message).toContain("Nur der Administrator");
  });
});

test.describe("Beiz, Karte und Organisator", () => {
  test("Der Organisator ist immer dabei und kann sich nicht abmelden", async ({ page }) => {
    await page.goto("/");
    await as(page, BEAT.email, "sb.rpc('claim_organizer', { p_event: 'e-2' })");
    await login(page, BEAT);
    const ev = page.locator("article.ev", { hasText: "Chlaus-Magnum" });
    await expect(ev.locator("[data-test=org-dabei]")).toHaveText("Als Organisator immer dabei");
    await expect(ev.getByRole("button", { name: "Abmelden" })).toHaveCount(0);
    for (const st of ["out", "virtual"]) {
      const r = await page.evaluate((st) => window.__mg.asId("u-beat", (sb) => sb.from("rsvps").upsert({ event_id: "e-2", member_id: "u-beat", status: st })), st);
      expect(r.error.message).toContain("Organisator ist immer dabei");
    }
    const d = await page.evaluate(() => window.__mg.asId("u-beat", (sb) => sb.from("rsvps").delete().eq("event_id", "e-2").eq("member_id", "u-beat")));
    expect(d.error.message).toContain("Organisator ist immer dabei");
    // Nach dem Abgeben geht Abmelden wieder
    await page.evaluate(() => window.__mg.asId("u-beat", (sb) => sb.rpc("set_organizer", { p_event: "e-2", p_member: null })));
    const ok = await page.evaluate(() => window.__mg.asId("u-beat", (sb) => sb.from("rsvps").upsert({ event_id: "e-2", member_id: "u-beat", status: "out" })));
    expect(ok.error).toBeNull();
  });

  test("Vergangener Anlass: der Organisator zählt als dabei, auch ohne Anmeldung", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.rsvps = d.rsvps.filter((r) => !(r.event_id == "e-past2" && r.member_id == "u-chris")) });
    await login(page, CHRIS);
    await page.locator("summary", { hasText: "Vergangene Anlässe" }).click();
    await page.locator('[data-a="ov"][data-t="event"][data-id="e-past2"]').click();
    await expect(page.locator("[data-test=war-dabei]")).toHaveText("Du warst dabei");
  });

  test("Quittung gehört zum Termin, nicht in die Statistik", async ({ page }) => {
    await login(page);
    await tab(page, "Statistik");
    await expect(page.getByRole("button", { name: /Beiz erfassen/ })).toHaveCount(0);
    await tab(page, "Termine");
    await details(page, "Herbst-Stamm");
    await page.getByRole("button", { name: /Beiz erfassen/ }).click();
    await expect(page.locator("[data-k=rsName]")).toHaveValue("Pinte zum Hirschen");
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(toast(page)).toContainText("Besuch gespeichert");
    const v = await page.evaluate(() => window.__mg.db().restaurant_visits.find((x) => x.event_id == "e-1"));
    expect(v).toBeTruthy();
  });

  test("Karte zeigt die Beizen mit Standort", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); Object.assign(d.restaurants[0], { lat: 47.42, lng: 9.37 }); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page);
    await tab(page, "Statistik");
    const k = card(page, "Karte der Beizen");
    await expect(k.locator(".leaflet-container")).toBeVisible();
    await expect(k.locator("path.leaflet-interactive")).toHaveCount(1);
    await expect(k.locator("[data-test=ohne-standort]")).toHaveText("1 Beiz ohne Standort");
  });

  test("Ohne Standort: freundlicher Hinweis", async ({ page }) => {
    await login(page);
    await tab(page, "Statistik");
    await expect(card(page, "Karte der Beizen")).toContainText("Noch keine Beiz mit Standort");
  });

  test("Organisator im Anlass ändern", async ({ page }) => {
    await login(page);
    await details(page, "Herbst-Stamm");
    await page.locator("summary", { hasText: "Anlass anpassen" }).click();
    await page.locator("[data-k=edOrg]").selectOption({ label: "Beat" });
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(toast(page)).toContainText("Anlass angepasst");
    expect(await page.evaluate(() => window.__mg.db().events.find((e) => e.id == "e-1").organizer_id)).toBe("u-beat");
  });

  test("Fremde setzen keinen Organisator", async ({ page }) => {
    await login(page, BEAT);
    const r = await page.evaluate(() => window.magnumDb.createClient().rpc("set_organizer", { p_event: "e-1", p_member: "u-beat" }));
    expect(r.error.message).toContain("Organisator und Administrator");
  });
});

test.describe("Personen auf Karten", () => {
  const karte = (page) => card(page, "Auf der Karte dabei");
  const punkte = (page) => page.locator("[data-test=punkte]").textContent().then(Number);

  test("Eingetragene bekommen +10 Punkte", async ({ page }) => {
    await login(page);
    const vorher = await punkte(page);
    await tab(page, "Karten");
    await page.locator(".kc", { hasText: "Die 6-Liter-Nacht" }).click();
    await karte(page).locator("select[data-c=kartdazu]").selectOption({ label: "Ot" });
    await expect(toast(page)).toContainText("ist dabei · +10 Punkte");
    await expect(karte(page).getByRole("button", { name: "Ot von der Karte nehmen" })).toBeVisible();
    await page.keyboard.press("Escape");
    await tab(page, "Termine");
    expect(await punkte(page)).toBe(vorher + 10);
  });

  test("Andere tragen sich nicht auf fremde Karten ein", async ({ page }) => {
    await login(page, BEAT);
    await tab(page, "Karten");
    await page.locator(".kc", { hasText: "Die 6-Liter-Nacht" }).click();
    await expect(karte(page)).toHaveCount(0);
    const r = await page.evaluate(() => window.magnumDb.createClient().from("card_members").insert({ card_id: "c-1", member_id: "u-beat", added_by: "u-beat" }));
    expect(r.error).toBeTruthy();
  });
});

test.describe("Gäste, Beizen und Sichtweise", () => {
  test("Gäste beim Anlass eintragen und austragen", async ({ page }) => {
    await login(page, BEAT);
    await details(page, "Herbst-Stamm");
    const g = card(page, "Gäste");
    await g.locator("input").fill("Peter");
    await g.getByRole("button", { name: "Eintragen" }).click();
    await expect(toast(page)).toContainText("Peter ist als Gast eingetragen");
    await expect(g).toContainText("Gäste (1)");
    await g.getByRole("button", { name: "Peter austragen" }).click();
    await expect(g).toContainText("Gäste (0)");
  });

  test("Reise ohne Obergrenze, mit Gästen", async ({ page }) => {
    await login(page);
    await tab(page, "Reisen");
    await expect(page.locator(".trip", { hasText: "Wallis" })).toContainText("4 Mitreisende");
    await page.locator(".trip", { hasText: "Wallis" }).click();
    const g = card(page, "Gäste");
    await g.locator("input").fill("Maria");
    await g.getByRole("button", { name: "Eintragen" }).click();
    await expect(g).toContainText("Gäste (1)");
    await page.keyboard.press("Escape");
    await expect(page.locator(".trip", { hasText: "Wallis" })).toContainText("1 Gäste");
  });

  test("Beiz vom Termin ist schon gewählt, Felder wie beim Anlass", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.restaurant_visits[0].event_id = "e-1"; d.events.find((e) => e.id == "e-1").ortschaft = "Gossau"; localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page);
    await details(page, "Herbst-Stamm");
    await page.getByRole("button", { name: /Fotografieren|Beiz erfassen/ }).first().click();
    await expect(page.locator("select[data-k=rsId]")).toHaveValue("re-1");
    await page.locator("select[data-k=rsId]").selectOption("");
    await expect(page.locator("[data-k=rsPlace]")).toHaveValue("Gossau");
    await expect(page.locator("input[aria-label='Quittung hochladen']")).toBeAttached();
  });

  test("Admin löscht eine Beiz", async ({ page }) => {
    await login(page);
    await tab(page, "Statistik");
    await page.locator("[aria-label='Unsere Beizen'] button", { hasText: "Rest. Sonne" }).click();
    await page.getByRole("button", { name: "Beiz löschen" }).click();
    await expect(toast(page)).toContainText("Beiz gelöscht");
    expect(await page.evaluate(() => window.__mg.db().restaurants.some((r) => r.id == "re-1"))).toBe(false);
  });

  test("Admin sieht die App als Mitglied", async ({ page }) => {
    await login(page);
    await tab(page, "Club");
    await page.getByRole("button", { name: "App als Mitglied ansehen" }).click();
    await expect(page.locator("[data-test=sicht]")).toBeVisible();
    await page.locator(".mem", { hasText: "Beat" }).click();
    await expect(card(page, "Rolle")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.locator("[data-test=sicht]").getByRole("button", { name: "Zurück zur Admin-Ansicht" }).click();
    await page.locator(".mem", { hasText: "Beat" }).click();
    await expect(card(page, "Rolle")).toBeVisible();
  });
});
