#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Draws the system screens' pictures Phoenix cannot take from Open webOS,
# at 1x, 2x and 3x (docs/spec/hidpi-art.md), into shell/assets/openwebos:
#
#   boot-logo.png, boot-logo-bright.png   200 x 200, the boot animation's
#       logo and its glow (BootupAnimation.cpp, ProgressAnimation.cpp's
#       logo type): in place of hp-logo.png / hp-logo-bright.png, HP's logo,
#       a trademark Apache-2.0 does not license (docs/LEGAL.md). A Phoenix
#       mark: three flames rising from a dark disc with a thin rim, grey;
#       the bright one lit, with a halo, as hp-logo-bright was.
#   msm-usb.png, msm-fsck-usb.png         768 x 768, the USB drive mode's
#       picture (TopLevelWindowManager.cpp:180-200, ProgressAnimation.cpp
#       TypeMsm) and the one over the check of the drive (TypeFsck): in
#       place of normal-usb.png / fsck-usb.png, which picture the TouchPad.
#       A plain device, its screen dark, the USB symbol on it; for the
#       check, the symbol higher with a frown under it, and room
#       under that for the text ProgressAnimation writes there (from 0.58
#       of the height, in the middle third).
#
# Each size is drawn on its own from the same shapes, four times as big and
# scaled down, so the variants are the same picture at more pixels.
#
#   python3 tools/draw-system-art.py           write them
#   python3 tools/draw-system-art.py --check   fail if one is out of date

import io
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ART = Path(__file__).resolve().parent.parent / "shell/assets/openwebos"
FACTORS = [1, 2, 3]
SS = 4   # supersampling


def bezier(p0, p1, p2, n=24):
    """Points of a quadratic Bezier curve."""
    out = []
    for i in range(n + 1):
        t = i / n
        a, b, c = (1 - t) ** 2, 2 * (1 - t) * t, t * t
        out.append((a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]))
    return out


def flame(cx, base, tip, width, lean):
    """A flame from (cx, base) up to its tip, `width` across, leaning by `lean`."""
    h = base - tip
    tx = cx + lean
    left = bezier((cx, base), (cx - width * 1.15, base - h * 0.45), (tx, tip))
    right = bezier((tx, tip), (cx + width * 0.9, base - h * 0.35), (cx, base))
    return left + right[1:]


def logo(size, bright):
    """The boot logo at `size` px (200 at 1x)."""
    s = size * SS
    u = s / 200.0
    im = Image.new("RGB", (s, s), (0, 0, 0))
    c = s / 2
    r = 36 * u
    if bright:
        halo = Image.new("L", (s, s), 0)
        ImageDraw.Draw(halo).ellipse((c - r * 1.08, c - r * 1.08, c + r * 1.08, c + r * 1.08), fill=255)
        halo = halo.filter(ImageFilter.GaussianBlur(9 * u))
        im.paste((215, 215, 215), (0, 0), halo)
    d = ImageDraw.Draw(im)
    # The rim, then the disc, darker towards its foot.
    rim = (235, 235, 235) if bright else (150, 150, 150)
    d.ellipse((c - r, c - r, c + r, c + r), fill=rim)
    inner = r - 1.6 * u
    disc = Image.new("RGB", (s, s), (0, 0, 0))
    dd = ImageDraw.Draw(disc)
    steps = 48
    for i in range(steps):
        t = i / (steps - 1)
        g = int((70 if bright else 46) * (1 - t) + (22 if bright else 10) * t)
        y0 = c - inner + 2 * inner * t
        dd.rectangle((0, y0, s, y0 + 2 * inner / steps + 1), fill=(g, g, g))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).ellipse((c - inner, c - inner, c + inner, c + inner), fill=255)
    im.paste(disc, (0, 0), mask)
    # Three flames rising, the middle one tallest: a phoenix, wings up.
    glyph = (255, 255, 255) if bright else (205, 205, 205)
    base = c + 20 * u
    d.polygon(flame(c, base, c - 25 * u, 7.5 * u, 0), fill=glyph)
    d.polygon(flame(c - 11 * u, base - 2 * u, c - 12 * u, 6 * u, -8 * u), fill=glyph)
    d.polygon(flame(c + 11 * u, base - 2 * u, c - 12 * u, 6 * u, 8 * u), fill=glyph)
    # The ground it rises from.
    d.rounded_rectangle((c - 17 * u, base + 3 * u, c + 17 * u, base + 6 * u), radius=1.5 * u, fill=glyph)
    return im.resize((size, size), Image.LANCZOS)


def usb_symbol(d, cx, cy, u, colour):
    """The USB trident, 120 px tall at 1x, centred on (cx, cy)."""
    w = 7 * u
    top, bottom = cy - 60 * u, cy + 44 * u
    d.rectangle((cx - w / 2, top + 16 * u, cx + w / 2, bottom), fill=colour)
    d.polygon([(cx, top), (cx - 12 * u, top + 20 * u), (cx + 12 * u, top + 20 * u)], fill=colour)
    d.ellipse((cx - 13 * u, bottom - 4 * u, cx + 13 * u, bottom + 22 * u), fill=colour)
    # Left arm to a ball, right arm to a square.
    lx, ly = cx - 30 * u, cy - 12 * u
    d.line([(cx, cy + 22 * u), (lx, cy + 4 * u), (lx, ly)], fill=colour, width=int(w), joint="curve")
    d.ellipse((lx - 9 * u, ly - 16 * u, lx + 9 * u, ly + 2 * u), fill=colour)
    rx, ry = cx + 30 * u, cy - 22 * u
    d.line([(cx, cy + 10 * u), (rx, cy - 6 * u), (rx, ry)], fill=colour, width=int(w), joint="curve")
    d.rectangle((rx - 9 * u, ry - 18 * u, rx + 9 * u, ry), fill=colour)


def usb(size, fsck):
    """The USB drive mode's picture at `size` px (768 at 1x), transparent."""
    s = size * SS
    u = s / 768.0
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # The device: a dark slab with a lighter edge, upright, just inside the
    # outline glow-bg.png lights up around it (its dark inside: 186-582 by
    # 132-638, corners of 38).
    x0, y0, x1, y1 = 186 * u, 132 * u, 582 * u, 638 * u
    d.rounded_rectangle((x0, y0, x1, y1), radius=38 * u, fill=(96, 98, 100, 255))
    d.rounded_rectangle((x0 + 3 * u, y0 + 3 * u, x1 - 3 * u, y1 - 3 * u), radius=35 * u, fill=(30, 31, 33, 255))
    # Its screen, a shade lighter towards the top.
    sx0, sy0, sx1, sy1 = x0 + 28 * u, y0 + 42 * u, x1 - 28 * u, y1 - 42 * u
    screen = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(screen)
    steps = 64
    for i in range(steps):
        t = i / (steps - 1)
        g = int(46 * (1 - t) + 24 * t)
        yy = sy0 + (sy1 - sy0) * t
        sd.rectangle((sx0, yy, sx1, yy + (sy1 - sy0) / steps + 1), fill=(g, g + 1, g + 2, 255))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((sx0, sy0, sx1, sy1), radius=6 * u, fill=255)
    im.paste(screen, (0, 0), mask)
    # A sheen across the screen's upper left.
    sheen = Image.new("L", (s, s), 0)
    ImageDraw.Draw(sheen).polygon([(sx0, sy0), (sx0 + 200 * u, sy0), (sx0, sy0 + 260 * u)], fill=18)
    sheen = Image.composite(sheen, Image.new("L", (s, s), 0), mask)
    im.paste((255, 255, 255, 255), (0, 0), sheen)
    # The speaker slot and the button.
    d.rounded_rectangle((384 * u - 24 * u, y0 + 17 * u, 384 * u + 24 * u, y0 + 22 * u), radius=2.5 * u, fill=(70, 72, 74, 255))
    d.ellipse((384 * u - 9 * u, y1 - 29 * u, 384 * u + 9 * u, y1 - 11 * u), outline=(80, 82, 84, 255), width=int(3 * u))
    colour = (200, 202, 204, 255)
    if not fsck:
        usb_symbol(d, 384 * u, 384 * u, u, colour)
    else:
        usb_symbol(d, 384 * u, 300 * u, 0.8 * u, colour)
        # A frown under it: the drive was pulled out unannounced.
        pts = [(384 * u + x * u, 400 * u - 10 * u * math.cos(x / 52.0 * math.pi / 2)) for x in range(-52, 53, 2)]
        d.line(pts, fill=colour, width=int(5 * u), joint="curve")
    return im.resize((size, size), Image.LANCZOS)


PICTURES = {
    "boot-logo.png": lambda k: logo(200 * k, False),
    "boot-logo-bright.png": lambda k: logo(200 * k, True),
    "msm-usb.png": lambda k: usb(768 * k, False),
    "msm-fsck-usb.png": lambda k: usb(768 * k, True),
}


def name_at(name, k):
    return name if k == 1 else name.replace(".png", "@%dx.png" % k)


def png(im):
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def main():
    check = "--check" in sys.argv
    stale = []
    for name, draw in PICTURES.items():
        for k in FACTORS:
            out = ART / name_at(name, k)
            data = png(draw(k))
            if check:
                if not out.exists() or Image.open(out).convert("RGBA").tobytes() != Image.open(io.BytesIO(data)).convert("RGBA").tobytes():
                    stale.append(out)
                continue
            out.write_bytes(data)
            print("wrote", out)
    for out in stale:
        print(f"{out} is out of date: run tools/draw-system-art.py", file=sys.stderr)
    if stale:
        return 1
    if check:
        print("the system screens' pictures are up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
