// Fotos: reine Logik, damit sie getestet werden kann.
// Pfad: <bereich>/<user-id>/<datei>.jpg. Die App verkleinert jedes Bild zu einem JPEG, der Speicher nimmt nichts anderes an.
export const MAX_FOTO = 5 * 1024 * 1024;
const PFAD = /^(drinks|trips|cards|receipts)\/([0-9a-f-]{36})\/[A-Za-z0-9._-]{1,80}\.jpg$/;

export const checkPfad = (p) => typeof p == "string" && PFAD.test(p) && !p.includes("..");

export function checkFoto(pfad, userId, data) {
  if (!checkPfad(pfad)) throw new Error("Ungültiger Speicherort.");
  if (pfad.split("/")[1] != userId) throw new Error("Hochladen nur in den eigenen Ordner.");
  if (data.length > MAX_FOTO) throw new Error("Das Bild ist zu gross.");
  if (data.length < 3 || data[0] != 0xff || data[1] != 0xd8 || data[2] != 0xff) throw new Error("Nur JPEG-Bilder.");
}
