# Magnum – Hinweise für die Weiterentwicklung

Gebaut wie InterChampionship (Herren Inter). Sprache in App, Code-Kommentaren, Commits und Doku: Deutsch (Schweiz, ohne ß).

## Aufbau
- `app/index.html`: die ganze App, ein eingebettetes `<script>` ohne Framework. Darstellung über `render()` mit HTML-Strings, Klicks über `data-a` (→ `ACT`), Formulare über `data-s` (→ `SUBMIT`), Dateien/Selects über `data-c` (→ `CHANGE`), Eingaben über `data-k` (→ `UI`).
- **Keine Inline-Handler** (`onclick=` usw.) und kein zweites `<script>`: Die CSP erlaubt nur das eine Skript per Prüfsumme (`scripts/build.mjs`).
- **Jeder Text aus der Datenbank geht durch `esc()`**.
- Spielregeln (Punkte, Streak, Ränge, Trinkfestigkeit) in `stats()`; Abstimmungsregeln gelten in der Datenbank (`resolve_proposal`), die App spiegelt sie nur zur Anzeige (`tally()`).

## Datenbank
- `db/setup.sql` ist mehrfach ausführbar und wird bei jedem Release eingespielt. Änderungen, die nicht idempotent sind, als neue Datei in `db/migrations/` (Name `JJJJMMTT_NN_titel.sql`).
- Neue Tabelle: `create table if not exists`, `enable row level security`, Policies, in die Live-Sync-Liste aufnehmen und in `tests/mock-neon.js` nachbilden.
- Neue Tabellen sind automatisch in der Datensicherung (`backup_tables()`). Rein technische Tabellen dort ausschliessen.
- Die angemeldete Person ist `public.uid()`, nie `auth.uid()`: Das Schema `auth` darf die Data-API-Rolle nicht nutzen.
- Serverseitiges liegt in `functions/index.ts` (Neon Function `api`), die reine Logik daneben in `.mjs`-Dateien mit Tests. Die Function läuft als Datenbank-Besitzer und muss selbst prüfen, wer anfragt.
- Regeln, die auch an der App vorbei gelten (Fristen, Plätze, fremde Inhalte), gehören in Trigger. `auth.uid() is null` lässt Server-Abläufe durch (Wiederherstellung, Release). Im Nachbau in `checkRow()` spiegeln.
- Neue Funktion mit `security definer`: `revoke execute … from public, anonymous` und gezielt `grant … to authenticated` (der Test in `tests/sicherheit.spec.js` prüft das).

## Tests (vor jedem Commit)
- `npm test`: Playwright gegen die nachgebaute Datenbank (`tests/mock-neon.js`). Neue Funktionen dort nachbilden und einen Test ergänzen: Ablauf in `tests/app.spec.js`, Konto in `konto.spec.js`, Abstimmungen in `abstimmung.spec.js`, Inhalte in `inhalte.spec.js`, Deployment in `betrieb.spec.js`.
- `npm run test:db`: Regeltests gegen Postgres (`tests-db/regeln.sql`). Neue Regeln dort testen.
- `npm run test:neon`: Durchlauf gegen einen Neon-Testbranch (`tests-e2e/neon.spec.js`), nie gegen `main`.
- `npm run demo`: App mit Demo-Daten auf http://localhost:4174.

## Ablauf
- Branch `feature/…` oder `fix/…`, Pull Request. Grün → automatisch gemergt und deployt (`auto-merge.yml`).
- Neue Use Cases in `.claude/agents/ui-tester.md` ergänzen.
