// Sicherheit: Content-Security-Policy im Browser und statische Prüfungen von Datenbank, Edge Functions, Workflows und Secrets.
const { test, expect, login } = require("./fixtures");
const base = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const sqlFiles = ["db/setup.sql", ...fs.readdirSync(path.join(root, "db/migrations")).filter((f) => f.endsWith(".sql")).map((f) => "supabase/migrations/" + f)];
const sql = sqlFiles.map(read).join("\n");
const workflows = fs.readdirSync(path.join(root, ".github/workflows")).map((f) => [f, read(".github/workflows/" + f)]);

test.describe("Sicherheit im Browser", () => {
  test("Content-Security-Policy mit Prüfsummen ist aktiv", async ({ page }) => {
    await page.goto("/");
    const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', "content");
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval' 'sha256-[A-Za-z0-9+/=]{44}'/);
    const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  test("eingeschleuster Inline-Code wird vom Browser blockiert", async ({ page }) => {
    await login(page);
    const ran = await page.evaluate(async () => {
      const d = document.createElement("div");
      d.innerHTML = '<img src="data:," onerror="window.__xss=1">';
      document.body.appendChild(d);
      await new Promise((r) => setTimeout(r, 300));
      return !!window.__xss;
    });
    expect(ran).toBe(false);
  });

  test("Texte von Mitgliedern werden nie als HTML ausgeführt", async ({ page }) => {
    await login(page);
    await page.locator("[aria-label='Prost-Wand'] [data-k=postText]").fill('<img src=x onerror="window.__xss=1"><b>fett</b>');
    await page.locator("[aria-label='Prost-Wand']").getByRole("button", { name: "Posten" }).click();
    await expect(page.locator("[aria-label='Prost-Wand']")).toContainText("<b>fett</b>");
    expect(await page.evaluate(() => !!window.__xss)).toBe(false);
  });
});

base.test.describe("Sicherheit (statisch)", () => {
  base.test("App: keine Inline-Event-Handler, Daten nur über esc() ins HTML", () => {
    const html = read("app/index.html");
    expect(html).not.toMatch(/\son(click|load|error|input|change|submit)=/i);
    expect(html.match(/<script>/g)).toHaveLength(1); // genau ein eingebettetes Skript (Prüfsumme in der CSP)
    expect(html).not.toMatch(/\beval\(|new Function\(/);
  });

  base.test("Datenbank-Funktionen sind ohne Login nicht ausführbar", () => {
    const defs = [...sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\) returns (\w+)[\s\S]*?security definer/gi)];
    const names = [...new Set(defs.filter((m) => m[3].toLowerCase() !== "trigger").map((m) => m[1]))];
    expect(names.length).toBeGreaterThan(8);
    const missing = names.filter((n) => !new RegExp(`revoke execute on function public\\.${n}\\([^)]*\\) from public`, "i").test(sql));
    expect(missing, "Funktionen ohne 'revoke … from public'").toEqual([]);
  });

  base.test("Jede Tabelle hat Row Level Security", () => {
    const tables = [...sql.matchAll(/create table if not exists public\.(\w+)/gi)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(20);
    const missing = tables.filter((t) => !new RegExp(`alter table public\\.${t} enable row level security`, "i").test(sql));
    expect(missing).toEqual([]);
  });

  base.test("Gerät, Admin, Spitzname und Sacceri sind nicht direkt änderbar", () => {
    expect(sql).toMatch(/revoke update on public\.profiles from authenticated;\s*grant update \(display_name, fav_wine, specialty\) on public\.profiles/);
    expect(sql).toMatch(/revoke update on public\.trips from authenticated;\s*grant update \(title, starts_on, ends_on, program, seats, color, ok_id, kassier_id\)/);
    expect(sql).toMatch(/revoke all on table public\.invites from anonymous, authenticated/);
  });

  base.test("Function prüft Login oder Secret, Secrets in konstanter Zeit", async () => {
    const src = read("functions/index.ts");
    for (const r of ["/feedback\"", "/fotos\"", "/fotos/links\""]) expect(src.slice(src.indexOf(r)), r).toMatch(/^[^\n]*\n\s*const m = await member\(c\.req\.raw\);/);
    expect(src).toContain("safeEqual(token, process.env.CRON_SECRET)");
    expect(src).toContain("parseTriggerDelivery(c.req.raw)");
    expect(src).toContain("cors({ origin: ORIGIN");
    expect(src, "Secret mit === verglichen").not.toMatch(/[!=]==\s*process\.env\.CRON_SECRET/);
    const S = await import("../functions/sicherheit.mjs");
    expect(S.safeEqual("abc", "abc")).toBe(true);
    expect(S.safeEqual("abc", "abd")).toBe(false);
    expect(S.safeEqual("", "")).toBe(false);
    expect(S.safeEqual(undefined, undefined)).toBe(false);
  });

  base.test("Einladung: Token und Eingaben", async () => {
    const L = await import("../functions/invite.mjs");
    const t = L.newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await L.hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(() => L.checkToken("kurz")).toThrow();
    expect(L.checkJoin({ name: "Luca", email: " Luca@Mail.CH ", password: "geheim1234", device: "android" })).toEqual({ name: "Luca", email: "luca@mail.ch", password: "geheim1234", device: "android" });
    expect(L.checkJoin({ name: "Luca", email: "l@m.ch", password: "geheim1234", device: "windows" }).device).toBe("iphone");
    expect(() => L.checkJoin({ name: "L", email: "l@m.ch", password: "geheim1234" })).toThrow("Namen");
    expect(() => L.checkJoin({ name: "Luca", email: "kaputt", password: "geheim1234" })).toThrow("Mail");
    expect(() => L.checkJoin({ name: "Luca", email: "l@m.ch", password: "1234567" })).toThrow("8 Zeichen");
  });

  base.test("Vorschläge: Issue ohne Mail-Adressen und ohne @-Erwähnungen", async () => {
    const F = await import("../functions/vorschlag.mjs");
    const i = F.buildIssue({ kind: "wunsch", title: "Weinkarte  @ot", text: "Hallo @beat" }, new Date("2026-10-31T10:00:00Z"));
    expect(i.title).toBe("🍷 Weinkarte @​ot");
    expect(i.body).toContain("@​beat");
    expect(i.body).toContain("Eingereicht in der App am");
    expect(i.body, "das Repository ist öffentlich").not.toContain(" von ");
    expect(i.labels).toEqual(["wunsch", "aus-der-app"]);
    expect(() => F.buildIssue({ kind: "x", title: "abc" })).toThrow();
    expect(() => F.buildIssue({ kind: "idee", title: "ab" })).toThrow("3–100");
    // Selbst eingetippte Kontaktdaten landen nicht im öffentlichen Issue, Daten und Preise bleiben
    const k = F.buildIssue({ kind: "idee", title: "Mail an beat.muster@gmx.ch", text: "Ruf an: +41 79 123 45 67 oder 079/123.45.67. Am 06.11.2026 für CHF 1200.50" });
    expect(k.title).toBe("💡 Mail an [Mail-Adresse entfernt]");
    expect(k.body).not.toMatch(/gmx|123 45|123\.45/);
    expect(k.body).toContain("06.11.2026");
    expect(k.body).toContain("CHF 1200.50");
  });

  base.test("Workflows: minimale Rechte, kein pull_request_target, Actions mit Commit-Hash", () => {
    expect(workflows.length).toBeGreaterThan(3);
    for (const [f, y] of workflows) {
      expect(y, `${f}: permissions fehlen`).toMatch(/^permissions:/m);
      expect(y, `${f}: pull_request_target`).not.toMatch(/pull_request_target/);
      const loose = [...y.matchAll(/uses: ([^\s.][^\s]*)@([^\s]+)/g)].filter((m) => !/^[0-9a-f]{40}$/.test(m[2])).map((m) => m[0]);
      expect(loose, `${f}: Action ohne Commit-Hash`).toEqual([]);
      expect(y, `${f}: Script-Injection`).not.toMatch(/run:.*\$\{\{\s*github\.event\.(pull_request|issue|comment)\.[^}]*(title|body|head\.ref)/);
    }
  });

  base.test("Datensicherung: Backup vor dem Release, Funktionen nur serverseitig, nicht lesbar", () => {
    const rel = workflows.find(([f]) => f.includes("release"))[1];
    expect(rel.indexOf("snapshot_club('vor Release")).toBeGreaterThan(-1);
    expect(rel.indexOf("snapshot_club('vor Release")).toBeLessThan(rel.indexOf("Wartungsseite einschalten"));
    expect(rel.indexOf("Wartungsseite einschalten")).toBeLessThan(rel.indexOf("db/setup.sql"));
    for (const f of ["backup_tables\\(\\)", "snapshot_club\\(text\\)", "restore_club\\(bigint\\)"])
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${f} from public, anonymous, authenticated`));
    expect(sql).not.toMatch(/on public\.backups\s+for/i);
  });

  base.test("Fotos: nur JPEG bis 5 MB, nur der eigene Ordner", async () => {
    const F = await import("../functions/fotos.mjs");
    const id = "00000000-0000-0000-0000-00000000000a", jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(() => F.checkFoto(`drinks/${id}/a.jpg`, id, jpg)).not.toThrow();
    expect(() => F.checkFoto(`drinks/00000000-0000-0000-0000-00000000000b/a.jpg`, id, jpg)).toThrow("eigenen Ordner");
    expect(() => F.checkFoto(`x/${id}/a.jpg`, id, jpg)).toThrow("Speicherort");
    expect(() => F.checkFoto(`drinks/${id}/a.html`, id, jpg)).toThrow("Speicherort");
    expect(() => F.checkFoto(`drinks/${id}/../a.jpg`, id, jpg)).toThrow("Speicherort");
    expect(() => F.checkFoto(`drinks/${id}/a.jpg`, id, new TextEncoder().encode("<html>"))).toThrow("JPEG");
    expect(() => F.checkFoto(`drinks/${id}/a.jpg`, id, new Uint8Array(F.MAX_FOTO + 1).fill(0xff))).toThrow("gross");
  });

  base.test("Videokarten: nur MP4/WebM bis 12 MB, nur der eigene Ordner", async () => {
    const F = await import("../functions/fotos.mjs");
    const id = "00000000-0000-0000-0000-00000000000a";
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0]), mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0]);
    expect(() => F.checkVideo(`videos/${id}/a.webm`, id, webm)).not.toThrow();
    expect(() => F.checkVideo(`videos/${id}/a.mp4`, id, mp4)).not.toThrow();
    expect(() => F.checkVideo(`videos/${id}/a.mp4`, id, webm)).toThrow("MP4");
    expect(() => F.checkVideo(`videos/00000000-0000-0000-0000-00000000000b/a.webm`, id, webm)).toThrow("eigenen Ordner");
    expect(() => F.checkVideo(`videos/${id}/a.mov`, id, mp4)).toThrow("Speicherort");
    expect(() => F.checkVideo(`videos/${id}/a.webm`, id, new Uint8Array(F.MAX_VIDEO + 1))).toThrow("gross");
    // Ein Video geht nicht als Foto durch und umgekehrt
    expect(() => F.checkFoto(`videos/${id}/a.webm`, id, webm)).toThrow("Speicherort");
    expect(F.istVideo(`cards/${id}/a.jpg`)).toBe(false);
    expect(F.videoTyp(`videos/${id}/a.webm`)).toBe("video/webm");
  });

  base.test("Keine Secrets im Repository", () => {
    let files;
    try { files = execSync("git ls-files", { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean) } catch { base.test.skip(); return }
    const bad = /(sb_secret_[A-Za-z0-9_-]{10,}|sbp_[a-f0-9]{30,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|service_role[^\n]{0,40}eyJ[A-Za-z0-9_-]{20,})/;
    const hits = files.filter((f) => !/\.(png|jpe?g|ico|pdf|woff2?)$/i.test(f) && fs.existsSync(path.join(root, f)) && bad.test(read(f)));
    expect(hits).toEqual([]);
  });
});
