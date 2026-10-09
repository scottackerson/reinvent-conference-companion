#!/bin/bash
# Regenerates public/icons/*.png using headless Chrome (no Node dependencies). Icons are committed, so
# you only need this if you change the artwork.
set -euo pipefail
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
for SIZE in 180 512; do
  FS=$((SIZE * 46 / 100))
  cat > "$TMP/i$SIZE.html" <<HTML
<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:${SIZE}px;height:${SIZE}px;background:#0F0B1E;overflow:hidden}
body{display:flex;align-items:center;justify-content:center;font:800 ${FS}px/1 -apple-system,"Helvetica Neue",Arial,sans-serif;letter-spacing:-0.03em}
span.a{color:#8B5CF6}span.b{color:#E040A0}
</style><body><span><span class="a">re</span><span class="b">:</span></span>
HTML
  OUT="$ROOT/public/icons/$([ $SIZE = 180 ] && echo apple-touch-icon || echo icon-512).png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=${SIZE},${SIZE} --screenshot="$OUT" "file://$TMP/i$SIZE.html" >/dev/null 2>&1
  # Chrome may pad the window height; crop to a square.
  sips -c $SIZE $SIZE "$OUT" >/dev/null
  sips -g pixelWidth -g pixelHeight "$OUT" | tail -2
done
rm -rf "$TMP"
