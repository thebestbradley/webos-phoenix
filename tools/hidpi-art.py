#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Writes the HiDPI variants of the system's art (name@1.5x.png, name@2x.png,
name@3x.png beside name.png, or in the compat overlay for art in a
submodule), as tools/hidpi-art.json lists them, and what asks for them:

  - the shell's Open webOS art (shell/assets/openwebos), which the shell
    picks for its density (Theme.asset, shell/native/hidpi.cpp);
  - the Phoenix apps' kit (apps/shared/phoenix-ui/assets), whose
    stylesheets ask for the variants themselves (`css`, checked here);
  - the original apps' and frameworks' art (`sets` with `devices`): the
    variants go to the compat overlay at each device path the art is
    served at; their stylesheets get overlay copies that ask for the
    variants with image sets (`rewrite-css`); runtime/hidpi-art.json lists
    them for pictures a page names from script (phoenix-runtime.js gives
    those <img>s a srcset and inline backgrounds an image set).

See docs/spec/hidpi-art.md.

  original  copied from a larger original Open webOS / Enyo ships elsewhere
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
    downscale  from a larger drawing of the same picture (`source`, e.g. an
            app's 256 px icon for its 48 px one): Lanczos down to each size.
  `source`  (model, smooth, downscale) a larger drawing of the same picture
            in the repository to make the variants from (Enyo's images-1.5
            art where it is exactly 1.5 times the 1x art and true to it).
    pixel   each pixel a square of k by k: for patterns drawn a pixel at a
            time (Calendar's 1-pixel hatch), which smoothing turns grey and
            the model loses; exactly the 1x art, magnified.
    copy    the variants of the same picture elsewhere in the repository.
  derived   variants another tool makes from these (keyboard-charcoal.py);
            checked here like the rest.
  skip      left at 1x, each with its reason (third parties' logos, photos,
            art nothing shows).

  python3 tools/hidpi-art.py --ref /path/to/checkouts --model RealESRGAN_x4plus.pth
  python3 tools/hidpi-art.py --missing --model RealESRGAN_x4plus.pth
                                          # only variants not yet written
  python3 tools/hidpi-art.py --check      # every 1x art has its variants, and
                                          # each scales down to its 1x art;
                                          # the stylesheets and the runtime's
                                          # list are up to date

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
COMPAT = os.path.join(ROOT, "compat", "rootfs")
MANIFEST = os.path.join(ROOT, "runtime", "hidpi-art.json")
REPO_DIRS = {"openwebos/luna-sysmgr": "luna-sysmgr", "enyojs/enyo-1.0": "enyo-1.0"}
IMG_EXT = (".png", ".jpg", ".gif")
# Mean absolute difference (0-255, premultiplied RGBA) allowed between the 1x
# art and a variant scaled back down to it: a sanity bound (a variant of the
# wrong picture, size or position is far above it); Real-ESRGAN's sharper
# edges on 20 px glyphs come to 4-5.
MAX_ERROR = 6.0
METHODS = ("model", "smooth", "downscale", "pixel")
# Variant factors looked for (shell/native/hidpi.cpp has its own).
HIDPI_FACTORS = (1.5, 2, 3)
CSS_HEADER = ("/* webOS Phoenix overlay (tools/hidpi-art.py): the original stylesheet, with each\n"
              "   picture that has HiDPI variants asked for as an image set of them\n"
              "   (docs/spec/hidpi-art.md). Do not edit; regenerate. */\n")


def variant_name(art, k):
    base, ext = os.path.splitext(art)
    return "%s@%sx%s" % (base, ("%g" % k), ext)


def is_art(name):
    return os.path.splitext(name)[1].lower() in IMG_EXT and "@" not in os.path.basename(name)


def all_art(root):
    """Every 1x art file under `root`, relative to it."""
    return sorted(os.path.relpath(p, root) for p in glob.glob(os.path.join(root, "**", "*"), recursive=True)
                  if is_art(p) and os.path.isfile(p))


def expand(pattern, root):
    names = sorted(os.path.relpath(p, root) for p in glob.glob(os.path.join(root, pattern), recursive=True))
    names = [n for n in names if is_art(n)]
    if not names:
        sys.exit("hidpi-art: nothing matches %s" % pattern)
    return names


# ---- Pictures -----------------------------------------------------------------

def frames_of(path):
    """An image's frames (one, or an animated GIF's), RGBA."""
    im = Image.open(path)
    out = []
    for i in range(getattr(im, "n_frames", 1)):
        im.seek(i)
        out.append(im.convert("RGBA"))
    return out


def save_art(frames, path, like):
    """Saves frames (RGBA images) as `path`, in the format of `like` (the 1x art)."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".png" and Image.open(like).mode == "P" and frames[0].getextrema()[3][0] == 255:
        # A palette picture (an opaque gradient in a few colours): its
        # variants too, dithered to 256 colours, a tenth of the size.
        frames[0].convert("RGB").quantize(256, dither=Image.Dither.FLOYDSTEINBERG).save(path, optimize=True)
    elif ext == ".png":
        frames[0].save(path, optimize=True)
    elif ext == ".jpg":
        frames[0].convert("RGB").save(path, quality=95, subsampling=0, optimize=True)
    elif ext == ".gif":
        # GIF has one bit of alpha: the edge is where the art is half covered.
        src = Image.open(like)
        out = []
        for f in frames:
            a = np.asarray(f).copy()
            a[..., 3] = np.where(a[..., 3] >= 128, 255, 0)
            out.append(Image.fromarray(a, "RGBA"))
        out[0].save(path, save_all=True, append_images=out[1:], loop=src.info.get("loop", 0),
                    duration=src.info.get("duration", 100), disposal=2, optimize=False)
    else:
        sys.exit("hidpi-art: cannot write %s" % path)


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
    `wrap`: "x", "y" or "xy" for art that is tiled, resampled as tiled
    so its edges still meet."""
    # Six source pixels of margin, filled as the art is (tiled, or the edge
    # pixels repeated), keep the edges true; 6 is a whole number of pixels
    # at every ratio used (2, 3, 4/3 from a 1.5x original).
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


def boxes(small, entry):
    """The cells of a sprite sheet, (x0, y0, x1, y1) in the 1x art's pixels:
    `tiles` [columns, rows] of one size, or `split` ("x", "y" or "xy") at
    the middle of each run of clear columns / rows between drawings."""
    cols, rows = entry.get("tiles", (1, 1))
    cw, ch = small.width // cols, small.height // rows
    xs, ys = [c * cw for c in range(cols + 1)], [r * ch for r in range(rows + 1)]

    def cuts(clear):
        out, i = [0], 0
        while i < len(clear):
            j = i
            while j < len(clear) and clear[j]:
                j += 1
            if j > i and i > 0 and j < len(clear):
                out.append((i + j) // 2)
            i = max(j, i + 1)
        return out + [len(clear)]

    alpha = np.asarray(small.convert("RGBA"))[..., 3]
    if "x" in entry.get("split", ""):
        xs = cuts(alpha.max(axis=0) == 0)
    if "y" in entry.get("split", ""):
        ys = cuts(alpha.max(axis=1) == 0)
    return [(xs[i], ys[j], xs[i + 1], ys[j + 1]) for j in range(len(ys) - 1) for i in range(len(xs) - 1)]


# ---- The device filesystem -----------------------------------------------------

class Rootfs:
    """Where runtime/rootfs.json serves the repository's files: apps at
    /usr/palm/applications/<id>/, mounts at their device paths."""

    def __init__(self):
        with open(os.path.join(ROOT, "runtime", "rootfs.json")) as f:
            cfg = json.load(f)
        self.dirs = []   # (repository directory, device directory), apps first
        apps = []
        for rel in cfg.get("applicationDirs", []):
            base = os.path.join(ROOT, rel)
            if os.path.isdir(base):
                apps += [os.path.join(rel, n) for n in sorted(os.listdir(base))]
        apps += cfg.get("systemApps", [])
        for rel in apps:
            for d in (rel, os.path.join(rel, "dist")):
                info = os.path.join(ROOT, d, "appinfo.json")
                if os.path.isfile(info):
                    with open(info, encoding="utf-8-sig") as f:
                        app_id = json.load(f).get("id")
                    self.dirs.append((os.path.normpath(d), "/usr/palm/applications/" + app_id))
                    break
        for dev, rel in cfg["mounts"].items():
            if dev.endswith("/"):
                self.dirs.append((os.path.normpath(rel), dev.rstrip("/")))

    def device(self, rel):
        """A repository path's device path (the app's, or the first mount's), or None."""
        best = None
        for d, dev in self.dirs:
            if (rel == d or rel.startswith(d + "/")) and (best is None or len(d) > len(best[0])):
                best = (d, dev)
        return best[1] + rel[len(best[0]):] if best else None

    def repo(self, device):
        """A device path's repository path (no overlay), or None."""
        best = None
        for d, dev in self.dirs:
            if (device == dev or device.startswith(dev + "/")) and (best is None or len(dev) > len(best[1])):
                best = (d, dev)
        return best[0] + device[len(best[1]):] if best else None


# ---- The sets of art ------------------------------------------------------------

class Sets:
    def __init__(self, spec, rootfs):
        self.rootfs = rootfs
        # The shell's art is the file's top level; `sets` are other art with
        # the same fields: `art` its directory (1x), `devices` the device
        # paths it is served at (its variants go to the compat overlay
        # there; else beside the art).
        self.sets = [dict(spec, name="shell", art=os.path.relpath(ART, ROOT))] + spec.get("sets", [])
        for st in self.sets:
            st["_dir"] = os.path.join(ROOT, st["art"])
            devices = st.get("devices", [])
            for d in devices:
                if rootfs.repo(d) != os.path.normpath(st["art"]):
                    sys.exit("hidpi-art: %s is not served at %s (runtime/rootfs.json)" % (st["art"], d))
            st["_devices"] = devices
            st["_out"] = [os.path.join(COMPAT, d.lstrip("/")) for d in devices] or [st["_dir"]]

    def set_of(self, path):
        best = None
        for st in self.sets:
            if path.startswith(st["_dir"] + os.sep) and (best is None or len(st["_dir"]) > len(best["_dir"])):
                best = st
        return best

    def outs(self, path, k):
        """Where art `path`'s variant at factor k goes (every device path)."""
        st = self.set_of(path)
        rel = os.path.relpath(path, st["_dir"]) if st else None
        if st is None:
            return [variant_name(path, k)]
        return [os.path.join(o, variant_name(rel, k)) for o in st["_out"]]

    def variants(self, path):
        """The factors of art `path`'s variants, smallest first."""
        return [k for k in HIDPI_FACTORS if os.path.exists(self.outs(path, k)[0])]


# ---- Web pages' art ----------------------------------------------------------
#
# Pages ask for the art in CSS; Chromium picks the file for its device pixel
# ratio (Theme.u: web views are zoomed by it) from -webkit-image-set() (the
# prefixed form: the simulator's Chromium is older than the plain one; both
# take sizes and border-image slices in the 1x art's pixels).

CSS_URL = re.compile(r"url\(\s*(['\"]?)([^'\")\s]+\.(?:png|jpg|gif))\1\s*\)", re.I)


def resolve_url(sets, url, css):
    """The repository file a stylesheet's url() names, or None."""
    if re.match(r"^[a-z]+:", url, re.I):
        return None
    if url.startswith("/"):
        rel = sets.rootfs.repo(url)
        return os.path.join(ROOT, rel) if rel else None
    return os.path.normpath(os.path.join(os.path.dirname(css), url))


def image_set(sets, url, art, css):
    """-webkit-image-set() of art `art`, named `url` in stylesheet `css`."""
    base, ext = os.path.splitext(url)
    parts = ["url(%s) 1x" % url] + ["url(%s@%gx%s) %gx" % (base, k, ext, k) for k in sets.variants(art)]
    return "-webkit-image-set(%s)" % ", ".join(parts)


def in_image_set(text, pos):
    """Whether the url() at `pos` is inside an image-set()."""
    start = max(text.rfind(";", 0, pos), text.rfind("{", 0, pos))
    return "image-set(" in text[start:pos]


def check_css(sets, path, failed, text=None, label=None):
    """Every url() of art with variants in a stylesheet asks for them all
    (`text`: the stylesheet's overlay copy, its url()s relative to `path`)."""
    if text is None:
        text = open(path).read()
    for m in CSS_URL.finditer(text):
        url = m.group(2)
        if "@" in os.path.basename(url):
            continue
        art = resolve_url(sets, url, path)
        if not art or not sets.variants(art):
            continue
        want = image_set(sets, url, art, path)
        if not in_image_set(text, m.start()) or want not in text[max(0, m.start() - len("-webkit-image-set(")):]:
            line = text.count("\n", 0, m.start()) + 1
            failed.append("%s:%d: %s without its variants: %s" % (label or os.path.relpath(path, ROOT), line, url, want))


IMAGE_DECL = re.compile(r"(^|;)\s*(background|background-image|-webkit-border-image|border-image)\s*:\s*([^;]+)", re.I)
SIZE_DECL = re.compile(r"(^|;)\s*(background-size|-webkit-background-size)\s*:\s*([^;]+)", re.I)
RULE = re.compile(r"([^{}]+)\{([^{}]*)\}")
HIDPI_MEDIA = re.compile(r"min-device-pixel-ratio\s*:\s*(\d+(?:\.\d+)?)", re.I)


def media_blocks(text):
    """(start, body start, body end, end, prelude) of each top-level @media."""
    out = []
    for m in re.finditer(r"@media([^{;]*)\{", text):
        if out and m.start() < out[-1][3]:
            continue
        depth, i = 1, m.end()
        while depth and i < len(text):
            depth += {"{": 1, "}": -1}.get(text[i], 0)
            i += 1
        out.append((m.start(), m.end(), i - 1, i, m.group(1)))
    return out


def with_image_sets(sets, text, path):
    """`text` (a part of stylesheet `path`) with each url() of art with
    variants as an image set of them."""
    out, pos = [], 0
    for m in CSS_URL.finditer(text):
        url = m.group(2)
        if "@" in os.path.basename(url) or in_image_set(text, m.start()):
            continue
        art = resolve_url(sets, url, path)
        if not art or not sets.variants(art):
            continue
        out += [text[pos:m.start()], image_set(sets, url, art, path)]
        pos = m.end()
    return "".join(out + [text[pos:]])


def image_decls(body):
    """{property: value} of a rule's declarations that set an image (the
    background shorthand as background-image)."""
    decls = {}
    for d in IMAGE_DECL.finditer(re.sub(r"/\*.*?\*/", "", body, flags=re.S)):
        prop, value = d.group(2).lower(), " ".join(d.group(3).split())
        if prop == "background":
            m = CSS_URL.search(value)
            prop, value = "background-image", ("url(%s)" % m.group(2) if m else "none")
        decls[prop.replace("-webkit-", "")] = (d.group(2).lower() if d.group(2).lower() != "background" else "background-image", value)
    return decls


def rewrite_css(sets, path, failed):
    """The stylesheet `path` with each url() of art with variants as an
    image set of them.

    Enyo's rules for screens of 1.5 and more (@media with a
    min-device-pixel-ratio under 2) draw its images-1.5 art in that art's
    own geometry (slices, sizes), which is not always 1.5 times the 1x
    art's. They stay as they are, and are followed by the same selectors'
    1x rules again, with image sets, for screens of 2 and more: there the
    @2x and @3x variants are drawn as the 1x art is."""
    text = open(path).read()
    clean = re.sub(r"/\*.*?\*/", lambda m: " " * len(m.group(0)), text, flags=re.S)
    out, pos = [], 0
    base = {}   # (selector, property) -> (property as written, value) of the 1x rules so far
    for start, body0, body1, end, prelude in media_blocks(clean) + [(len(text), len(text), len(text), len(text), "")]:
        # Rules before this block: 1x.
        for r in RULE.finditer(clean[pos:start] if start > pos else ""):
            for sel in r.group(1).split(","):
                for prop, decl in image_decls(r.group(2)).items():
                    base[(" ".join(sel.split()), prop)] = decl
        out.append(with_image_sets(sets, text[pos:start], path))
        if start == len(text):
            break
        ratio = HIDPI_MEDIA.search(prelude)
        block = text[start:end]
        if not ratio or not 1 < float(ratio.group(1)) < 2:
            # 1x rules (max-device-pixel-ratio: 1.49), or other media.
            for r in RULE.finditer(clean[body0:body1]):
                for sel in r.group(1).split(","):
                    for prop, decl in image_decls(r.group(2)).items():
                        base[(" ".join(sel.split()), prop)] = decl
            out.append(with_image_sets(sets, block, path))
            pos = end
            continue
        out.append(with_image_sets(sets, block, path))
        pos = end
        # The 1x rules again for 2x and more, where this block draws
        # art that is not 1x art with variants (its images-1.5 art).
        again = []
        for r in RULE.finditer(clean[body0:body1]):
            decls = image_decls(r.group(2))
            sizes = SIZE_DECL.findall(r.group(2))
            for sel in (" ".join(s.split()) for s in r.group(1).split(",")):
                body = []
                for prop, (written, value) in decls.items():
                    m = CSS_URL.search(value)
                    art = resolve_url(sets, m.group(2), path) if m else None
                    if not m or (art and sets.variants(art)):
                        continue
                    if (sel, prop) in base:
                        bw, bv = base[(sel, prop)]
                    elif "images-1.5/" in m.group(2):
                        # No 1x rule for this selector (Enyo draws
                        # .enyo-dialog's art at 1x and .enyo-toaster-dialog's
                        # at 1.5): Enyo's 1x art is in images/, its 1.5
                        # slices 1.5 times the 1x ones.
                        bw = written
                        bv = value.replace(m.group(0), "url(%s)" % m.group(2).replace("images-1.5/", "images/"))
                        if "border-image" in prop:
                            bv = re.sub(r"(?<=\) )([\d. ]+)", lambda n: " ".join(
                                "%g" % round(float(x) / 1.5, 3) for x in n.group(1).split()) + " ", bv, count=1)
                    else:
                        failed.append("%s: %s { %s } has no 1x rule before it" % (os.path.relpath(path, ROOT), sel, prop))
                        continue
                    bm = CSS_URL.search(bv)
                    bart = resolve_url(sets, bm.group(2), path) if bm else None
                    if not bart or not sets.variants(bart):
                        continue   # its 1x art has no variants either
                    body.append("\t\t%s: %s;" % (bw, with_image_sets(sets, bv, path)))
                    if sizes:
                        body.append("\t\tbackground-size: auto;")
                if body:
                    again.append("\t%s {\n%s\n\t}" % (sel, "\n".join(body)))
        if again:
            out.append("\n@media (-webkit-min-device-pixel-ratio: 2) { /* webOS Phoenix: the 1x rules above with their variants */\n%s\n}" % "\n".join(again))
    return CSS_HEADER + "".join(out)


def manifest(sets):
    """For phoenix-runtime.js: the art pages name from script, by device
    directory: each picture's variant factors (name@kx beside it)."""
    art = {}
    for st in sets.sets:
        devices = st["_devices"] or ([sets.rootfs.device(st["art"])] if sets.rootfs.device(st["art"]) else [])
        if not devices or st["name"] in ("shell",):
            continue
        for rel in all_art(st["_dir"]):
            path = os.path.join(st["_dir"], rel)
            entry = sets.variants(path)
            if not entry:
                continue
            for d in devices:
                where = (d + "/" + os.path.dirname(rel)).rstrip("/") + "/"
                art.setdefault(where, {})[os.path.basename(rel)] = entry
    lines = ['{', '    "//": "tools/hidpi-art.py: pictures of the original apps and frameworks with HiDPI variants, by device directory (docs/spec/hidpi-art.md). Do not edit; regenerate.",',
             '    "art": {']
    dirs = sorted(art)
    for i, d in enumerate(dirs):
        lines.append("        %s: %s%s" % (json.dumps(d), json.dumps(art[d], sort_keys=True, separators=(",", ":")),
                                         "," if i < len(dirs) - 1 else ""))
    lines += ["    }", "}"]
    return "\n".join(lines) + "\n"


# ---- Making variants ---------------------------------------------------------------

def make(entry, method, art_path, src_path, todo, outs, up):
    """Writes art_path's variants at the factors in `todo` to outs(k)[0]: a
    cell of a sprite sheet at a time (`boxes`), from `src_path` (the 1x art,
    or a larger drawing of it)."""
    small_frames = frames_of(art_path)
    src_frames = frames_of(src_path) if src_path != art_path else small_frames
    results = {k: [] for k in todo}
    for small, src in zip(small_frames, src_frames):
        s = src.width / small.width
        if abs(src.height / small.height - s) > 1e-6:
            sys.exit("hidpi-art: %s is not %s scaled" % (src_path, art_path))
        hr = {k: np.zeros((round(small.height * k), round(small.width * k), 4)) for k in todo}
        for box in boxes(small, entry):
            sb = tuple(round(v * s) for v in box)
            if any(abs(v * s - w) > 1e-6 for v, w in zip(box, sb)):
                sys.exit("hidpi-art: %s's cells are not whole pixels of %s" % (art_path, src_path))
            cell = src.crop(sb)
            if method == "model":
                # Tiled art: enlarged with its neighbours (itself) around it,
                # so its edges still meet.
                wrap = entry.get("wrap", "")
                px, py = (8 if "x" in wrap else 0), (8 if "y" in wrap else 0)
                padded = np.pad(np.asarray(cell.convert("RGBA")), ((py, py), (px, px), (0, 0)), mode="wrap")
                big = up.enlarge(Image.fromarray(padded, "RGBA"))
                big = big[py * 4:big.shape[0] - py * 4, px * 4:big.shape[1] - px * 4]
            for k in todo:
                x0, y0, x1, y1 = (round(v * k) for v in box)
                size = (x1 - x0, y1 - y0)
                if method == "model":
                    out = resize_premul(big, size, Image.LANCZOS)
                elif method == "pixel":
                    out = resize_premul(premul(cell), size, Image.NEAREST)
                elif method == "downscale":
                    if cell.width < size[0] or cell.height < size[1]:
                        sys.exit("hidpi-art: %s is smaller than %s at %gx" % (src_path, art_path, k))
                    out = clamp(resize_premul(premul(cell), size, Image.LANCZOS))
                else:
                    out = resample(cell, size, entry.get("wrap", ""))
                hr[k][y0:y1, x0:x1] = out
        for k in todo:
            results[k].append(unpremul(hr[k]))
    for k in todo:
        dest = outs(k)[0]
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        save_art(results[k], dest, art_path)


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
    sets = Sets(spec, Rootfs())
    failed = []
    counts = []
    up = None

    # Made first, then copied (a copy's art may come later in the file),
    # then checked.
    for phase in (["check"] if args.check else ["make", "copy", "check"]):
        for st in sets.sets:
            art_dir = st["_dir"]
            covered, skipped = set(), set()

            def mark(art):
                if art in covered:
                    failed.append("%s/%s: listed twice" % (st["art"], art))
                covered.add(art)

            def outs_of(art):
                return lambda k: sets.outs(os.path.join(art_dir, art), k)

            def check(art, k, tolerance=MAX_ERROR):
                small = Image.open(os.path.join(art_dir, art))
                first = None
                for path in outs_of(art)(k):
                    if not os.path.exists(path):
                        failed.append("%s: missing" % os.path.relpath(path, ROOT))
                        continue
                    if first is not None:
                        if open(path, "rb").read() != open(first, "rb").read():
                            failed.append("%s: not the same as %s" % (os.path.relpath(path, ROOT), os.path.relpath(first, ROOT)))
                        continue
                    first = path
                    big = Image.open(path)
                    want = (round(small.width * k), round(small.height * k))
                    if big.size != want:
                        failed.append("%s: %dx%d, not %dx%d" % (os.path.relpath(path, ROOT), big.width, big.height, *want))
                        continue
                    if getattr(big, "n_frames", 1) != getattr(small, "n_frames", 1):
                        failed.append("%s: not as many frames as the 1x art" % os.path.relpath(path, ROOT))
                    e = error(small, big)
                    if e > tolerance:
                        failed.append("%s: %.1f from the 1x art" % (os.path.relpath(path, ROOT), e))

            for o in st.get("original", []):
                if args.only and args.only not in o["art"]:
                    continue
                dests = outs_of(o["art"])(o["factor"])
                if phase == "make" and not (args.missing and all(os.path.exists(d) for d in dests)):
                    if not args.ref:
                        sys.exit("hidpi-art: --ref is needed to copy the originals")
                    for dest in dests:
                        os.makedirs(os.path.dirname(dest), exist_ok=True)
                        shutil.copyfile(os.path.join(args.ref, REPO_DIRS[o["repo"]], o["from"]), dest)
                    print("copied", os.path.relpath(dests[0], ROOT))
                if phase == "check":
                    check(o["art"], o["factor"])

            for entry in st.get("upscale", []):
                method = entry.get("method", "model")
                if method not in METHODS + ("copy",):
                    sys.exit("hidpi-art: %s: no method %s" % (entry["art"], method))
                tolerance = entry.get("tolerance", MAX_ERROR)
                if phase == "check" and "tolerance" in entry and not entry.get("why"):
                    failed.append("%s/%s: a tolerance without a reason" % (st["art"], entry["art"]))
                for art in expand(entry["art"], art_dir):
                    if phase == "check":
                        mark(art)
                    if args.only and args.only not in os.path.join(st["art"], art):
                        continue
                    art_path = os.path.join(art_dir, art)
                    outs = outs_of(art)
                    # `factors`: only these (the others are originals).
                    mine = entry.get("factors", factors)
                    todo = [k for k in mine if not (args.missing and all(os.path.exists(p) for p in outs(k)))]
                    if todo and phase == ("copy" if method == "copy" else "make"):
                        if method == "copy":
                            # The same art elsewhere in the repository: its variants.
                            src = os.path.join(ROOT, entry["from"])
                            for k in todo:
                                frm = sets.outs(src, k)[0]
                                for dest in outs(k):
                                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                                    shutil.copyfile(frm, dest)
                            print("copy", os.path.join(st["art"], art), flush=True)
                        else:
                            if up is None and method == "model":
                                if not args.model:
                                    sys.exit("hidpi-art: --model is needed to upscale %s" % art)
                                up = Upscaler(args.model, spec["model"]["sha256"])
                            src = art_path
                            if "from" in entry:
                                # A larger variant (an original), beside the others.
                                src = os.path.join(os.path.dirname(outs(2)[0]), entry["from"])
                            elif "source" in entry:
                                # A larger drawing of the same picture elsewhere.
                                src = os.path.join(ROOT, entry["source"])
                            make(entry, method, art_path, src, todo, outs, up)
                            for k in todo:
                                for dest in outs(k)[1:]:
                                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                                    shutil.copyfile(outs(k)[0], dest)
                            print("%s %s" % (method, os.path.join(st["art"], art)), flush=True)
                    if phase == "check":
                        for k in mine:
                            check(art, k, tolerance)

            if phase != "check":
                continue
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

    # Stylesheets: those that must ask for every variant themselves (`css`),
    # and the original pages' (`rewrite-css`), whose copies in the compat
    # overlay do.
    written = set()
    for st in sets.sets:
        for pattern in st.get("css", []):
            files = sorted(glob.glob(os.path.join(ROOT, pattern), recursive=True))
            if not files:
                failed.append("%s: no stylesheet" % pattern)
            for css in files:
                check_css(sets, css, failed)
        for pattern in st.get("rewrite-css", []):
            files = sorted(glob.glob(os.path.join(st["_dir"], pattern), recursive=True))
            if not files:
                failed.append("%s/%s: no stylesheet" % (st["art"], pattern))
            for css in files:
                text = rewrite_css(sets, css, failed)
                if text == CSS_HEADER + open(css).read():
                    continue   # no art with variants
                # The copy asks for every variant (a url() this does not
                # understand would show here).
                check_css(sets, css, failed, text, "%s (overlay copy)" % os.path.relpath(css, ROOT))
                for d in st["_devices"]:
                    dest = os.path.join(COMPAT, d.lstrip("/"), os.path.relpath(css, st["_dir"]))
                    written.add(dest)
                    if args.check:
                        if not os.path.exists(dest) or open(dest).read() != text:
                            failed.append("%s: out of date" % os.path.relpath(dest, ROOT))
                    elif not os.path.exists(dest) or open(dest).read() != text:
                        os.makedirs(os.path.dirname(dest), exist_ok=True)
                        with open(dest, "w") as f:
                            f.write(text)
                        print("wrote", os.path.relpath(dest, ROOT))
    # Overlay stylesheets this no longer writes.
    for css in glob.glob(os.path.join(COMPAT, "**", "*.css"), recursive=True):
        if css not in written and open(css).read().startswith(CSS_HEADER):
            if args.check:
                failed.append("%s: written by tools/hidpi-art.py for no stylesheet" % os.path.relpath(css, ROOT))
            else:
                os.remove(css)
                print("removed", os.path.relpath(css, ROOT))

    text = manifest(sets)
    if args.check:
        if not os.path.exists(MANIFEST) or open(MANIFEST).read() != text:
            failed.append("%s: out of date" % os.path.relpath(MANIFEST, ROOT))
    elif not os.path.exists(MANIFEST) or open(MANIFEST).read() != text:
        with open(MANIFEST, "w") as f:
            f.write(text)
        print("wrote", os.path.relpath(MANIFEST, ROOT))

    for f in failed:
        print("FAIL", f)
    if failed:
        sys.exit(1)
    print("hidpi-art: every piece of art has its variants (%s), each within %.1f of its 1x art" % (", ".join(counts), MAX_ERROR))


if __name__ == "__main__":
    main()
