#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Writes the HiDPI variants of the system's art (name@1.5x.png, name@2x.png,
name@3x.png beside name.png), as tools/hidpi-art.json lists them: the
shell's Open webOS art (shell/assets/openwebos), and in `sets` the Phoenix
apps' kit (apps/shared/phoenix-ui/assets) and luna-systemui's (its variants
in the compat overlay). The shell picks one for its density (Theme.asset,
shell/native/hidpi.cpp), a page for its device pixel ratio (CSS image sets,
which --check checks too); see docs/spec/hidpi-art.md.

  original  copied from a larger original Open webOS / Enyo ships
            (--ref: a directory holding those repositories' checkouts,
            e.g. luna-sysmgr/ and enyo-1.0/).
  upscale   art Open webOS ships at 1x only, enlarged by one of:
    model   Real-ESRGAN (RealESRGAN_x4plus, BSD-3-Clause) enlarges the art
            4x, colour first bled into the transparent pixels so edges do
            not darken, alpha enlarged by the same model; three rounds of
            back-projection then make the result scale back down to the
            original art; Lanczos takes it to 2x and 3x. For icons, glyphs
            and pictures: sharp edges and lines.
    smooth  bicubic, on premultiplied colour, straight to each size, then
            five rounds of back-projection. For gradients, shadows, glows,
            masks, scrims, panels, buttons and key tiles, where the model
            adds grain (and, on a faint rim, a hard line and a halo):
            nothing is made up, the result is the 1x art enlarged smoothly
            and true to it.
    copy    the variants of the same picture elsewhere in the repository.
  derived   variants another tool makes from these (keyboard-charcoal.py);
            checked here like the rest.
  skip      left at 1x, each with its reason (third parties' logos).

  python3 tools/hidpi-art.py --ref /path/to/checkouts --model RealESRGAN_x4plus.pth
  python3 tools/hidpi-art.py --missing --model RealESRGAN_x4plus.pth
                                          # only variants not yet written
  python3 tools/hidpi-art.py --check      # every 1x art has its variants, and
                                          # each scales down to its 1x art

Needs Pillow and NumPy; upscaling also SciPy, and for `model` torch (CPU
is fine) and spandrel:  pip install torch spandrel scipy pillow numpy
"""

import argparse
import glob
import hashlib
import json
import os
import re
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
METHODS = ("model", "smooth")
# Variant factors looked for in web pages (shell/native/hidpi.cpp has its own).
HIDPI_FACTORS = (1.5, 2, 3)


def variant_name(art, k):
    base, ext = os.path.splitext(art)
    return "%s@%sx%s" % (base, ("%g" % k), ext)


def all_art(root):
    """Every 1x art file under `root`, relative to it."""
    return sorted(os.path.relpath(p, root) for p in glob.glob(os.path.join(root, "**", "*.png"), recursive=True)
                  if "@" not in os.path.basename(p))


def expand(pattern, root):
    names = sorted(os.path.relpath(p, root) for p in glob.glob(os.path.join(root, pattern)))
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
    chans = [np.asarray(Image.fromarray(a[..., i].astype(np.float32), "F").resize(size, method)) for i in range(a.shape[2])]
    return np.dstack(chans).astype(np.float64)


def clamp(hr):
    hr[..., 3] = np.clip(hr[..., 3], 0, 255)
    hr[..., :3] = np.clip(hr[..., :3], 0, hr[..., 3:4])
    return hr


def backproject(hr, lr, rounds):
    """Corrects `hr` (premultiplied) until it scales down (box) to `lr`."""
    for _ in range(rounds):
        down = resize_premul(hr, (lr.shape[1], lr.shape[0]), Image.BOX)
        hr = clamp(hr + resize_premul(lr - down, (hr.shape[1], hr.shape[0]), Image.BICUBIC))
    return hr


def bleed(a):
    """RGB of an RGBA array with each transparent pixel the colour of the
    nearest one that is not, so resampling does not pull in black."""
    from scipy import ndimage
    mask = a[..., 3] > 0
    rgb = a[..., :3]
    if mask.any() and not mask.all():
        idx = ndimage.distance_transform_edt(~mask, return_distances=False, return_indices=True)
        rgb = rgb[idx[0], idx[1]]
    return rgb


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
        from spandrel import ModelLoader
        self.torch = torch
        self.model = ModelLoader().load_from_file(path).eval()
        torch.manual_seed(0)

    def _run(self, rgb):
        t = self.torch.from_numpy(rgb / 255.0).permute(2, 0, 1)[None].float()
        with self.torch.no_grad():
            o = self.model(t)
        return o[0].permute(1, 2, 0).clamp(0, 1).numpy().astype(np.float64) * 255.0

    def x4(self, im):
        """RGBA image -> RGBA image four times the size (premultiplied). Only
        the part of the art that is not transparent goes through the model
        (the clock hands are thin lines on large clear squares)."""
        a = np.asarray(im.convert("RGBA")).astype(np.float64)
        out = np.zeros((a.shape[0] * 4, a.shape[1] * 4, 4))
        ys, xs = np.nonzero(a[..., 3] > 0)
        if len(ys) == 0:
            return out
        pad = 8
        y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + 1 + pad)
        x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + 1 + pad)
        c = np.pad(a[y0:y1, x0:x1], ((pad, pad), (pad, pad), (0, 0)), mode="constant")
        if (c[..., 3] == 255).all():
            alpha = np.full((c.shape[0] * 4, c.shape[1] * 4), 255.0)
        else:
            alpha = self._run(np.repeat(c[..., 3:4], 3, axis=2)).mean(axis=2)
        big = np.dstack([self._run(bleed(c)), alpha])
        big[..., :3] *= big[..., 3:4] / 255.0
        out[y0 * 4:y1 * 4, x0 * 4:x1 * 4] = big[pad * 4:-pad * 4, pad * 4:-pad * 4]
        return out

    def enlarge(self, im):
        """4x, back-projected onto `im`. Premultiplied float."""
        return backproject(self.x4(im), premul(im), 3)


def resample(src, size, wrap=""):
    """`src` (one sprite cell) at `size` by `smooth`: see above.
    `wrap`: "x", "y" or "xy" for art the shell tiles, resampled as tiled
    so its edges still meet."""
    # Six source pixels of margin, filled as the shell fills them (tiled, or
    # the edge pixels repeated), keep the edges true; 6 is a whole number of
    # pixels at every ratio used (2, 3, 4/3 from a 1.5x original).
    p = 6
    rx, ry = size[0] / src.width, size[1] / src.height
    mx, my = round(p * rx), round(p * ry)
    if abs(p * rx - mx) > 1e-6 or abs(p * ry - my) > 1e-6:
        sys.exit("hidpi-art: %gx%g is not a ratio this resamples" % (rx, ry))

    def pad(a, px, py):
        mode = lambda axis: "wrap" if axis in wrap else "edge"
        a = np.pad(a, ((py, py), (0, 0), (0, 0)), mode=mode("y"))
        return np.pad(a, ((0, 0), (px, px), (0, 0)), mode=mode("x"))

    lr = pad(premul(src), p, p)
    big = (size[0] + 2 * mx, size[1] + 2 * my)
    hr = backproject(clamp(resize_premul(lr, big, Image.BICUBIC)), lr, 5)
    return hr[my:my + size[1], mx:mx + size[0]]


# ---- Web pages' art ----------------------------------------------------------
#
# Pages ask for the art in CSS; Chromium picks the file for its device pixel
# ratio (Theme.u: web views are zoomed by it) from -webkit-image-set() (the
# prefixed form: the simulator's Chromium is older than the plain one; both
# take sizes and border-image slices in the 1x art's pixels).

CSS_URL = re.compile(r"url\(\s*['\"]?([^'\")\s]+\.png)['\"]?\s*\)")


def variant_files(png, out_of):
    """[(k, path)] of a 1x art file's variants, smallest first."""
    out = []
    for k in HIDPI_FACTORS:
        path = variant_name(out_of(png), k)
        if os.path.exists(path):
            out.append((k, path))
    return out


def image_set(ref, ks):
    base, ext = os.path.splitext(ref)
    return "-webkit-image-set(%s)" % ", ".join(
        ["url(%s) 1x" % ref] + ["url(%s@%gx%s) %gx" % (base, k, ext, k) for k in ks])


def in_image_set(text, pos):
    """Whether the url() at `pos` is inside an image-set()."""
    start = max(text.rfind(";", 0, pos), text.rfind("{", 0, pos))
    return "image-set(" in text[start:pos]


def check_css(path, out_of, failed):
    """Every url() of art with variants in a stylesheet asks for them all."""
    text = open(path).read()
    for m in CSS_URL.finditer(text):
        if "@" in os.path.basename(m.group(1)):
            continue
        png = os.path.normpath(os.path.join(os.path.dirname(path), m.group(1)))
        ks = [k for k, _ in variant_files(png, out_of)]
        if not ks:
            continue
        want = image_set(m.group(1), ks)
        if not in_image_set(text, m.start()) or want not in text[max(0, m.start() - len("-webkit-image-set(")):]:
            line = text.count("\n", 0, m.start()) + 1
            failed.append("%s:%d: %s without its variants: %s" % (os.path.relpath(path, ROOT), line, m.group(1), want))


def overlay_css(sources, out_of):
    """A stylesheet for a page in a submodule, loaded after `sources`: each of
    their rules that sets a background or border image, again, in order (so
    the cascade among them is unchanged), its art as an image-set of its
    variants."""
    rule = re.compile(r"([^{}]+)\{([^{}]*)\}")
    decl = re.compile(r"(^|;)\s*(background|background-image|-webkit-border-image|border-image)\s*:\s*([^;]+)", re.I)
    out = ["/* webOS Phoenix overlay (tools/hidpi-art.py): the rules of the stylesheets",
           "   below that set an image, again, with each image's HiDPI variants",
           "   (docs/spec/hidpi-art.md). Do not edit; regenerate. */"]
    for src in sources:
        text = re.sub(r"/\*.*?\*/", "", open(os.path.join(ROOT, src)).read(), flags=re.S)
        out.append("\n/* %s */" % src)
        for r in rule.finditer(text):
            selector = " ".join(r.group(1).split())
            if selector.startswith("@"):
                continue
            body = []
            for d in decl.finditer(r.group(2)):
                prop, value = d.group(2).lower(), " ".join(d.group(3).split())
                if prop == "background":
                    # The shorthand sets the image too: none without a url.
                    m = CSS_URL.search(value)
                    prop, value = "background-image", ("url(%s)" % m.group(1) if m else "none")

                def swap(m):
                    png = os.path.normpath(os.path.join(ROOT, os.path.dirname(src), m.group(1)))
                    ks = [k for k, _ in variant_files(png, out_of)]
                    return image_set(m.group(1), ks) if ks else m.group(0)
                body.append("    %s: %s;" % (prop, CSS_URL.sub(swap, value)))
            if body:
                out.append("%s {\n%s\n}" % (selector, "\n".join(body)))
    return "\n".join(out) + "\n"


def cells(im, tiles):
    cols, rows = tiles
    cw, ch = im.width // cols, im.height // rows
    for r in range(rows):
        for c in range(cols):
            yield c, r, im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ref", help="directory with the luna-sysmgr and enyo-1.0 checkouts (for `original`)")
    ap.add_argument("--model", help="the RealESRGAN_x4plus.pth tools/hidpi-art.json names (for `model`)")
    ap.add_argument("--only", help="only art whose path contains this")
    ap.add_argument("--missing", action="store_true", help="only write variants that are not there yet")
    ap.add_argument("--check", action="store_true", help="check the variants, write nothing")
    args = ap.parse_args()

    with open(os.path.join(ROOT, "tools", "hidpi-art.json")) as f:
        spec = json.load(f)
    factors = spec["factors"]
    failed = []
    counts = []
    up = None

    # The shell's art is the file's top level; `sets` are other art with
    # the same fields, `art` its directory (1x) and `out` where its variants
    # go when that is not beside it (art in a submodule: its variants in
    # the compat overlay at the same device path).
    sets = [dict(spec, name="shell", art=os.path.relpath(ART, ROOT))] + spec.get("sets", [])
    for st in sets:
        art_dir = os.path.join(ROOT, st["art"])
        out_dir = os.path.join(ROOT, st.get("out", st["art"]))
        covered, skipped = set(), set()

        def mark(art):
            if art in covered:
                failed.append("%s/%s: listed twice" % (st["art"], art))
            covered.add(art)

        def check(art, k):
            small = Image.open(os.path.join(art_dir, art))
            name = variant_name(art, k)
            path = os.path.join(out_dir, name)
            if not os.path.exists(path):
                failed.append("%s: missing" % os.path.relpath(path, ROOT))
                return
            big = Image.open(path)
            want = (round(small.width * k), round(small.height * k))
            if big.size != want:
                failed.append("%s: %dx%d, not %dx%d" % (os.path.relpath(path, ROOT), big.width, big.height, *want))
                return
            e = error(small, big)
            if e > MAX_ERROR:
                failed.append("%s: %.1f from the 1x art" % (os.path.relpath(path, ROOT), e))

        for o in st.get("original", []):
            if args.only and args.only not in o["art"]:
                continue
            dest = os.path.join(out_dir, variant_name(o["art"], o["factor"]))
            if not args.check and not (args.missing and os.path.exists(dest)):
                if not args.ref:
                    sys.exit("hidpi-art: --ref is needed to copy the originals")
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copyfile(os.path.join(args.ref, REPO_DIRS[o["repo"]], o["from"]), dest)
                print("copied", os.path.relpath(dest, ROOT))
            check(o["art"], o["factor"])

        for entry in st.get("upscale", []):
            method = entry.get("method", "model")
            if method not in METHODS + ("copy",):
                sys.exit("hidpi-art: %s: no method %s" % (entry["art"], method))
            for art in expand(entry["art"], art_dir):
                mark(art)
                if args.only and args.only not in art:
                    continue
                # `factors`: only these (the others are originals).
                mine = entry.get("factors", factors)
                todo = [k for k in mine if not (args.missing and os.path.exists(os.path.join(out_dir, variant_name(art, k))))]
                if not args.check and todo:
                    os.makedirs(os.path.dirname(os.path.join(out_dir, art)), exist_ok=True)
                    if method == "copy":
                        # The same art elsewhere in the repository: its variants.
                        for k in todo:
                            shutil.copyfile(os.path.join(ROOT, variant_name(entry["from"], k)),
                                            os.path.join(out_dir, variant_name(art, k)))
                        print("copy", art, flush=True)
                        for k in mine:
                            check(art, k)
                        continue
                    if up is None and method == "model":
                        if not args.model:
                            sys.exit("hidpi-art: --model is needed to upscale %s" % art)
                        up = Upscaler(args.model, spec["model"]["sha256"])
                    small = Image.open(os.path.join(art_dir, art)).convert("RGBA")
                    src = small
                    if "from" in entry:
                        # A larger variant (an original), beside the others.
                        src = Image.open(os.path.join(out_dir, os.path.dirname(art), entry["from"])).convert("RGBA")
                    tiles = tuple(entry.get("tiles", (1, 1)))
                    if method == "model":
                        cw, ch = src.width // tiles[0], src.height // tiles[1]
                        big = np.zeros((src.height * 4, src.width * 4, 4))
                        for c, r, cell in cells(src, tiles):
                            big[r * ch * 4:(r + 1) * ch * 4, c * cw * 4:(c + 1) * cw * 4] = up.enlarge(cell)
                    for k in todo:
                        size = (round(small.width * k), round(small.height * k))
                        if method == "model":
                            out = unpremul(resize_premul(big, size, Image.LANCZOS))
                        else:
                            cs = (size[0] // tiles[0], size[1] // tiles[1])
                            hr = np.zeros((size[1], size[0], 4))
                            for c, r, cell in cells(src, tiles):
                                hr[r * cs[1]:(r + 1) * cs[1], c * cs[0]:(c + 1) * cs[0]] = \
                                    resample(cell, cs, entry.get("wrap", ""))
                            out = unpremul(hr)
                        out.save(os.path.join(out_dir, variant_name(art, k)), optimize=True)
                    print("%s %s" % (method, art), flush=True)
                for k in mine:
                    check(art, k)

        # Art another tool makes from art above (its variants from their
        # variants): only checked here.
        for d in st.get("derived", []):
            for art in expand(d["art"], art_dir):
                mark(art)
                for k in factors:
                    check(art, k)

        # Left at 1x on purpose, each with its reason.
        for sk in st.get("skip", []):
            if not sk.get("why"):
                failed.append("%s/%s: skipped without a reason" % (st["art"], sk["art"]))
            skipped.update(expand(sk["art"], art_dir))

        # Every piece of the set's art has its variants, or a reason not to.
        for art in all_art(art_dir):
            if art not in covered and art not in skipped:
                failed.append("%s/%s: not in tools/hidpi-art.json" % (st["art"], art))
        counts.append("%s %d" % (st["name"], len(covered)))

    # Stylesheets: those that must ask for every variant (`css`), and those
    # written for pages in a submodule (`overlay-css`).
    dirs = [(os.path.join(ROOT, st["art"]), os.path.join(ROOT, st.get("out", st["art"]))) for st in sets]

    def out_of(path):
        for a, o in dirs:
            if path.startswith(a + os.sep):
                return o + path[len(a):]
        return path

    for st in sets:
        for pattern in st.get("css", []):
            files = sorted(glob.glob(os.path.join(ROOT, pattern), recursive=True))
            if not files:
                failed.append("%s: no stylesheet" % pattern)
            for css in files:
                check_css(css, out_of, failed)
        ov = st.get("overlay-css")
        if ov:
            text = overlay_css(ov["from"], out_of)
            dest = os.path.join(ROOT, ov["to"])
            if args.check:
                if not os.path.exists(dest) or open(dest).read() != text:
                    failed.append("%s: out of date" % ov["to"])
            else:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, "w") as f:
                    f.write(text)
                print("wrote", ov["to"])

    for f in failed:
        print("FAIL", f)
    if failed:
        sys.exit(1)
    print("hidpi-art: every piece of art has its variants (%s), each within %.1f of its 1x art" % (", ".join(counts), MAX_ERROR))


if __name__ == "__main__":
    main()
