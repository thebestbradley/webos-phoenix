#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Generate the bundled wallpapers (public/wallpapers/*.jpg).

The Palm wallpapers were not open-sourced, so Phoenix ships generated ones,
dedicated to the public domain (CC0). Deterministic: rerunning gives the
same images. Needs Pillow.

    python3 apps/settings/tools/make-wallpapers.py
"""

import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "wallpapers")


def gradient(stops):
    """Vertical gradient; stops = [(pos 0..1, (r, g, b)), ...]."""
    im = Image.new("RGB", (1, SIZE))
    px = im.load()
    for y in range(SIZE):
        t = y / (SIZE - 1)
        for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
            if p0 <= t <= p1:
                f = (t - p0) / (p1 - p0) if p1 > p0 else 0
                px[0, y] = tuple(int(a + (b - a) * f) for a, b in zip(c0, c1))
                break
    return im.resize((SIZE, SIZE))


def glow(im, cx, cy, r, color, alpha, blur):
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse((cx - r, cy - r, cx + r, cy + r), fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return Image.alpha_composite(im.convert("RGBA"), layer)


def ribbon(im, y0, amp, freq, phase, width, color, alpha, blur):
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for x in range(0, SIZE + 8, 4):
        y = y0 + amp * math.sin(x / SIZE * math.pi * freq + phase)
        d.line((x, y - width, x, y + width * 0.2), fill=color + (alpha,), width=5)
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return Image.alpha_composite(im.convert("RGBA"), layer)


def stars(im, n, seed):
    rnd = random.Random(seed)
    d = ImageDraw.Draw(im)
    for _ in range(n):
        x, y = rnd.randrange(SIZE), rnd.randrange(int(SIZE * 0.6))
        a = rnd.randint(60, 200)
        d.point((x, y), fill=(255, 255, 255, a))
    return im


def dusk():
    im = gradient([(0, (8, 18, 44)), (0.5, (34, 68, 120)), (0.8, (190, 98, 60)), (1, (236, 164, 80))])
    im = stars(im.convert("RGBA"), 220, 1)
    im = glow(im, SIZE // 2, int(SIZE * 0.97), 180, (255, 200, 120), 170, 90)
    return im


def aurora():
    im = gradient([(0, (4, 10, 24)), (0.7, (8, 34, 52)), (1, (12, 58, 64))]).convert("RGBA")
    im = stars(im, 300, 2)
    im = ribbon(im, 330, 90, 2.2, 0.3, 160, (60, 230, 150), 120, 30)
    im = ribbon(im, 420, 70, 1.6, 1.8, 120, (80, 170, 255), 90, 36)
    im = ribbon(im, 280, 50, 3.0, 2.6, 80, (190, 110, 255), 60, 28)
    return im


def ember():
    im = gradient([(0, (30, 6, 8)), (0.55, (110, 22, 16)), (1, (220, 92, 28))]).convert("RGBA")
    rnd = random.Random(3)
    for _ in range(38):
        r = rnd.randint(18, 90)
        im = glow(im, rnd.randrange(SIZE), rnd.randrange(SIZE), r,
                  rnd.choice([(255, 160, 60), (255, 210, 120), (255, 90, 40)]), rnd.randint(40, 110), r // 3 + 4)
    return im


def tide():
    im = gradient([(0, (6, 26, 58)), (0.5, (14, 72, 120)), (1, (26, 132, 160))]).convert("RGBA")
    for i in range(7):
        im = ribbon(im, 420 + i * 90, 30 + i * 6, 1.3 + i * 0.25, i * 1.1, 70, (255, 255, 255), 26 + i * 4, 10)
    im = glow(im, int(SIZE * 0.72), int(SIZE * 0.18), 110, (220, 240, 255), 70, 60)
    return im


def slate():
    im = gradient([(0, (70, 76, 84)), (1, (22, 24, 28))]).convert("RGBA")
    rnd = random.Random(5)
    noise = Image.effect_noise((SIZE, SIZE), 18).convert("L")
    im = Image.blend(im, Image.merge("RGBA", (noise, noise, noise, Image.new("L", im.size, 255))), 0.08)
    for i in range(6):
        im = glow(im, rnd.randrange(SIZE), rnd.randrange(SIZE), rnd.randint(150, 320), (120, 140, 160), 40, 120)
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, fn in [("dusk", dusk), ("aurora", aurora), ("ember", ember), ("tide", tide), ("slate", slate)]:
        path = os.path.join(OUT, name + ".jpg")
        fn().convert("RGB").save(path, quality=84, optimize=True, progressive=True)
        print("wrote", os.path.relpath(path), os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    main()
