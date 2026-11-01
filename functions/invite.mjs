// Einladungslinks: reine Logik, damit sie getestet werden kann.
// Jedes Mitglied darf einladen. Der Club hat höchstens settings.max_members Mitglieder (Standard 12).
export const INVITE_DAYS = 7;
export const MAX_OFFEN = 3; // offene Einladungen pro Mitglied, der Admin ist nicht begrenzt

// Link-Token: 32 Zufallsbytes (base64url). In der Datenbank liegt nur der SHA-256-Hash.
export function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function checkToken(token) {
  const t = String(token ?? "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(t)) throw new Error("Dieser Einladungslink ist ungültig.");
  return t;
}

// Registrierung über den Link: Name, Mail, Passwort und Gerät prüfen.
// Das Gerät erkennt die App automatisch. Doppelt zählt Android erst, wenn der Admin es bestätigt hat.
export function checkJoin(input) {
  const name = String(input?.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 40) throw new Error("Bitte deinen Namen eingeben (2–40 Zeichen).");
  const email = String(input?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) throw new Error("Bitte eine gültige Mail-Adresse eingeben.");
  const password = String(input?.password ?? "");
  if (password.length < 8) throw new Error("Das Passwort braucht mindestens 8 Zeichen.");
  if (password.length > 72) throw new Error("Das Passwort darf höchstens 72 Zeichen haben.");
  const device = input?.device === "android" ? "android" : "iphone";
  return { name, email, password, device };
}

export function clubFull(count, max) {
  return Number(count) >= Number(max || 12);
}

// Verständliche Meldung für die häufigsten Fehler des Auth-Dienstes
export function joinError(message = "") {
  if (/already been registered|already registered|exists/i.test(message)) return "Diese Adresse hat bereits ein Konto. Bitte normal anmelden.";
  if (/password/i.test(message)) return "Das Passwort ist zu schwach. Bitte ein längeres wählen.";
  return "Registrierung fehlgeschlagen: " + message;
}
