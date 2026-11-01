// Durchlauf gegen ein echtes Neon-Backend, nie gegen main. Die Function muss mit APP_URL=http://localhost:4183/ laufen.
// Aufruf: DATABASE_URL=… NEON_DATA_API_URL=… MAGNUM_API_URL=… NEON_AUTH_BASE_URL=… CRON_SECRET=… npm run test:neon
const { test, expect } = require("@playwright/test");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pg = require("pg");

const E = process.env, ORIGIN = "http://localhost:4183", API = E.MAGNUM_API_URL.replace(/\/$/, ""), DATA = E.NEON_DATA_API_URL;
if (/main/.test(E.NEON_BRANCH || "")) throw new Error("Nicht gegen main testen");
const zufall = () => crypto.randomBytes(6).toString("hex");
const db = new pg.Client({ connectionString: E.DATABASE_URL.replace("sslmode=require", "sslmode=verify-full") });
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

// Der Auth-Dienst begrenzt Anfragen, 429 heisst hier: warten und nochmals
const post = async (pfad, body, kopf = {}) => {
  for (;;) {
    const r = await fetch(API + pfad, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...kopf }, body: JSON.stringify(body || {}) });
    if (r.status == 429) { await new Promise((w) => setTimeout(w, 5000)); continue }
    return { s: r.status, j: await r.json().catch(() => null) };
  }
};
const daten = async (t, pfad, init = {}) => {
  const r = await fetch(DATA + pfad, { ...init, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}), ...(init.headers || {}) } });
  const x = await r.text(); let j = null; try { j = JSON.parse(x) } catch {}
  return { s: r.status, j };
};
const bearer = (t) => ({ authorization: "Bearer " + t });
const einladung = async (admin) => {
  if (admin) {
    const { hashToken, newToken } = await import("../functions/invite.mjs");
    const t = newToken();
    await db.query("insert into public.invites (token_hash, expires_at, als_admin) values ($1, now() + interval '7 days', true)", [await hashToken(t)]);
    return t;
  }
};
let A, B, emailA, pw = "Pr-" + zufall();

test.describe.configure({ mode: "serial", timeout: 120000 });
test.beforeAll(async () => {
  await db.connect();
  const setup = fs.readFileSync(path.join(__dirname, "..", "db", "setup.sql"), "utf8");
  await db.query(setup); await db.query(setup);
  await db.query(`truncate public.profiles cascade; truncate public.invites restart identity cascade; delete from neon_auth."user"; update public.app_status set maintenance = false`);
});
test.afterAll(async () => { await db.end() });

test("Status ohne Login, Daten ohne Login gesperrt", async () => {
  expect((await (await fetch(API + "/status")).json()).maintenance).toBe(false);
  for (const t of ["profiles", "events", "backups", "invites"]) {
    const r = await daten(null, "/" + t + "?select=*");
    expect(r.s >= 400 || (Array.isArray(r.j) && r.j.length == 0), t).toBe(true);
  }
});

test("Freie Registrierung am Auth-Dienst scheitert", async () => {
  const email = `frei-${zufall()}@magnum.test`;
  const r = await fetch(E.NEON_AUTH_BASE_URL + "/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ email, password: pw, name: "Frei" }) });
  expect(r.ok).toBe(false);
  expect((await db.query(`select 1 from neon_auth."user" where email = $1`, [email])).rowCount).toBe(0);
});

test("Erster Link macht zum Admin", async () => {
  emailA = `admin-${zufall()}@magnum.test`;
  const t = await einladung(true);
  expect((await post("/invite", { action: "check", token: t })).s).toBe(200);
  const r = await post("/invite", { action: "join", token: t, name: "Ot", email: emailA, password: pw, device: "iphone" });
  expect(r.s, JSON.stringify(r.j)).toBe(200);
  expect((await post("/invite", { action: "join", token: t, name: "Ot", email: "x" + emailA, password: pw })).s, "Link nur einmal").toBe(404);
  const l = await post("/auth/login", { email: emailA, password: pw });
  expect(l.s).toBe(200);
  A = l.j;
  const me = await daten(A.token, "/rpc/me", { method: "POST", body: "{}" });
  expect(me.s, JSON.stringify(me.j)).toBe(200);
  expect(me.j.is_admin).toBe(true);
});

test("Login: falsches Passwort, Token erneuern, Abmelden", async () => {
  expect((await post("/auth/login", { email: emailA, password: "falsch-falsch" })).s).toBe(400);
  const n = await post("/auth/login", { email: emailA, password: pw });
  const t = await post("/auth/token", { session: n.j.session });
  expect(t.s).toBe(200);
  await post("/auth/logout", { session: n.j.session });
  expect((await post("/auth/token", { session: n.j.session })).s).toBe(401);
  expect((await post("/auth/token", { session: "x=y" })).s).toBe(401);
});

test("Mitglied über Einladung, Gerät wird gespeichert", async () => {
  const c = await post("/invite", { action: "create" }, bearer(A.token));
  expect(c.s, JSON.stringify(c.j)).toBe(200);
  const email = `beat-${zufall()}@magnum.test`;
  expect((await post("/invite", { action: "join", token: c.j.token, name: "Beat", email, password: pw, device: "android" })).s).toBe(200);
  const l = await post("/auth/login", { email, password: pw });
  B = l.j; B.id = JSON.parse(Buffer.from(B.token.split(".")[1], "base64url")).sub;
  const inv = await db.query("select invited_by, device from public.profiles where id = $1", [B.id]);
  expect(inv.rows[0].device).toBe("android");
  expect(inv.rows[0].invited_by).toBeTruthy();
  for (let i = 0; i < 4; i++) expect((await post("/invite", { action: "create" }, bearer(B.token))).s).toBe(200);
});

test("Rechte an der App vorbei", async () => {
  const self = await daten(B.token, `/profiles?id=eq.${B.id}`, { method: "PATCH", body: JSON.stringify({ is_admin: true }) });
  expect(self.s).toBeGreaterThanOrEqual(400);
  const dev = await daten(B.token, `/profiles?id=eq.${B.id}`, { method: "PATCH", body: JSON.stringify({ device: "iphone" }) });
  expect(dev.s).toBeGreaterThanOrEqual(400);
  const name = await daten(B.token, `/profiles?id=eq.${B.id}`, { method: "PATCH", body: JSON.stringify({ fav_wine: "Cornalin" }) });
  expect(name.s).toBeLessThan(300);
  expect((await daten(B.token, "/backups?select=*")).s).toBeGreaterThanOrEqual(400);
  expect((await daten(B.token, "/invites?select=*")).s).toBeGreaterThanOrEqual(400);

  const ev = await daten(B.token, "/events?select=id", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ title: "Stamm", starts_at: new Date(Date.now() + 864e5).toISOString() }) });
  expect(ev.s, JSON.stringify(ev.j)).toBe(201);
  const id = ev.j[0].id;
  const alt = await daten(B.token, "/events", { method: "POST", body: JSON.stringify({ title: "Alt", starts_at: "2020-01-01T10:00:00Z" }) });
  expect(alt.s).toBeGreaterThanOrEqual(400);
  // Upsert wie die App, zweimal hintereinander
  for (const status of ["in", "virtual"]) {
    const u = await daten(B.token, "/rsvps", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ event_id: id, member_id: B.id, status, updated_at: new Date().toISOString() }) });
    expect(u.s, JSON.stringify(u.j)).toBeLessThan(300);
  }
  const k = await daten(B.token, `/rsvps?event_id=eq.${id}&member_id=eq.${B.id}`, { method: "PATCH", body: JSON.stringify({ redeemed: true }) });
  expect(k.s).toBeGreaterThanOrEqual(400);
  const r = await daten(B.token, "/rpc/open_magnum_kasse", { method: "POST", body: "{}" });
  expect(r.s).toBeGreaterThanOrEqual(400);
  expect((await daten(A.token, "/rpc/open_magnum_kasse", { method: "POST", body: "{}" })).j).toBe(1);
});

test("Live-Sync: Änderungen erhöhen den Stand", async () => {
  const a = (await daten(B.token, "/sync_stand?select=stand")).j[0].stand;
  const p = await daten(B.token, "/posts", { method: "POST", body: JSON.stringify({ text: "Prost" }) });
  expect(p.s, JSON.stringify(p.j)).toBeLessThan(300);
  expect(Number((await daten(B.token, "/sync_stand?select=stand")).j[0].stand)).toBeGreaterThan(Number(a));
});

test("Fotos: nur eigener Ordner, nur JPEG, nur Mitglieder", async () => {
  const hoch = (pfad, body, t, typ = "image/jpeg") => fetch(`${API}/fotos?pfad=${encodeURIComponent(pfad)}`, { method: "POST", headers: { "content-type": typ, ...(t ? bearer(t) : {}) }, body });
  const p = `drinks/${B.id}/${zufall()}.jpg`;
  expect((await hoch(p, JPEG, null)).status).toBe(403);
  const ok = await hoch(p, JPEG, B.token);
  expect(ok.status, await ok.clone().text()).toBe(200);
  expect((await hoch(`drinks/00000000-0000-0000-0000-00000000000a/x.jpg`, JPEG, B.token)).status).toBe(400);
  expect((await hoch(`drinks/${B.id}/x.jpg`, "<html>", B.token)).status).toBe(400);
  const l = await post("/fotos/links", { paths: [p] }, bearer(A.token));
  expect(l.s).toBe(200);
  const f = await fetch(l.j.items[0].signedUrl);
  expect(f.status).toBe(200);
  expect(Buffer.from(await f.arrayBuffer()).equals(JPEG)).toBe(true);
  expect((await post("/fotos/links", { paths: [p] })).s).toBe(403);
});

test("Vorschlag, Export nur mit Secret, Sicherung nur vom Trigger", async () => {
  const f = await post("/feedback", { kind: "idee", title: "Mehr Magnum", text: "Hallo" }, bearer(B.token));
  expect(f.s, JSON.stringify(f.j)).toBe(200);
  expect((await post("/feedback-export", { action: "pending" }, bearer("falsch"))).s).toBe(403);
  const x = await post("/feedback-export", { action: "pending" }, bearer(E.CRON_SECRET));
  expect(x.j.items.some((i) => i.title.includes("Mehr Magnum"))).toBe(true);
  expect(JSON.stringify(x.j)).not.toContain("Beat");
  expect((await post("/backup", {})).s).toBe(401);
  await db.query("select public.snapshot_club('Test')");
});

test("Passwort-Reset anfordern", async () => {
  expect((await post("/auth/reset-request", { email: emailA })).s).toBe(200);
  expect((await post("/auth/reset", { token: "falsch", password: "langgenug1" })).s).toBe(400);
});

test.describe("Echte App im Browser", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/config.js", (r) => r.fulfill({ contentType: "application/javascript", body: `window.MG_CONFIG=${JSON.stringify({ data: DATA, api: API })}` }));
  });

  test("anmelden, Daten sehen, zusagen, neu laden, abmelden", async ({ page }) => {
    const fehler = []; page.on("pageerror", (e) => fehler.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.goto("/");
    await page.fill("#login input[name=email]", emailA);
    await page.fill("#login input[name=pw]", pw);
    await page.click("#login .btn");
    await expect(page.locator("header h1")).toHaveText("Magnum", { timeout: 20000 });
    const e = page.locator("article.ev", { hasText: "Stamm" });
    await expect(e).toBeVisible({ timeout: 20000 });
    await e.getByRole("button", { name: "Bin dabei" }).click();
    await expect(page.locator("#toast")).toContainText("Angemeldet");
    await page.reload();
    await expect(e).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "Club" }).click();
    await page.getByRole("button", { name: "Abmelden" }).last().click();
    await expect(page.locator("#login")).toBeVisible();
    expect(fehler).toEqual([]);
  });
});
