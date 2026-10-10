# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Every file the image ships traces to an allowed licence.

  no-provenance  a picture, sound, font or model the image installs (from
                 install-rootfs.py's plan and the shell's assets) whose
                 origin nothing records: no PROVENANCE.md, THIRD-PARTY
                 notice or licence file in its folder or above, not in
                 tools/hidpi-art.json, not an @2x/@3x variant of a recorded
                 picture, not part of an Open webOS submodule (third_party/,
                 Apache-2.0 as released)
  submodule      a third_party/ submodule without a licence file
  recipe-licence a meta-phoenix recipe whose LICENSE is not in docs/LEGAL.md's
                 allowed list (Apache-2.0 and permissive; firmware as
                 LEGAL.md describes)
  source-offer   a GPL or LGPL component the image installs that
                 docs/LEGAL.md's "Source offer" section does not list, with
                 the duty it brings (the corresponding source with the image)
"""

import fnmatch
import json
import os
import re

from . import Findings, finish, parser, read, recipe_vars, recipe_files, rel, install_plan

CHECKER = "licences"
MEDIA = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".mp3", ".wav", ".ogg", ".m4a", ".aac",
         ".ttf", ".otf", ".woff", ".woff2", ".onnx", ".gguf", ".mp4", ".webm", ".pdf")
MARKERS = re.compile(r"^(PROVENANCE\.md|THIRD-PARTY.*|LICEN[CS]E.*|COPYING.*|NOTICE.*)$", re.I)
PERMISSIVE = {"Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "CC0-1.0", "Unlicense",
              "OFL-1.1", "CLOSED", "PD", "BSL-1.0", "Python-2.0", "CC-BY-4.0", "Firmware-only"}

# GPL and LGPL components every Phoenix image installs: OSE's base and what
# meta-phoenix's packagegroups add (their licences as OE-core, meta-oe and
# meta-qt6 declare them). The image's license.manifest is the full list; a
# first build should be compared with it (docs/PRE-IMAGE-CHECKLIST.md L2).
COPYLEFT = {
    "linux kernel": "GPL-2.0-only",
    "glibc": "LGPL-2.1-or-later",
    "systemd": "LGPL-2.1-or-later",
    "qtbase": "LGPL-3.0-only | GPL-2.0-or-later | GPL-3.0-only",
    "qtdeclarative": "LGPL-3.0-only | GPL-2.0-or-later | GPL-3.0-only",
    "qtwayland": "LGPL-3.0-only | GPL-2.0-or-later | GPL-3.0-only",
    "qt5compat": "LGPL-3.0-only | GPL-2.0-or-later | GPL-3.0-only",
    "qtsvg": "LGPL-3.0-only | GPL-2.0-or-later | GPL-3.0-only",
    "bash": "GPL-3.0-or-later",
    "coreutils": "GPL-3.0-or-later",
    "nano": "GPL-3.0-or-later",
    "htop": "GPL-2.0-or-later",
    "procps": "GPL-2.0-or-later & LGPL-2.0-or-later",
    "less": "GPL-3.0-or-later | BSD-2-Clause",
    "opkg": "GPL-2.0-or-later",
    "kernel modules (rtl8812au, rtl8814au)": "GPL-2.0-only",
    "linux-firmware (some files)": "Firmware licences, some GPL-2.0 (LEGAL.md, Firmware and drivers)",
}


README_LICENCE = re.compile(r"licen[cs]e|CC0|CC BY|public domain|Apache-2\.0", re.I)


def provenance_dirs(root):
    """Folders whose files' origin is written down: a PROVENANCE.md, a
    notice or licence file, or a README.md that names their licence."""
    out = set()
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in (".git", "node_modules", "build", "dist")]
        if any(MARKERS.match(fn) for fn in files):
            out.add(d)
        elif "README.md" in files and d != root and README_LICENCE.search(read(os.path.join(d, "README.md"))):
            out.add(d)
    return out


def app_icon_outputs(root):
    """The app icons tools/render-app-icons.cjs draws from art/app-icons
    (whose PROVENANCE.md records them): every size of each "out"."""
    path = os.path.join(root, "art", "app-icons", "icons.json")
    if not os.path.isfile(path):
        return []
    pats = []
    for name, icon in json.load(open(path, encoding="utf-8")).items():
        if isinstance(icon, dict):
            for out in icon.get("out", []):
                pats += [out + ".png", out + "-*x*.png"]
    return pats


def hidpi_listed(root):
    """Pictures tools/hidpi-art.json records (full repository paths, globs)."""
    path = os.path.join(root, "tools", "hidpi-art.json")
    if not os.path.isfile(path):
        return []
    data = json.load(open(path, encoding="utf-8"))
    pats = []

    def add(base, entries):
        for e in entries or []:
            if isinstance(e, dict) and e.get("art"):
                pats.append(os.path.join(base, e["art"]))
    base = os.path.join("shell", "assets", "openwebos")
    for k in ("original", "upscale", "derived"):
        add(base, data.get(k))
    for s in data.get("sets", []):
        for k in ("original", "upscale", "derived", "skip"):
            add(s.get("art", ""), s.get(k))
    return pats


HASHED = re.compile(r"^(.+?)[-.][A-Za-z0-9_-]{8}(\.\w+)$")


def built_source(root, src):
    """A built app's file (apps/<app>/dist/...) back to its source: public/
    as it is, or an asset Vite renamed (name-HASH.ext) from the app's or a
    shared package's sources. None: bundled from an npm package (whose
    licence the app's notices carry), or not found."""
    m = re.match(r"^(apps/[^/]+)/dist/(.+)$", rel(root, src).replace(os.sep, "/"))
    if not m:
        return src
    app, inner = m.group(1), m.group(2)
    pub = os.path.join(root, app, "public", inner)
    if os.path.isfile(pub):
        return pub
    hm = HASHED.match(os.path.basename(inner))
    name = hm.group(1) + hm.group(2) if hm else os.path.basename(inner)
    for base in (os.path.join(root, app), os.path.join(root, "apps", "shared")):
        for d, dirs, files in os.walk(base):
            dirs[:] = [x for x in dirs if x not in ("node_modules", "dist", ".git")]
            if name in files:
                return os.path.join(d, name)
    return None


def traced(root, src, prov_dirs, hidpi):
    r = rel(root, src)
    if r.startswith("third_party" + os.sep):
        return True
    plain = re.sub(r"@[23]x(\.\w+)$", r"\1", r)
    for cand in (r, plain):
        if any(fnmatch.fnmatchcase(cand, p) for p in hidpi):
            return True
    d = os.path.dirname(src)
    while len(d) >= len(root):
        if d in prov_dirs:
            return True
        if d == root:
            break
        d = os.path.dirname(d)
    return False


def check(root):
    f = Findings(CHECKER)
    plan, notes = install_plan(root)
    prov = provenance_dirs(root)
    prov.discard(root)   # the repository's own LICENSE covers code, not pictures of unknown origin
    # compat/rootfs: overlays of the originals' files (compat/README.md says how each was made).
    compat = os.path.join(root, "compat")
    if os.path.isfile(os.path.join(compat, "README.md")):
        prov.add(compat)
    hidpi = hidpi_listed(root) + app_icon_outputs(root)
    sources = [s for s in plan.values() if not s.startswith("generated:")]
    assets = os.path.join(root, "shell", "assets")
    for d, dirs, files in os.walk(assets):
        sources += [os.path.join(d, fn) for fn in files]
    # The built apps' files come from their public/ (as is) and src/ (what
    # the bundle imports): check those, so the result is the same whether
    # or not the apps were built here (CI builds them first).
    apps = os.path.join(root, "apps")
    for n in sorted(os.listdir(apps)) if os.path.isdir(apps) else []:
        for sub in ("public", "src"):
            base = os.path.join(apps, n, sub)
            for d, dirs, files in os.walk(base):
                dirs[:] = [x for x in dirs if x not in ("node_modules", "test", "tests", "__tests__", "fixtures")]
                sources += [os.path.join(d, fn) for fn in files]
    shared = os.path.join(apps, "shared")
    for n in sorted(os.listdir(shared)) if os.path.isdir(shared) else []:
        for sub in ("src", "assets"):
            for d, dirs, files in os.walk(os.path.join(shared, n, sub)):
                dirs[:] = [x for x in dirs if x not in ("node_modules", "test", "tests", "__tests__", "fixtures")]
                sources += [os.path.join(d, fn) for fn in files]
    seen = set()
    bundled = []   # built assets from npm packages: the apps' licence notices cover them
    for src in sorted(set(sources)):
        if not src.lower().endswith(MEDIA) or src in seen:
            continue
        seen.add(src)
        orig = built_source(root, src)
        if orig is None:
            bundled.append(rel(root, src))
            continue
        if traced(root, orig, prov, hidpi):
            continue
        src = orig
        key = rel(root, os.path.dirname(src))
        f.add("no-provenance", key, "%s ships pictures, sounds or fonts with no recorded origin (add a "
              "PROVENANCE.md, or list them in tools/hidpi-art.json)" % key, rel(root, src))
    legal = os.path.join(root, "docs", "LEGAL.md")
    legal_text = read(legal) if os.path.isfile(legal) else ""
    # Submodules: a licence file, a declared licence, or docs/LEGAL.md's
    # account of it (Open webOS's repositories carry Apache-2.0 headers).
    gm = os.path.join(root, ".gitmodules")
    if os.path.isfile(gm):
        for path in re.findall(r"^\s*path\s*=\s*(\S+)", read(gm), re.M):
            full = os.path.join(root, path)
            if not os.path.isdir(full) or not os.listdir(full):
                notes.append("%s: submodule not checked out; not checked" % path)
                continue
            if any(MARKERS.match(fn) for fn in os.listdir(full)):
                continue
            declared = False
            for meta in ("package.json", "bower.json"):
                p = os.path.join(full, meta)
                if os.path.isfile(p) and re.search(r'"licen[cs]e"\s*:\s*"(%s)"' % "|".join(PERMISSIVE), read(p)):
                    declared = True
            if not declared and os.path.basename(path) not in legal_text:
                f.add("submodule", path, "%s has no licence file at its top, no licence in its package.json, "
                      "and docs/LEGAL.md does not say what it is" % path, path)
    # Recipes' licences.
    for path in recipe_files(root):
        v, _, _, _ = recipe_vars(path)
        lic = v.get("LICENSE", "")
        # Kernel modules are GPL-2.0 by necessity (LEGAL.md, Firmware and
        # drivers: shipped with the kernel's source offer).
        kernel = os.sep + "recipes-kernel" + os.sep in path
        for part in re.split(r"[\s&|()]+", lic):
            if kernel and part == "GPL-2.0-only":
                continue
            if part and part not in PERMISSIVE and not part.startswith("${"):
                f.add("recipe-licence", "%s:%s" % (os.path.basename(path), part),
                      "%s is %s, which docs/LEGAL.md does not allow for Phoenix's own recipes"
                      % (os.path.basename(path), lic), rel(root, path))
    if bundled:
        notes.append("%d built assets come from npm packages (the apps' licence notices cover them), e.g. %s"
                     % (len(bundled), bundled[0]))
    # GPL/LGPL source offer.
    text = legal_text
    m = re.search(r"^## Source offer\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    section = m.group(1) if m else ""
    for comp, lic in sorted(COPYLEFT.items()):
        if comp.split(" (")[0].lower() not in section.lower():
            f.add("source-offer", comp, "the image installs %s (%s); docs/LEGAL.md's \"Source offer\" section "
                  "does not list it" % (comp, lic), "docs/LEGAL.md")
    return f, notes


def main(argv=None):
    ap = parser(__doc__.splitlines()[0])
    args = ap.parse_args(argv)
    findings, notes = check(os.path.abspath(args.root))
    return finish(CHECKER, findings, args, notes=[n for n in notes if "submodule" in n or "npm" in n])
