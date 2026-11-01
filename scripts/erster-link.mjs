// Erzeugt den allerersten Einladungslink. Wer ihn einlöst, wird Admin.
// Aufruf: DATABASE_URL=… node scripts/erster-link.mjs https://<github-name>.github.io/magnum/
// Es braucht kein Passwort im Klartext: Die Person wählt es beim Einlösen selbst.
import pg from "pg";
import { hashToken, newToken } from "../functions/invite.mjs";

const app = process.argv[2];
if (!process.env.DATABASE_URL || !app) { console.error("DATABASE_URL und App-Adresse angeben"); process.exit(1) }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const t = newToken();
await c.query("insert into public.invites (token_hash, expires_at, als_admin) values ($1, now() + interval '7 days', true)", [await hashToken(t)]);
await c.end();
console.log(app + "#einladung=" + t);
