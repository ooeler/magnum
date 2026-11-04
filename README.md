# Magnum

PWA des **Magnum Clubs**: Anlässe mit An- und Abmeldung, Reisen, Rangliste, Sammelkarten und Statistik. Gamification, Zusammenhalt, Fröhlichkeit und Geselligkeit, damit alle öfter kommen. Login nur mit Einladung, Live-Sync zwischen allen Handys.

Aufgebaut wie die App **Herren Inter** (InterChampionship), als Backend aber [Neon](https://neon.com): eine einzige `index.html` ohne Framework, Playwright-Tests, Deployment über GitHub Actions. Alles läuft **kostenlos**: GitHub (Code, Tests, Hosting über GitHub Pages) + Neon Free.

## Funktionen

| Bereich | Inhalt |
|---|---|
| 🍷 Termine | Begrüssung je nach Lage, am Tag nach einem Anlass für alle, die dabei waren: „Hast du Kopfweh?“ oder „Hallo Brummschädel“, nach drei verpassten Anlässen „Komm mal wieder“. Spruch des Tages, eigener Rang mit Punkten, Streak und errechneter Trinkfestigkeit, Club-Ziel, die **nächsten drei Magnum-Abende** (letzter Freitag im Monat, automatisch angelegt, Name und Datum anpassbar), **Duell des Monats Android gegen iPhone**, nächste Anlässe mit „Bin dabei“ / „Abmelden“. Beim Abmelden: **„Ich kann nicht, möchte aber virtuell dabei sein und bezahle eine Magnum“** (Streak bleibt, Magnum geht in die Kasse). „Ich organisiere den Abend“, einen künftigen Abend kann jedes Mitglied jederzeit übernehmen. Magnum-Kasse, Magnum-Abend mit hüpfenden Weingläsern, „Mein Abend“ (Getränke fotografieren), Prost-Wand |
| Anlass-Details | Beiz und Quittung pro Termin, Wer dabei ist, Organisator (im Anlass anpassbar), **Magnums des Abends mit Gasttrinkern pro Magnum**, Heimweg/Fahrservice: Mitfahrer bewerten den Fahrer (3 Kriterien) und verteilen 10–50 Punkte |
| ✈️ Reisen | Reisen erfassen, mitreisen, **OK und Kassier** eintragen, **Auszeichnung „De Sacceri“**: Antrag durch ein Mitglied, ⅔-Mehrheit der Anwesenden. Beste Bilder hochladen: 3 sichtbar, der Rest wird zur **Collage-Karte unter „Legendär“** |
| 👥 Club | Saison-Rangliste (gleiche Punkte = gleicher Rang), Mitgliederprofile mit Gerät, Rollen Mitglied und Administrator, **Spitznamen** (Vorschlag + zweite Unterstützung + ⅔-Mehrheit), Einladungen, Verbesserungsvorschläge (→ GitHub-Issue), Administration |
| 🃏 Karten | Sammelkarten Magic Moment, Legendär, „Klug war’s nicht, aber geil“, Sacceri- und Collage-Karten, geheime Karten (Trophäe, Location, Club) zum Freischalten |
| 📊 Statistik | **Karte der Beizen** (OpenStreetMap, ohne Schlüssel), Kennzahlen, Teilnahme pro Anlass, Beizen mit Quittungsfoto, Kosten pro Kopf, Bewertung (Preis-Leistung, Geselligkeit, „Willkommen, auch wenn du betrunken bist“), Link zu Google Maps |

### Spielregeln

- **Abstimmungen** (Sacceri, Spitznamen): Zweidrittelmehrheit der Stimmberechtigten. Jede Stimme zählt gleich viel. Beim Sacceri stimmt ab, wer beim Antrag mitreist. Die Regeln laufen in der Datenbank (`db/setup.sql`) und lassen sich nicht über die App umgehen.
- **Punkte:** Anlass +50, virtuell mit Magnum +20, organisiert +40, Gasttrinker +15, Reise +30, als Fahrer 10–50 von jedem Mitfahrer, Fahrt bewertet +5, Restaurant bewertet +5, Sammelkarte +10, auf einer Karte dabei +10, Vorschlag +2, wenn er angenommen wird weitere +8. Punkte für Anlässe und Reisen zählen, sobald sie stattgefunden haben. An- und abmelden geht bis und mit Anlasstag, mitreisen bis und mit Starttag und solange Plätze frei sind. Vergangene Anlässe und Reisen trägt nur der Administrator nach. Unter „Vergangene Anlässe“ erfasst er sie und setzt in den Details die Anwesenheit.
- **Magnum-Serie:** Immer am letzten Freitag im Monat um 19 Uhr, Name aus dem Datum (z. B. „November-Magnum“). Anpassen dürfen Organisator und Admin, auch den Organisator selbst. Ein gelöschter oder verschobener Abend wird nicht neu angelegt.
- **Ränge:** Neuling, Stammgast (200), Kellermeister (400), Magnum-Ritter (600), Club-Legende (900).
- **Streak:** Anlässe in Folge (dabei oder virtuell). „Nur abmelden“ setzt sie auf 0, der **Rekord** bleibt stehen.
- **Duell des Monats:** Anwesenheit in Prozent, Android gegen iPhone (das Gerät wird bei der Registrierung erkannt, ändern kann es nur der Administrator). Es zählt nur, wer wirklich dabei war. Wer im Vormonat verloren hat, bringt die nächste Magnum; das zeigt die App nur an.
- **Effekte:** Am Anlasstag fliegen gefüllte Weingläser durchs Bild, an besonderen Tagen Emojis (Samichlaus, Halloween, Ostern usw.). Im Advent trägt das Glas eine Mütze, an manchen Wintertagen schneit es. Bei „Bewegung reduzieren“ bewegt sich nichts.
- **Trinkfestigkeit:** Ø Getränke pro Abend aus den Quittungen (der Wein zählt zu gleichen Teilen für alle Anwesenden, 1 dl ist ein Glas) und den fotografierten Getränken, am gleichen Abend zählt der höhere Wert. Getränkefotos: (Wein, Bier, Schnaps 1, Magnum-Glas 1,5, Wasser 0). Die App schlägt „Wein“ vor, man korrigiert mit einem Tipp. Quittungen liest eine Texterkennung direkt auf dem Handy aus, kostenlos und ohne dass das Foto das Gerät verlässt. Das Ergebnis lässt sich vor dem Speichern korrigieren.

## Projektstruktur

```
app/                      Die PWA (wird so ausgeliefert)
  index.html              App (ein eingebettetes Skript, abgesichert per Content-Security-Policy)
  sw.js                   Service Worker (offline)
  config.js               Verbindungsdaten (beim Release automatisch erzeugt)
  client.js               Kleiner Client für das Neon-Backend
db/
  setup.sql               Tabellen, Zugriffsregeln, Abstimmungs-Funktionen (mehrfach ausführbar)
  migrations/             spätere Änderungen, jeweils einmal angewendet
functions/                Neon Function "api": Login, Einladungen, Fotos, Vorschläge, Sicherung
neon.ts                   Neon-Dienste (Login, Data API, Fotospeicher, Function, Zeitplan)
tests/                    Playwright-Tests mit nachgebauter Datenbank (Android, iPhone, Desktop)
tests-db/                 Regeltests gegen ein echtes Postgres (Rechte, Abstimmungen, Einladungen)
tests-e2e/                Durchlauf gegen ein echtes Neon-Backend (npm run test:neon)
scripts/                  Build (CSP), Demo, Datenbank-Tests, Vorschläge → Issues
.github/                  Tests, Release-Deploy, Auto-Merge, Dependabot, CodeQL
```

## Einrichtung (einmalig)

### 1. Neon

1. Auf [neon.com](https://neon.com) ein Projekt in **AWS Frankfurt** anlegen.
2. Unter **Account settings → API keys** einen API-Key erstellen. Er kommt in GitHub, nie in den Chat und nie ins Repository.

Login, Data API, Fotospeicher, Function und Datenbank richtet der Release-Ablauf ein.

### 2. GitHub

1. **Settings → Pages** → *Source: GitHub Actions*.
2. **Settings → Secrets and variables → Actions**
   - *Variables*: `NEON_PROJECT_ID`, `APP_URL` (`https://<github-name>.github.io/magnum/`), `NEON_DATA_API_URL`, `MAGNUM_API_URL`, `NEON_HOSTS` (Adressen von Data API, Function und Fotospeicher, mit Komma getrennt)
   - *Secrets*: `NEON_API_KEY`, `MAGNUM_CRON_SECRET` (beliebige lange Zufallszeichenfolge)
3. **Settings → Code security**: *Dependabot alerts* und *security updates* einschalten.

### 3. Erstes Mitglied (Admin)

Nach dem ersten Release einen Einladungslink erzeugen. Wer ihn einlöst, wird Admin:

```bash
DATABASE_URL="$(neon connection-string main)" node scripts/erster-link.mjs https://<github-name>.github.io/magnum/
```

Alle weiteren Mitglieder lädst du in der App ein: **Club → Einladungen → Einladungslink erstellen** und per WhatsApp schicken. Der Link gilt 7 Tage und einmal.

### 4. Verbesserungsvorschläge → GitHub-Issues

Im Tab **Club** können alle Mitglieder Ideen, Fehler und Wünsche melden. Die Function `api` speichert den Vorschlag; der Ablauf **„Vorschläge → Issues“** legt daraus alle 10 Minuten ein Issue an (Labels `verbesserung` / `fehler` / `wunsch` + `aus-der-app`, max. 5 pro Person und Tag, keine Mail-Adressen). Wird das Issue geschlossen, zeigt die App „umgesetzt“. Es braucht **kein persönliches GitHub-Token**.

## Ablauf im Alltag (wie bei Herren Inter)

- **Jede Änderung über einen Branch + Pull Request**: `feature/…` → Minor-Release, `fix/…` → Patch-Release, `docs/…`, `ci/…` → nur mergen. Sind Tests, Datenbank-Tests, Semgrep, npm audit und CodeQL grün, wird automatisch gemergt und deployt.
- **Release** = Tests → Backup → Wartungsseite an → Neon-Dienste → `db/setup.sql` + Migrationen → Sicherheitsprüfung der echten Datenbank → Funktionstest → App → Wartungsseite aus.
- Falls die Wartungsseite hängen bleibt: `update public.app_status set maintenance = false;` im SQL Editor von Neon.

### Rollback

Vor jedem Release (die letzten 30) und täglich um 02:30 UTC (30 Tage) wird der ganze Club in `public.backups` gesichert. Fotos liegen im Speicher und sind nicht enthalten. Neon selbst kann im Gratis-Plan nur 6 Stunden zurückspringen, darum zählen diese Sicherungen. Wiederherstellen im SQL Editor:

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
npm run test:neon # Durchlauf gegen ein echtes Neon-Backend, siehe Kopf von tests-e2e/neon.spec.js (nie gegen main)
npm start         # App unter http://localhost:4183 (config.js mit den Neon-Adressen füllen)
```

Demo-Konten: `ot@magnum.test` (Admin, iPhone), `beat@magnum.test` (Android), `chris@magnum.test`, Passwort jeweils `magnum123`.

## Nächste Schritte

- Push-Nachrichten vor Anlässen (wie bei Herren Inter mit VAPID, hier als Route der Function `api`)
- Deutsche Mails: Neon verschickt Passwort-Mails auf Englisch. Eigene Texte gehen über einen Webhook und eigenen Mailversand.
- Teilen-Knöpfe für die WhatsApp-Gruppe
