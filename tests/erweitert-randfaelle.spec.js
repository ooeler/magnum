// Erweiterte Tests: Randfälle bei Texten, Daten, Punkten, Abstimmungen, Belegen und Doppelklicks.
const { test, expect, login, tab, as, BEAT, OT, CHRIS } = require("./fixtures");

const BOESE = `<img src=x onerror="window.__xss=1">&"'<script>window.__xss=2</script>`;
function db(page, fn, arg) {
  return page.evaluate(([fn, arg]) => { const d = window.__mg.db(); new Function("d", "arg", fn)(d, arg); localStorage.setItem("__mg_db", JSON.stringify(d)) }, [fn, arg]);
}

test.describe("Texte", () => {
  test("Sonderzeichen in Namen, Titeln, Orten, Beiträgen, Gästen und Spitznamen werden nie ausgeführt", async ({ page }) => {
    const fehler = []; page.on("pageerror", (e) => fehler.push(e.message));
    await page.goto("/");
    await db(page, `const b = arg;
      d.profiles.find(p => p.id == "u-chris").display_name = b.slice(0, 40);
      d.profiles.find(p => p.id == "u-dani").nickname = b.slice(0, 40);
      d.events.find(e => e.id == "e-1").title = b.slice(0, 80); d.events.find(e => e.id == "e-1").location = b;
      d.posts.push({ id: "po-x", author_id: "u-chris", text: b, created_at: new Date().toISOString() });
      d.gaeste.push({ id: "ga-x", event_id: "e-1", trip_id: null, name: b.slice(0, 60), added_by: "u-beat", created_at: new Date().toISOString() });
      d.sayings.push({ id: "s-x", text: b, author_id: "u-chris", created_at: "2000-01-01T00:00:00Z" });
      d.saying_prosts.push({ saying_id: "s-x", member_id: "u-ot" }, { saying_id: "s-x", member_id: "u-beat" }, { saying_id: "s-x", member_id: "u-chris" });
      d.trips.find(t => t.id == "t-wallis").title = b.slice(0, 60); d.trips.find(t => t.id == "t-wallis").program = b;
      d.restaurants[0].name = b; d.cards[0].title = b; d.cards[0].story = b;`, BOESE);
    await login(page, OT);
    for (const t of ["Termine", "Reisen", "Club", "Karten", "Statistik"]) { await tab(page, t); await page.waitForTimeout(100) }
    await tab(page, "Termine");
    await page.locator("[data-ev=e-1]").getByRole("button", { name: "Details" }).click();
    await expect(page.locator("#ov")).toContainText("<img src=x");
    await page.getByRole("button", { name: "Zurück" }).click();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(fehler).toEqual([]);
  });

  test("Emoji am Namensanfang: Initiale im Kreis ist ein ganzes Zeichen (kein halbes Surrogat)", async ({ page }) => {
    await page.goto("/");
    await db(page, `d.profiles.find(p => p.id == "u-beat").display_name = "🍷 Beat";`);
    await login(page, OT);
    await tab(page, "Club");
    const av = page.locator(".mem", { hasText: "Beat" }).locator(".av");
    const t = await av.textContent();
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(t), "Initiale: " + JSON.stringify(t)).toBe(false);
  });

  test("sehr lange Wörter (Name, Anlass, Reise, Beitrag) erzeugen bei 320 px kein seitliches Scrollen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");
    const lang = "Weinbergschneckenpastetenliebhaberinnenclub".repeat(3);
    await db(page, `const l = arg;
      d.profiles.find(p => p.id == "u-chris").display_name = l.slice(0, 40);
      d.profiles.find(p => p.id == "u-dani").nickname = l.slice(0, 40);
      d.events.find(e => e.id == "e-1").title = l.slice(0, 80); d.events.find(e => e.id == "e-1").location = l.slice(0, 120);
      d.posts.push({ id: "po-x", author_id: "u-chris", text: l, created_at: new Date().toISOString() });
      d.trips.find(t => t.id == "t-wallis").title = l.slice(0, 60);
      d.cards[0].title = l.slice(0, 80); d.restaurants[0].name = l.slice(0, 80);`, lang);
    await login(page, OT);
    const breit = {};
    for (const t of ["Termine", "Reisen", "Club", "Karten", "Statistik"]) {
      await tab(page, t); await page.waitForTimeout(150);
      breit[t] = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    }
    await tab(page, "Termine");
    await page.locator("[data-ev=e-1]").getByRole("button", { name: "Details" }).click();
    breit["Anlass-Details"] = await page.evaluate(() => { const o = document.getElementById("ov"); return Math.max(o.scrollWidth - o.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth) });
    expect(breit).toEqual({ Termine: 0, Reisen: 0, Club: 0, Karten: 0, Statistik: 0, "Anlass-Details": 0 });
  });
});

test.describe("Texte am Handy", () => {
  test("Link in einem Prost-Wand-Beitrag: bei 390 px kein seitliches Scrollen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/");
    await db(page, `d.posts.push({ id: "po-l", author_id: "u-chris", text: "Fotos: https://photos.app.goo.gl/AbCdEfGhIjKlMnOpQrStUvWxYz123456", created_at: new Date().toISOString() });`);
    await login(page, BEAT);
    await expect(page.locator("[aria-label=Prost-Wand]")).toContainText("photos.app.goo.gl");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});

test.describe("Daten und Zeit", () => {
  test("Statistik: Anlass am 1. Januar 00:30 zählt zum neuen Jahr", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2027-01-15T10:00:00+01:00"));
    await page.goto("/");
    await db(page, `d.events.push({ id: "e-neujahr", title: "Neujahrs-Magnum", starts_at: new Date("2027-01-01T00:30:00+01:00").toISOString(), location: null, organizer_id: null, created_by: "u-ot", created_at: "2026-12-01T00:00:00Z" });
      ["u-ot", "u-beat"].forEach(m => d.rsvps.push({ event_id: "e-neujahr", member_id: m, status: "in", redeemed: false, updated_at: "2026-12-01T00:00:00Z" }));`);
    await login(page, OT);
    await tab(page, "Statistik");
    const soll = await page.evaluate(() => pastEvents().filter((e) => localDay(e.starts_at).slice(0, 4) == "2027").length);
    await expect(page.locator(".card", { hasText: "Anlässe 2027" }).locator(".big")).toHaveText(String(soll));
  });

  test("Anlass, der vor 1 Stunde begann, erscheint nicht gleichzeitig unter 'Nächste' und 'Vergangene'", async ({ page }) => {
    await page.goto("/");
    await db(page, `d.events.push({ id: "e-jetzt", title: "Läuft-Gerade-Magnum", starts_at: new Date(Date.now() - 3600e3).toISOString(), location: null, organizer_id: null, created_by: "u-ot", created_at: "2026-10-01T00:00:00Z" });`);
    await login(page, OT);
    const n = await page.locator("main").getByText("Läuft-Gerade-Magnum").count();
    expect(n).toBe(1);
  });

  test("Anlass um Mitternacht (00:00) zeigt Datum und Zeit des richtigen Tages", async ({ page }) => {
    await page.goto("/");
    await db(page, `d.events.push({ id: "e-mitternacht", title: "Mitternachts-Magnum", starts_at: new Date("2026-11-07T00:00:00+01:00").toISOString(), location: null, organizer_id: null, created_by: "u-ot", created_at: "2026-10-01T00:00:00Z" });`);
    await login(page, OT);
    const k = page.locator("[data-ev=e-mitternacht]");
    await expect(k.locator(".dt b")).toHaveText("7");
    await expect(k).toContainText("00:00");
  });

  test("Anlass während der Sommerzeit-Umstellung (25.10.2026 02:30) erfassen", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-20T10:00:00+02:00"));
    await page.goto("/");
    await login(page, BEAT);
    await page.getByRole("button", { name: "+ Anlass erfassen" }).click();
    await page.locator("[data-k=evTitle]").fill("Umstellungs-Test");
    await page.locator("[data-k=evDate]").fill("2026-10-25");
    await page.locator("[data-k=evTime]").fill("02:30");
    await page.getByRole("button", { name: "Anlass erfassen" }).click();
    await expect(page.locator("#toast")).toContainText("Anlass erfasst");
    await expect(page.locator("article", { hasText: "Umstellungs-Test" })).toContainText("02:30");
  });
});

test.describe("Punkte und Abstimmungen", () => {
  test("Vorschläge: 2 Punkte beim Einreichen, 10 wenn umgesetzt", async ({ page }) => {
    await page.goto("/");
    await login(page, OT);
    const p = await page.evaluate(() => {
      const vor = stats(uid()).points;
      D.feedback.push({ id: 99, user_id: uid(), status: "neu" }); CACHE = null; const neu = stats(uid()).points;
      D.feedback[D.feedback.length - 1].status = "umgesetzt"; CACHE = null; const um = stats(uid()).points;
      return [neu - vor, um - vor];
    });
    expect(p).toEqual([2, 10]);
  });

  test("Rangliste: gleiche Punkte = gleicher Rang, Nummer nur beim ersten", async ({ page }) => {
    await page.goto("/");
    await login(page, OT);
    const L = await page.evaluate(() => board().map((x) => [x.place, x.showNo, x.s.points]));
    for (let i = 1; i < L.length; i++) {
      if (L[i][2] == L[i - 1][2]) { expect(L[i][0]).toBe(L[i - 1][0]); expect(L[i][1]).toBe(false) }
      else { expect(L[i][0]).toBe(i + 1); expect(L[i][1]).toBe(true) }
    }
  });

});

test.describe("Belege", () => {
  test("Preis pro Person: CHF 100 durch 3 Personen", async ({ page }) => {
    await page.goto("/");
    await db(page, `d.restaurant_visits.push({ id: "rv-x", restaurant_id: "re-1", visited_on: "2026-10-30", people: 3, total_chf: 100, receipt_path: null, created_by: "u-ot", created_at: "2026-10-30T22:00:00Z" });`);
    await login(page, OT);
    await tab(page, "Statistik");
    await page.locator("[aria-label='Unsere Beizen'] button", { hasText: "Rest. Sonne" }).click();
    // Erwartet auf 5 Rappen genau (33.35), die App rundet auf ganze Franken
    await expect(page.locator("#ov")).toContainText("CHF 33.35 p.P.");
  });

  test("Formular 'Besuch erfassen': Personen 0 → 1, Total negativ → 0", async ({ page }) => {
    await page.goto("/");
    await login(page, OT);
    await page.locator("[data-ev=e-1]").getByRole("button", { name: "Details" }).click();
    await page.getByRole("button", { name: /Quittung fotografieren/ }).click();
    await page.locator("[data-k=rsId]").selectOption({ label: "Rest. Sonne" });
    await page.locator("[data-k=rsPeople]").fill("0");
    await page.locator("[data-k=rsTotal]").fill("-50");
    // Der Browser hält das Formular an (min=1 / min=0); an der Prüfung vorbei klemmt die App selbst
    expect(await page.evaluate(() => document.querySelector("form[data-s=visit]").checkValidity())).toBe(false);
    await page.evaluate(() => document.querySelector("form[data-s=visit]").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })));
    await expect(page.locator("#toast")).toContainText("Besuch gespeichert");
    const v = await page.evaluate(() => D.restaurant_visits.filter((x) => x.event_id == "e-1").map((x) => [x.people, x.total_chf]));
    expect(v).toEqual([[1, 0]]);
  });
});

test.describe("Doppelklick und gleichzeitiges Senden", () => {
  // Bei echtem Netz dauert eine Antwort 100–500 ms. Zwei Absendungen vor der ersten Antwort (Doppeltipp)
  // bildet der Test mit zweimal requestSubmit() direkt hintereinander nach.
  for (const [name, vorher, felder, form, tabelle] of [
    ["Prost-Wand: Beitrag", null, { postText: "Doppelt gemoppelt" }, "post", "posts"],
    ["Anlass erfassen", "+ Anlass erfassen", { evTitle: "Doppel-Anlass", evDate: "2026-11-20" }, "event", "events"],
    ["Spruch einreichen", "+ Einreichen", { spText: "Doppelt hält besser" }, "saying", "sayings"],
    ["Reise erfassen", "+ Reise erfassen", { trTitle: "Doppelreise", trFrom: "2026-12-01" }, "trip", "trips"],
  ]) {
    test(name + ": zweimal Absenden vor der Antwort legt nur einen Eintrag an", async ({ page }) => {
      await page.goto("/");
      await login(page, BEAT);
      if (vorher == "+ Reise erfassen") await tab(page, "Reisen");
      if (vorher) await page.getByRole("button", { name: vorher }).click();
      for (const k of Object.keys(felder)) await page.locator(`[data-k=${k}]`).fill(felder[k]);
      const vor = await page.evaluate((t) => window.__mg.db()[t].length, tabelle);
      await page.evaluate((f) => { const el = document.querySelector(`form[data-s=${f}]`); el.requestSubmit(); el.requestSubmit() }, form);
      await page.waitForTimeout(800);
      const nach = await page.evaluate((t) => window.__mg.db()[t].length, tabelle);
      expect(nach - vor).toBe(1);
    });
  }

  test("Anlass erfassen mit dem vorgeschlagenen Datum (nur Titel eintippen) klappt", async ({ page }) => {
    await page.goto("/");
    await login(page, BEAT);
    await page.getByRole("button", { name: "+ Anlass erfassen" }).click();
    await expect(page.locator("[data-k=evDate]")).not.toHaveValue("");
    await page.locator("[data-k=evTitle]").fill("Mit Standarddatum");
    await page.getByRole("button", { name: "Anlass erfassen", exact: true }).click();
    await expect(page.locator("#toast")).toContainText("Anlass erfasst");
    await expect(page.locator("article", { hasText: "Mit Standarddatum" })).toHaveCount(1);
  });

  test("Fahrservice: zweimal 'Plätze anbieten' vor der Antwort – im Nachbau wie in der DB höchstens ein Angebot", async ({ page }) => {
    await page.goto("/");
    await login(page, BEAT);
    await page.locator("[data-ev=e-1]").getByRole("button", { name: "Details" }).click();
    await page.getByRole("button", { name: "Ich fahre · Plätze anbieten" }).click();
    await page.evaluate(() => { const el = document.querySelector("form[data-s=ride]"); el.requestSubmit(); el.requestSubmit() });
    await page.waitForTimeout(800);
    const n = await page.evaluate(() => window.__mg.db().rides.filter((r) => r.driver_id == "u-beat" && r.event_id == "e-1").length);
    // db/setup.sql: unique (event_id, driver_id) – der Nachbau kennt das nicht
    expect(n).toBe(1);
  });
});
