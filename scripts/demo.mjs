// Demo ohne Backend: baut die App und liefert statt config.js die nachgebaute Datenbank aus den Tests aus.
// Ideal zum Ausprobieren und für den UI-Test-Agenten (.claude/agents/ui-tester.md). http://localhost:4174
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "./build.mjs";
import { serve } from "./serve.mjs";

const out = build();
copyFileSync(join(out, "..", "tests", "mock-supabase.js"), join(out, "config.js"));
console.log("Demo: http://localhost:4174  (Login z. B. ot@magnum.test / magnum123)");
serve(out, 4174);
