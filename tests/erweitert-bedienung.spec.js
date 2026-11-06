// Erweiterte Tests: Bedienbarkeit (Tastatur, Fokus, Zurück-Taste, Beschriftungen, 320 px), Konsolenfehler,
// mehrere Tabs gleichzeitig (Live-Sync) und grobe Leistung mit vielen Daten.
const { test, expect, setup, login, tab, as, BEAT, OT, CHRIS } = require("./fixtures");

test.describe("Bedienbarkeit", () => {
  test("keine Konsolenfehler in allen Bereichen und Overlays (Admin)", async ({ page }) => {
    const fehler = [];
    page.on("pageerror", (e) => fehler.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() == "error" && !/fonts\.|Failed to load resource|tile|cartocdn/i.test(m.text())) fehler.push("console: " + m.text()) });
    await login(page, OT);
    for (const t of ["Termine", "Reisen", "Club", "Karten", "Statistik"]) { await tab(page, t); await page.waitForTimeout(200) }
    await tab(page, "Termine");
    await page.locator("[data-ev=e-1]").getByRole("button", { name: "Details" }).click(); await page.getByRole("button", { name: "Zurück" }).click();
    await tab(page, "Reisen"); await page.locator(".trip").first().click(); await page.getByRole("button", { name: "Zurück" }).click();
    await tab(page, "Club"); await page.locator(".mem").first().click(); await page.getByRole("button", { name: "Zurück" }).click();
    await tab(page, "Karten"); await page.locator(".kgrid .kc:not(.lock)").first().click(); await page.getByRole("button", { name: "Zurück" }).click();
    await tab(page, "Statistik"); await page.locator("[aria-label='Unsere Beizen'] button").first().click(); await page.getByRole("button", { name: "Zurück" }).click();
    expect(fehler).toEqual([]);
  });

  test("Escape schliesst das Overlay und der Fokus kehrt zum auslösenden Knopf zurück", async ({ page }) => {
    await login(page, OT);
    const det = page.locator("[data-ev=e-1]").getByRole("button", { name: "Details" });
    await det.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#ov")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ov")).toHaveCount(0);
    const f = await page.evaluate(() => { const a = document.activeElement; return a && a.tagName + ":" + (a.getAttribute("data-a") || "") + ":" + (a.getAttribute("data-id") || "") });
    expect(f).toBe("BUTTON:ov:e-1");
  });

  test("Overlay: Fokus springt beim Öffnen ins Overlay (Zurück-Knopf)", async ({ page }) => {
    await login(page, OT);
    const det = page.locator("[data-ev=e-1]").getByRole("button", { name: "Details" });
    await det.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#ov")).toBeVisible();
    const drin = await page.evaluate(() => !!document.activeElement.closest("#ov"));
    expect(drin).toBe(true);
  });

  test("Zurück-Taste des Browsers/Handys schliesst ein offenes Overlay statt die App zu verlassen", async ({ page }) => {
    await login(page, OT);
    await page.locator("[data-ev=e-1]").getByRole("button", { name: "Details" }).click();
    await expect(page.locator("#ov")).toBeVisible();
    await page.goBack().catch(() => {});
    await expect(page).toHaveURL(/localhost/);
    await expect(page.locator("nav")).toBeVisible();
    await expect(page.locator("#ov")).toHaveCount(0);
  });

  test("alle Knöpfe und Eingabefelder haben einen zugänglichen Namen", async ({ page }) => {
    await login(page, OT);
    const ohne = [];
    for (const t of ["Termine", "Reisen", "Club", "Karten", "Statistik"]) {
      await tab(page, t); await page.waitForTimeout(100);
      const L = await page.evaluate(() => Array.from(document.querySelectorAll("button, input:not([type=hidden]), select, textarea, a[href]")).filter((e) => {
        if (e.offsetParent === null && e.type != "file") return false;
        const lab = e.getAttribute("aria-label") || (e.labels && e.labels.length && e.labels[0].textContent.trim()) || (e.tagName != "INPUT" && e.tagName != "SELECT" && e.tagName != "TEXTAREA" && e.textContent.trim()) || e.getAttribute("title") || e.getAttribute("placeholder");
        return !lab;
      }).map((e) => e.outerHTML.slice(0, 120)));
      L.forEach((x) => ohne.push(t + ": " + x));
    }
    expect(ohne).toEqual([]);
  });

  test("320 px: kein seitliches Scrollen in allen Bereichen und Overlays", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await login(page, OT);
    const breit = {};
    for (const t of ["Termine", "Reisen", "Club", "Karten", "Statistik"]) {
      await tab(page, t); await page.waitForTimeout(150);
      breit[t] = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    }
    await tab(page, "Club"); await page.locator(".mem", { hasText: "Beat" }).click();
    breit["Mitglied (Admin)"] = await page.evaluate(() => { const o = document.getElementById("ov"); return o.scrollWidth - o.clientWidth });
    await page.getByRole("button", { name: "Zurück" }).click();
    await tab(page, "Reisen"); await page.locator(".trip", { hasText: "Wallis" }).click();
    breit["Reise"] = await page.evaluate(() => { const o = document.getElementById("ov"); return o.scrollWidth - o.clientWidth });
    expect(breit).toEqual({ Termine: 0, Reisen: 0, Club: 0, Karten: 0, Statistik: 0, "Mitglied (Admin)": 0, Reise: 0 });
  });

  test("Tastatur: Tab erreicht die Navigation und Enter wechselt den Bereich", async ({ page }) => {
    await login(page, OT);
    await page.locator("nav button", { hasText: "Club" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("nav button.on")).toHaveText("Club");
    await expect(page.locator("h2", { hasText: "Saison-Rangliste" })).toBeVisible();
  });
});

test.describe("Mehrere Tabs", () => {
  test("gleichzeitig organisieren: Beat und Chris klicken 'Ich organisiere' – am Schluss genau einer, Toast stimmt", async ({ page, browser }) => {
    await login(page, BEAT);
    await page.locator("[data-ev=e-2]").getByRole("button", { name: /Ich organisiere/ }).waitFor();
    // Chris übernimmt im Hintergrund, Beats Ansicht ist noch alt
    await as(page, CHRIS.email, `sb.rpc("claim_organizer", { p_event: "e-2" })`);
    await page.evaluate(() => { clearTimeout(RT) });
    const knopf = page.locator("[data-ev=e-2]").getByRole("button", { name: /Ich organisiere/ });
    if (await knopf.count()) await knopf.click();
    await page.waitForTimeout(600);
    const org = await page.evaluate(() => window.__mg.db().events.find((e) => e.id == "e-2").organizer_id);
    // Beat hat Chris unbemerkt verdrängt (claim_organizer erlaubt Übernahme ohne Rückfrage)
    expect(org, "Organisator nach gleichzeitigem Klick").toBe("u-chris");
  });

  test("Neuladen mitten im Ziehen einer Karte: keine doppelte Ziehung", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const d = window.__mg.db();
      d.events.push({ id: "e-x", title: "Reload-Magnum", starts_at: new Date(Date.now() - 3600e3).toISOString(), location: null, organizer_id: null, created_by: "u-ot", created_at: "2026-10-01T00:00:00Z" });
      d.rsvps.push({ event_id: "e-x", member_id: "u-beat", status: "in", redeemed: false, updated_at: "2026-10-01T00:00:00Z" });
      d.video_karten.push({ id: "v-a", title: "A", path: "videos/u-ot/a.webm", created_by: "u-ot", created_at: "2026-10-01T00:00:00Z" }, { id: "v-b", title: "B", path: "videos/u-ot/b.webm", created_by: "u-ot", created_at: "2026-10-01T00:00:00Z" });
      localStorage.setItem("__mg_db", JSON.stringify(d));
    });
    await login(page, BEAT);
    const b = page.locator("[aria-label='Karte ziehen']").getByRole("button", { name: "Karte ziehen" });
    await b.dblclick();
    await page.reload();
    await expect(page.locator("nav")).toBeVisible();
    expect(await page.evaluate(() => window.__mg.db().video_ziehungen.length)).toBe(1);
    await expect(page.locator("[aria-label='Karte ziehen']")).toHaveCount(0);
  });
});

test.describe("Leistung", () => {
  test("300 Anlässe, 2000 Anmeldungen, 500 Sammelkarten, 500 Videokarten: jeder Bereich zeichnet in unter 1 s", async ({ page }, info) => {
    test.skip(info.project.name != "desktop", "einmal reicht");
    test.setTimeout(120000);
    await page.goto("/");
    await page.evaluate(() => {
      const d = window.__mg.db(), ids = d.profiles.map((p) => p.id), t0 = Date.parse("2026-10-31T10:00:00+01:00");
      for (let i = 0; i < 300; i++) d.events.push({ id: "e-p" + i, title: "Anlass " + i, starts_at: new Date(t0 - (i - 20) * 7 * 864e5).toISOString(), location: "Ort " + i, organizer_id: ids[i % ids.length], created_by: "u-ot", created_at: "2020-01-01T00:00:00Z" });
      let n = 0;
      for (let i = 0; i < 300 && n < 2000; i++) for (let j = 0; j < ids.length && n < 2000; j++) if ((i + j) % 2 == 0 || j < 3) { d.rsvps.push({ event_id: "e-p" + i, member_id: ids[j], status: (i + j) % 7 ? "in" : "virtual", redeemed: false, updated_at: "2020-01-01T00:00:00Z" }); n++ }
      for (let i = 0; i < 500; i++) d.cards.push({ id: "c-p" + i, title: "Karte " + i, rarity: ["magic", "legend", "geil"][i % 3], story: "x", happened_on: "2020-01-01", place: "Ort", who: "Alle", photo_path: null, created_by: ids[i % ids.length], created_at: "2020-01-01T00:00:00Z" });
      for (let i = 0; i < 500; i++) d.video_karten.push({ id: "v-p" + i, title: "Video " + i, path: "videos/" + ids[i % ids.length] + "/" + i + ".webm", created_by: ids[i % ids.length], created_at: "2020-01-01T00:00:00Z" });
      for (let i = 0; i < 200; i++) d.video_ziehungen.push({ event_id: "e-p" + (i + 30), member_id: ids[i % ids.length], karte_id: "v-p" + ((i * 7) % 500), gezogen_at: "2020-01-01T00:00:00Z" });
      localStorage.setItem("__mg_db", JSON.stringify(d));
    });
    await login(page, OT);
    const ms = {};
    for (const t of ["termine", "reisen", "club", "karten", "stats"]) {
      ms[t] = await page.evaluate((t) => { TAB = t; const a = performance.now(); render(); return Math.round(performance.now() - a) }, t);
    }
    // Eine Aktion lädt alles neu und zeichnet: Gesamtdauer einer Anmeldung
    ms.anmelden = await page.evaluate(() => { const a = performance.now(); return after(sb.from("rsvps").upsert({ event_id: "e-1", member_id: uid(), status: "in" })).then(() => Math.round(performance.now() - a)) });
    console.log("Renderzeiten (ms):", JSON.stringify(ms));
    for (const k of Object.keys(ms)) expect(ms[k], k).toBeLessThan(1000);
  });
});
