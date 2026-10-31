# Sicherheit

## Schwachstelle melden
Bitte nicht als öffentliches Issue, sondern über **Security → Report a vulnerability** im GitHub-Repository.

## Grundsätze
- Zugang nur mit Einladungslink (einmalig, 7 Tage gültig, in der Datenbank nur als SHA-256-Hash). Freie Registrierung ist in Supabase ausgeschaltet.
- Row Level Security auf jeder Tabelle: Wer nicht Mitglied ist, sieht nichts. Mitglieder ändern nur ihre eigenen Einträge.
- Gerätetyp (Stimmgewicht), Admin-Status, Spitznamen und die Sacceri-Auszeichnung sind nicht direkt änderbar, sondern nur über Datenbank-Funktionen mit Prüfung (Admin bzw. Abstimmung mit ⅔-Mehrheit). Admin-Änderungen werden protokolliert.
- Keine Datenbank-Funktion ist ohne Login ausführbar.
- Fotos liegen in einem privaten Speicher; hochladen nur in den eigenen Ordner, anzeigen nur über zeitlich begrenzte Links.
- Die ausgelieferte App hat eine Content-Security-Policy mit Prüfsumme: Nur der eigene Code läuft, eingeschleuster Code wird vom Browser blockiert. Alle Texte von Mitgliedern werden escaped.

## Was vor jedem Merge geprüft wird

| Prüfung | Was sie findet |
|---|---|
| **CodeQL** (security-extended) | Schwachstellen im Code und in den Workflows |
| **Semgrep** | Schwachstellen-Muster, eingecheckte Secrets, unsichere Workflows |
| **npm audit** | Abhängigkeiten mit bekannten Schwachstellen |
| `tests/sicherheit.spec.js` | CSP, blockierter Fremdcode, Escaping, Funktionsrechte, RLS, Edge Functions, Workflows, Secrets |
| `tests-db/regeln.sql` | gegen echtes Postgres: Nicht-Mitglieder sehen nichts, Gerät/Admin/Sacceri nicht selbst änderbar, Abstimmungsregeln, Fotos nur im eigenen Ordner |

Bei jedem Release prüft `release.yml` zusätzlich die echte Datenbank (Funktionsrechte, Row Level Security).
