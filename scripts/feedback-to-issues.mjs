// Holt neue Verbesserungsvorschläge aus Supabase und legt sie als GitHub-Issues an.
// Läuft in GitHub Actions (feedback-issues.yml) mit dem eingebauten GITHUB_TOKEN.
// Env: SUPABASE_URL, CRON_SECRET, GITHUB_TOKEN, GITHUB_REPOSITORY
// Exit-Code 1, wenn etwas schiefgeht → GitHub meldet den fehlgeschlagenen Lauf per Mail.

export async function run({ env, fetch: f = fetch, log = console.log }) {
  const ops = (body) =>
    f(`${env.SUPABASE_URL}/functions/v1/feedback-export`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CRON_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const res = await ops({ action: "pending" });
  if (!res.ok) throw new Error(`feedback-export antwortet mit HTTP ${res.status}`);
  const { items } = await res.json();
  log(`${items.length} neue Vorschläge`);

  let failed = 0;
  for (const it of items) {
    const gh = await f(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Magnum",
      },
      body: JSON.stringify({ title: it.title, body: it.body, labels: it.labels }),
    });
    if (gh.ok) {
      const issue = await gh.json();
      const r = await ops({ action: "done", id: it.id, number: issue.number, url: issue.html_url });
      if (!r.ok) throw new Error(`Issue #${issue.number} angelegt, aber Status nicht gespeichert (HTTP ${r.status})`);
      log(`✓ Vorschlag ${it.id} → Issue #${issue.number}`);
    } else {
      failed++;
      const msg = `GitHub HTTP ${gh.status}: ${(await gh.text()).slice(0, 200)}`;
      await ops({ action: "failed", id: it.id, error: msg });
      log(`✗ Vorschlag ${it.id}: ${msg}`);
    }
  }
  if (failed) throw new Error(`${failed} Vorschläge konnten nicht als Issue angelegt werden`);

  // Geschlossene Issues zurückmelden: In der App erscheint der Vorschlag als "umgesetzt" oder "geschlossen"
  const open = await ops({ action: "open" });
  if (!open.ok) throw new Error(`feedback-export (open) antwortet mit HTTP ${open.status}`);
  for (const it of (await open.json()).items || []) {
    const gh = await f(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/issues/${it.issue_number}`, {
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Magnum" },
    });
    if (!gh.ok) { log(`Issue #${it.issue_number}: HTTP ${gh.status}, wird beim nächsten Lauf erneut geprüft`); continue; }
    const issue = await gh.json();
    if (issue.state !== "closed") continue;
    const completed = issue.state_reason === "completed";
    const r = await ops({ action: "closed", id: it.id, completed });
    if (!r.ok) throw new Error(`Issue #${it.issue_number} geschlossen, aber Status nicht gespeichert (HTTP ${r.status})`);
    log(`Issue #${it.issue_number} geschlossen (${completed ? "umgesetzt" : "nicht umgesetzt"})`);
  }
  return items.length;
}

if (process.argv[1] && process.argv[1].split("\\").join("/").endsWith("scripts/feedback-to-issues.mjs")) {
  for (const k of ["SUPABASE_URL", "CRON_SECRET", "GITHUB_TOKEN", "GITHUB_REPOSITORY"]) {
    if (!process.env[k]) { console.error(`::error::${k} fehlt`); process.exit(1); }
  }
  run({ env: process.env }).catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
}
