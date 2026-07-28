#!/usr/bin/env bash
# Generates build/icon.icns from build/icon.svg — macOS-only (uses qlmanage's
# QuickLook renderer for SVG->PNG, since sips itself can't rasterize SVG, then
# sips to resize into the .iconset sizes and iconutil to pack the .icns).
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="build/icon.svg"
ICONSET="build/icon.iconset"
OUT="build/icon.icns"
MASTER_PNG="build/.icon-master.png"

rm -rf "$ICONSET" "$MASTER_PNG"
mkdir -p "$ICONSET"

# QuickLook thumbnail generation renders to <name>.png inside the given -o dir.
qlmanage -t -s 1024 -o build "$SRC" >/dev/null
mv "build/$(basename "$SRC").png" "$MASTER_PNG"

# qlmanage flattens SVG transparency onto white, which used to ship the icon
# with opaque white squircle corners. The squircle outline is the SVG's first
# <path> (a pure M/L polygon), so re-apply it here as a real alpha channel:
# rasterize that polygon 4x supersampled for a smooth edge, downsample to the
# master's size, and write it into the PNG before the per-size resizes below
# (sips preserves alpha; iconutil accepts it).
python3 - "$SRC" "$MASTER_PNG" <<'PY'
import re, sys
from PIL import Image, ImageDraw

svg_path, png_path = sys.argv[1], sys.argv[2]
d = re.search(r'<path d="([^"]+)"', open(svg_path).read()).group(1)
pts = [(float(x), float(y)) for x, y in re.findall(r'[ML] ([0-9.]+) ([0-9.]+)', d)]
im = Image.open(png_path).convert('RGBA')
w, h = im.size
SS = 4
mask = Image.new('L', (w * SS, h * SS), 0)
sx, sy = w * SS / 1024, h * SS / 1024
ImageDraw.Draw(mask).polygon([(x * sx, y * sy) for x, y in pts], fill=255)
im.putalpha(mask.resize((w, h), Image.LANCZOS))
im.save(png_path)
PY

# Keep the tracked full-size PNG (build/icon.png) in sync with the same
# masked master the .icns is packed from.
cp "$MASTER_PNG" build/icon.png

declare -a SIZES=(16 32 64 128 256 512 1024)
for size in "${SIZES[@]}"; do
  sips -z "$size" "$size" "$MASTER_PNG" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  if [ "$size" -le 512 ]; then
    double=$((size * 2))
    sips -z "$double" "$double" "$MASTER_PNG" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  fi
done

iconutil -c icns "$ICONSET" -o "$OUT"
rm -rf "$ICONSET" "$MASTER_PNG"

echo "Wrote $OUT"

# Menu-bar tray icon — a macOS "template" image (pure black + real alpha, no
# background), which the OS then tints per-theme automatically. qlmanage's SVG
# thumbnailer flattens transparency onto white, so this is drawn directly with
# Pillow instead of going through the SVG at all.
python3 - <<'PY'
from PIL import Image, ImageDraw

def make(size, path):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = cy = size / 2
    r_dot, r_ring = size * 0.18, size * 0.34
    ring_w = max(1, round(size * 0.07))
    d.ellipse([cx - r_dot, cy - r_dot, cx + r_dot, cy + r_dot], fill=(0, 0, 0, 255))
    d.ellipse([cx - r_ring, cy - r_ring, cx + r_ring, cy + r_ring], outline=(0, 0, 0, 255), width=ring_w)
    im.save(path)

import os
os.makedirs('resources', exist_ok=True)
make(22, 'resources/trayTemplate.png')
make(44, 'resources/trayTemplate@2x.png')
PY

echo "Wrote resources/trayTemplate.png (+@2x)"
