# Magnum

PWA des **Magnum Clubs** (12 Mitglieder): Anlässe mit An- und Abmeldung, Reisen, Rangliste, Sammelkarten und Statistik. Gamification, Zusammenhalt, Fröhlichkeit und Geselligkeit, damit alle öfter kommen. Login nur mit Einladung, Live-Sync zwischen allen Handys.

Aufgebaut wie die App **Herren Inter** (InterChampionship): eine einzige `index.html` ohne Framework, Supabase, Playwright-Tests, Deployment über GitHub Actions. Alles läuft **kostenlos**: GitHub (Code, Tests, Hosting über GitHub Pages) + Supabase Free.

## Funktionen

| Bereich | Inhalt |
|---|---|
| 🍷 Termine | Begrüssung je nach Lage, am Tag nach einem Anlass für alle, die dabei waren: „Hast du Kopfweh?“ oder „Hallo Brummschädel“, nach drei verpassten Anlässen „Komm mal wieder“. Spruch des Tages, eigener Rang mit Punkten, Streak und errechneter Trinkfestigkeit, Club-Ziel, **Duell des Monats Android gegen iPhone**, nächste Anlässe mit „Bin dabei“ / „Abmelden“. Beim Abmelden: **„Ich kann nicht, möchte aber virtuell dabei sein und bezahle eine Magnum“** (Streak bleibt, Magnum geht in die Kasse). „Ich organisiere den Abend“. Magnum-Kasse, Magnum-Abend mit hüpfenden Weingläsern, „Mein Abend“ (Getränke fotografieren), Phrasenschwein, Prost-Wand |
| Anlass-Details | Wer dabei ist, **Magnums des Abends mit Gasttrinkern pro Magnum**, Heimweg/Fahrservice: Mitfahrer bewerten den Fahrer (3 Kriterien) und verteilen 10–50 Punkte |
| ✈️ Reisen | Reisen erfassen, mitreisen, **OK und Kassier** eintragen, **Auszeichnung „De Sacceri“**: Antrag durch ein Mitglied, ⅔-Mehrheit der Anwesenden. Beste Bilder hochladen: 3 sichtbar, der Rest wird zur **Collage-Karte unter „Legendär“** |
| 👥 Club | Saison-Rangliste (gleiche Punkte = gleicher Rang), Mitgliederprofile, **Spitznamen** (Vorschlag + zweite Unterstützung + ⅔-Mehrheit), Einladungen, Verbesserungsvorschläge (→ GitHub-Issue), Administration |
| 🃏 Karten | Sammelkarten Magic Moment, Legendär, „Klug war’s nicht, aber geil“, Sacceri- und Collage-Karten, geheime Karten (Trophäe, Location, Club) zum Freischalten |
| 📊 Statistik | Kennzahlen, Teilnahme pro Anlass, Beizen mit Quittungsfoto, Kosten pro Kopf, Bewertung (Preis-Leistung, Geselligkeit, „Willkommen, auch wenn du betrunken bist“), Link zu Google Maps |

### Spielregeln

- **Abstimmungen** (Sacceri, Spitznamen): Zweidrittelmehrheit der Stimmberechtigten. **Android-Stimmen zählen doppelt.** Das Gerät wird bei der Registrierung erkannt, doppelt zählt es aber erst, wenn der **Administrator** es im Mitgliederprofil bestätigt hat. Ändern kann es nur er, jede Änderung steht im Admin-Protokoll. Beim Sacceri stimmt ab, wer beim Antrag mitreist. Die Regeln laufen in der Datenbank (`supabase/setup.sql`) und lassen sich nicht über die App umgehen.
- **Punkte:** Anlass +50, virtuell mit Magnum +20, organisiert +40, Gasttrinker +15, Reise +30, als Fahrer 10–50 von jedem Mitfahrer, Fahrt bewertet +5, Restaurant bewertet +5, Sammelkarte +10, Vorschlag +10. Punkte für Anlässe und Reisen zählen, sobald sie stattgefunden haben. An- und abmelden geht bis und mit Anlasstag, mitreisen bis und mit Starttag und solange Plätze frei sind. Vergangene Anlässe und Reisen trägt nur der Administrator nach.
- **Ränge:** Neuling, Stammgast (200), Kellermeister (400), Magnum-Ritter (600), Club-Legende (900).
- **Streak:** Anlässe in Folge (dabei oder virtuell). „Nur abmelden“ setzt sie auf 0, der **Rekord** bleibt stehen.
- **Duell des Monats:** Anwesenheit in Prozent, Android gegen iPhone (das Gerät zählt wie im Profil, auch unbestätigt). Es zählt nur, wer wirklich dabei war. Wer im Vormonat verloren hat, bringt die nächste Magnum; das zeigt die App nur an.
- **Effekte:** Am Anlasstag fliegen gefüllte Weingläser durchs Bild, an besonderen Tagen Emojis (Samichlaus, Halloween, Ostern usw.). Im Advent trägt das Glas eine Mütze, an manchen Wintertagen schneit es. Bei „Bewegung reduzieren“ bewegt sich nichts.
- **Trinkfestigkeit:** Ø Getränke pro Abend aus den fotografierten Getränken (Wein, Bier, Schnaps 1, Magnum-Glas 1,5, Wasser 0). Die App schlägt „Wein“ vor, man korrigiert mit einem Tipp. Eine automatische Bilderkennung ist noch nicht eingebaut.

## Projektstruktur

```
app/                      Die PWA (wird so ausgeliefert)
  index.html              App (ein eingebettetes Skript, abgesichert per Content-Security-Policy)
  sw.js                   Service Worker (offline)
  config.js               Verbindungsdaten (beim Release automatisch erzeugt)
supabase/
  setup.sql               Tabellen, Zugriffsregeln, Abstimmungs-Funktionen (mehrfach ausführbar)
  migrations/             spätere Änderungen, jeweils einmal angewendet
  functions/invite/       Einladungslinks (Konto anlegen ohne Mailversand)
  functions/feedback/     Verbesserungsvorschläge entgegennehmen
  functions/feedback-export/  Schnittstelle für GitHub Actions (Vorschläge → Issues)
tests/                    Playwright-Tests mit nachgebauter Datenbank (Android, iPhone, Desktop)
tests-db/                 Regeltests gegen ein echtes Postgres (Rechte, Abstimmungen, Einladungen)
scripts/                  Build (CSP), Demo, Datenbank-Tests, Vorschläge → Issues
.github/                  Tests, Release-Deploy, Auto-Merge, Dependabot, CodeQL
```

## Einrichtung (einmalig)

### 1. Supabase

1. Auf [supabase.com](https://supabase.com) kostenloses Projekt anlegen (Region Zürich/Frankfurt).
2. **SQL Editor** → Inhalt von `supabase/setup.sql` einfügen → *Run*. (Spätere Releases spielen die Datei automatisch ein.)
3. **Authentication → Sign In / Providers**: *Allow new users to sign up* **ausschalten**. Konten entstehen nur über Einladungslinks. Jeder Release sperrt die Registrierung zusätzlich und bricht ab, wenn sie offen bleibt.
4. **Authentication → URL Configuration**: *Site URL* und *Redirect URLs* = `https://<github-name>.github.io/magnum/`.
5. **Erstes Mitglied (Admin)**: Unter **Authentication → Users → Add user** dich selbst mit Mail und Passwort anlegen (*Auto Confirm*). Das Konto hat noch kein Profil, weil es nicht über eine Einladung entstand. Dann im SQL Editor:
   ```sql
   insert into public.profiles (id, display_name, is_admin, role_title, since_year)
   select id, 'Ot', true, 'Präsident', extract(year from now())::int from auth.users where email = 'deine@adresse.ch';
   ```
6. Danach lädst du alle weiteren Mitglieder in der App ein: **Club → Einladungen → Einladungslink erstellen** und per WhatsApp schicken. Der Link gilt 7 Tage und einmal. Der Club nimmt höchstens 12 Mitglieder auf (`settings.max_members`).

### 2. GitHub

1. Code in das Repository `magnum` pushen.
2. **Settings → Pages** → *Source: GitHub Actions*.
3. **Settings → Secrets and variables → Actions**
   - *Variables*: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PROJECT_REF`, `SUPABASE_TOKEN_EXPIRES` (Ablaufdatum des Tokens, Format `JJJJ-MM-TT`)
   - *Secrets*: `SUPABASE_ACCESS_TOKEN` (Supabase → Account → Access Tokens), `SUPABASE_CRON_SECRET` (beliebige lange Zufallszeichenfolge)
4. **Settings → Code security**: *Dependabot alerts* und *security updates* einschalten.
5. Erstes Release: **Releases → Draft a new release** → `v1.0.0` → *Publish*. Danach ist die App unter `https://<github-name>.github.io/magnum/` erreichbar.

### 3. Verbesserungsvorschläge → GitHub-Issues

Im Tab **Club** können alle Mitglieder Ideen, Fehler und Wünsche melden. Die Edge Function `feedback` speichert den Vorschlag; der Ablauf **„Vorschläge → Issues“** legt daraus alle 10 Minuten ein Issue an (Labels `verbesserung` / `fehler` / `wunsch` + `aus-der-app`, max. 5 pro Person und Tag, keine Mail-Adressen). Wird das Issue geschlossen, zeigt die App „umgesetzt“. Es braucht **kein persönliches GitHub-Token**.

## Ablauf im Alltag (wie bei Herren Inter)

- **Jede Änderung über einen Branch + Pull Request**: `feature/…` → Minor-Release, `fix/…` → Patch-Release, `docs/…`, `ci/…` → nur mergen. Sind Tests, Datenbank-Tests, Semgrep, npm audit und CodeQL grün, wird automatisch gemergt und deployt.
- **Release** = Tests → Backup → Wartungsseite an → `setup.sql` + Migrationen → Sicherheitsprüfung der echten Datenbank → Funktionstest → Edge Functions → Mailvorlagen → App → Wartungsseite aus.
- Falls die Wartungsseite hängen bleibt: `update public.app_status set maintenance = false;`
- **Token-Erinnerung:** 14 Tage vor `SUPABASE_TOKEN_EXPIRES` (oder sofort, wenn das Token ungültig ist) legt der Ablauf ein Issue mit Anleitung an.

### Rollback

Vor jedem Release (die letzten 30) und täglich um 02:30 UTC (30 Tage) wird der ganze Club in `public.backups` gesichert. Fotos liegen im Speicher und sind nicht enthalten. Wiederherstellen im SQL Editor:

```sql
select id, reason, saved_at from public.backups order by saved_at desc limit 20;
select public.restore_club(<id>);
```

Das ersetzt alle Club-Daten durch den gesicherten Stand. Der aktuelle Stand wird vorher als „vor Wiederherstellung“ gesichert. Passt eine Sicherung nicht mehr, etwa weil ein Mitgliedskonto inzwischen gelöscht wurde, bricht die Wiederherstellung ab und es ändert sich nichts.

## Lokal entwickeln

Voraussetzung: [Node.js](https://nodejs.org) 20+.

```bash
npm install
npx playwright install
npm run demo      # App mit Demo-Daten ohne Backend: http://localhost:4174 (ot@magnum.test / magnum123)
npm test          # alle Tests (nachgebaute Datenbank, Android/iPhone/Desktop)
npm run test:db   # Regeltests gegen Postgres (DB_URL=postgres://… setzen)
npm start         # App unter http://localhost:4183 (config.js mit Supabase-Werten füllen)
```

Demo-Konten: `ot@magnum.test` (Admin, iPhone), `beat@magnum.test` (Android), `chris@magnum.test`, Passwort jeweils `magnum123`.

## Nächste Schritte

- Push-Nachrichten vor Anlässen (wie bei Herren Inter mit VAPID und Edge Function `notify`)
- End-to-End-Tests gegen eine lokale Supabase (wie bei Herren Inter in `tests-e2e/`)
- Bilderkennung für Getränkefotos
- Karte mit allen Beizen in der App (heute: Link pro Beiz zu Google Maps)
- Teilen-Knöpfe für die WhatsApp-Gruppe
