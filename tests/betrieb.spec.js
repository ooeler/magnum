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

  test("Reihenfolge: Tests, Backup, Wartung an, Neon-Dienste, Datenbank, Funktionstest, App, Wartung aus", () => {
    const schritte = ["needs: [pruefen, test]", "Backup vor dem Deployment", "Wartungsseite einschalten", "neon deploy --env", "-f db/setup.sql", "Sicherheitsprüfung Datenbank",
      "Funktionstest Datenbank", "needs: backend", "wartung-aus:"];
    const pos = schritte.map((s) => release.indexOf(s));
    expect(pos, "Schritt fehlt").not.toContain(-1);
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
  });

  test("Release ueberspringt Tests nur fuer den im PR gruen getesteten Stand", () => {
    const b = release.slice(release.indexOf("  backend:"), release.indexOf("Backup vor dem Deployment"));
    expect(b).toContain("needs.test.result == 'success'");
    expect(b).toContain("needs.test.result == 'skipped' && needs.pruefen.outputs.getestet == 'true'");
    const p = release.slice(release.indexOf("  pruefen:"), release.indexOf("  test:"));
    expect(p).toContain("git rev-parse 'HEAD^{tree}'");
    expect(p).toContain('select(.conclusion != "success")');
  });

  test("Release prüft, dass Konten nur mit Einladung entstehen", () => {
    const t = release.slice(release.indexOf("Sicherheitsprüfung Datenbank"), release.indexOf("Funktionstest Datenbank"));
    expect(t).toContain("user_gate");
    expect(t).toMatch(/exit 1/);
  });

  test("Wartungsseite geht auch nach einem Fehler wieder aus", () => {
    expect(release.slice(release.indexOf("wartung-aus:"))).toMatch(/if: always\(\)/);
  });

  test("Funktionstest lässt keine Spuren in der echten Datenbank", () => {
    const t = release.slice(release.indexOf("Funktionstest Datenbank"), release.indexOf("  pages:"));
    expect(t).toContain("raise exception using errcode = 'P0099'");
    expect(t).toContain("when sqlstate 'P0099' then null");
  });

  test("Pakete nur nach Lockfile, Versionen stimmen überein", () => {
    expect(ci).toContain("npm ci");
    expect(ci + release).not.toMatch(/npm install/);
    const pkg = JSON.parse(read("package.json")), lock = JSON.parse(read("package-lock.json"));
    for (const [n, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) expect(lock.packages["node_modules/" + n].version, n).toBe(v);
  });

  test("Lokaler Server übersteht ungültige Adressen", async ({ request }) => {
    expect((await request.get("/%")).status()).toBe(400);
    expect((await request.get("/")).status()).toBe(200);
  });

  test("Migrationen sind richtig benannt", () => {
    const f = fs.readdirSync(path.join(root, "db/migrations")).filter((x) => x.endsWith(".sql"));
    for (const n of f) expect(n).toMatch(/^\d{8}_\d{2}_[a-z0-9_]+\.sql$/);
  });
});

test.describe("Visuelle Tests", () => {
  const auto = read(".github/workflows/auto-merge.yml"), vis = read(".github/workflows/visuell.yml"), sh = read("scripts/visuell.sh");

  test("Keine Referenzbilder im Repo, nicht Teil der normalen Läufe", () => {
    expect(fs.existsSync(path.join(root, "tests/visuell.spec.js-snapshots"))).toBe(false);
    expect(read(".gitignore")).toMatch(/^visuell-referenz\/$/m);
    const cfg = read("playwright.config.js");
    expect(cfg).toContain('testIgnore: VISUELL ? [] : ["visuell.spec.js"]');
    expect(cfg).toContain("VISUELL_BILDER");
  });

  test("Vergleich: Basis-Stand erzeugt die Referenz, neuer Stand wird verglichen", () => {
    // Referenz aus dem gebauten Basis-Stand, Spec und Nachbau aus dem neuen Stand
    const ref = sh.indexOf("tests/visuell.spec.js --update-snapshots=all"), vgl = sh.lastIndexOf("npx playwright test tests/visuell.spec.js");
    expect(sh).toContain('git worktree add --detach "$wt" "$basis"');
    expect(sh.indexOf("&& node scripts/build.mjs")).toBeGreaterThan(-1);
    expect(sh.indexOf("&& node scripts/build.mjs")).toBeLessThan(ref);
    expect(sh.slice(0, ref)).toContain('VISUELL_DIST="$wt/dist"');
    expect(vgl).toBeGreaterThan(ref);
    expect(sh.slice(vgl)).not.toContain("update-snapshots");
    expect(sh).toContain("set -euo pipefail");
    // CI: Base des Pull Requests, mobil und Desktop, Unterschiede als Artefakt
    expect(vis).toContain("npm ci");
    expect(vis).not.toMatch(/npm install/);
    expect(vis).toContain('bash scripts/visuell.sh "$BASIS" --project=android --project=desktop');
    expect(vis).toMatch(/if: failure\(\)\n\s+with:\n\s+name: visuell-unterschiede/);
    expect(auto).toContain("basis: ${{ github.event.pull_request.base.sha }}");
  });

  test("Blockiert nur Abhängigkeits-Updates, bei allen anderen nur ein Hinweis", () => {
    expect(auto).toMatch(/  visuell:\n\s+if: github\.event\.pull_request\.draft == false/);
    const m = auto.slice(auto.indexOf("  merge:"));
    expect(m).toContain("needs: [test, codeql, visuell]");
    // Merge-Job läuft auch bei rotem Vergleich, aber nur mit grünen Tests und CodeQL
    expect(m).toContain("if: ${{ !cancelled() && needs.test.result == 'success' && needs.codeql.result == 'success' }}");
    const k = m.slice(m.indexOf("Art der Änderung bestimmen"), m.indexOf("- name: Mergen"));
    expect(k).toContain("VISUELL: ${{ needs.visuell.result }}");
    expect(k).toMatch(/dependabot\/\*\|fix\/abhaengigkeiten-\*\)\n\s+if \[ "\$VISUELL" != "success" \]; then[\s\S]*merge=false/);
    // Major-Updates bleiben offen wie bisher
    expect(k).toContain('if [ "$UPD" = "version-update:semver-major" ]; then merge=false');
  });
});

test("Function bindet web-push als Namensraum ein (web-push 4 hat keinen Default-Export)", async () => {
  const src = read("functions/index.ts");
  expect(src).toMatch(/import \* as webpushNs from "web-push";/);
  expect(src).not.toMatch(/import webpush from "web-push"/);
  // dieselbe Auflösung wie in der Function, mit der installierten Version
  const ns = await import("web-push");
  const webpush = ns.default ?? ns;
  for (const f of ["setVapidDetails", "sendNotification", "generateVAPIDKeys"]) expect(typeof webpush[f]).toBe("function");
});
