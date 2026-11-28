#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Write tools/devicecheck/bus-permissions.json: the table the simulator's
runtime checks each Luna call against, as ls-hubd does on a device
(tools/devicecheck/luna.py bus_table(); runtime/phoenix-runtime.js, "Bus
permissions"; docs/SIM-PARITY.md). Rerun it whenever a sysbus file, an
app's requiredPermissions or compat/app-permissions.json changes;
--check (tools/ci-checks.sh) fails when the checked-in table is not what
this writes.

    tools/gen-bus-permissions.py [--check]
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from devicecheck import luna  # noqa: E402

REPO = os.path.dirname(HERE)
OUT = os.path.join(HERE, "devicecheck", "bus-permissions.json")


def render(root):
    return json.dumps(luna.bus_table(root), indent=1, sort_keys=False) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="fail if the checked-in table is out of date")
    ap.add_argument("--root", default=REPO)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    out = args.out or (OUT if os.path.abspath(args.root) == REPO else os.path.join(args.root, "bus-permissions.json"))
    text = render(os.path.abspath(args.root))
    if args.check:
        try:
            with open(out, encoding="utf-8") as f:
                old = f.read()
        except OSError:
            old = None
        if old != text:
            print("%s is out of date: run tools/gen-bus-permissions.py" % os.path.relpath(out, REPO), file=sys.stderr)
            return 1
        print("%s is up to date" % os.path.relpath(out, REPO))
        return 0
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote %s" % os.path.relpath(out, REPO))
    return 0


if __name__ == "__main__":
    sys.exit(main())
