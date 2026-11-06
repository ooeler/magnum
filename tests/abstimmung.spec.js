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
