// Erweiterte Tests Videokarten: Ziehfenster an den Grenzen (auch Sommerzeit), leerer Stapel, nur eigene Karten,
// alle schon gezogen, Admin, Löschen, Prozent-Rundung, Status-Wechsel nach dem Ziehen.
const { test, expect, login, tab, BEAT, OT } = require("./fixtures");

// Legt einen Anlass mit Beginn `start` an (ISO), Beat mit Status `st`, und die Karten `karten`
function vorbereiten(page, start, st, karten) {
  return page.evaluate(([start, st, karten]) => {
    const d = window.__mg.db();
    d.events.push({ id: "e-x", title: "Rand-Magnum", starts_at: start, location: "Pinte", organizer_id: null, created_by: "u-ot", created_at: "2026-01-01T00:00:00Z" });
    if (st) d.rsvps.push({ event_id: "e-x", member_id: "u-beat", status: st, redeemed: false, updated_at: "2026-01-01T00:00:00Z" });
    karten.forEach((k, i) => d.video_karten.push({ id: "v-" + i, title: k.t || "Karte " + i, path: "videos/" + k.by + "/" + i + ".webm", created_by: k.by, created_at: "2026-01-01T00:00:00Z" }));
    localStorage.setItem("__mg_db", JSON.stringify(d));
  }, [start, st, karten]);
}
const DREI = [{ by: "u-ot" }, { by: "u-chris" }, { by: "u-chris" }];

async function zeit(page, iso) { await page.clock.setFixedTime(new Date(iso)) }

test.describe("Videokarten erweitert: Ziehfenster", () => {
  const faelle = [
    // [Beschreibung, Anlass-Beginn, Uhrzeit, sichtbar]
    ["1 Sekunde vor Beginn", "2026-10-30T19:00:00+01:00", "2026-10-30T18:59:59+01:00", false],
    ["genau bei Beginn", "2026-10-30T19:00:00+01:00", "2026-10-30T19:00:00+01:00", true],
    ["nächster Tag 11:59:59", "2026-10-30T19:00:00+01:00", "2026-10-31T11:59:59+01:00", true],
    ["nächster Tag genau 12:00", "2026-10-30T19:00:00+01:00", "2026-10-31T12:00:00+01:00", true],
    ["nächster Tag 12:00:01", "2026-10-30T19:00:00+01:00", "2026-10-31T12:00:01+01:00", false],
    // Sommerzeit-Ende: Nacht vom 24. auf den 25. Oktober 2026 (03:00 → 02:00)
    ["Sommerzeit-Ende 25.10. 11:59 MEZ", "2026-10-24T19:00:00+02:00", "2026-10-25T11:59:00+01:00", true],
    ["Sommerzeit-Ende 25.10. 12:01 MEZ", "2026-10-24T19:00:00+02:00", "2026-10-25T12:01:00+01:00", false],
    // Sommerzeit-Beginn: Nacht vom 27. auf den 28. März 2027 (02:00 → 03:00)
    ["Sommerzeit-Beginn 28.3. 11:59 MESZ", "2027-03-27T19:00:00+01:00", "2027-03-28T11:59:00+02:00", true],
    ["Sommerzeit-Beginn 28.3. 12:01 MESZ", "2027-03-27T19:00:00+01:00", "2027-03-28T12:01:00+02:00", false],
    // Anlass um Mitternacht beginnt am neuen Tag: ziehen bis am Folgetag 12 Uhr
    ["Anlass 00:00, am selben Tag 23:00", "2026-11-01T00:00:00+01:00", "2026-11-01T23:00:00+01:00", true],
    ["Anlass 23:59 am 31.12., Neujahr 11:00", "2026-12-31T23:59:00+01:00", "2027-01-01T11:00:00+01:00", true],
    ["Schaltjahr: Anlass 28.2.2028, 29.2. 11:00", "2028-02-28T19:00:00+01:00", "2028-02-29T11:00:00+01:00", true],
    ["Schaltjahr: Anlass 28.2.2028, 1.3. 11:00", "2028-02-28T19:00:00+01:00", "2028-03-01T11:00:00+01:00", false],
  ];
  for (const [name, start, jetzt, sichtbar] of faelle) {
    test(name + (sichtbar ? " → Karte ziehen sichtbar und Ziehen klappt" : " → kein Ziehen"), async ({ page }) => {
      await zeit(page, jetzt);
      await page.goto("/");
      await vorbereiten(page, start, "in", DREI);
      await login(page, BEAT);
      const box = page.locator("[aria-label='Karte ziehen']");
      await expect(page.locator("[data-test=punkte]")).toBeVisible();
      await expect(box).toHaveCount(sichtbar ? 1 : 0);
      // Die Datenbank-Regel (Nachbau) muss zur Anzeige passen
      const r = await page.evaluate(() => sb.rpc("karte_ziehen", { p_event: "e-x" }).then((r) => r.error ? r.error.message : "ok"));
      expect(r == "ok").toBe(sichtbar);
    });
  }
});

test.describe("Videokarten erweitert: Stapel", () => {
  test("leerer Stapel: 0 von 0 · 0 %, keine Division durch null", async ({ page }) => {
    await page.goto("/");
    await login(page, BEAT);
    await tab(page, "Karten");
    await expect(page.locator("[data-test=video-stand]")).toHaveText("0 von 0 · 0 %");
    await expect(page.locator("[aria-label=Videokarten] .bar i")).toHaveAttribute("style", /width:0%/);
  });

  test("leerer Stapel am Abend: Box 'Karte ziehen' sollte nicht erscheinen (oder klar sagen, dass nichts da ist)", async ({ page }) => {
    await page.goto("/");
    await vorbereiten(page, "2026-10-31T09:00:00+01:00", "in", []);
    await login(page, BEAT);
    await expect(page.locator("[data-test=punkte]")).toBeVisible();
    // Erwartung: Ohne Karte im Stapel kein Aufruf "Deine Magnum-Karte wartet"
    await expect(page.locator("[aria-label='Karte ziehen']")).toHaveCount(0);
  });

  test("nur eigene Karten im Stapel: Box sollte nicht 'Karte wartet' versprechen", async ({ page }) => {
    await page.goto("/");
    await vorbereiten(page, "2026-10-31T09:00:00+01:00", "in", [{ by: "u-beat" }, { by: "u-beat" }]);
    await login(page, BEAT);
    await expect(page.locator("[data-test=punkte]")).toBeVisible();
    const box = page.locator("[aria-label='Karte ziehen']");
    if (await box.count()) {
      await box.getByRole("button", { name: "Karte ziehen" }).click();
      await expect(page.locator("#toast")).toContainText("Keine neue Karte");
    }
    await expect(box).toHaveCount(0);
  });

  test("alle Karten schon an früheren Abenden gezogen: kein weiteres Ziehen", async ({ page }) => {
    await page.goto("/");
    await vorbereiten(page, "2026-10-31T09:00:00+01:00", "in", DREI);
    await page.evaluate(() => {
      const d = window.__mg.db();
      ["v-0", "v-1", "v-2"].forEach((k) => d.video_ziehungen.push({ event_id: "e-past" + (k == "v-0" ? "1" : "2") + k, member_id: "u-beat", karte_id: k, gezogen_at: "2026-09-01T20:00:00Z" }));
      localStorage.setItem("__mg_db", JSON.stringify(d));
    });
    await login(page, BEAT);
    await tab(page, "Karten");
    await expect(page.locator("[data-test=video-stand]")).toHaveText("3 von 3 · 100 %");
    const r = await page.evaluate(() => sb.rpc("karte_ziehen", { p_event: "e-x" }).then((r) => r.error && r.error.message));
    expect(r).toContain("Keine neue Karte");
  });

  test("Prozent wird gerundet: 1 von 3 → 33 %, 2 von 3 → 67 %", async ({ page }) => {
    await page.goto("/");
    await vorbereiten(page, "2026-10-31T09:00:00+01:00", "in", DREI);
    await page.evaluate(() => {
      const d = window.__mg.db();
      d.video_ziehungen.push({ event_id: "e-past1", member_id: "u-beat", karte_id: "v-0", gezogen_at: "2026-09-01T20:00:00Z" });
      localStorage.setItem("__mg_db", JSON.stringify(d));
    });
    await login(page, BEAT);
    await tab(page, "Karten");
    await expect(page.locator("[data-test=video-stand]")).toHaveText("1 von 3 · 33 %");
    await tab(page, "Termine");
    await page.locator("[aria-label='Karte ziehen']").getByRole("button", { name: "Karte ziehen" }).click();
    await expect(page.locator("#ov video")).toHaveCount(1);
    await page.getByRole("button", { name: "Zurück" }).click();
    await tab(page, "Karten");
    await expect(page.locator("[data-test=video-stand]")).toHaveText("2 von 3 · 67 %");
  });

  test("nach dem Ziehen abmelden: Karte bleibt, kein zweites Ziehen nach erneutem Anmelden", async ({ page }) => {
    await page.goto("/");
    await vorbereiten(page, "2026-10-31T09:00:00+01:00", "in", DREI);
    await login(page, BEAT);
    await page.locator("[aria-label='Karte ziehen']").getByRole("button", { name: "Karte ziehen" }).click();
    await expect(page.locator("#ov video")).toHaveCount(1);
    await page.getByRole("button", { name: "Zurück" }).click();
    const r1 = await page.evaluate(() => sb.from("rsvps").upsert({ event_id: "e-x", member_id: uid(), status: "out" }).then((r) => r.error && r.error.message));
    expect(r1).toBeNull();
    await page.evaluate(() => loadAll().then(render));
    await expect(page.locator("[aria-label='Karte ziehen']")).toHaveCount(0);
    await tab(page, "Karten");
    await expect(page.locator("[data-test=video-stand]")).toHaveText("1 von 3 · 33 %");
    const r2 = await page.evaluate(() => sb.from("rsvps").upsert({ event_id: "e-x", member_id: uid(), status: "in" }).then(() => sb.rpc("karte_ziehen", { p_event: "e-x" })).then((r) => r.error && r.error.message));
    expect(r2).toContain("schon gezogen");
  });

  test("Admin: verwaltet alle Karten, sieht Anzahl Ziehungen, Löschen einer gezogenen Karte", async ({ page }) => {
    await page.goto("/");
    await vorbereiten(page, "2026-10-31T09:00:00+01:00", "in", DREI);
    await page.evaluate(() => {
      const d = window.__mg.db();
      d.video_ziehungen.push({ event_id: "e-x", member_id: "u-beat", karte_id: "v-1", gezogen_at: "2026-10-31T09:30:00Z" });
      localStorage.setItem("__mg_db", JSON.stringify(d));
    });
    await login(page, OT);
    await tab(page, "Karten");
    // Admin hat keine Karte gezogen, aber eine im Stapel
    await expect(page.locator("[data-test=video-stand]")).toHaveText("0 von 3 · 0 %");
    await expect(page.locator("[data-test=video-eigene]")).toHaveText("Von dir im Stapel: 1");
    const det = page.locator("[aria-label=Videokarten] details");
    await det.locator("summary").click();
    await expect(det).toContainText("1 Mal gezogen");
    await det.getByRole("button", { name: /Karte 1/ }).click();
    await page.locator("#ov").getByRole("button", { name: "Videokarte löschen" }).click();
    await expect(page.locator("#toast")).toContainText("gelöscht");
    await expect(page.locator("[data-test=video-stand]")).toHaveText("0 von 2 · 0 %");
    // Die Ziehung ist mit der Karte weg (cascade)
    expect(await page.evaluate(() => D.video_ziehungen.length)).toBe(0);
  });

  test("Titel mit Sonderzeichen und Emoji wird sauber angezeigt", async ({ page }) => {
    await page.goto("/");
    await vorbereiten(page, "2026-10-31T09:00:00+01:00", "in", [{ by: "u-beat", t: `<img src=x onerror="window.__xss=1">&"'🍾` }]);
    await login(page, OT);
    await tab(page, "Karten");
    const det = page.locator("[aria-label=Videokarten] details");
    await det.locator("summary").click();
    await expect(det).toContainText(`<img src=x onerror="window.__xss=1">&"'🍾`);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});
