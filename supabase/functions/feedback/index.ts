// Supabase Edge Function "feedback": nimmt einen Verbesserungsvorschlag aus der App entgegen.
// Nur für eingeloggte Mitglieder, max. DAILY_LIMIT pro Person und Tag.
// Der Vorschlag wird in der Tabelle "feedback" gespeichert; GitHub Actions (feedback-issues.yml)
// legt daraus alle 10 Minuten das GitHub-Issue an – ohne persönliches GitHub-Token.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { buildIssue, DAILY_LIMIT } from "./logic.mjs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return json({ error: "Nicht angemeldet" }, 401);
  const { data: member } = await db.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  if (!member) return json({ error: "Kein Mitglied" }, 403);

  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await db.from("feedback").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return json({ error: `Maximal ${DAILY_LIMIT} Vorschläge pro Tag.` }, 429);

  let issue;
  try {
    issue = buildIssue(await req.json(), member);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  const { data, error } = await db.from("feedback")
    .insert({ user_id: user.id, kind: issue.kind, title: issue.title, body: issue.body, labels: issue.labels })
    .select("id").single();
  if (error) return json({ error: "Vorschlag konnte nicht gespeichert werden." }, 500);
  return json({ queued: true, id: data.id });
});
