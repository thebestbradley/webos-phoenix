#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Write compat overlays that remove HP/Palm trademarks from the original apps' UI strings.

The Open webOS apps are Apache-2.0, but trademarks are not licensed
(Apache-2.0 section 6), so user-visible "HP webOS", "HP TouchPad", ...
strings are replaced. Enyo does not translate strings in its source
locale (en_us), so this cannot be done with a strings file; instead the
few affected source files get overlay copies in compat/rootfs with the
text replaced. third_party/ stays untouched.

Run again after updating a submodule:

    tools/debrand-overlays.py [--check]

--check exits non-zero if an overlay is missing or out of date (CI).
"""

import argparse
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVERLAY = os.path.join(REPO, "compat", "rootfs")

# Source trees and the device paths they are served at (runtime/rootfs.json).
TREES = [
    ("third_party/core-apps", "/usr/palm/applications"),
    ("third_party/enyo-1.0/framework", "/usr/palm/frameworks/enyo/0.10/framework"),
]

# Longest first, so specific strings win over their substrings.
REPLACEMENTS = [
    ("Please respond to the verification email sent to #{email} from Palm_Inc@email.palmnewsletters.com. The new email address will not be updated until it has been verified.",
     "Please respond to the verification email sent to #{email}. The new email address will not be updated until it has been verified."),
    ("The United States Government prohibits HP from allowing you to use this email address to set up a webOS account.",
     "This email address can't be used to set up an account."),
    ("Must be connected to a network to communicate with HP's Cloud Services.",
     "Must be connected to a network to reach the account service."),
    ("-- Sent from my HP TouchPad", "-- Sent from Phoenix"),
    ("HP webOS Account", "Phoenix Account"),
    ("HP WebOS Account", "Phoenix Account"),
    ("HP WEBOS ACCOUNT", "PHOENIX ACCOUNT"),
    ("HP webOS", "Phoenix"),
    ("Palm Profile", "Phoenix Profile"),
]

SKIP_DIRS = {"mock", "spec", "specs", "test", "tests", "docs", ".git", "node_modules"}
HEADER = ("// webOS Phoenix overlay (tools/debrand-overlays.py): the original file with\n"
          "// HP/Palm trademarks replaced in UI strings. Do not edit; regenerate.\n")


def targets():
    for tree, device_root in TREES:
        base = os.path.join(REPO, tree)
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fn in files:
                if not fn.endswith(".js"):
                    continue
                src = os.path.join(root, fn)
                with open(src, encoding="utf-8", errors="surrogateescape") as f:
                    text = f.read()
                if not any(a in text for a, _ in REPLACEMENTS):
                    continue
                device = device_root + "/" + os.path.relpath(src, base).replace(os.sep, "/")
                yield src, device, text


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    stale = 0
    for src, device, text in targets():
        dst = os.path.join(OVERLAY, device.lstrip("/"))
        # Another compat fix may already overlay this file: build on it.
        if os.path.isfile(dst):
            with open(dst, encoding="utf-8", errors="surrogateescape") as f:
                text = f.read()
        out = text
        for a, b in REPLACEMENTS:
            out = out.replace(a, b)
        if not out.startswith(HEADER):
            out = HEADER + out
        current = open(dst, encoding="utf-8", errors="surrogateescape").read() if os.path.isfile(dst) else None
        if current == out:
            continue
        stale += 1
        if args.check:
            print("out of date: " + device)
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "w", encoding="utf-8", errors="surrogateescape") as f:
            f.write(out)
        print("wrote " + device)
    if args.check and stale:
        sys.exit(1)


if __name__ == "__main__":
    main()
