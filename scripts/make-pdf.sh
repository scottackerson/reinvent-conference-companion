#!/bin/bash
# Builds the site, then prints the print variant (every <details> open, light theme, no console or tab bar)
# to agenda.pdf in the repo root. Passphrase mode: needs PASSPHRASE in the environment, prints
# build-private/print.html. Other modes: prints public/print.html.
set -euo pipefail
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node build.mjs
SRC="$(AG="$([ -f agenda.json ] && echo agenda.json || echo agenda.example.json)" node -e '
  const fs = require("fs"), p = "build-private/print.html", q = "public/print.html";
  const priv = JSON.parse(fs.readFileSync(process.env.AG, "utf8")).privacy === "passphrase";
  const use = priv || (fs.existsSync(p) && (!fs.existsSync(q) || fs.statSync(p).mtimeMs > fs.statSync(q).mtimeMs));
  console.log(use ? p : q);')"
[ -f "$SRC" ] || { echo "Missing $SRC. The build did not produce a print page." >&2; exit 1; }
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$ROOT/agenda.pdf" \
  "file://$ROOT/$SRC" >/dev/null 2>&1
ls -l "$ROOT/agenda.pdf"
echo "Printed $SRC. Save agenda.pdf to iCloud Drive and mark it Keep Downloaded."
