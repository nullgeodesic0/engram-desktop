#!/usr/bin/env python3
"""Writes the Nave ground's grain tile, src/renderer/src/assets/grain.png.

The same seeded noise RaftHad's Nave Folio draws at runtime (FNV-1a of
'cairn-grain' seeding mulberry32): 200x200 black and white specks at low
alpha. Shipping it as a file instead of a runtime data URL in a CSS custom
property matters for speed: a ~50KB `var(--look-grain)` was re-resolved on
every style recalc of every sheet that used it, and repainting it was most of
the renderer's work while the pointer moved. Run: python3 scripts/make-grain.py
"""
from pathlib import Path
from PIL import Image

M = 0xFFFFFFFF


def fnv(text: str) -> int:
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & M
    return h


def mulberry32(seed: int):
    s = seed & M

    def nxt() -> float:
        nonlocal s
        s = (s + 0x6D2B79F5) & M
        t = s
        t = ((t ^ (t >> 15)) * (t | 1)) & M
        t = (t ^ ((t + (((t ^ (t >> 7)) * (t | 61)) & M)) & M)) & M
        return ((t ^ (t >> 14)) & M) / 4294967296

    return nxt


def main() -> None:
    r = mulberry32(fnv('cairn-grain'))
    img = Image.new('RGBA', (200, 200))
    px = []
    for _ in range(200 * 200):
        v = r()
        c = 255 if v > 0.5 else 0
        a = int(pow(abs(v - 0.5) * 2, 1.6) * 90)
        px.append((c, c, c, a))
    img.putdata(px)
    out = Path(__file__).resolve().parent.parent / 'src/renderer/src/assets/grain.png'
    img.save(out, optimize=True)
    print(out, out.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
