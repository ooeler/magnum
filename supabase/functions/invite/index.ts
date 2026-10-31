// Supabase Edge Function "invite": Einladungslinks statt Mail – es braucht keinen Mailversand.
//   Mitglieder (angemeldet):
//     { action: "create" }      → { token }  (Link = App-Adresse + "#einladung=" + token, 7 Tage gültig, einmalig)
//     { action: "list" }        → offene Einladungen
//     { action: "revoke", id }  → Einladung zurückziehen (eigene; der Admin alle)
//   Eingeladene Person (ohne Login, mit Token aus dem Link):
//     { action: "check", token }                                → { ok, from }
//     { action: "join", token, name, email, password, device }  → legt das Konto an (Gerät iPhone/Android)
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { checkJoin, checkToken, clubFull, hashToken, INVITE_DAYS, joinError, MAX_OFFEN, newToken } from "./logic.mjs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const INVALID = "Dieser Einladungslink ist ungültig, abgelaufen oder wurde schon verwendet.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();

  const full = async () => {
    const [{ count }, { data: s }] = await Promise.all([
      db.from("profiles").select("id", { count: "exact", head: true }),
      db.from("settings").select("max_members").eq("id", 1).maybeSingle(),
    ]);
    return clubFull(count ?? 0, s?.max_members);
  };

  if (body.action === "check" || body.action === "join") {
    let hash;
    try {
      hash = await hashToken(checkToken(body.token));
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
    const { data: open } = await db.from("invites").select("id, created_by")
      .eq("token_hash", hash).is("used_at", null).gt("expires_at", now).maybeSingle();
    if (!open) return json({ error: INVALID }, 404);
    if (await full()) return json({ error: "Der Club ist voll. Bitte beim Admin melden." }, 409);

    if (body.action === "check") {
      const { data: p } = await db.from("profiles").select("display_name").eq("id", open.created_by).maybeSingle();
      return json({ ok: true, from: p?.display_name ?? null });
    }

    let j;
    try {
      j = checkJoin(body);
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
    // Link atomar reservieren: kann nur einmal eingelöst werden
    const { data: inv } = await db.from("invites").update({ used_at: now })
      .eq("id", open.id).is("used_at", null).select("id, created_by").maybeSingle();
    if (!inv) return json({ error: INVALID }, 404);
    const { data, error } = await db.auth.admin.createUser({
      email: j.email, password: j.password, email_confirm: true,
      user_metadata: { display_name: j.name, device: j.device },
      app_metadata: { eingeladen: true }, // nur damit entsteht ein Profil (handle_new_user)
    });
    if (error) {
      await db.from("invites").update({ used_at: null }).eq("id", inv.id); // Link bleibt gültig
      // Hat jemand gleichzeitig den letzten Platz genommen, liefert Supabase nur einen Datenbankfehler
      if (await full()) return json({ error: "Der Club ist voll. Bitte beim Admin melden." }, 409);
      return json({ error: joinError(error.message) }, 400);
    }
    // Profil wurde per Trigger angelegt (Name, Gerät) – Einladende Person vermerken
    await db.from("profiles").update({ invited_by: inv.created_by }).eq("id", data.user.id);
    await db.from("invites").update({ used_by: data.user.id }).eq("id", inv.id);
    return json({ ok: true, email: j.email });
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return json({ error: "Nicht angemeldet" }, 401);
  const { data: caller } = await db.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!caller) return json({ error: "Nur Mitglieder dürfen einladen." }, 403);

  if (body.action === "create") {
    if (await full()) return json({ error: "Der Club ist voll (12 Mitglieder)." }, 409);
    if (!caller.is_admin) {
      const { count } = await db.from("invites").select("id", { count: "exact", head: true })
        .eq("created_by", user.id).is("used_at", null).gt("expires_at", now);
      if ((count ?? 0) >= MAX_OFFEN) return json({ error: `Du hast schon ${MAX_OFFEN} offene Einladungen. Ziehe zuerst eine zurück.` }, 409);
    }
    const t = newToken();
    const expires_at = new Date(Date.now() + INVITE_DAYS * 864e5).toISOString();
    const { error } = await db.from("invites").insert({ token_hash: await hashToken(t), created_by: user.id, expires_at });
    return error ? json({ error: "Einladung konnte nicht erstellt werden." }, 500) : json({ ok: true, token: t, expires_at });
  }
  if (body.action === "list") {
    const { data } = await db.from("invites").select("id, created_by, created_at, expires_at")
      .is("used_at", null).gt("expires_at", now).order("created_at", { ascending: false }).limit(50);
    return json({ ok: true, items: (data ?? []).map(({ created_by, ...x }) => ({ ...x, mine: created_by === user.id, from: created_by })) });
  }
  if (body.action === "revoke") {
    let q = db.from("invites").delete().eq("id", Number(body.id)).is("used_at", null);
    if (!caller.is_admin) q = q.eq("created_by", user.id);
    const { error } = await q;
    return error ? json({ error: "Zurückziehen fehlgeschlagen." }, 500) : json({ ok: true });
  }
  return json({ error: "unknown action" }, 400);
});
