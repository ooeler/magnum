// Abstimmen über die Oberfläche: Unterstützung, Ja/Nein und die Meldung zum Ergebnis.
const { test, expect, login, tab, as, OT, BEAT, CHRIS } = require("./fixtures");

const card = (page, label) => page.locator(`[aria-label="${label}"]`);
const toast = (page) => page.locator("#toast");

// Ot schlägt für Hans vor, Beat unterstützt. Alle ausser Hans: total 13, nötig 9; Ot 1 + Beat 2 = 3
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
    await expect(n).toContainText("Ja 3 · Nein 0 · offen 10 · nötig 9");
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
    await expect(n).toContainText("Ja 4 · Nein 0 · offen 9 · nötig 9");
    await expect(n.getByRole("button", { name: "Ja, passt" })).toHaveCount(0);
  });

  test("letzte nötige Stimme: Spitzname ist vergeben", async ({ page }) => {
    await unterstuetzt(page);
    await stimmen(page, ["u-dani", "u-erich", "u-gabi", "u-jurg", "u-kurt"], true); // 3 + 5 = 8 von nötig 9
    const n = await hans(page, CHRIS);
    await n.getByRole("button", { name: "Ja, passt" }).click();
    await expect(toast(page)).toContainText("Angenommen mit Zweidrittelmehrheit!");
    await expect(n).toContainText("«Hansi»");
  });

  test("Nein macht die Mehrheit unmöglich: abgelehnt", async ({ page }) => {
    await unterstuetzt(page);
    await stimmen(page, ["u-fritz", "u-ivo"], false); // Android: 4 Nein, mit einem weiteren bleiben nur noch 8 möglich
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

  test("Mitreisende stimmen per Knopf ab, Android zählt doppelt", async ({ page }) => {
    await page.goto("/");
    await as(page, OT.email, "sb.rpc('propose_sacceri', { p_trip: 't-wallis', p_target: 'u-chris' })");
    const s = await wallis(page, BEAT);
    await s.getByRole("button", { name: "Ja, verdient" }).click();
    await expect(toast(page)).toContainText("Stimme abgegeben");
    await expect(s.locator("[data-test=tally]")).toHaveText("Ja 3 · Nein 0 · offen 2 · nötig 4");
    await expect(s).toContainText("Deine Stimme ist abgegeben");
  });

  test("Nicht-Mitreisende stimmen nicht mit", async ({ page }) => {
    await page.goto("/");
    await as(page, OT.email, "sb.rpc('propose_sacceri', { p_trip: 't-wallis', p_target: 'u-chris' })");
    await as(page, OT.email, "sb.from('trip_participants').delete().eq('trip_id', 't-wallis').eq('member_id', 'u-ot')");
    await as(page, BEAT.email, "sb.from('trip_participants').delete().eq('trip_id', 't-wallis').eq('member_id', 'u-beat')");
    const s = await wallis(page, BEAT);
    await expect(s).toContainText("Nur Mitreisende stimmen ab.");
    await expect(s.getByRole("button", { name: "Ja, verdient" })).toHaveCount(0);
  });
});
