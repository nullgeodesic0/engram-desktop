#!/usr/bin/env python3
"""Generate the Windows and Linux icon assets from the committed master PNG.

`scripts/build-icons.sh` produces the macOS side (`build/icon.icns` plus the
black `trayTemplate` images the menu bar tints for itself) and can only run on
a Mac — it goes through `qlmanage`, `sips`, and `iconutil`. This script covers
the other two platforms and runs anywhere Pillow does, reading the already
committed, already alpha-masked `build/icon.png` rather than re-rasterising
the SVG, so both halves are guaranteed to be the same artwork.

Outputs (all committed, so a fresh checkout and a CI runner never need to run
this to produce a build):

  build/icon.ico          multi-resolution Windows icon (16-256px)
  resources/tray.png      16px colour tray icon, Windows + Linux
  resources/tray@2x.png   32px, for HiDPI
  resources/badge/N.png   1-9 and 9plus, the Windows taskbar overlay badge

## Why the tray icon is not the macOS one

`resources/trayTemplate.png` is pure black with an alpha channel — a macOS
"template image", which the OS recolours per menu-bar theme automatically.
Neither Windows nor Linux does any such thing: shipped as-is, a black glyph is
invisible against the default (dark) Windows taskbar. The tray icon here is
therefore drawn in the app's own amber ink (`--color-ink-warm`, #e8a857),
which is the one choice that stays legible against a dark taskbar AND a light
one without needing to detect and follow a theme we would then have to keep
following as the user changes it.

Usage: python3 scripts/build-platform-icons.py   (requires Pillow)
"""

import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(ROOT, "build", "icon.png")

# Windows renders the icon at all of these; shipping every size beats letting
# the shell downscale 256px art into a 16px taskbar slot.
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

INK_WARM = (232, 168, 87, 255)  # --color-ink-warm
VOID = (13, 14, 18, 255)  # --color-void, the numeral drawn inside the badge

# macOS ships this; the outputs are committed, so no build or CI machine ever
# needs it. Any bold grotesque would do — the glyphs are single digits at 16px.
BADGE_FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
# "9+" is two glyphs in a 16px disc; a condensed face is the difference between
# legible and a smudge. Verified by rendering the sheet at 4x and looking.
BADGE_FONT_CONDENSED = "/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf"


def build_ico() -> None:
    if not os.path.exists(MASTER):
        sys.exit(f"missing {MASTER} — run scripts/make-icon.mjs first")
    master = Image.open(MASTER).convert("RGBA")
    out = os.path.join(ROOT, "build", "icon.ico")
    # Pillow writes each requested size as its own image in the .ico, using
    # PNG compression for the large ones — which is what Windows Vista+ and
    # every Electron/NSIS toolchain expects.
    master.save(out, format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"Wrote {os.path.relpath(out, ROOT)} ({', '.join(f'{s}px' for s in ICO_SIZES)})")


def build_tray() -> None:
    """The same soma-and-ring mark build-icons.sh draws for the macOS menu
    bar, in amber instead of black — see this module's docstring."""
    resources = os.path.join(ROOT, "resources")
    os.makedirs(resources, exist_ok=True)
    for size, name in ((16, "tray.png"), (32, "tray@2x.png")):
        # Drawn 8x oversampled and downsampled, because a 16px ring stroked
        # directly is a jagged mess at this radius.
        ss = 8
        big = size * ss
        im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        c = big / 2
        r_dot, r_ring = big * 0.18, big * 0.34
        ring_w = max(1, round(big * 0.07))
        d.ellipse([c - r_dot, c - r_dot, c + r_dot, c + r_dot], fill=INK_WARM)
        d.ellipse([c - r_ring, c - r_ring, c + r_ring, c + r_ring], outline=INK_WARM, width=ring_w)
        path = os.path.join(resources, name)
        im.resize((size, size), Image.LANCZOS).save(path)
        print(f"Wrote {os.path.relpath(path, ROOT)}")


def build_badges() -> None:
    """The Windows taskbar overlay badge, one image per count.

    macOS and Linux take a number straight from `app.setBadgeCount`. Windows
    has no such API — its equivalent is `BrowserWindow.setOverlayIcon`, which
    takes a picture, so the numbers have to be drawn ahead of time. Ten files
    (1-9 and 9plus) covers every count worth distinguishing on a 16px overlay;
    past nine the exact figure is unreadable at that size anyway, and the app
    already shows the real count in the sidebar.
    """
    from PIL import ImageFont

    out_dir = os.path.join(ROOT, "resources", "badge")
    os.makedirs(out_dir, exist_ok=True)
    labels = [(str(n), f"{n}.png") for n in range(1, 10)] + [("9+", "9plus.png")]
    ss = 8  # supersample: a 16px disc drawn directly has a visibly stepped edge
    big = 16 * ss
    try:
        font_full = ImageFont.truetype(BADGE_FONT, int(big * 0.62))
        font_wide = ImageFont.truetype(BADGE_FONT_CONDENSED, int(big * 0.64))
    except OSError:
        sys.exit(f"badge font not found: {BADGE_FONT} (run this on macOS, or point BADGE_FONT at any bold TTF)")

    for text, name in labels:
        im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.ellipse([0, 0, big - 1, big - 1], fill=INK_WARM)
        font = font_wide if len(text) > 1 else font_full
        # `anchor="mm"` centres on the glyph's own ink box rather than its
        # advance width, which is what keeps "1" from sitting left of centre.
        d.text((big / 2, big / 2), text, font=font, fill=VOID, anchor="mm")
        path = os.path.join(out_dir, name)
        im.resize((16, 16), Image.LANCZOS).save(path)
    print(f"Wrote {len(labels)} badge overlays to {os.path.relpath(out_dir, ROOT)}")


if __name__ == "__main__":
    build_ico()
    build_tray()
    build_badges()
