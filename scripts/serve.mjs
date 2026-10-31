// Kleiner statischer Server für Entwicklung, Tests und Demo (ohne zusätzliche Abhängigkeit).
// Aufruf: node scripts/serve.mjs <ordner> <port>
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

export function serve(dir, port) {
  const root = resolve(dir);
  return createServer(async (req, res) => {
    let path;
    try { path = decodeURIComponent(new URL(req.url, "http://x").pathname) } catch { res.writeHead(400).end(); return }
    const file = normalize(join(root, path.endsWith("/") ? path + "index.html" : path));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }).end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Nicht gefunden");
    }
  }).listen(port, () => console.log(`http://localhost:${port}`));
}

if (process.argv[1] && process.argv[1].split("\\").join("/").endsWith("scripts/serve.mjs")) {
  serve(process.argv[2] || "dist", Number(process.argv[3] || 4173));
}
