// Fotos: reine Logik, damit sie getestet werden kann.
// Pfad: <bereich>/<user-id>/<datei>.jpg. Die App verkleinert jedes Bild zu einem JPEG, der Speicher nimmt nichts anderes an.
// Videokarten: videos/<user-id>/<datei>.mp4|webm, höchstens 7 Sekunden (kürzt die App), höchstens 12 MB.
export const MAX_FOTO = 5 * 1024 * 1024;
export const MAX_VIDEO = 12 * 1024 * 1024;
const PFAD = /^(drinks|trips|cards|receipts)\/([0-9a-f-]{36})\/[A-Za-z0-9._-]{1,80}\.jpg$/;
const VIDEO = /^videos\/([0-9a-f-]{36})\/[A-Za-z0-9._-]{1,80}\.(mp4|webm)$/;

export const checkPfad = (p) => typeof p == "string" && (PFAD.test(p) || VIDEO.test(p)) && !p.includes("..");
export const istVideo = (p) => typeof p == "string" && VIDEO.test(p);
export const videoTyp = (p) => (p.endsWith(".webm") ? "video/webm" : "video/mp4");

export function checkVideo(pfad, userId, data) {
  if (!istVideo(pfad) || pfad.includes("..")) throw new Error("Ungültiger Speicherort.");
  if (pfad.split("/")[1] != userId) throw new Error("Hochladen nur in den eigenen Ordner.");
  if (data.length > MAX_VIDEO) throw new Error("Das Video ist zu gross.");
  const mp4 = data.length > 12 && data[4] == 0x66 && data[5] == 0x74 && data[6] == 0x79 && data[7] == 0x70; // "ftyp"
  const webm = data.length > 4 && data[0] == 0x1a && data[1] == 0x45 && data[2] == 0xdf && data[3] == 0xa3;
  if (pfad.endsWith(".mp4") ? !mp4 : !webm) throw new Error("Nur MP4- oder WebM-Videos.");
}

// Aufräumen: Videodateien ohne Karte, älter als "tage" (so stört es kein Hochladen, das gerade läuft).
// Ob eine Sicherung die Karte noch enthält, prüft die Function danach in der Datenbank.
export const verwaisteVideos = (objekte, behalten, jetzt, tage = 2) =>
  objekte.filter((o) => istVideo(o.Key) && !behalten.has(o.Key) && jetzt - new Date(o.LastModified).getTime() > tage * 864e5).map((o) => o.Key);

export function checkFoto(pfad, userId, data) {
  if (!checkPfad(pfad) || istVideo(pfad)) throw new Error("Ungültiger Speicherort.");
  if (pfad.split("/")[1] != userId) throw new Error("Hochladen nur in den eigenen Ordner.");
  if (data.length > MAX_FOTO) throw new Error("Das Bild ist zu gross.");
  if (data.length < 3 || data[0] != 0xff || data[1] != 0xd8 || data[2] != 0xff) throw new Error("Nur JPEG-Bilder.");
}
