// Baut aus einem Verbesserungsvorschlag ein GitHub-Issue. Reine Logik, damit sie getestet werden kann.
// Das Repository ist öffentlich: Es werden weder Namen noch Mail-Adressen veröffentlicht. Wer den
// Vorschlag eingereicht hat, steht nur in der Tabelle "feedback".
export const KINDS = {
  idee: { label: "verbesserung", prefix: "💡" },
  fehler: { label: "fehler", prefix: "🐞" },
  wunsch: { label: "wunsch", prefix: "🍷" },
};
export const DAILY_LIMIT = 5;

// @-Erwähnungen entschärfen, damit niemand auf GitHub ungewollt angepingt wird.
const noPing = (s) => s.replace(/@(?=\w)/g, "@​");

export function buildIssue(input, now = new Date()) {
  const kind = KINDS[input?.kind] ? input.kind : null;
  const title = String(input?.title ?? "").trim().replace(/\s+/g, " ");
  const text = String(input?.text ?? "").trim();
  if (!kind) throw new Error("Bitte Idee, Fehler oder Wunsch wählen.");
  if (title.length < 3 || title.length > 100) throw new Error("Der Titel muss 3–100 Zeichen lang sein.");
  if (text.length > 4000) throw new Error("Die Beschreibung darf höchstens 4000 Zeichen lang sein.");
  const date = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", dateStyle: "medium" }).format(now);
  return {
    kind,
    title: `${KINDS[kind].prefix} ${noPing(title)}`,
    body: `${text ? noPing(text) : "_Keine Beschreibung._"}\n\n---\nEingereicht in der App am ${date}.`,
    labels: [KINDS[kind].label, "aus-der-app"],
  };
}
