// Push-Nachrichten: reine Logik, damit sie getestet werden kann.
export const ERINNERUNG_TAGE = 7;

// Kalendertag in der Schweiz als JJJJ-MM-TT
export function tagZuerich(d) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date(d));
}
export function plusTage(tag, n) {
  const d = new Date(tag + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Montag der Woche, in der der Tag liegt
export function wochenStart(tag) {
  const d = new Date(tag + "T12:00:00Z"), wt = (d.getUTCDay() + 6) % 7;
  return plusTage(tag, -wt);
}

// Anlässe, die heute in genau 7 Tagen stattfinden
export function erinnerungen(events, heute) {
  const ziel = plusTage(heute, ERINNERUNG_TAGE);
  return events.filter((e) => tagZuerich(e.starts_at) == ziel);
}

// Karte der Woche: zufällig, aber keine der zuletzt gezeigten, solange es andere gibt
export function karteWaehlen(karten, bisher, zufall = Math.random) {
  if (!karten.length) return null;
  const sperre = new Set(bisher.slice(0, Math.min(10, karten.length - 1)));
  const frei = karten.filter((k) => !sperre.has(k));
  return frei[Math.floor(zufall() * frei.length)] ?? null;
}

// Prüft ein Push-Abo aus dem Browser, bevor es gespeichert wird
export function checkAbo(b) {
  const endpoint = String(b?.endpoint ?? ""), p256dh = String(b?.keys?.p256dh ?? ""), auth = String(b?.keys?.auth ?? "");
  if (!/^https:\/\/[^\s]{10,500}$/.test(endpoint)) throw new Error("Ungültiges Push-Abo.");
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) throw new Error("Ungültiges Push-Abo.");
  return { endpoint, p256dh, auth };
}
