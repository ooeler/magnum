// Baut die auslieferbare App nach dist/: kopiert app/ und setzt eine Content-Security-Policy
// mit SHA-256-Prüfsummen der eingebetteten Skripte. Nur dieser Code darf laufen – eingeschleuste
// Inline-Handler (z. B. onerror="…") blockiert der Browser. Tests und Deployment nutzen dieselbe Ausgabe.
import { createHash } from "node:crypto";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "app"), out = join(root, "dist");
const supabase = process.env.SUPABASE_URL || "https://*.supabase.co";

export function csp(html, supabaseUrl = supabase) {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => `'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
  const host = supabaseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // http nur für die lokale Test-Datenbank der E2E-Tests, ausgeliefert wird immer https
  const [http, ws] = /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(supabaseUrl) ? ["http", "ws"] : ["https", "wss"];
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src 'self' ${http}://${host} ${ws}://${host}`,
    // Fotos kommen als signierte Links aus dem privaten Supabase-Speicher
    `img-src 'self' data: blob: ${http}://${host}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function build() {
  rmSync(out, { recursive: true, force: true });
  cpSync(src, out, { recursive: true });
  const file = join(out, "index.html");
  const html = readFileSync(file, "utf8");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp(html)}">`;
  writeFileSync(file, html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${meta}`));
  return out;
}

if (process.argv[1] && process.argv[1].split("\\").join("/").endsWith("scripts/build.mjs")) {
  console.log("gebaut: " + build());
}
