// Betrieb: PWA-Dateien und Deployment-Abläufe passen zusammen (statisch, ohne Browser).
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const release = read(".github/workflows/release.yml");
const ci = read(".github/workflows/ci.yml");

test.describe("PWA", () => {
  test("Manifest: Pflichtangaben, alle Icons vorhanden, eines maskable", () => {
    const m = JSON.parse(read("app/manifest.webmanifest"));
    expect(m).toMatchObject({ name: "Magnum", start_url: "./", scope: "./", display: "standalone" });
    for (const i of m.icons) expect(fs.existsSync(path.join(root, "app", i.src)), i.src).toBe(true);
    expect(m.icons.some((i) => i.purpose == "maskable")).toBe(true);
    expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  test("Service Worker: alle Offline-Dateien gibt es wirklich", () => {
    const shell = JSON.parse(read("app/sw.js").match(/var SHELL = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
    for (const f of shell.filter((x) => x != "./")) expect(fs.existsSync(path.join(root, "app", f)), f).toBe(true);
  });

  test("index.html bindet Manifest und Touch-Icon ein", () => {
    const html = read("app/index.html");
    expect(html).toMatch(/rel="manifest" href="manifest\.webmanifest"/);
    expect(html).toMatch(/rel="apple-touch-icon"/);
  });
});

test.describe("Deployment", () => {
  test("Release ersetzt die Cache-Version, damit Handys Updates laden", () => {
    const v = read("app/sw.js").match(/var V = "([^"]+)"/)[1];
    expect(release).toContain(`s/var V = \\"${v}\\"/`);
  });

  test("Release schreibt die Konfiguration, die die App liest", () => {
    expect(read("app/config.js")).toContain("window.MG_CONFIG");
    expect(read("app/index.html")).toContain("window.MG_CONFIG");
    expect(release).toContain('"window.MG_CONFIG = "');
  });

  test("Reihenfolge: Tests, Backup, Wartung an, Datenbank, Funktionstest, Functions, Mails, App, Wartung aus", () => {
    const schritte = ["needs: test", "Backup vor dem Deployment", "Wartungsseite einschalten", "-f supabase/setup.sql", "Sicherheitsprüfung Datenbank",
      "Funktionstest Datenbank", "- name: Edge Functions", "Mailvorlagen auf Deutsch", "needs: backend", "wartung-aus:"];
    const pos = schritte.map((s) => release.indexOf(s));
    expect(pos, "Schritt fehlt").not.toContain(-1);
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
  });

  test("Wartungsseite geht auch nach einem Fehler wieder aus", () => {
    expect(release.slice(release.indexOf("wartung-aus:"))).toMatch(/if: always\(\)/);
  });

  test("Funktionstest lässt keine Spuren in der echten Datenbank", () => {
    const t = release.slice(release.indexOf("Funktionstest Datenbank"), release.indexOf("Secret für die Vorschläge"));
    expect(t).toContain("raise exception using errcode = 'P0099'");
    expect(t).toContain("when sqlstate 'P0099' then null");
  });

  test("Pakete nur nach Lockfile, Versionen stimmen überein", () => {
    expect(ci).toContain("npm ci");
    expect(ci + release).not.toMatch(/npm install/);
    const pkg = JSON.parse(read("package.json")), lock = JSON.parse(read("package-lock.json"));
    for (const [n, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) expect(lock.packages["node_modules/" + n].version, n).toBe(v);
  });

  test("Token-Erinnerung: läuft täglich, legt ihr Label selbst an", () => {
    const y = read(".github/workflows/token-erinnerung.yml");
    expect(y).toMatch(/cron: /);
    expect(y).toContain("issues: write");
    expect(y.indexOf("gh label create wartung")).toBeGreaterThan(-1);
    expect(y.indexOf("gh label create wartung")).toBeLessThan(y.indexOf("gh issue create"));
  });

  test("Lokaler Server übersteht ungültige Adressen", async ({ request }) => {
    expect((await request.get("/%")).status()).toBe(400);
    expect((await request.get("/")).status()).toBe(200);
  });

  test("Migrationen sind richtig benannt", () => {
    const f = fs.readdirSync(path.join(root, "supabase/migrations")).filter((x) => x.endsWith(".sql"));
    for (const n of f) expect(n).toMatch(/^\d{8}_\d{2}_[a-z0-9_]+\.sql$/);
  });
});
