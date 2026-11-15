// Karte der Woche: aufgedeckt nur für 3 Mitglieder, die anderen sehen sie verdeckt. So bleibt es spannend.
const base = require("@playwright/test");
const { test, expect, login, BEAT } = require("./fixtures");

// Testuhr: Samstag, 31.10.2026 → laufende Woche ab Montag, 26.10.
function woche(page, w, fuer) {
  return page.evaluate(([w, fuer]) => {
    const d = window.__mg.db();
    d.karte_der_woche.push({ woche: w, card_id: "c-2" });
    fuer.forEach((m) => d.karte_der_woche_fuer.push({ woche: w, member_id: m }));
    localStorage.setItem("__mg_db", JSON.stringify(d));
  }, [w, fuer]);
}
const kdw = (page) => page.locator("[aria-label='Karte der Woche']");

test.describe("Karte der Woche für 3 Mitglieder", () => {
  test("Wer nicht dran ist, sieht sie verdeckt und für wen sie aufgedeckt ist", async ({ page }) => {
    await page.goto("/");
    await woche(page, "2026-10-26", ["u-beat", "u-chris", "u-dani"]);
    await login(page);                                   // Ot ist diese Woche nicht dabei
    await expect(page.locator("[data-test=kdw-verdeckt]")).toContainText("Karte der Woche · verdeckt");
    await expect(kdw(page)).toContainText("Diese Woche aufgedeckt für Beat, Chris und Dani");
    await expect(kdw(page)).not.toContainText("Sonnenaufgang im Rebberg");
    await expect(page.getByRole("link", { name: "Karte in WhatsApp teilen" })).toHaveCount(0);
    expect(await page.evaluate(() => D.karte_der_woche.length)).toBe(0);   // die Karte kommt gar nicht erst an
  });

  test("Für die 3: aufgedeckt, mit den anderen beiden, ohne WhatsApp-Knopf", async ({ page }) => {
    await page.goto("/");
    await woche(page, "2026-10-26", ["u-beat", "u-chris", "u-dani"]);
    await login(page, BEAT);
    await expect(kdw(page)).toContainText("Karte der Woche · für dich aufgedeckt");
    await expect(kdw(page)).toContainText("Sonnenaufgang im Rebberg");
    await expect(page.locator("[data-test=kdw-fuer]")).toHaveText("Nur für dich, Chris und Dani · die anderen sehen sie verdeckt");
    await expect(page.getByRole("link", { name: "Karte in WhatsApp teilen" })).toHaveCount(0);
  });

  test("Vergangene Wochen sehen alle", async ({ page }) => {
    await page.goto("/");
    await woche(page, "2026-10-19", ["u-beat", "u-chris", "u-dani"]);
    await login(page);
    await expect(kdw(page)).toContainText("Karte der Woche · aufgedeckt");
    await expect(kdw(page)).toContainText("Sonnenaufgang im Rebberg");
  });
});

base.test("Auswahl der 3: wer zuletzt am seltensten dran war, keine doppelt", async () => {
  const P = await import("../functions/push.mjs");
  const alle = ["a", "b", "c", "d", "e"];
  const drei = P.dreiWaehlen(alle, ["a", "a", "b", "c"], () => 0.5);
  base.expect(drei).toHaveLength(3);
  base.expect(new Set(drei).size).toBe(3);
  base.expect(drei.slice(0, 2).sort()).toEqual(["d", "e"]);        // noch nie dran
  base.expect(["b", "c"]).toContain(drei[2]);                       // einmal dran, nicht a (zweimal)
  base.expect(P.dreiWaehlen(["x", "y"], [])).toHaveLength(2);      // weniger als 3 Mitglieder
});
