#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Writes the HiDPI variants of the shell's Open webOS art (name@1.5x.png,
name@2x.png, name@3x.png beside name.png in shell/assets/openwebos), as
tools/hidpi-art.json lists them. The shell picks one for its density
(Theme.asset, shell/native/hidpi.cpp); see docs/spec/hidpi-art.md.

  original  copied from a larger original Open webOS / Enyo ships
            (--ref: a directory holding those repositories' checkouts,
            e.g. luna-sysmgr/ and enyo-1.0/).
  upscale   Real-ESRGAN (RealESRGAN_x4plus, BSD-3-Clause) enlarges the art
            4x, colour first bled into the transparent pixels so edges do
            not darken, alpha enlarged by the same model; three rounds of
            back-projection then make the result scale back down to the
            original art; Lanczos takes it to 2x and 3x.

  python3 tools/hidpi-art.py --ref /path/to/checkouts --model RealESRGAN_x4plus.pth
  python3 tools/hidpi-art.py --check      # every variant listed exists and
                                          # scales down to its 1x art

Needs Pillow and NumPy; upscaling also torch (CPU is fine), spandrel and
SciPy:  pip install torch spandrel scipy pillow numpy
"""

import argparse
import glob
import hashlib
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "shell", "assets", "openwebos")
REPO_DIRS = {"openwebos/luna-sysmgr": "luna-sysmgr", "enyojs/enyo-1.0": "enyo-1.0"}
# Mean absolute difference (0-255, premultiplied RGBA) allowed between the 1x
# art and a variant scaled back down to it: a sanity bound (a variant of the
# wrong picture, size or position is far above it); Real-ESRGAN's sharper
# edges on 20 px glyphs come to 4-5.
MAX_ERROR = 6.0


def variant_name(art, k):
    base, ext = os.path.splitext(art)
    return "%s@%sx%s" % (base, ("%g" % k), ext)


def expand(pattern):
    names = sorted(os.path.relpath(p, ART) for p in glob.glob(os.path.join(ART, pattern)))
    names = [n for n in names if "@" not in os.path.basename(n)]
    if not names:
        sys.exit("hidpi-art: nothing matches %s" % pattern)
    return names


def premul(im):
    a = np.asarray(im.convert("RGBA")).astype(np.float64)
    a[..., :3] *= a[..., 3:4] / 255.0
    return a


def unpremul(a):
    a = a.copy()
    al = np.clip(a[..., 3:4], 0, 255)
    rgb = np.where(al > 0, a[..., :3] * 255.0 / np.maximum(al, 1e-6), 0)
    out = np.dstack([np.clip(rgb, 0, 255), al])
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), "RGBA")


def resize_premul(a, size, method):
    # Pillow resizes each channel on its own: fine on premultiplied data.
    chans = [np.asarray(Image.fromarray(a[..., i].astype(np.float32), "F").resize(size, method)) for i in range(4)]
    return np.dstack(chans).astype(np.float64)


def error(small, big):
    down = resize_premul(premul(big), small.size, Image.BOX)
    return float(np.abs(down - premul(small)).mean())


class Upscaler:
    def __init__(self, path, sha256):
        with open(path, "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()
        if digest != sha256:
            sys.exit("hidpi-art: %s is not the model tools/hidpi-art.json names (sha256 %s)" % (path, digest))
        import torch
        from scipy import ndimage
        from spandrel import ModelLoader
        self.torch = torch
        self.ndimage = ndimage
        self.model = ModelLoader().load_from_file(path).eval()
        torch.manual_seed(0)

    def _run(self, rgb):
        t = self.torch.from_numpy(rgb / 255.0).permute(2, 0, 1)[None].float()
        with self.torch.no_grad():
            o = self.model(t)
        return o[0].permute(1, 2, 0).clamp(0, 1).numpy().astype(np.float64) * 255.0

    def x4(self, im):
        """RGBA image -> RGBA image four times the size."""
        a = np.asarray(im.convert("RGBA")).astype(np.float64)
        pad = 8
        a = np.pad(a, ((pad, pad), (pad, pad), (0, 0)), mode="constant")
        mask = a[..., 3] > 0
        rgb = a[..., :3]
        if mask.any() and not mask.all():
            # Bleed each transparent pixel the colour of the nearest opaque one.
            idx = self.ndimage.distance_transform_edt(~mask, return_distances=False, return_indices=True)
            rgb = rgb[idx[0], idx[1]]
        out = self._run(rgb)
        alpha = self._run(np.repeat(a[..., 3:4], 3, axis=2)).mean(axis=2) if not mask.all() else np.full(out.shape[:2], 255.0)
        out = np.dstack([out, alpha])[pad * 4:-pad * 4, pad * 4:-pad * 4]
        out[..., :3] *= out[..., 3:4] / 255.0
        return out   # premultiplied float

    def enlarge(self, im, tiles=(1, 1)):
        """4x, cell by cell, back-projected onto `im`. Premultiplied float."""
        cols, rows = tiles
        cw, ch = im.width // cols, im.height // rows
        big = np.zeros((im.height * 4, im.width * 4, 4))
        for r in range(rows):
            for c in range(cols):
                cell = im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
                hr = self.x4(cell)
                lr = premul(cell)
                for _ in range(3):
                    down = resize_premul(hr, cell.size, Image.BOX)
                    hr += resize_premul(lr - down, (cw * 4, ch * 4), Image.BICUBIC)
                    hr[..., 3] = np.clip(hr[..., 3], 0, 255)
                    hr[..., :3] = np.clip(hr[..., :3], 0, hr[..., 3:4])
                big[r * ch * 4:(r + 1) * ch * 4, c * cw * 4:(c + 1) * cw * 4] = hr
        return big


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ref", help="directory with the luna-sysmgr and enyo-1.0 checkouts (for `original`)")
    ap.add_argument("--model", help="the RealESRGAN_x4plus.pth tools/hidpi-art.json names (for `upscale`)")
    ap.add_argument("--only", help="only art whose path contains this")
    ap.add_argument("--check", action="store_true", help="check the variants, write nothing")
    args = ap.parse_args()

    with open(os.path.join(ROOT, "tools", "hidpi-art.json")) as f:
        spec = json.load(f)
    factors = spec["factors"]
    failed = []

    def check(art, k):
        small = Image.open(os.path.join(ART, art))
        path = os.path.join(ART, variant_name(art, k))
        if not os.path.exists(path):
            failed.append("%s: missing" % variant_name(art, k))
            return
        big = Image.open(path)
        want = (round(small.width * k), round(small.height * k))
        if big.size != want:
            failed.append("%s: %dx%d, not %dx%d" % (variant_name(art, k), big.width, big.height, *want))
            return
        e = error(small, big)
        if e > MAX_ERROR:
            failed.append("%s: %.1f from the 1x art" % (variant_name(art, k), e))

    for o in spec["original"]:
        if args.only and args.only not in o["art"]:
            continue
        if not args.check:
            if not args.ref:
                sys.exit("hidpi-art: --ref is needed to copy the originals")
            src = os.path.join(args.ref, REPO_DIRS[o["repo"]], o["from"])
            shutil.copyfile(src, os.path.join(ART, variant_name(o["art"], o["factor"])))
            print("copied", variant_name(o["art"], o["factor"]))
        check(o["art"], o["factor"])

    up = None
    for entry in spec["upscale"]:
        for art in expand(entry["art"]):
            if args.only and args.only not in art:
                continue
            if not args.check:
                if up is None:
                    if not args.model:
                        sys.exit("hidpi-art: --model is needed to upscale")
                    up = Upscaler(args.model, spec["model"]["sha256"])
                small = Image.open(os.path.join(ART, art)).convert("RGBA")
                src = small
                if "from" in entry:
                    src = Image.open(os.path.join(ART, os.path.dirname(art), entry["from"])).convert("RGBA")
                big = up.enlarge(src, tuple(entry.get("tiles", (1, 1))))
                for k in factors:
                    size = (round(small.width * k), round(small.height * k))
                    out = unpremul(resize_premul(big, size, Image.LANCZOS))
                    out.save(os.path.join(ART, variant_name(art, k)), optimize=True)
                print("upscaled", art)
            for k in factors:
                check(art, k)

    for f in failed:
        print("FAIL", f)
    if failed:
        sys.exit(1)
    print("hidpi-art: all variants present and within %.1f of their 1x art" % MAX_ERROR)


if __name__ == "__main__":
    main()
