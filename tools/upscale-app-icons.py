#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Writes larger icons for the apps whose icons Phoenix shows as they were
released (docs/spec/app-icons.md), named icon-<N>x<N>.png beside the icon:

  - the Open webOS apps ship 64 and 256 px; this writes icon-512x512.png in
    the compat overlay (compat/rootfs/usr/palm/applications/<id>/), since
    the apps' own folders are submodules we never change;
  - Voice Dial's icon is luna-sysmgr's 64 px one only; this writes
    icon-128x128.png and icon-256x256.png beside it (apps/voicedial/public).

The shell draws the smallest one that covers an icon's size in pixels
(Theme.appIcon, docs/spec/hidpi-art.md): the launcher at density 2 the 128 px
one, the loading card at density 3 the 512 px one, for instance; pages ask
for them with a srcset.

Real-ESRGAN (RealESRGAN_x4plus, BSD-3-Clause; a tool, not shipped) enlarges
the largest original four times,
its colour first bled into the transparent pixels so edges do not darken and
its alpha enlarged by the same model; three rounds of back-projection make the
result scale back down to the original exactly; Lanczos takes it to each size. On
these icons it keeps outlines and fine lines (the calculator's keys, the
envelope's stripes, the binder rings) sharper than Lanczos alone does, with no
artefacts on the smooth gradients. The method is that of tools/hidpi-art.py.

  python3 tools/upscale-app-icons.py --model RealESRGAN_x4plus.pth
  python3 tools/upscale-app-icons.py --check    # each exists, is its size and
                                                # scales down to its original

Needs Pillow and NumPy; upscaling also torch (CPU is fine), spandrel and
SciPy:  pip install torch spandrel scipy pillow numpy
"""

import argparse
import hashlib
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVERLAY = os.path.join(ROOT, "compat", "rootfs", "usr", "palm", "applications")
MODEL_SHA256 = "4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1"
# (app id, the largest original in this repository, the folder the larger
# icons go to, their sizes)
def _core(app_id, folder=""):
    return (app_id, "third_party/core-apps/%s/%s" % (app_id, os.path.join(folder, "icon-256x256.png")),
            os.path.join(OVERLAY, app_id, folder), [512])


ICONS = [
    _core("com.palm.app.accounts"),
    _core("com.palm.app.calculator"),
    _core("com.palm.app.calendar", "images"),
    _core("com.palm.app.clock"),
    _core("com.palm.app.contacts"),
    _core("com.palm.app.email"),
    _core("com.palm.app.notes"),
    ("com.palm.app.browser", "third_party/isis/isis-browser/icon-256x256.png", os.path.join(OVERLAY, "com.palm.app.browser"), [512]),
    # No 512 px: that would be eight times the original, more than the model
    # draws; the loading card at density 3 (288 px) scales the 256 px one.
    ("org.webosphoenix.voicedial", "apps/voicedial/public/icon.png", os.path.join(ROOT, "apps", "voicedial", "public"), [128, 256]),
]
# Mean absolute difference (0-255, premultiplied RGBA) allowed between the
# original and the 512 px icon scaled back down to it; the upscales come to
# 0.1-0.3, and a wrong or shifted picture is far above it.
MAX_ERROR = 1.5


def premul(im):
    a = np.asarray(im.convert("RGBA")).astype(np.float64)
    a[..., :3] *= a[..., 3:4] / 255.0
    return a


def unpremul(a):
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


def out_path(folder, n):
    return os.path.join(folder, "icon-%dx%d.png" % (n, n))


def upscale(model_path, todo):
    with open(model_path, "rb") as f:
        if hashlib.sha256(f.read()).hexdigest() != MODEL_SHA256:
            sys.exit("upscale-app-icons: %s is not RealESRGAN_x4plus.pth (sha256 %s)" % (model_path, MODEL_SHA256))
    import torch
    from scipy import ndimage
    from spandrel import ModelLoader
    model = ModelLoader().load_from_file(model_path).eval()
    torch.manual_seed(0)

    def run(rgb):
        t = torch.from_numpy(rgb / 255.0).permute(2, 0, 1)[None].float()
        with torch.no_grad():
            o = model(t)
        return o[0].permute(1, 2, 0).clamp(0, 1).numpy().astype(np.float64) * 255.0

    for app_id, src, folder, sizes in todo:
        im = Image.open(os.path.join(ROOT, src)).convert("RGBA")
        pad = 8
        a = np.pad(np.asarray(im).astype(np.float64), ((pad, pad), (pad, pad), (0, 0)), mode="constant")
        mask = a[..., 3] > 0
        # Bleed each transparent pixel the colour of the nearest opaque one.
        idx = ndimage.distance_transform_edt(~mask, return_distances=False, return_indices=True)
        rgb = a[..., :3][idx[0], idx[1]]
        hr = np.dstack([run(rgb), run(np.repeat(a[..., 3:4], 3, axis=2)).mean(axis=2)])
        hr = hr[pad * 4:-pad * 4, pad * 4:-pad * 4]
        hr[..., :3] *= hr[..., 3:4] / 255.0
        lr = premul(im)
        for _ in range(3):
            down = resize_premul(hr, im.size, Image.BOX)
            hr += resize_premul(lr - down, (im.width * 4, im.height * 4), Image.BICUBIC)
            hr[..., 3] = np.clip(hr[..., 3], 0, 255)
            hr[..., :3] = np.clip(hr[..., :3], 0, hr[..., 3:4])
        for n in sizes:
            if n > im.width * 4:
                sys.exit("upscale-app-icons: %d px is more than four times %s" % (n, src))
            out = unpremul(resize_premul(hr, (n, n), Image.LANCZOS))
            path = out_path(folder, n)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            out.save(path, optimize=True)
            print("upscaled", os.path.relpath(path, ROOT))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", help="RealESRGAN_x4plus.pth")
    ap.add_argument("--only", help="only the app whose id contains this")
    ap.add_argument("--check", action="store_true", help="check the icons, write nothing")
    args = ap.parse_args()
    todo = [i for i in ICONS if not args.only or args.only in i[0]]
    if not args.check:
        if not args.model:
            sys.exit("upscale-app-icons: --model is needed")
        upscale(args.model, todo)
    failed = []
    count = 0
    for app_id, src, folder, sizes in todo:
        for n in sizes:
            count += 1
            path = out_path(folder, n)
            rel = os.path.relpath(path, ROOT)
            if not os.path.exists(path):
                failed.append("%s: missing" % rel)
                continue
            big = Image.open(path)
            if big.size != (n, n):
                failed.append("%s: %dx%d, not %dx%d" % (rel, big.width, big.height, n, n))
                continue
            e = error(Image.open(os.path.join(ROOT, src)), big)
            if e > MAX_ERROR:
                failed.append("%s: %.2f from %s" % (rel, e, src))
    for f in failed:
        print("FAIL", f)
    if failed:
        sys.exit(1)
    print("upscale-app-icons: %d icons present and within %.1f of their originals" % (count, MAX_ERROR))


if __name__ == "__main__":
    main()
