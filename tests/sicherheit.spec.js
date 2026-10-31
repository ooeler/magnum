// Sicherheit: Content-Security-Policy im Browser und statische Prüfungen von Datenbank, Edge Functions, Workflows und Secrets.
const { test, expect, login } = require("./fixtures");
const base = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const sqlFiles = ["supabase/setup.sql", ...fs.readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).map((f) => "supabase/migrations/" + f)];
const sql = sqlFiles.map(read).join("\n");
const fnDirs = fs.readdirSync(path.join(root, "supabase/functions")).filter((d) => !d.startsWith("_"));
const workflows = fs.readdirSync(path.join(root, ".github/workflows")).map((f) => [f, read(".github/workflows/" + f)]);

test.describe("Sicherheit im Browser", () => {
  test("Content-Security-Policy mit Prüfsummen ist aktiv", async ({ page }) => {
    await page.goto("/");
    const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', "content");
    expect(csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]{44}'/);
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
    expect(sql).toMatch(/revoke all on table public\.invites from anon, authenticated/);
  });

  base.test("Edge Functions prüfen Login oder Secret, Secrets in konstanter Zeit", async () => {
    for (const d of fnDirs) {
      const src = read(`supabase/functions/${d}/index.ts`);
      expect(/auth\.getUser\(|safeEqual\(token/.test(src), `${d}: keine Zugriffsprüfung`).toBe(true);
      expect(src, `${d}: Secret mit === verglichen`).not.toMatch(/[!=]==\s*Deno\.env\.get\("CRON_SECRET"\)/);
    }
    const S = await import("../supabase/functions/_shared/sicherheit.mjs");
    expect(S.safeEqual("abc", "abc")).toBe(true);
    expect(S.safeEqual("abc", "abd")).toBe(false);
    expect(S.safeEqual("", "")).toBe(false);
    expect(S.safeEqual(undefined, undefined)).toBe(false);
  });

  base.test("Einladung: Token, Eingaben und volle Clubs", async () => {
    const L = await import("../supabase/functions/invite/logic.mjs");
    const t = L.newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await L.hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(() => L.checkToken("kurz")).toThrow();
    expect(L.checkJoin({ name: "Luca", email: " Luca@Mail.CH ", password: "geheim1234", device: "android" })).toEqual({ name: "Luca", email: "luca@mail.ch", password: "geheim1234", device: "android" });
    expect(L.checkJoin({ name: "Luca", email: "l@m.ch", password: "geheim1234", device: "windows" }).device).toBe("iphone");
    expect(() => L.checkJoin({ name: "L", email: "l@m.ch", password: "geheim1234" })).toThrow("Namen");
    expect(() => L.checkJoin({ name: "Luca", email: "kaputt", password: "geheim1234" })).toThrow("Mail");
    expect(() => L.checkJoin({ name: "Luca", email: "l@m.ch", password: "1234567" })).toThrow("8 Zeichen");
    expect(L.clubFull(12, 12)).toBe(true);
    expect(L.clubFull(11, 12)).toBe(false);
  });

  base.test("Vorschläge: Issue ohne Mail-Adressen und ohne @-Erwähnungen", async () => {
    const F = await import("../supabase/functions/feedback/logic.mjs");
    const i = F.buildIssue({ kind: "wunsch", title: "Weinkarte  @ot", text: "Hallo @beat" }, { display_name: "Ot" }, new Date("2026-10-31T10:00:00Z"));
    expect(i.title).toBe("🍷 Weinkarte @​ot");
    expect(i.body).toContain("@​beat");
    expect(i.body).toContain("Eingereicht in der App von **Ot**");
    expect(i.labels).toEqual(["wunsch", "aus-der-app"]);
    expect(() => F.buildIssue({ kind: "x", title: "abc" }, {})).toThrow();
    expect(() => F.buildIssue({ kind: "idee", title: "ab" }, {})).toThrow("3–100");
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

  base.test("Keine Secrets im Repository", () => {
    let files;
    try { files = execSync("git ls-files", { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean) } catch { base.test.skip(); return }
    const bad = /(sb_secret_[A-Za-z0-9_-]{10,}|sbp_[a-f0-9]{30,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|service_role[^\n]{0,40}eyJ[A-Za-z0-9_-]{20,})/;
    const hits = files.filter((f) => !/\.(png|jpe?g|ico|pdf|woff2?)$/i.test(f) && fs.existsSync(path.join(root, f)) && bad.test(read(f)));
    expect(hits).toEqual([]);
  });
});
