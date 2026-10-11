#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Draw the account icons of Phoenix's messaging connectors with Pillow:
Matrix (linked rooms), Delta Chat (a letter that is a chat) and the
unofficial Telegram client (a chat bubble on a cloud: on purpose nothing
like Telegram's paper plane, docs/SYNERGY-CONNECTORS.md 7). Each a 1024 px
drawing (art/<name>-1024.png in the connector's folder) and its 32 and 48 px
account icons; tools/hidpi-art.py makes their @2x and @3x from the drawing
(method downscale), and the app's icon.png (64 px).

    python3 tools/make-connector-art.py
"""

import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024


def tile(color):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((40, 40, S - 40, S - 40), radius=210, fill=color)
    return img, d


def matrix():
    img, d = tile((22, 112, 112, 255))
    white = (255, 255, 255, 255)
    pts = [(300, 330), (720, 300), (520, 560), (300, 740), (730, 720)]
    for a, b in [(0, 2), (1, 2), (2, 3), (2, 4), (0, 1), (3, 4)]:
        d.line([pts[a], pts[b]], fill=(190, 235, 230, 255), width=34)
    for i, (x, y) in enumerate(pts):
        r = 92 if i == 2 else 70
        d.ellipse((x - r, y - r, x + r, y + r), fill=white)
    return img


def deltachat():
    img, d = tile((44, 96, 190, 255))
    white = (255, 255, 255, 255)
    # A letter...
    d.rounded_rectangle((190, 260, 834, 690), radius=50, fill=white)
    d.line([(210, 290), (512, 520), (814, 290)], fill=(44, 96, 190, 255), width=40, joint="curve")
    # ...that is a chat (its tail).
    d.polygon([(330, 680), (330, 820), (470, 680)], fill=white)
    return img


def cloudchat():
    img, d = tile((228, 132, 52, 255))
    white = (255, 255, 255, 255)
    # A cloud...
    for (x, y, r) in [(390, 470, 150), (560, 400, 190), (700, 500, 140)]:
        d.ellipse((x - r, y - r, x + r, y + r), fill=white)
    d.rounded_rectangle((250, 470, 840, 640), radius=85, fill=white)
    # ...that speaks: a tail and three dots.
    d.polygon([(380, 620), (330, 790), (520, 630)], fill=white)
    for x in (420, 545, 670):
        d.ellipse((x - 38, 520 - 38, x + 38, 520 + 38), fill=(228, 132, 52, 255))
    return img


def write(img, app, template, name):
    base = os.path.join(ROOT, "apps", app)
    os.makedirs(os.path.join(base, "art"), exist_ok=True)
    img.save(os.path.join(base, "art", name + "-1024.png"))
    images = os.path.join(base, "public", "accounts", template, "images")
    os.makedirs(images, exist_ok=True)
    for size in (32, 48):
        img.resize((size, size), Image.LANCZOS).save(os.path.join(images, "%s-%dx%d.png" % (name, size, size)))
    img.resize((64, 64), Image.LANCZOS).save(os.path.join(base, "icon.png"))


if __name__ == "__main__":
    write(matrix(), "connectors/matrix", "com.webosphoenix.matrix", "matrix")
    write(deltachat(), "connectors/deltachat", "com.webosphoenix.deltachat", "deltachat")
    write(cloudchat(), "telegram", "com.webosphoenix.telegram", "cloudchat")
    print("drawn")
