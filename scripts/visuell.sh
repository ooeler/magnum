#!/usr/bin/env bash
# Visueller Vergleich: Basis-Stand gegen den aktuellen Arbeitsstand (tests/visuell.spec.js).
#   1. Basis-Stand (Git-Ref, Standard origin/main) in einen temporären Worktree holen, mit dessen
#      package-lock.json installieren und bauen (dist/).
#   2. Referenzbilder aus diesem Build erzeugen (--update-snapshots=all) in VISUELL_BILDER.
#   3. Aktuellen Stand bauen und mit den Referenzbildern vergleichen.
# Spec, Nachbau (tests/), Playwright und Browser kommen in beiden Durchläufen aus dem aktuellen Stand,
# nur die gebaute App wechselt. Es liegen keine Referenzbilder im Repo.
#
# Aufruf: bash scripts/visuell.sh [basis-ref] [weitere Playwright-Argumente]
#   bash scripts/visuell.sh origin/main --project=android --project=desktop --workers=2
# Unterschiede: test-results/ (je Bild *-expected, *-actual, *-diff).
set -euo pipefail

basis="${1:-origin/main}"; [ $# -gt 0 ] && shift
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
bilder="${VISUELL_BILDER:-$root/visuell-referenz}"
tmp="$(mktemp -d)"
wt="$tmp/basis"
aufraeumen() { git worktree remove --force "$wt" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap aufraeumen EXIT

echo "▶ Basis-Stand $basis bauen"
git worktree add --detach "$wt" "$basis" >/dev/null
(cd "$wt" && npm ci --no-audit --no-fund --loglevel=error && node scripts/build.mjs)

echo "▶ Referenzbilder aus dem Basis-Stand erzeugen"
rm -rf "$bilder"
VISUELL=1 VISUELL_DIST="$wt/dist" VISUELL_BILDER="$bilder" npx playwright test tests/visuell.spec.js --update-snapshots=all --reporter=line "$@"

echo "▶ Aktuellen Stand vergleichen"
VISUELL=1 VISUELL_BILDER="$bilder" npx playwright test tests/visuell.spec.js "$@"
