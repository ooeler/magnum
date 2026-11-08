// Wischen nach links/rechts wechselt den Reiter.
const { test, expect, login } = require("./fixtures");

// Ein Wisch mit einem Finger: von (x1, y1) nach (x2, y2) über dem Element `sel`
function wisch(page, sel, x1, y1, x2, y2) {
  return page.evaluate(([sel, x1, y1, x2, y2]) => {
    const el = document.querySelector(sel);
    const tp = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [tp(x1, y1)], changedTouches: [tp(x1, y1)] }));
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [tp(x2, y2)] }));
  }, [sel, x1, y1, x2, y2]);
}
const aktiv = (page) => page.locator("nav [aria-current=page]");

test.describe("Wischen zwischen den Reitern", () => {
  // WebKit (iPhone-Projekt) lässt im Test keine künstlichen Berührungen bauen (new Touch)
  test.beforeEach(({}, info) => test.skip(info.project.name == "iphone", "new Touch in WebKit nicht möglich"));
  test("nach links: nächster Reiter, nach rechts: zurück, am Rand bleibt es", async ({ page }) => {
    await login(page);
    await expect(aktiv(page)).toHaveText("Termine");
    await wisch(page, "main h2", 300, 300, 120, 310);
    await expect(aktiv(page)).toHaveText("Reisen");
    await expect(page.locator("main")).toHaveClass(/vonr/);
    await wisch(page, "main", 100, 300, 300, 290);
    await expect(aktiv(page)).toHaveText("Termine");
    await wisch(page, "main", 100, 300, 300, 290);       // vor Termine gibt es nichts
    await expect(aktiv(page)).toHaveText("Termine");
    for (const n of ["Reisen", "Club", "Karten", "Statistik"]) {
      await wisch(page, "main", 300, 300, 100, 300);
      await expect(aktiv(page)).toHaveText(n);
    }
    await wisch(page, "main", 300, 300, 100, 300);       // nach Statistik auch nicht
    await expect(aktiv(page)).toHaveText("Statistik");
  });

  test("Scrollen, kurze Bewegungen und der Bildschirmrand wechseln nicht", async ({ page }) => {
    await login(page);
    await wisch(page, "main", 300, 400, 200, 150);       // eher senkrecht: scrollen
    await wisch(page, "main", 300, 300, 260, 300);       // zu kurz
    await wisch(page, "main", 10, 300, 250, 300);        // vom Rand: Zurück-Geste des iPhones
    await expect(aktiv(page)).toHaveText("Termine");
  });

  test("In einem offenen Fenster und in Eingabefeldern wechselt nichts", async ({ page }) => {
    await login(page);
    await page.locator("[data-a=ov][data-t=event]").first().click();
    await expect(page.locator("#ov")).toBeVisible();
    await wisch(page, "#ov", 300, 300, 100, 300);
    await page.keyboard.press("Escape");
    await expect(aktiv(page)).toHaveText("Termine");
    await page.getByRole("button", { name: "+ Anlass erfassen" }).click();
    await wisch(page, "main input", 300, 300, 100, 300);
    await expect(aktiv(page)).toHaveText("Termine");
  });
});
