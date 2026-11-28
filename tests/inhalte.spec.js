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
    await page.locator("#ov [data-a=tripab]").click();
    await expect(toast(page)).toContainText("Von Wallis abgemeldet");
    await expect(page.locator("#ov [data-a=tripab]")).toContainText("Abgemeldet");
    await expect(page.locator("#ov [data-test=reise-ab]")).toContainText("Ot");
    await expect(page.locator("#ov [data-test=reise-dabei]")).not.toContainText("Ot");
    await expect(page.locator("#ov [data-test=reise-offen]")).toContainText("Noch offen:");
    await page.locator("#ov [data-a=tripzu]").click();
    await expect(toast(page)).toContainText("Dabei in Wallis");
    await expect(page.locator("#ov [data-a=tripzu]")).toContainText("Bin dabei ✓");
    await expect(page.locator("#ov [data-test=reise-ab]")).toHaveCount(0);
  });

  test("Ämtli als Liste: bearbeiten, Person mit Rolle hinzufügen und entfernen", async ({ page }) => {
    await login(page);
    await tab(page, "Reisen");
    await expect(page.locator(".trip", { hasText: "Wallis" }).locator("[data-test=aemtli-kurz]")).toContainText("OK: Chris ·");
    await page.locator(".trip", { hasText: "Wallis" }).click();
    const a = page.locator("#ov [aria-label=Ämtli]");
    await expect(a.locator("[data-test=aemtli]")).toContainText("OK · Chris");
    await a.getByRole("button", { name: "Bearbeiten" }).click();
    await a.locator("[data-k=amtPerson]").selectOption({ label: "Beat" });
    await a.locator("[data-k=amtRolle]").selectOption({ label: "Kassier" });
    await a.getByRole("button", { name: "Hinzufügen" }).click();
    await expect(toast(page)).toContainText("Beat ist Kassier");
    await a.locator("[data-k=amtPerson]").selectOption({ label: "Beat" });
    await a.locator("[data-k=amtRolle]").selectOption({ label: "Organisator" });
    await a.getByRole("button", { name: "Hinzufügen" }).click();
    await expect(a.locator("[data-test=aemtli]")).toContainText("Organisator · Beat");
    await expect(a.locator("[data-test=aemtli]")).toContainText("Kassier · Beat");
    await a.getByRole("button", { name: "Chris als OK entfernen" }).click();
    await expect(a.locator("[data-test=aemtli]")).not.toContainText("Chris");
    await a.getByRole("button", { name: "Fertig" }).click();
    await expect(a.getByRole("button", { name: /entfernen/ })).toHaveCount(0);
  });

  test("Bilder hochladen zählt mit", async ({ page }) => {
    await login(page);
    await tab(page, "Reisen");
    await page.locator(".trip", { hasText: "Bordeaux" }).click();
    await page.locator("#ov input[data-c=tripphotos]").setInputFiles([{ name: "a.png", mimeType: "image/png", buffer: PNG }, { name: "b.png", mimeType: "image/png", buffer: PNG }]);
    await expect(toast(page)).toContainText("2 Bilder hochgeladen");
    await expect(page.locator("#ov [data-test=foto-anzahl]")).toHaveText("8 hochgeladen · 3 auf der Karte");
  });

  test("Reisefotos sehen nur Mitreisende, Daheimgebliebene sehen die Anzahl", async ({ page }) => {
    await login(page, BEAT);                               // Beat war in Bordeaux dabei
    await tab(page, "Reisen");
    await page.locator(".trip", { hasText: "Bordeaux" }).click();
    await expect(page.locator("#ov .ph img")).toHaveCount(6);
    await page.locator("#ov .back").click();
    await page.evaluate(() => { const d = window.__mg.db(); d.trip_participants = d.trip_participants.filter((p) => !(p.trip_id == "t-bordeaux" && p.member_id == "u-beat")); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await page.reload();
    await tab(page, "Reisen");
    await page.locator(".trip", { hasText: "Bordeaux" }).click();
    await expect(page.locator("#ov [data-test=foto-anzahl]")).toHaveText("6 Fotos gemacht");
    await expect(page.locator("#ov .ph img")).toHaveCount(0);
    await expect(page.locator("#ov input[data-c=tripphotos]")).toHaveCount(0);
    // Die Fotos für die Karte sieht er trotzdem: Collage unter Legendär
    expect(await page.evaluate(() => D.trip_photos.filter((p) => p.trip_id == "t-bordeaux").length)).toBe(3);
  });

  test("Pro Foto wählen, ob es auf die Collage-Karte kommt", async ({ page }) => {
    await login(page, CHRIS);                              // Chris hat die Bordeaux-Fotos hochgeladen
    await tab(page, "Reisen");
    await page.locator(".trip", { hasText: "Bordeaux" }).click();
    const erstes = page.locator("#ov [data-a=fotokarte]").first();
    await expect(erstes).toHaveText("Als Karte");
    await erstes.click();
    await expect(toast(page)).toContainText("Kommt auf die Collage-Karte");
    await expect(page.locator("#ov [data-test=foto-anzahl]")).toHaveText("6 hochgeladen · 4 auf der Karte");
    await page.locator("#ov .back").click();
    await tab(page, "Karten");
    await page.getByRole("button", { name: "Legendär", exact: true }).click();
    await expect(page.locator(".kc", { hasText: "Collage Bordeaux" })).toContainText("4 Bilder");
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
    await page.getByRole("button", { name: "Mein Profil" }).click();
    await page.locator("#ov [aria-label=Ansicht]").getByRole("button", { name: "Mitglied" }).click();
    await expect(page.locator("[data-test=sicht]")).toBeVisible();
    await page.keyboard.press("Escape");
    await tab(page, "Club");
    await page.locator(".mem", { hasText: "Beat" }).click();
    await expect(card(page, "Rolle")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Zurück zur Admin-Ansicht" }).click();
    await page.locator(".mem", { hasText: "Beat" }).click();
    await expect(card(page, "Rolle")).toBeVisible();
  });
});

test.describe("Nächste Anlässe", () => {
  test("Tipp auf die Karte öffnet die Details, Knöpfe darin bleiben eigene Aktionen", async ({ page }) => {
    await login(page, BEAT);
    const karte = page.locator("article.ev").first();
    const titel = (await karte.locator(".b").first().textContent()).trim();
    await karte.locator("[data-test=anzahl]").click();
    await expect(page.locator("#ov")).toContainText(titel);
    await page.keyboard.press("Escape");
    await expect(page.locator("#ov")).toHaveCount(0);
    await karte.getByRole("button", { name: "Bin dabei" }).click();
    await expect(karte.getByRole("button", { name: "Bin dabei" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#ov")).toHaveCount(0);
  });
});

test.describe("Vorschläge", () => {
  test("Umgesetzter Vorschlag: Danke-Banner bleibt, bis man ihn schliesst", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.feedback.push({ id: 99, user_id: "u-ot", kind: "idee", title: "Push Benachrichtigung", body: "x", labels: [], status: "umgesetzt", created_at: new Date().toISOString() }); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page);
    const banner = page.locator("[data-test=dank]");
    await expect(banner).toContainText("Danke für deine guten Inputs!");
    await expect(banner).toContainText("Push Benachrichtigung");
    await page.reload();
    await expect(banner).toBeVisible();                                   // bleibt nach dem Neuladen
    await banner.getByRole("button", { name: "Danke-Banner schliessen" }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.locator("header h1")).toHaveText("Magnum");
    await expect(banner).toHaveCount(0);
  });

  test("Status «umgesetzt» bricht auch bei langem Titel nicht um", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.feedback.push({ id: 98, user_id: "u-ot", kind: "fehler", title: "Karte von Restaurant geht nicht richtig auf", body: "x", labels: [], status: "umgesetzt", issue_number: 22, issue_url: "https://github.com/ooeler/magnum/issues/22", created_at: new Date().toISOString() }); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page);
    await tab(page, "Club");
    const chip = page.locator("[aria-label=Verbesserungsvorschläge] .status", { hasText: "umgesetzt" }).first();
    await expect(chip).toBeVisible();
    const h = await chip.evaluate((el) => ({ hoehe: el.getBoundingClientRect().height, zeile: parseFloat(getComputedStyle(el).lineHeight) || 20 }));
    expect(h.hoehe).toBeLessThan(h.zeile * 2);                           // eine Zeile
  });

  test("Vergangener Anlass: Gäste nur der Admin, Fahrten nur bis zum Folgetag", async ({ page }) => {
    await login(page, BEAT);
    await page.locator("summary", { hasText: "Vergangene Anlässe" }).click();
    await page.locator('[data-a=ov][data-t=event][data-id="e-past2"]').click();
    await expect(page.locator("#ov [data-test=gast-gesperrt]")).toBeVisible();
    await expect(page.locator("#ov form[data-s=gast]")).toHaveCount(0);
    await expect(page.locator("#ov [data-test=fahrt-vorbei]")).toBeVisible();
    await expect(page.locator("#ov").getByRole("button", { name: /Ich fahre/ })).toHaveCount(0);
    const g = await page.evaluate(() => window.__mg.asId("u-beat", (sb) => sb.from("gaeste").insert({ event_id: "e-past2", name: "Hans", added_by: "u-beat" })));
    expect(g.error.message).toContain("nur der Administrator");
    const r = await page.evaluate(() => window.__mg.asId("u-beat", (sb) => sb.from("rides").insert({ event_id: "e-past2", driver_id: "u-beat", direction: "Gossau", seats: 3 })));
    expect(r.error.message).toContain("bis und mit dem Tag nach dem Anlass");
  });
});

test("Fahrten anbieten geht auch noch am Tag nach dem Anlass (Heimfahrt nach Mitternacht)", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const d = window.__mg.db(), g = new Date(); g.setDate(g.getDate() - 1); g.setHours(19, 0, 0, 0);
    d.events.push({ id: "e-gestern", title: "Langer Abend", starts_at: g.toISOString(), location: "Keller", organizer_id: null, created_by: "u-ot", created_at: g.toISOString() });
    localStorage.setItem("__mg_db", JSON.stringify(d));
  });
  await login(page, BEAT);
  await page.locator("summary", { hasText: "Vergangene Anlässe" }).click();
  await page.locator('[data-a=ov][data-t=event][data-id="e-gestern"]').click();
  await expect(page.locator("#ov [data-test=fahrt-vorbei]")).toHaveCount(0);
  await page.locator("#ov").getByRole("button", { name: /Ich fahre/ }).click();
  await page.locator("#ov [data-k=rdDir]").fill("Wil");
  await page.locator("#ov").getByRole("button", { name: "Plätze anbieten" }).click();
  await expect(page.locator("#toast")).toContainText("als Fahrer eingetragen");
  const r = await page.evaluate(() => window.__mg.asId("u-chris", (sb) => sb.from("ride_passengers").insert({ ride_id: D.rides.find((x) => x.event_id == "e-gestern").id, passenger_id: "u-chris" })));
  expect(r.error).toBeFalsy();                                           // Mitfahren auch noch am Folgetag
});

test.describe("Archiv aus dem Chat", () => {
  test("Archiv-Abende stehen in der Liste, brechen aber weder Streak noch Duell", async ({ page }) => {
    await page.goto("/");
    const vorher = await page.evaluate(async () => { const d = window.__mg.db(); return d.events.length });
    await login(page);
    const streak = await page.locator("[data-test=streak]").textContent();
    await page.evaluate(() => {
      const d = window.__mg.db();
      d.events.push({ id: "e-arch", title: "Oktober-Magnum", starts_at: new Date(Date.now() - 2 * 864e5).toISOString(), location: "Quellenhof", ortschaft: "Gossau", organizer_id: null, created_by: null, created_at: new Date().toISOString(), archiv: true });
      localStorage.setItem("__mg_db", JSON.stringify(d));
    });
    await page.reload();
    await expect(page.locator("[data-test=streak]")).toHaveText(streak);
    await page.locator("summary", { hasText: "Vergangene Anlässe" }).click();
    await expect(page.locator('[data-a=ov][data-id="e-arch"]')).toContainText("Quellenhof");
    expect(vorher).toBeGreaterThan(0);
  });
});

test.describe("Unsere Beizen", () => {
  test("zuerst die 5 zuletzt besuchten, «Mehr anzeigen» zeigt den Rest", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const d = window.__mg.db();
      for (let i = 1; i <= 6; i++) {
        d.restaurants.push({ id: "re-x" + i, name: "Beiz " + i, place: "Gossau", lat: null, lng: null, created_by: "u-ot", created_at: "2020-01-01T10:00:00Z" });
        d.restaurant_visits.push({ id: "rv-x" + i, restaurant_id: "re-x" + i, visited_on: "2026-10-2" + i, people: 1, total_chf: 0, created_by: null, created_at: "2026-01-01T10:00:00Z" });
      }
      localStorage.setItem("__mg_db", JSON.stringify(d));
    });
    await login(page);
    await tab(page, "Statistik");
    const b = page.locator("[aria-label='Unsere Beizen']");
    const zeilen = b.locator("button[data-t=resto]");
    await expect(zeilen).toHaveCount(5);
    await expect(zeilen.first()).toContainText("Beiz 6");                 // zuletzt besucht zuerst
    await b.getByRole("button", { name: /Mehr anzeigen/ }).click();
    await expect(zeilen).toHaveCount(await page.evaluate(() => D.restaurants.length));
    await b.getByRole("button", { name: "Weniger anzeigen" }).click();
    await expect(zeilen).toHaveCount(5);
  });
});

test.describe("Statistik mit Archiv", () => {
  test("Anlässe des Jahres zählen das Archiv mit, Ø Teilnehmende nur erfasste", async ({ page }) => {
    await page.goto("/");
    const vorher = await page.evaluate(() => window.__mg.db().events.filter((e) => e.starts_at.slice(0, 4) == "2026" && new Date(e.starts_at) < new Date()).length);
    await page.evaluate(() => {
      const d = window.__mg.db();
      ["2026-02-27T18:00:00Z", "2026-03-27T18:00:00Z"].forEach((t, i) => d.events.push({ id: "e-a" + i, title: "Archiv", starts_at: t, location: "Adler", ortschaft: "Zuckenriet", organizer_id: null, created_by: null, created_at: t, archiv: true }));
      localStorage.setItem("__mg_db", JSON.stringify(d));
    });
    await login(page);
    await tab(page, "Statistik");
    const kachel = page.locator(".card", { hasText: "Anlässe 2026" });
    await expect(kachel).toContainText(String(vorher + 2));
    await expect(page.locator(".card", { hasText: "Ø Teilnehmende" })).toContainText("in der App erfasst");
  });
});

test.describe("Neue Anlässe als Popup", () => {
  async function seitVorTagen(page, id, tage) {
    await page.goto("/");
    await page.evaluate(([id, tage]) => { const d = window.__mg.db(); d.profiles.find((p) => p.id == id).last_seen = new Date(Date.now() - tage * 864e5).toISOString(); localStorage.setItem("__mg_db", JSON.stringify(d)) }, [id, tage]);
  }

  test("seit dem letzten Besuch erfasste Anlässe erscheinen beim Öffnen; anmelden, dann «Später»; danach nicht mehr", async ({ page }) => {
    await seitVorTagen(page, "u-beat", 10);
    await login(page, BEAT);
    const pop = page.locator("[data-test=neu-popup]");
    await expect(pop).toContainText("2 neue Anlässe");               // Herbst-Stamm hat Beat schon zugesagt
    await expect(pop).not.toContainText("Herbst-Stamm");
    await expect(pop).toContainText("Chlaus-Magnum");
    await pop.getByRole("button", { name: "Bin dabei" }).first().click();
    await expect(page.locator("#toast")).toContainText("Angemeldet");
    await expect(pop).toContainText("Neuer Anlass");
    expect(await page.evaluate(() => D.rsvps.some((r) => r.event_id == "e-2" && r.member_id == "u-beat" && r.status == "in"))).toBe(true);
    await pop.getByRole("button", { name: "Später" }).click();
    await expect(page.locator("#sh")).toHaveCount(0);
    await page.reload();
    await expect(page.locator("header h1")).toHaveText("Magnum");
    await expect(page.locator("#sh")).toHaveCount(0);                       // letzter Besuch ist jetzt
  });

  test("eigene Anlässe und solche, bei denen man schon zugesagt hat, erscheinen nicht; «Details» öffnet den Anlass", async ({ page }) => {
    await seitVorTagen(page, "u-ot", 10);
    await login(page);
    const pop = page.locator("[data-test=neu-popup]");
    await expect(pop).toContainText("Neuer Anlass");                         // e-2 und e-3 hat Ot selbst erfasst
    await expect(pop).toContainText("Herbst-Stamm");
    await expect(pop).not.toContainText("Chlaus-Magnum");
    await pop.getByRole("button", { name: "Details" }).click();
    await expect(page.locator("#sh")).toHaveCount(0);
    await expect(page.locator("#ov")).toContainText("Herbst-Stamm");
  });

  test("neue Reise: «Ich reise mit» meldet an", async ({ page }) => {
    await seitVorTagen(page, "u-beat", 30);                                  // Wallis wurde vor 20 Tagen erfasst
    await page.evaluate(() => { const d = window.__mg.db(); d.rsvps.push(...["e-2", "e-3"].map((e) => ({ event_id: e, member_id: "u-beat", status: "in", redeemed: false, updated_at: new Date().toISOString() }))); d.trip_participants = d.trip_participants.filter((p) => !(p.trip_id == "t-wallis" && p.member_id == "u-beat")); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page, BEAT);
    const pop = page.locator("[data-test=neu-popup]");
    await expect(pop).toContainText("Neue Reise");
    await expect(pop).toContainText("Wallis");
    await pop.getByRole("button", { name: "Ich reise mit" }).click();
    await expect(page.locator("#toast")).toContainText("Dabei in Wallis");
    await expect(page.locator("#sh")).toHaveCount(0);
    expect(await page.evaluate(() => D.trip_participants.some((p) => p.trip_id == "t-wallis" && p.member_id == "u-beat"))).toBe(true);
  });

  test("Badener Fahrt: einmalig für alle als Beispiel, auch beim ersten Besuch und wenn man schon dabei ist", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { const d = window.__mg.db(); d.trips.push({ id: "t-baden", title: "Badener Fahrt", starts_on: new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10), ends_on: null, program: "Badenfahrt mit dem Zug", seats: 12, color: "#6E2433", ok_id: "u-chris", kassier_id: null, sacceri_id: null, created_by: "u-chris", created_at: new Date(Date.now() - 90 * 864e5).toISOString() }); d.trip_participants.push({ trip_id: "t-baden", member_id: "u-beat" }); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page, BEAT);
    const pop = page.locator("[data-test=neu-popup]");
    await expect(pop).toContainText("Badener Fahrt");
    await expect(pop).toContainText("Du bist dabei");
    await pop.getByRole("button", { name: "Details" }).click();
    await expect(page.locator("#ov")).toContainText("Badener Fahrt");
    await page.reload();
    await expect(page.locator("header h1")).toHaveText("Magnum");
    await expect(page.locator("[data-test=neu-popup]")).toHaveCount(0);           // nur einmal
  });

  test("ohne frühere Anmeldung (erster Besuch) kein Popup", async ({ page }) => {
    await login(page, BEAT);
    await expect(page.locator("header h1")).toHaveText("Magnum");
    await expect(page.locator("[data-test=neu-popup]")).toHaveCount(0);
  });
});
