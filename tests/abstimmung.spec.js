// Abstimmen über die Oberfläche: Unterstützung, Ja/Nein und die Meldung zum Ergebnis.
const { test, expect, login, tab, as, OT, BEAT, CHRIS } = require("./fixtures");

const card = (page, label) => page.locator(`[aria-label="${label}"]`);
const toast = (page) => page.locator("#toast");

// Ot schlägt für Hans vor, Beat unterstützt. Alle ausser Hans: total 10, nötig 7; Ot + Beat = 2
async function vorschlag(page) {
  await page.goto("/");
  await as(page, OT.email, "sb.rpc('propose_nickname', { p_target: 'u-hans', p_nick: 'Hansi' })");
}
async function unterstuetzt(page) {
  await vorschlag(page);
  await as(page, BEAT.email, "sb.rpc('second_proposal', { p_proposal: window.__mg.db().proposals.find(p => p.kind == 'nickname' && p.status == 'open').id })");
}
const stimmen = (page, ids, ja) => page.evaluate(async ([ids, ja]) => {
  const id = window.__mg.db().proposals.find((p) => p.kind == "nickname" && p.status == "open").id;
  for (const u of ids) await window.__mg.asId(u, (sb) => sb.rpc("cast_ballot", { p_proposal: id, p_yes: ja }));
}, [ids, ja]);
async function hans(page, user) {
  await login(page, user);
  await tab(page, "Club");
  await page.locator(".mem", { hasText: "Hans" }).click();
  return card(page, "Spitzname");
}

test.describe("Spitzname", () => {
  test("zweite Unterstützung per Knopf", async ({ page }) => {
    await vorschlag(page);
    const n = await hans(page, BEAT);
    await n.getByRole("button", { name: "Ich unterstütze den Vorschlag" }).click();
    await expect(toast(page)).toContainText("Unterstützt · Abstimmung offen");
    await expect(n.locator("[data-test=nickstatus]")).toContainText("unterstützt von Beat");
    await expect(n).toContainText("Ja 2 · Nein 0 · offen 8 · nötig 7");
  });

  test("Antragsteller sieht keinen Unterstützen-Knopf", async ({ page }) => {
    await vorschlag(page);
    const n = await hans(page);
    await expect(n.locator("[data-test=nickstatus]")).toContainText("Braucht eine zweite Person");
    await expect(n.getByRole("button", { name: "Ich unterstütze den Vorschlag" })).toHaveCount(0);
  });

  test("Stimme abgeben: nur einmal, Abstimmung bleibt offen", async ({ page }) => {
    await unterstuetzt(page);
    const n = await hans(page, CHRIS);
    await n.getByRole("button", { name: "Ja, passt" }).click();
    await expect(toast(page)).toContainText("Stimme abgegeben");
    await expect(n).toContainText("Ja 3 · Nein 0 · offen 7 · nötig 7");
    await expect(n.getByRole("button", { name: "Ja, passt" })).toHaveCount(0);
  });

  test("letzte nötige Stimme: Spitzname ist vergeben", async ({ page }) => {
    await unterstuetzt(page);
    await stimmen(page, ["u-dani", "u-erich", "u-gabi", "u-jurg"], true); // 2 + 4 = 6 von nötig 7
    const n = await hans(page, CHRIS);
    await n.getByRole("button", { name: "Ja, passt" }).click();
    await expect(toast(page)).toContainText("Angenommen mit Zweidrittelmehrheit!");
    await expect(n).toContainText("«Hansi»");
  });

  test("Nein macht die Mehrheit unmöglich: abgelehnt", async ({ page }) => {
    await unterstuetzt(page);
    await stimmen(page, ["u-fritz", "u-ivo", "u-kurt"], false); // mit einem weiteren Nein bleiben nur noch 6 möglich
    const n = await hans(page, CHRIS);
    await n.getByRole("button", { name: "Nein" }).click();
    await expect(toast(page)).toContainText("Abgelehnt");
    await expect(n).toContainText("noch keiner");
  });
});

test.describe("Sacceri", () => {
  async function wallis(page, user) {
    await login(page, user);
    await tab(page, "Reisen");
    await page.locator(".trip", { hasText: "Wallis" }).click();
    return card(page, "Auszeichnung De Sacceri");
  }

  test("Mitreisende stimmen per Knopf ab, jede Stimme zählt gleich", async ({ page }) => {
    await page.goto("/");
    await as(page, OT.email, "sb.rpc('propose_sacceri', { p_trip: 't-wallis', p_target: 'u-chris' })");
    const s = await wallis(page, BEAT);
    await s.getByRole("button", { name: "Nein" }).click();
    await expect(toast(page)).toContainText("Stimme abgegeben");
    await expect(s.locator("[data-test=tally]")).toHaveText("Ja 1 · Nein 1 · offen 1 · nötig 2");
    await expect(s).toContainText("Deine Stimme ist abgegeben");
  });

  test("Die vorgeschlagene Person stimmt nicht über sich selbst ab", async ({ page }) => {
    await page.goto("/");
    await as(page, OT.email, "sb.rpc('propose_sacceri', { p_trip: 't-wallis', p_target: 'u-chris' })");
    const s = await wallis(page, CHRIS);
    await expect(s).toContainText("Über dich stimmen die anderen Mitreisenden ab.");
    await expect(s.getByRole("button", { name: "Ja, verdient" })).toHaveCount(0);
    await expect(s.locator("[data-test=tally]")).toHaveText("Ja 1 · Nein 0 · offen 2 · nötig 2");
    const r = await page.evaluate(() => {
      const id = window.__mg.db().proposals.find((p) => p.kind == "sacceri" && p.status == "open").id;
      return window.__mg.asId("u-chris", (sb) => sb.rpc("cast_ballot", { p_proposal: id, p_yes: true }));
    });
    expect(r.error.message).toContain("nicht stimmberechtigt");
  });

  test("Nicht-Mitreisende stimmen nicht mit", async ({ page }) => {
    await page.goto("/");
    await as(page, BEAT.email, "sb.from('trip_participants').delete().eq('trip_id', 't-wallis').eq('member_id', 'u-beat')");
    await as(page, OT.email, "sb.rpc('propose_sacceri', { p_trip: 't-wallis', p_target: 'u-chris' })");
    const s = await wallis(page, BEAT);
    await expect(s).toContainText("Nur Mitreisende stimmen ab.");
    await expect(s.getByRole("button", { name: "Ja, verdient" })).toHaveCount(0);
  });

  test("Beitritt nach dem Antrag gibt keine Stimme", async ({ page }) => {
    await page.goto("/");
    await as(page, OT.email, "sb.rpc('propose_sacceri', { p_trip: 't-wallis', p_target: 'u-chris' })");
    await page.evaluate(() => window.__mg.asId("u-erich", (sb) => sb.from("trip_participants").insert({ trip_id: "t-wallis", member_id: "u-erich" })));
    const r = await page.evaluate(() => {
      const id = window.__mg.db().proposals.find((p) => p.kind == "sacceri" && p.status == "open").id;
      return window.__mg.asId("u-erich", (sb) => sb.rpc("cast_ballot", { p_proposal: id, p_yes: false }));
    });
    expect(r.error.message).toContain("nicht stimmberechtigt");
  });
});

// ───────────── Strafen: Anwesende beantragen, ⅔ der übrigen Anwesenden entscheiden ─────────────
test.describe("Strafen", () => {
  // Abend vor 2 Tagen: Ot, Beat, Chris dabei, Dani virtuell. Stimmberechtigt gegen Beat: Ot und Chris (nötig 2)
  async function strafabend(page, tageZurueck) {
    await page.goto("/");
    await page.evaluate((t) => {
      const d = window.__mg.db(), iso = new Date(Date.now() - t * 864e5).toISOString();
      d.events.push({ id: "e-straf", title: "Blinddegustation", starts_at: iso, location: "Keller", organizer_id: null, created_by: "u-ot", created_at: iso });
      for (const [m, s] of [["u-ot", "in"], ["u-beat", "in"], ["u-chris", "in"], ["u-dani", "virtual"]]) d.rsvps.push({ event_id: "e-straf", member_id: m, status: s, redeemed: false, updated_at: iso });
      localStorage.setItem("__mg_db", JSON.stringify(d));
    }, tageZurueck);
  }
  async function oeffnen(page) {
    await page.locator("summary", { hasText: "Vergangene Anlässe" }).click();
    await page.locator('[data-a=ov][data-t=event][data-id="e-straf"]').click();
    return page.locator("#ov [aria-label=Strafen]");
  }

  test("beantragen, Push an die Anwesenden, ⅔ → ausgesprochen: Punkte weg, Magnum in der Kasse, Push an den Bestraften", async ({ page }) => {
    await strafabend(page, 2);
    await login(page);
    const vorher = await page.evaluate(() => stats("u-beat").points);
    const kasse = await page.evaluate(() => strafMagnums());
    const st = await oeffnen(page);
    await st.getByRole("button", { name: "Strafe beantragen" }).click();
    await st.locator("[data-k=stWer]").selectOption({ label: "Beat" });
    await st.getByRole("button", { name: "−50" }).click();
    await st.locator("[data-k=stGrund]").fill("Hat auf die Etikette geschaut");
    await st.getByRole("button", { name: "Antrag stellen" }).click();
    await expect(page.locator("#toast")).toContainText("Strafantrag gestellt");
    await expect(st.locator("[data-test=strafe]")).toContainText("Beat · −50 Punkte + 1 Magnum");
    await expect(st.locator("[data-test=strafe-status]")).toHaveText("Abstimmung läuft");
    await expect(st.locator("[data-test=tally]")).toHaveText("Ja 1 · Nein 0 · offen 1 · nötig 2");
    await expect(st).toContainText("Deine Stimme ist abgegeben");
    // Chris stimmt zu
    const r = await page.evaluate(() => window.__mg.asId("u-chris", (sb) => sb.rpc("cast_ballot", { p_proposal: D.proposals.find((p) => p.kind == "strafe").id, p_yes: true })));
    expect(r.data).toBe("passed");
    await page.reload();
    const st2 = await oeffnen(page);
    await expect(st2.locator("[data-test=strafe-status]")).toHaveText("Ausgesprochen");
    expect(await page.evaluate(() => stats("u-beat").points)).toBe(vorher - 50);
    expect(await page.evaluate(() => stats("u-beat").parts.Strafen)).toBe(-50);
    expect(await page.evaluate(() => strafMagnums())).toBe(kasse + 1);
    const push = await page.evaluate(() => (window.__mg.db().push_queue || []).filter((x) => x.titel == "Strafe ausgesprochen").map((x) => x.an));
    expect(push).toEqual(["u-beat"]);
  });

  test("die bestrafte Person und Abwesende stimmen nicht ab; virtuell Dabeigewesene beantragen nichts", async ({ page }) => {
    await strafabend(page, 1);
    await as(page, OT.email, "sb.rpc('propose_strafe', { p_event: 'e-straf', p_target: 'u-beat', p_punkte: 20, p_grund: 'Glas versteckt' })");
    await login(page, BEAT);
    const st = await oeffnen(page);
    await expect(st).toContainText("Über dich stimmen die anderen Anwesenden ab.");
    await expect(st.getByRole("button", { name: "Ja, Strafe" })).toHaveCount(0);
    const r = await page.evaluate(() => window.__mg.asId("u-dani", (sb) => sb.rpc("propose_strafe", { p_event: "e-straf", p_target: "u-chris", p_punkte: 10, p_grund: "x" })));
    expect(r.error.message).toContain("Nur Anwesende");
    const r2 = await page.evaluate(() => window.__mg.asId("u-dani", (sb) => sb.rpc("cast_ballot", { p_proposal: D.proposals.find((p) => p.kind == "strafe").id, p_yes: true })));
    expect(r2.error.message).toContain("nicht stimmberechtigt");
  });

  test("Chris stimmt in der App mit Ja: Zweidrittelmehrheit erreicht", async ({ page }) => {
    await strafabend(page, 3);
    await as(page, OT.email, "sb.rpc('propose_strafe', { p_event: 'e-straf', p_target: 'u-beat', p_punkte: 10, p_grund: 'Falscher Jahrgang behauptet' })");
    await login(page, CHRIS);
    const st = await oeffnen(page);
    await st.getByRole("button", { name: "Ja, Strafe" }).click();
    await expect(page.locator("#toast")).toContainText("Angenommen mit Zweidrittelmehrheit");
    await expect(st.locator("[data-test=strafe-status]")).toHaveText("Ausgesprochen");
  });

  test("nach 7 Tagen kein neuer Antrag mehr; offene Anträge laufen nach 7 Tagen ab", async ({ page }) => {
    await strafabend(page, 6);
    await as(page, OT.email, "sb.rpc('propose_strafe', { p_event: 'e-straf', p_target: 'u-beat', p_punkte: 20, p_grund: 'Bescheissen' })");
    await page.evaluate(() => { const d = window.__mg.db(); d.proposals.find((p) => p.kind == "strafe").created_at = new Date(Date.now() - 8 * 864e5).toISOString(); d.events.find((e) => e.id == "e-straf").starts_at = new Date(Date.now() - 9 * 864e5).toISOString(); localStorage.setItem("__mg_db", JSON.stringify(d)) });
    await login(page, CHRIS);
    const st = await oeffnen(page);
    await expect(st.locator("[data-test=strafe-status]")).toHaveText("Abgelaufen");
    await expect(st.getByRole("button", { name: "Strafe beantragen" })).toHaveCount(0);
    await expect(st.getByRole("button", { name: "Ja, Strafe" })).toHaveCount(0);
    const r = await page.evaluate(() => window.__mg.asId("u-chris", (sb) => sb.rpc("cast_ballot", { p_proposal: D.proposals.find((p) => p.kind == "strafe").id, p_yes: true })));
    expect(r.data).toBe("abgelaufen");
  });
});
