// Neon Function "api": alles, was nicht direkt über die Data API läuft.
// Login     /auth/*           Die App liegt auf github.io, Login-Cookies des Auth-Dienstes wären dort Fremd-Cookies
//                             (Safari blockiert sie). Darum meldet sich diese Function an und gibt der App das Sitzungs-Token.
// Status    /status           Wartungsseite, ohne Login
// Einladung /invite           Links statt Mail
// Vorschlag /feedback         Vorschlag speichern, /feedback-export für GitHub Actions (feedback-issues.yml)
// Fotos     /fotos, /fotos/links  privater Speicher: nur JPEG bis 5 MB, nur Mitglieder
// Backup    /backup           täglicher Function Trigger (neon.ts), legt auch die nächsten Magnum-Abende an
import { attachDatabasePool } from "@neon/functions";
import { parseTriggerDelivery } from "@neon/functions/triggers";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Pool } from "pg";
import { checkFoto, checkPfad, MAX_FOTO } from "./fotos.mjs";
import { checkJoin, checkToken, clubFull, hashToken, INVITE_DAYS, joinError, newToken } from "./invite.mjs";
import { safeEqual } from "./sicherheit.mjs";
import { buildIssue, DAILY_LIMIT } from "./vorschlag.mjs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
attachDatabasePool(pool);
const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows;

const AUTH = process.env.NEON_AUTH_BASE_URL!;
const APP_URL = process.env.APP_URL!;
const ORIGIN = new URL(APP_URL).origin;
const JWKS = createRemoteJWKSet(new URL(process.env.NEON_AUTH_JWKS_URL!));
const s3 = new S3Client({ forcePathStyle: true });
const BUCKET = "photos";
const INVALID = "Dieser Einladungslink ist ungültig, abgelaufen oder wurde schon verwendet.";

const app = new Hono();
app.use("*", cors({ origin: ORIGIN, allowHeaders: ["authorization", "content-type"], allowMethods: ["GET", "POST", "OPTIONS"] }));
app.onError((e, c) => { console.error(e); return c.json({ error: "Interner Fehler" }, 500) });
app.get("/", (c) => c.text("Magnum"));

// ───────────── Hilfen ─────────────
const auth = (pfad: string, body?: unknown, cookie?: string) => fetch(AUTH + pfad, {
  method: body ? "POST" : "GET",
  headers: { origin: ORIGIN, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const cookies = (r: Response) => r.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
// Der Auth-Dienst begrenzt Anfragen pro Absender, und für ihn sind alle Mitglieder diese Function:
// Überlast (429) heisst nicht, dass die Sitzung abgelaufen ist.
const tokenFor = async (session: string) => {
  const r = await auth("/token", undefined, session);
  return { status: r.status, token: r.ok ? (await r.json()).token as string : null };
};
const BESETZT = { error: "Gerade sehr viel los. Bitte in ein paar Sekunden nochmals versuchen." };
const userId = async (req: Request) => {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, JWKS, { issuer: new URL(AUTH).origin });
    return payload.sub ?? null;
  } catch { return null }
};
const member = async (req: Request) => {
  const id = await userId(req);
  if (!id) return null;
  return (await q("select id, is_admin from public.profiles where id = $1", [id]))[0] ?? null;
};
const full = async () => {
  const [r] = await q("select (select count(*)::int from public.profiles) n, (select max_members from public.settings where id = 1) max");
  return clubFull(r.n, r.max);
};

// ───────────── Status & Login ─────────────
app.get("/status", async (c) => {
  const [r] = await q("select maintenance from public.app_status where id = 'main'");
  return c.json({ maintenance: !!r?.maintenance });
});

app.post("/auth/login", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const r = await auth("/sign-in/email", { email: String(b.email ?? ""), password: String(b.password ?? "") });
  if (r.status === 429) return c.json(BESETZT, 429);
  if (!r.ok) return c.json({ error: "Invalid login credentials" }, 400);
  const session = cookies(r), t = await tokenFor(session);
  if (t.status === 429) return c.json(BESETZT, 429);
  return t.token ? c.json({ session, token: t.token }) : c.json({ error: "Anmeldung fehlgeschlagen" }, 500);
});
app.post("/auth/token", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const t = await tokenFor(String(b.session ?? ""));
  if (t.status === 429) return c.json(BESETZT, 429);
  return t.token ? c.json({ token: t.token }) : c.json({ error: "Sitzung abgelaufen" }, 401);
});
app.post("/auth/logout", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  await auth("/sign-out", {}, String(b.session ?? ""));
  return c.json({ ok: true });
});
// Die Rücksprung-Adresse setzt der Server: Eine Reset-Mail führt immer zur App
app.post("/auth/reset-request", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  await auth("/request-password-reset", { email: String(b.email ?? ""), redirectTo: APP_URL });
  return c.json({ ok: true });
});
app.post("/auth/reset", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const password = String(b.password ?? "");
  if (password.length < 8) return c.json({ error: "Das Passwort braucht mindestens 8 Zeichen." }, 400);
  const r = await auth("/reset-password", { token: String(b.token ?? ""), newPassword: password });
  return r.ok ? c.json({ ok: true }) : c.json({ error: "Der Link ist abgelaufen. Bitte neu anfordern." }, 400);
});

// ───────────── Einladungen ─────────────
//   Mitglieder (angemeldet):
//     { action: "create" }      → { token }  (Link = App-Adresse + "#einladung=" + token, 7 Tage gültig, einmalig)
//     { action: "list" }        → offene Einladungen
//     { action: "revoke", id }  → Einladung zurückziehen (eigene; der Admin alle)
//   Eingeladene Person (ohne Login, mit Token aus dem Link):
//     { action: "check", token }                                → { ok, from }
//     { action: "join", token, name, email, password, device }  → legt das Konto an (Gerät iPhone/Android)
app.post("/invite", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (body.action === "check" || body.action === "join") {
    let hash;
    try { hash = await hashToken(checkToken(body.token)) } catch (e) { return c.json({ error: (e as Error).message }, 400) }
    const [open] = await q("select id, created_by from public.invites where token_hash = $1 and used_at is null and expires_at > now()", [hash]);
    if (!open) return c.json({ error: INVALID }, 404);
    if (await full()) return c.json({ error: "Der Club ist voll. Bitte beim Admin melden." }, 409);
    if (body.action === "check") {
      const [p] = await q("select display_name from public.profiles where id = $1", [open.created_by]);
      return c.json({ ok: true, from: p?.display_name ?? null });
    }
    let j;
    try { j = checkJoin(body) } catch (e) { return c.json({ error: (e as Error).message }, 400) }
    // Link atomar reservieren: Nur diese Adresse kommt am Trigger gate_new_user vorbei
    const [inv] = await q(`update public.invites set used_at = now(), email = $2, name = $3, device = $4
      where id = $1 and used_at is null returning id`, [open.id, j.email, j.name, j.device]);
    if (!inv) return c.json({ error: INVALID }, 404);
    const r = await auth("/sign-up/email", { email: j.email, password: j.password, name: j.name });
    if (!r.ok) {
      await q("update public.invites set used_at = null, email = null, name = null, device = null where id = $1", [inv.id]); // Link bleibt gültig
      if (r.status === 429) return c.json(BESETZT, 429);
      // Hat jemand gleichzeitig den letzten Platz genommen, kommt nur ein allgemeiner Fehler zurück
      if (await full()) return c.json({ error: "Der Club ist voll. Bitte beim Admin melden." }, 409);
      const e = await r.json().catch(() => ({}));
      return c.json({ error: joinError(e.code || e.message) }, 400);
    }
    return c.json({ ok: true, email: j.email });
  }

  const m = await member(c.req.raw);
  if (!m) return c.json({ error: "Nur Mitglieder dürfen einladen." }, 403);
  if (body.action === "create") {
    if (await full()) return c.json({ error: "Der Club ist voll (12 Mitglieder)." }, 409);
    const t = newToken(), expires_at = new Date(Date.now() + INVITE_DAYS * 864e5).toISOString();
    await q("insert into public.invites (token_hash, created_by, expires_at) values ($1, $2, $3)", [await hashToken(t), m.id, expires_at]);
    return c.json({ ok: true, token: t, expires_at });
  }
  if (body.action === "list") {
    const rows = await q(`select id, created_by, created_at, expires_at from public.invites
      where used_at is null and expires_at > now() order by created_at desc limit 50`);
    return c.json({ ok: true, items: rows.map(({ created_by, ...x }) => ({ ...x, mine: created_by === m.id, from: created_by })) });
  }
  if (body.action === "revoke") {
    await q("delete from public.invites where id = $1 and used_at is null and ($2 or created_by = $3)", [Number(body.id), m.is_admin, m.id]);
    return c.json({ ok: true });
  }
  return c.json({ error: "unknown action" }, 400);
});

// ───────────── Vorschläge ─────────────
app.post("/feedback", async (c) => {
  const m = await member(c.req.raw);
  if (!m) return c.json({ error: "Kein Mitglied" }, 403);
  const [o] = await q("select count(*)::int n from public.feedback where user_id = $1 and created_at >= now() - interval '1 day'", [m.id]);
  if (o.n >= DAILY_LIMIT) return c.json({ error: `Maximal ${DAILY_LIMIT} Vorschläge pro Tag.` }, 429);
  let issue;
  try { issue = buildIssue(await c.req.json()) } catch (e) { return c.json({ error: (e as Error).message }, 400) }
  const [r] = await q("insert into public.feedback (user_id, kind, title, body, labels) values ($1, $2, $3, $4, $5) returning id",
    [m.id, issue.kind, issue.title, issue.body, issue.labels]);
  return c.json({ queued: true, id: r.id });
});

// Schnittstelle für GitHub Actions. Header: Authorization: Bearer <CRON_SECRET>
//   { action: "pending" }                  – bis zu 20 neue Vorschläge
//   { action: "done", id, number, url }    – als Issue erfasst
//   { action: "failed", id, error }        – Anlegen fehlgeschlagen (wird nicht erneut versucht)
//   { action: "open" }                     – erfasste Vorschläge, deren Issue noch offen sein könnte
//   { action: "closed", id, completed }    – Issue geschlossen → in der App "umgesetzt" bzw. "geschlossen"
app.post("/feedback-export", async (c) => {
  const token = (c.req.header("authorization") || "").replace(/^Bearer /, "");
  if (!safeEqual(token, process.env.CRON_SECRET)) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => ({}));
  if (body.action === "pending") return c.json({ items: await q("select id, title, body, labels from public.feedback where status = 'neu' order by created_at limit 20") });
  if (body.action === "done") {
    await q("update public.feedback set status = 'erfasst', issue_number = $2, issue_url = $3, error = null where id = $1", [body.id, body.number, body.url]);
    return c.json({ ok: true });
  }
  if (body.action === "failed") {
    await q("update public.feedback set status = 'fehler', error = $2 where id = $1", [body.id, String(body.error || "").slice(0, 500)]);
    return c.json({ ok: true });
  }
  if (body.action === "open") return c.json({ items: await q("select id, issue_number from public.feedback where status = 'erfasst' and issue_number is not null limit 100") });
  if (body.action === "closed") {
    await q("update public.feedback set status = $2 where id = $1 and status = 'erfasst'", [body.id, body.completed ? "umgesetzt" : "geschlossen"]);
    return c.json({ ok: true });
  }
  return c.json({ error: "unknown action" }, 400);
});

// ───────────── Fotos ─────────────
app.post("/fotos", async (c) => {
  const m = await member(c.req.raw);
  if (!m) return c.json({ error: "Kein Mitglied" }, 403);
  if (Number(c.req.header("content-length") || 0) > MAX_FOTO) return c.json({ error: "Das Bild ist zu gross." }, 413);
  const data = new Uint8Array(await c.req.arrayBuffer());
  try { checkFoto(c.req.query("pfad"), m.id, data) } catch (e) { return c.json({ error: (e as Error).message }, 400) }
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: c.req.query("pfad"), Body: data, ContentType: "image/jpeg" }));
  return c.json({ path: c.req.query("pfad") });
});
app.post("/fotos/links", async (c) => {
  const m = await member(c.req.raw);
  if (!m) return c.json({ error: "Kein Mitglied" }, 403);
  const b = await c.req.json().catch(() => ({}));
  const paths: string[] = (Array.isArray(b.paths) ? b.paths : []).filter(checkPfad).slice(0, 200);
  const links = await Promise.all(paths.map(async (path) => ({
    path, signedUrl: await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: path }), { expiresIn: 3600 }),
  })));
  return c.json({ items: links });
});

// ───────────── Tägliche Sicherung ─────────────
// pg_cron läuft nicht, solange die Datenbank schläft. Der Function Trigger weckt sie.
app.post("/backup", async (c) => {
  const t = await parseTriggerDelivery(c.req.raw);
  if (!t.ok) return c.json({ error: t.error }, t.error === "invalid_body" ? 400 : 401);
  await q("select public.snapshot_club('täglich')");
  await q("select public.magnum_termine()");
  return c.json({ ok: true });
});

export default app;
