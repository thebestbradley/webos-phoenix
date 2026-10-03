#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Makes the phone keyboard's charcoal key art,
# shell/assets/openwebos/keyboard-phone/key-charcoal.png, from the original
# key-gray.png (Open webOS keyboard plugin art, Apache-2.0; unchanged).
# Phoenix's bordered phone keys (shift, delete, the bottom row) use it: the
# original's near-black face (#1a1a1a) in a lighter grey rim (#404040) made
# each key an outline, busy beside the borderless letters (the owner,
# 2 October 2026). Here the face is charcoal, near black, and the rim
# only a shade lighter, so a key reads as one dark shape. The black edge, the corners'
# alpha and the pressed half (the blue glow, below the middle) are kept.
# Its HiDPI variants (key-charcoal@2x.png, @3x) are made the same way from
# key-gray's (tools/hidpi-art.py, docs/spec/hidpi-art.md).
#
#   python3 tools/keyboard-charcoal.py           write them
#   python3 tools/keyboard-charcoal.py --check   fail if one is out of date

import io
import sys
from pathlib import Path

from PIL import Image

ART = Path(__file__).resolve().parent.parent / "shell/assets/openwebos/keyboard-phone"
# key-gray.png -> key-charcoal.png, and each variant of it.
VARIANTS = ["", "@2x", "@3x"]
PAIRS = [(ART / f"key-gray{v}.png", ART / f"key-charcoal{v}.png") for v in VARIANTS]

# The original's greys (r = g = b) and what they become, by level:
# 0 the black edge, 26 the face, 64 the rim. In between, linear.
FACE = (32, 33, 36)    # #202124
RIM = (43, 44, 47)     # #2b2c2f


def remap(v):
    if v <= 26:
        t = v / 26
        return tuple(round(c * t) for c in FACE)
    t = min(1.0, (v - 26) / (64 - 26))
    return tuple(round(f + (r - f) * t) for f, r in zip(FACE, RIM))


def make(source):
    im = Image.open(source).convert("RGBA")
    w, h = im.size
    out = im.copy()
    px = out.load()
    for y in range(h // 2):            # the unpressed half only
        for x in range(w):
            r, g, b, a = px[x, y]
            if r == g == b:
                px[x, y] = remap(r) + (a,)
    buf = io.BytesIO()
    out.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def main():
    stale = []
    for source, out in PAIRS:
        data = make(source)
        if "--check" in sys.argv:
            if not out.exists() or Image.open(out).convert("RGBA").tobytes() != Image.open(io.BytesIO(data)).convert("RGBA").tobytes():
                stale.append(out)
            continue
        out.write_bytes(data)
        print("wrote", out.relative_to(Path.cwd()) if out.is_relative_to(Path.cwd()) else out)
    for out in stale:
        print(f"{out} is out of date: run tools/keyboard-charcoal.py", file=sys.stderr)
    if stale:
        return 1
    if "--check" in sys.argv:
        print("key-charcoal.png and its variants are up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
