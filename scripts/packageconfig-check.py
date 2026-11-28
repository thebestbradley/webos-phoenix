#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Check that every PACKAGECONFIG option meta-phoenix asks for exists in the
# recipe it is for, for one MACHINE, without building anything.
#
#   scripts/packageconfig-check.py LAYER          inside a build environment
#   scripts/packageconfig-check.py --list LAYER   the recipes it would check
#
# OE's QA check for this (invalid-packageconfig) runs in each recipe's
# do_configure, so a parse and a dry run (scripts/parse-check.sh) do not see
# it: on 26 November 2026 the first PineTab2 build stopped after three hours
# at mesa's do_configure, on a "kmsro" option Mesa 26 no longer has. This
# parses only the recipes LAYER sets PACKAGECONFIG for (a conf file's
# PACKAGECONFIG...:pn-RECIPE line, or a bbappend that sets PACKAGECONFIG)
# with the machine's configuration, and compares each option against the
# recipe's PACKAGECONFIG[...] flags, as OE's check does.
#
# A recipe this MACHINE cannot build (COMPATIBLE_MACHINE, a missing
# provider) is skipped. Exit status: 0 when every option exists, 1 when one
# does not, 2 on a usage error.

import os
import re
import shutil
import sys

PN_LINE = re.compile(r"^\s*PACKAGECONFIG\S*:pn-([A-Za-z0-9+._-]+)\s*[:?+.]*=")
SETS_PACKAGECONFIG = re.compile(r"^\s*PACKAGECONFIG(?![\[\w])\S*\s*[:?+.]*=", re.M)


def recipes(layer):
    """The recipes LAYER sets PACKAGECONFIG for: {recipe: [files]}."""
    found = {}
    for root, dirs, files in os.walk(layer):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for name in sorted(files):
            path = os.path.join(root, name)
            rel = os.path.relpath(path, layer)
            if name.endswith((".conf", ".inc")):
                with open(path, errors="replace") as f:
                    for line in f:
                        m = PN_LINE.match(line)
                        if m and "$" not in m.group(1):
                            found.setdefault(m.group(1), []).append(rel)
            elif name.endswith(".bbappend"):
                with open(path, errors="replace") as f:
                    if SETS_PACKAGECONFIG.search(f.read()):
                        pn = name[:-len(".bbappend")].split("_")[0]
                        found.setdefault(pn, []).append(rel)
    return {pn: sorted(set(files)) for pn, files in sorted(found.items())}


def invalid(options, flags):
    """The options that are not one of the recipe's PACKAGECONFIG flags."""
    return [o for o in options.split() if o not in flags]


def check(layer):
    bitbake = shutil.which("bitbake")
    if not bitbake:
        print("error: no bitbake on PATH; run this inside a build environment", file=sys.stderr)
        return 2
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(bitbake))), "lib"))
    import bb.tinfoil  # noqa: E402  (bitbake's own library, found above)

    wanted = recipes(layer)
    machine = os.environ.get("MACHINE", "?")
    bad = 0
    with bb.tinfoil.Tinfoil() as tinfoil:
        tinfoil.prepare(config_only=False, quiet=2)
        machine = tinfoil.config_data.getVar("MACHINE") or machine
        for pn, files in wanted.items():
            try:
                d = tinfoil.parse_recipe(pn)
            except Exception as e:  # not buildable for this machine
                print(f"{machine}: {pn}: skipped ({str(e).splitlines()[0] if str(e) else type(e).__name__})")
                continue
            flags = d.getVarFlags("PACKAGECONFIG") or {}
            wrong = invalid(d.getVar("PACKAGECONFIG") or "", flags)
            if wrong:
                bad += 1
                print(f"{machine}: {pn}: PACKAGECONFIG has {', '.join(wrong)}, which {pn} does not "
                      f"offer (meta-phoenix sets its PACKAGECONFIG in {', '.join(files)})")
            else:
                print(f"{machine}: {pn}: ok")
    return 1 if bad else 0


def main(argv):
    args = argv[1:]
    listing = args[:1] == ["--list"]
    if listing:
        args = args[1:]
    if len(args) != 1 or not os.path.isdir(args[0]):
        print("usage: packageconfig-check.py [--list] LAYER", file=sys.stderr)
        return 2
    if listing:
        for pn, files in recipes(args[0]).items():
            print(f"{pn}\t{' '.join(files)}")
        return 0
    return check(args[0])


if __name__ == "__main__":
    sys.exit(main(sys.argv))
