#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Prepares Phoenix's photographic wallpapers (apps/settings/public/wallpapers).

Palm's and HP's wallpapers were not in the open-source release (docs/LEGAL.md).
The phones and the TouchPad shipped photographs of nature close up: smooth
stones under water, a clownfish in its anemone, flowers, water drops and so
on. These are other photographs of such subjects, each a real photograph
under an open licence (CC0, public domain or CC BY; never CC BY-SA, NC or ND)
from Wikimedia Commons, chosen to be composed differently from Palm's. Each
one's author, licence and source are in PHOTOS below and in the wallpapers'
PROVENANCE.md; the CC BY ones are credited there, in NOTICE and in Settings'
licences.

The script fetches each photograph from Commons (at the size it needs, into a
temporary directory it deletes afterwards; nothing of the original is kept),
crops a square about the chosen point, scales it to the 2048 x 2048 master the
shell crops to any screen about the centre (Wallpaper.qml; see generate.py),
grades it gently in linear light to sit with the drawn set (exposure,
saturation, a little warmth or coolness), darkens it towards the top for the
status bar and towards the bottom for the launcher's labels and the quick
launch bar, and writes the master and the 240 x 360 thumbnail for Settings'
picker, as generate.py does for the drawn ones.

    python3 tools/wallpapers/photos.py                 # all of them
    python3 tools/wallpapers/photos.py clownfish       # only these
    python3 tools/wallpapers/photos.py --report        # white text's contrast on each screen
    python3 tools/wallpapers/photos.py --src DIR       # keep the downloads in DIR (reused)
    python3 tools/wallpapers/photos.py --preview out.jpg  # each one's crops on a Pre, a phone, a TouchPad

Needs NumPy and Pillow, and the network (upload.wikimedia.org).
"""

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate as g  # noqa: E402  (the drawn set's finishing and checks)

N = g.N
F = np.float32
UA = "webOS-Phoenix-wallpapers/1.0 (https://github.com/thebestbradley/webos-phoenix)"

# Each photograph: the Commons file; its author, licence and the page that
# shows them (checked by hand on that page); where to crop (the square's
# centre as fractions of the photo's width and height, and its side as a
# fraction of the photo's shorter side); the grade (exposure in stops,
# saturation, warmth: + warmer, - cooler); the darkening at the top and
# bottom (generate.bands: how much, and how far in).
PHOTOS = [
    dict(slug="river-stones", name="River Stones",
         file="Smooth Stones (2071301568).jpg",
         title="Smooth Stones", author="Sharon Mollerus", licence="CC BY 2.0",
         licence_url="https://creativecommons.org/licenses/by/2.0/",
         source="https://www.flickr.com/photos/clairity/2071301568/",
         crop=(0.5, 0.42, 1.0), soften=1.0, exposure=-0.3, saturation=1.0, warmth=0.0,
         top=0.55, top_to=0.24, bottom=0.5, bottom_from=0.78),
    dict(slug="clownfish", name="Clownfish",
         file="Clownfish in Anemone (34637539442).jpg",
         title="Clownfish in Anemone", author="Eden, Janine and Jim", licence="CC BY 2.0",
         licence_url="https://creativecommons.org/licenses/by/2.0/",
         source="https://www.flickr.com/photos/edenpictures/34637539442/",
         crop=(0.5, 0.5, 1.0), soften=1.0, exposure=-0.9, saturation=0.9, warmth=0.0,
         top=0.55, top_to=0.24, bottom=0.5, bottom_from=0.78),
    dict(slug="jellyfish", name="Jellyfish",
         file="Lion's mane jellyfish in Gullmarn fjord at Sämstad 8.jpg",
         title="Lion's mane jellyfish in Gullmarn fjord at Sämstad 8", author="W.carter", licence="CC0 1.0",
         licence_url="https://creativecommons.org/publicdomain/zero/1.0/",
         source=None,
         crop=(0.38, 0.4, 0.85), soften=0.6, exposure=-0.2, saturation=1.0, warmth=0.0,
         top=0.5, top_to=0.22, bottom=0.45, bottom_from=0.8),
    dict(slug="raindrops", name="Raindrops",
         file="Water Drops (29076462192).jpg",
         title="Water Drops", author="kuhnmi", licence="CC BY 2.0",
         licence_url="https://creativecommons.org/licenses/by/2.0/",
         source="https://www.flickr.com/photos/31176607@N05/29076462192/",
         crop=(0.5, 0.5, 1.0), soften=0.8, exposure=-0.4, saturation=0.95, warmth=0.0,
         top=0.6, top_to=0.26, bottom=0.55, bottom_from=0.76),
    dict(slug="dandelion", name="Dandelion",
         file="White dandelion seed head pappus macro fluffy texture.jpg",
         title="White dandelion seed head pappus macro fluffy texture", author="MacrofyStudio",
         licence="CC BY 4.0", licence_url="https://creativecommons.org/licenses/by/4.0/",
         source=None,
         crop=(0.5, 0.5, 1.0), soften=1.0, exposure=-0.9, saturation=1.0, warmth=0.0,
         top=0.55, top_to=0.24, bottom=0.5, bottom_from=0.78),
    dict(slug="gerbera", name="Gerbera",
         file="Gerber Daisy - Pennsylvania.jpg",
         title="Gerber Daisy - Pennsylvania", author="Donald Olszewski", licence="CC BY 4.0",
         licence_url="https://creativecommons.org/licenses/by/4.0/",
         source="https://www.flickr.com/photos/186499581@N05/54959532398/",
         crop=(0.32, 0.5, 1.0), soften=2.0, exposure=-0.6, saturation=0.9, warmth=0.0,
         top=0.55, top_to=0.24, bottom=0.5, bottom_from=0.78),
    dict(slug="wave", name="Wave",
         file="Crispy curls - Flickr - chris kuga.jpg",
         title="crispy curls", author="Chris Kuga", licence="CC BY 2.0",
         licence_url="https://creativecommons.org/licenses/by/2.0/",
         source="https://www.flickr.com/photos/126928999@N04/16086023438/",
         crop=(0.6, 0.5, 1.0), soften=0.8, exposure=-0.7, saturation=1.0, warmth=0.0,
         top=0.55, top_to=0.24, bottom=0.5, bottom_from=0.78),
    dict(slug="seashells", name="Seashells",
         file="Shell beach. - Flickr - Bernard Spragg.jpg",
         title="Shell beach.", author="Bernard Spragg. NZ", licence="CC0 1.0",
         licence_url="https://creativecommons.org/publicdomain/zero/1.0/",
         source="https://www.flickr.com/photos/volvob12b/20745959392/",
         crop=(0.5, 0.5, 1.0), soften=1.2, exposure=-1.0, saturation=0.9, warmth=0.0,
         top=0.6, top_to=0.26, bottom=0.55, bottom_from=0.76),
]

QUALITY = 86
# White text's contrast (90th percentile of the band behind it, generate.report)
# each wallpaper gives at least, on every screen: the status bar's, and the
# launcher labels' and quick launch bar's.
TOP_CONTRAST = 6.0
BOTTOM_CONTRAST = 4.5
MAX_BYTES = 320 * 1024


def page_url(p):
    return "https://commons.wikimedia.org/wiki/File:" + urllib.parse.quote(p["file"].replace(" ", "_"))


def fetch(url):
    for i in range(12):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(max(int(e.headers.get("retry-after") or 0), 15 * (i + 1)))
    raise SystemExit("Commons kept refusing (429): try again later")


# Commons serves renditions at these widths (mediawiki.org, "Common
# thumbnail sizes"); other sizes, and the originals in bulk, it refuses.
STANDARD_WIDTHS = (1280, 1920, 3840)


def download(p, dest):
    """The photograph at the size the crop needs: the smallest standard
    rendition whose shorter side covers the crop (or nearly: up to a tenth
    is made up by scaling), else the original."""
    path = os.path.join(dest, p["slug"] + ".src")
    if os.path.exists(path):
        return path
    q = {"action": "query", "format": "json", "titles": "File:" + p["file"], "prop": "imageinfo",
         "iiprop": "url|size"}
    ii = next(iter(json.loads(fetch("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(q)))
                   ["query"]["pages"].values()))["imageinfo"][0]
    w, h = ii["width"], ii["height"]
    want = 2048 / p["crop"][2] / 1.1  # the crop's side in the photo's pixels
    url = ii["url"]
    for sw in STANDARD_WIDTHS:
        if sw < w and min(w, h) * sw / w >= want:
            q["iiurlwidth"] = sw
            ii = next(iter(json.loads(fetch("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(q)))
                           ["query"]["pages"].values()))["imageinfo"][0]
            url = ii["thumburl"]
            break
    data = fetch(url)
    with open(path + ".part", "wb") as f:
        f.write(data)
    os.replace(path + ".part", path)
    return path


def prepare(p, src):
    im = Image.open(src)
    im = im.convert("RGB")
    w, h = im.size
    cx, cy, k = p["crop"]
    side = min(w, h) * k
    x0 = min(max(cx * w - side / 2, 0), w - side)
    y0 = min(max(cy * h - side / 2, 0), h - side)
    im = im.resize((N, N), Image.LANCZOS, box=(x0, y0, x0 + side, y0 + side))
    if p.get("soften"):
        # The film or sensor grain, softened a little: the file stays near
        # 300 KB without the JPEG's blocks.
        im = im.filter(ImageFilter.GaussianBlur(p["soften"]))
    a = g.lin(np.asarray(im))  # 0-255 triples to linear light, per channel
    a = a * F(2.0 ** p["exposure"])
    y = (a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722)[..., None]
    a = y + (a - y) * F(p["saturation"])
    if p["warmth"]:
        a = a * np.array([1 + p["warmth"], 1.0, 1 - p["warmth"]], F)
    # Then darker towards the top and bottom, as much as white text needs
    # there on every screen (TOP_CONTRAST, BOTTOM_CONTRAST, at least as the
    # drawn ones give): the photo's own grade first, deeper only as needed.
    # Stronger and, on a sideways tablet (whose screen shows the middle 69%
    # of the square), further in.
    top, top_to, bottom, bottom_from = p["top"], p["top_to"], p["bottom"], p["bottom_from"]
    while True:
        out = to8(g.bands(a.copy(), top=top, top_to=top_to, bottom=bottom, bottom_from=bottom_from))
        rows = g.report(out)
        low_top = min(r[1] for r in rows) < TOP_CONTRAST and top_to < 0.5
        low_bottom = min(r[2] for r in rows) < BOTTOM_CONTRAST and bottom_from > 0.5
        if not (low_top or low_bottom):
            p["bands"] = (round(top, 2), round(top_to, 2), round(bottom, 2), round(bottom_from, 2))
            return out
        if low_top:
            top, top_to = min(0.9, top + 0.03), top_to + 0.01
        if low_bottom:
            bottom, bottom_from = min(0.9, bottom + 0.03), bottom_from - 0.01


def to8(a):
    """Linear light to 8-bit sRGB. No grain or dither, unlike the drawn
    ones: a photograph has its own."""
    return Image.fromarray(np.clip(np.round(g.to_srgb(a) * 255.0), 0, 255).astype(np.uint8), "RGB")


def save(im, path):
    q = QUALITY
    while True:
        im.save(path, quality=q, optimize=True, progressive=True, subsampling="4:2:0")
        if os.path.getsize(path) <= MAX_BYTES or q <= 72:
            return q
        q -= 2


def preview(rows, path):
    """Each wallpaper as a Pre (320x480), a modern phone (393x852) and a
    TouchPad sideways (1024x768) would show it, scaled to one height."""
    hgt = 300
    screens = [(320, 480), (393, 852), (1024, 768)]
    tiles = []
    for name, im in rows:
        row = [g.crop(im, w, h).resize((round(hgt * w / h), hgt), Image.LANCZOS) for w, h in screens]
        tiles.append((name, row))
    width = sum(t.size[0] for t in tiles[0][1]) + 8 * (len(screens) + 1)
    sheet = Image.new("RGB", (width * 2, ((len(tiles) + 1) // 2) * (hgt + 28)), (40, 40, 40))
    d = ImageDraw.Draw(sheet)
    for i, (name, row) in enumerate(tiles):
        x, y = (i % 2) * width + 8, (i // 2) * (hgt + 28)
        d.text((x, y + 6), name, fill=(255, 255, 255))
        for t in row:
            sheet.paste(t, (x, y + 22))
            x += t.size[0] + 8
    sheet.save(path, quality=85)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("names", nargs="*", help="only these (slugs)")
    ap.add_argument("--report", action="store_true", help="print white text's contrast over each (90th percentile)")
    ap.add_argument("--src", help="keep the downloaded photographs here and reuse them")
    ap.add_argument("--preview", help="also write a sheet of each one's crops on three screens to this JPEG")
    ap.add_argument("--out", default=g.OUT, help="output directory (default: the Settings app's public/wallpapers)")
    args = ap.parse_args()
    chosen = [p for p in PHOTOS if not args.names or p["slug"] in args.names]
    os.makedirs(os.path.join(args.out, "thumbs"), exist_ok=True)
    tmp = None if args.src else tempfile.mkdtemp(prefix="phoenix-photos-")
    src_dir = args.src or tmp
    os.makedirs(src_dir, exist_ok=True)
    rows = []
    worst = 99.0
    try:
        for p in chosen:
            im = prepare(p, download(p, src_dir))
            path = os.path.join(args.out, p["slug"] + ".jpg")
            q = save(im, path)
            g.crop(im, 2, 3).resize(g.THUMB, Image.LANCZOS).save(
                os.path.join(args.out, "thumbs", p["slug"] + ".jpg"), quality=84, optimize=True, progressive=True)
            print(f"wrote {os.path.relpath(path, g.ROOT)} {os.path.getsize(path) // 1024} KB (quality {q}, "
                  f"bands {p['bands']})", flush=True)
            if args.report:
                for label, top, bottom, clock in g.report(im):
                    worst = min(worst, top, bottom)
                    print(f"    {label:17s} status bar {top:5.2f}:1   launcher {bottom:5.2f}:1   clock {clock:5.2f}:1")
            if args.preview:
                rows.append((p["name"], im))
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)
    if args.preview and rows:
        preview(rows, args.preview)
    if args.report:
        print(f"lowest top/bottom contrast: {worst:.2f}:1")
    return 0


if __name__ == "__main__":
    sys.exit(main())
