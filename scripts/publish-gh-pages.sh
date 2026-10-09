#!/bin/bash
# Builds in passphrase (or public) mode and force-pushes ONLY public/ to the gh-pages branch of origin.
# Usage: PASSPHRASE='long passphrase here' npm run publish:gh-pages
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[ -f agenda.json ] || { echo "No agenda.json found. Build your agenda first." >&2; exit 1; }
PRIVACY="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("agenda.json","utf8")).privacy||"")')"
case "$PRIVACY" in
  passphrase)
    [ -n "${PASSPHRASE:-}" ] || { echo "Set PASSPHRASE in the environment, for example: PASSPHRASE='...' npm run publish:gh-pages" >&2; exit 1; } ;;
  public)
    echo "privacy is \"public\": anyone with the link will see your whole schedule." ;;
  *)
    echo "Refusing to publish to GitHub Pages: agenda.json privacy is \"$PRIVACY\". Use \"passphrase\" (or \"public\")." >&2
    exit 1 ;;
esac

REMOTE="$(git remote get-url origin)"
node build.mjs

# Safety checks on the folder that will be published.
if [ -e public/agenda.json ] && [ "$PRIVACY" = "passphrase" ]; then
  echo "public/agenda.json exists. Refusing to publish plaintext." >&2; exit 1
fi
if [ "$PRIVACY" = "passphrase" ] && [ ! -f public/agenda.enc ]; then
  echo "public/agenda.enc is missing. Build did not produce encrypted output." >&2; exit 1
fi
if find public -name 'agenda.json' -o -name 'build-private' -o -name '*.pdf' | grep -q . && [ "$PRIVACY" = "passphrase" ]; then
  echo "public/ contains files that must not be published." >&2; exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R public/. "$TMP/"
rm -rf "$TMP/build-private"
touch "$TMP/.nojekyll"
(
  cd "$TMP"
  git init -q -b gh-pages
  git add -A
  git -c user.name="${GIT_AUTHOR_NAME:-publish}" -c user.email="${GIT_AUTHOR_EMAIL:-publish@localhost}" commit -q -m "Publish $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git remote add origin "$REMOTE"
  git push -f origin gh-pages
)
echo "Published public/ to the gh-pages branch."
echo "Enable it in GitHub: Settings, Pages, Deploy from branch, gh-pages, / (root)."
echo "Then run: npm run check-private -- https://<owner>.github.io/<repo>/"
