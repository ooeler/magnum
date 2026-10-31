// Supabase Edge Function "feedback-export": Schnittstelle für GitHub Actions (feedback-issues.yml).
// Header: Authorization: Bearer <CRON_SECRET>   (GitHub-Secret SUPABASE_CRON_SECRET)
//   { action: "pending" }                  – bis zu 20 neue Vorschläge
//   { action: "done", id, number, url }    – als Issue erfasst
//   { action: "failed", id, error }        – Anlegen fehlgeschlagen (wird nicht erneut versucht)
//   { action: "open" }                     – erfasste Vorschläge, deren Issue noch offen sein könnte
//   { action: "closed", id, completed }    – Issue geschlossen → in der App "umgesetzt" bzw. "geschlossen"
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { safeEqual } from "../_shared/sicherheit.mjs";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  if (!safeEqual(token, Deno.env.get("CRON_SECRET"))) return json({ error: "forbidden" }, 403);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));

  if (body.action === "pending") {
    const { data, error } = await db.from("feedback").select("id, title, body, labels")
      .eq("status", "neu").order("created_at").limit(20);
    return error ? json({ error: error.message }, 500) : json({ items: data });
  }
  if (body.action === "done") {
    const { error } = await db.from("feedback")
      .update({ status: "erfasst", issue_number: body.number, issue_url: body.url, error: null }).eq("id", body.id);
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }
  if (body.action === "failed") {
    const { error } = await db.from("feedback")
      .update({ status: "fehler", error: String(body.error || "").slice(0, 500) }).eq("id", body.id);
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }
  if (body.action === "open") {
    const { data, error } = await db.from("feedback").select("id, issue_number")
      .eq("status", "erfasst").not("issue_number", "is", null).limit(100);
    return error ? json({ error: error.message }, 500) : json({ items: data });
  }
  if (body.action === "closed") {
    const { error } = await db.from("feedback").update({ status: body.completed ? "umgesetzt" : "geschlossen" })
      .eq("id", body.id).eq("status", "erfasst");
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }
  return json({ error: "unknown action" }, 400);
});
