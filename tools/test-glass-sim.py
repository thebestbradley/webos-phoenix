#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Ember Glass's shell contract in the simulator (docs/SYSTEM-UI-2.md, "The
shell contract"): a page that draws its card's glass from what the shell
gives it lines its blur up with the sharp wallpaper around its card.

Two runs of phoenix-sim on the Fairphone 6's screen (1116 x 2484 at 2.5, the
mock-ups' 446 x 994), in Ember Glass, each in a fresh home:

  1. the test page (tools/fixtures/glass-app, installed for the run) maximized,
     drawing only the blurred wallpaper the shell gives it, where the window
     lies (its launch point "raw": .eg-window's L1 without tone map or tint);
  2. the card view with no cards: the sharp wallpaper as the screen shows it.

The second, blurred as the contract says (a Gaussian of 40 CSS px), must be
the first, pixel for pixel within a few levels, in the middle of the screen
(clear of the status bar, Just Type and the dock); and moved by the status
bar's height, or sideways, it must not be: the blur is where the wallpaper is.

  tools/test-glass-sim.py [--sim build/phoenix-sim] [--qml-dir shell/qml]
                          [--repo-dir .] [--out DIR] [--delay MS]

Needs Pillow and NumPy; without a display, xvfb-run.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageFilter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H, SCALE = 1116, 2484, 2.5
DEVIATION = 40 * SCALE           # glass.l1.blur, in the screen's pixels
APP = "org.webosphoenix.glasstest"


def run(args, out, extra, delay):
    home = tempfile.mkdtemp(prefix="glass-home-")
    installed = tempfile.mkdtemp(prefix="glass-apps-")
    try:
        apps = os.path.join(installed, "usr/palm/applications")
        os.makedirs(apps)
        os.symlink(os.path.join(REPO, "tools/fixtures/glass-app"), os.path.join(apps, APP))
        cmd = [args.sim, "--qml-dir", args.qml_dir, "--repo-dir", args.repo_dir, "--size", "%dx%d" % (W, H),
               "--scale", str(SCALE), "--phone", "--no-marketplace", "--installed-dir", installed,
               "--screenshot", out, "--delay", str(delay)] + extra + ["--", "--look", "ember-glass"]
        if not os.environ.get("DISPLAY") and shutil.which("xvfb-run"):
            cmd = ["xvfb-run", "-a", "-s", "-screen 0 %dx%dx24" % (W + 300, H + 200)] + cmd
        env = dict(os.environ, HOME=home, QTWEBENGINE_DISABLE_SANDBOX="1")
        r = subprocess.run(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=600)
        if r.returncode != 0 or not os.path.exists(out):
            sys.stdout.write(r.stdout.decode(errors="replace")[-3000:])
            raise SystemExit("phoenix-sim failed (%d)" % r.returncode)
    finally:
        shutil.rmtree(home, ignore_errors=True)
        shutil.rmtree(installed, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--sim", default=os.path.join(REPO, "build/phoenix-sim"))
    ap.add_argument("--qml-dir", default=os.path.join(REPO, "shell/qml"))
    ap.add_argument("--repo-dir", default=REPO)
    ap.add_argument("--out", default=os.path.join(REPO, "build/glass-sim"))
    ap.add_argument("--delay", type=int, default=35000, help="ms before each screenshot (the page and the wallpaper load)")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    page = os.path.join(args.out, "page.png")
    sharp = os.path.join(args.out, "wallpaper.png")
    run(args, page, ["--launch", APP + ".raw"], args.delay)
    run(args, sharp, ["--scene", "empty"], args.delay)

    a = np.asarray(Image.open(page).convert("RGB"), dtype=np.float64)
    expected = np.asarray(Image.open(sharp).convert("RGB").filter(ImageFilter.GaussianBlur(DEVIATION)), dtype=np.float64)
    if a.shape != expected.shape:
        raise SystemExit("the screenshots differ in size: %s, %s" % (a.shape, expected.shape))
    # The middle of the screen: three deviations clear of the screen's sides,
    # the status bar and Just Type above, the dock below.
    m = int(3 * DEVIATION)
    y0, y1, x0, x1 = 700, 1700, m, W - m

    def error(dx, dy):
        return np.abs(a[y0:y1, x0:x1] - expected[y0 + dy:y1 + dy, x0 + dx:x1 + dx]).mean()

    failures = 0

    def check(cond, what):
        nonlocal failures
        print(("ok   " if cond else "FAIL ") + what)
        if not cond:
            failures += 1

    lined = error(0, 0)
    bar = int(round(32 * SCALE))
    shifted = {"down by the status bar (32 CSS px)": error(0, bar), "up by it": error(0, -bar),
               "40 CSS px left": error(-100, 0), "40 CSS px right": error(100, 0)}
    spread = float(np.abs(expected[y0:y1, x0:x1] - expected[y0:y1, x0:x1].mean(axis=(0, 1))).mean())
    print("mean difference, levels of 255: in place %.2f; %s; the wallpaper's own variation %.2f" % (
        lined, "; ".join("%s %.2f" % kv for kv in shifted.items()), spread))
    check(lined < 4.0, "the page's blur is the sharp wallpaper blurred where it lies (%.2f < 4 levels)" % lined)
    check(all(v > lined * 2 for v in shifted.values()),
          "moved by the status bar or sideways it is not (each at least twice the difference in place)")
    check(spread > 8, "the wallpaper varies there, so the comparison means something (%.2f)" % spread)
    print("screenshots in " + args.out)
    if failures:
        print("%d failed" % failures)
        sys.exit(1)
    print("all passed")


if __name__ == "__main__":
    main()
