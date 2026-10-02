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
#
#   python3 tools/keyboard-charcoal.py           write it
#   python3 tools/keyboard-charcoal.py --check   fail if it is out of date

import io
import sys
from pathlib import Path

from PIL import Image

ART = Path(__file__).resolve().parent.parent / "shell/assets/openwebos/keyboard-phone"
SOURCE = ART / "key-gray.png"
OUT = ART / "key-charcoal.png"

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


def make():
    im = Image.open(SOURCE).convert("RGBA")
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
    data = make()
    if "--check" in sys.argv:
        if not OUT.exists() or Image.open(OUT).convert("RGBA").tobytes() != Image.open(io.BytesIO(data)).convert("RGBA").tobytes():
            print(f"{OUT} is out of date: run tools/keyboard-charcoal.py", file=sys.stderr)
            return 1
        print("key-charcoal.png is up to date")
        return 0
    OUT.write_bytes(data)
    print("wrote", OUT.relative_to(Path.cwd()) if OUT.is_relative_to(Path.cwd()) else OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
