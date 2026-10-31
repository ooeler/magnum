// Kopiert die Supabase-Bibliothek aus node_modules in app/vendor/,
// damit die App sie selbst ausliefert (offline-fähig, von Dependabot aktuell gehalten).
const fs = require("fs");
const path = require("path");

const src = require.resolve("@supabase/supabase-js/dist/umd/supabase.js");
const dir = path.join(__dirname, "..", "app", "vendor");
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(src, path.join(dir, "supabase.js"));
console.log("vendor/supabase.js aktualisiert");
