// Konto: Passwort, Profil, Einladungen verwalten, Wartung und Fehlermeldungen.
const { test, expect, login, tab, OT, BEAT } = require("./fixtures");

const card = (page, label) => page.locator(`[aria-label="${label}"]`);
const toast = (page) => page.locator("#toast");

test.describe("Passwort", () => {
  test("vergessen: Mail anfordern, zurück zur Anmeldung", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Passwort vergessen?" }).click();
    await page.fill("form[data-s=reset] input[name=email]", "ot@magnum.test");
    await page.click("form[data-s=reset] .btn");
    await expect(page.locator(".auth")).toContainText("Falls die Adresse bekannt ist");
    await page.getByRole("button", { name: "Zur Anmeldung" }).click();
    await expect(page.locator("#login")).toBeVisible();
  });

  test("neu setzen über den Link aus der Mail: danach gilt nur noch das neue", async ({ page }) => {
    await login(page);
    await page.evaluate(() => window.__mg.recovery());
    await page.fill("form[data-s=newpw] input[name=pw]", "neuesgeheimnis");
    await page.click("form[data-s=newpw] .btn");
    await expect(toast(page)).toContainText("Passwort gespeichert");
    await tab(page, "Club");
    await page.getByRole("button", { name: "Abmelden" }).click();
    await expect(page.locator("#login")).toBeVisible();
    await page.fill("#login input[name=email]", OT.email);
    await page.fill("#login input[name=pw]", OT.password);
    await page.click("#login .btn");
    await expect(page.locator("#login")).toContainText("stimmt nicht");
    await login(page, { email: OT.email, password: "neuesgeheimnis" });
  });

  test("ungültiger Einladungslink führt zurück zur Anmeldung", async ({ page }) => {
    await page.goto("/#einladung=" + "x".repeat(43));
    await page.getByRole("button", { name: "Zur Anmeldung" }).click();
    await expect(page.locator("#login")).toBeVisible();
    expect(new URL(page.url()).hash).toBe("");
  });
});

test.describe("Profil", () => {
  test("eigene Angaben ändern bleibt nach dem Neuladen", async ({ page }) => {
    await login(page);
    await tab(page, "Club");
    await page.fill("[data-k=pfWine]", "Humagne Rouge");
    await page.click("form[data-s=profile] .btn");
    await expect(toast(page)).toContainText("Profil gespeichert");
    await page.reload();
    await tab(page, "Club");
    await expect(page.locator("[data-k=pfWine]")).toHaveValue("Humagne Rouge");
  });

  test("Admin vergibt eine Funktion", async ({ page }) => {
    await login(page);
    await tab(page, "Club");
    await page.locator(".mem", { hasText: "Hans" }).click();
    await page.fill("#ov form[data-s=role] input", "Weinwart");
    await page.click("#ov form[data-s=role] .btn");
    await expect(toast(page)).toContainText("Funktion gespeichert");
    expect(await page.evaluate(() => window.__mg.db().profiles.find((p) => p.id == "u-hans").role_title)).toBe("Weinwart");
  });

  test("Funktion ändern ist Nicht-Admins verwehrt", async ({ page }) => {
    await login(page, BEAT);
    const r = await page.evaluate(() => window.magnumDb.createClient().rpc("admin_set_role", { p_member: "u-beat", p_role: "Präsident" }));
    expect(r.error).toBeTruthy();
  });
});

test.describe("Einladungen verwalten", () => {
  test("Link kopieren", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { window.__copied = t; return Promise.resolve() } } }));
    await login(page);
    await tab(page, "Club");
    const inv = card(page, "Einladungen");
    await inv.getByRole("button", { name: "Einladungslink erstellen" }).click();
    const link = await inv.locator("[data-test=link]").textContent();
    await inv.getByRole("button", { name: "Kopieren" }).click();
    await expect(toast(page)).toContainText("Link kopiert");
    expect(await page.evaluate(() => window.__copied)).toBe(link);
  });

  test("zurückgezogener Link gilt nicht mehr", async ({ page }) => {
    await login(page);
    await tab(page, "Club");
    const inv = card(page, "Einladungen");
    await inv.getByRole("button", { name: "Einladungslink erstellen" }).click();
    const link = await inv.locator("[data-test=link]").textContent();
    await inv.getByRole("button", { name: "Zurückziehen" }).click();
    await expect(toast(page)).toContainText("Einladung zurückgezogen");
    await expect(inv.getByRole("button", { name: "Zurückziehen" })).toHaveCount(0);
    await page.getByRole("button", { name: "Abmelden" }).click();
    await page.goto(link);
    await page.reload();
    await expect(page.locator(".auth")).toContainText("Einladung ungültig");
  });
});

test.describe("Wartung und Fehler", () => {
  test("Speichern während eines Updates zeigt die Update-Seite, keine Fehlermeldung", async ({ page }) => {
    await login(page);
    await page.evaluate(() => window.__mg.maintenance(true));
    await page.locator("[data-a=pprost][data-id=po-2]").click();
    await expect(page.locator(".auth")).toContainText("Update wird eingespielt");
    await expect(page.locator(".auth .ladeglas")).toBeVisible();
    await expect(page.locator("#toast")).not.toContainText("Datenbank");
  });

  test("Anzeige beim Laden: Weinglas füllt sich", async ({ page }) => {
    await page.addInitScript(() => { window.__mg_warten = true });
    await page.goto("/");
    await page.fill("#login input[name=email]", OT.email);
    await page.fill("#login input[name=pw]", OT.password);
    await page.click("#login .btn");
    const g = page.locator(".auth .ladeglas");
    await expect(g).toBeVisible();
    await expect(page.locator(".auth")).toContainText("Lade den Club");
    await expect(g.locator(".wein")).toHaveCSS("animation-name", "mgFill");
    await page.evaluate(() => window.__mg_weiter());
    await expect(page.locator("header h1")).toHaveText("Magnum");
    await expect(g).toHaveCount(0);
  });

  test("Bewegung reduzieren: Glas steht still und ist gefüllt", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => { window.__mg_warten = true });
    await page.goto("/");
    await page.fill("#login input[name=email]", OT.email);
    await page.fill("#login input[name=pw]", OT.password);
    await page.click("#login .btn");
    await expect(page.locator(".ladeglas .wein")).toHaveCSS("animation-name", "none");
  });

  test("Wartungsseite ersetzt die App", async ({ page }) => {
    await login(page);
    await page.evaluate(() => window.__mg.maintenance(true));
    await page.reload();
    await expect(page.locator(".auth")).toContainText("Update wird eingespielt");
    await expect(page.locator("nav")).toHaveCount(0);
  });

  test("abgelaufene Sitzung wird verständlich gemeldet", async ({ page }) => {
    await login(page);
    await page.evaluate(() => localStorage.removeItem("__mg_session"));
    await page.locator("article.ev", { hasText: "Chlaus-Magnum" }).getByRole("button", { name: /Bin dabei/ }).click();
    await expect(toast(page)).toContainText("Bitte neu anmelden.");
  });

  test("technische Fehler werden übersetzt", async ({ page }) => {
    await login(page);
    const t = await page.evaluate(() => [
      'new row violates row-level security policy for table "trips"', "permission denied for table settings",
      "duplicate key value violates unique constraint", "JWT expired", "Die Abstimmung ist abgeschlossen",
    ].map((m) => errText({ message: m })));
    expect(t).toEqual(["Dafür fehlen dir die Rechte.", "Dafür fehlen dir die Rechte.", "Das gibt es schon.", "Bitte neu anmelden.", "Die Abstimmung ist abgeschlossen"]);
  });
});

test.describe("Einladungen begrenzen", () => {
  const neu = (page, id) => page.evaluate((id) => window.__mg.asId(id, (sb) => sb.functions.invoke("invite", { body: { action: "create" } })).then((r) => !r.error), id);

  test("Mitglieder höchstens 3 offene, der Admin ohne Grenze", async ({ page }) => {
    await page.goto("/");
    for (let i = 0; i < 3; i++) expect(await neu(page, "u-beat")).toBe(true);
    expect(await neu(page, "u-beat")).toBe(false);
    for (let i = 0; i < 4; i++) expect(await neu(page, "u-ot")).toBe(true);
  });
});
