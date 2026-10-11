#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The device profiles (device-profiles.json beside this file): the first
# targets as the ARM64 VM and scripts/vm.sh run them. Python 3's standard
# library only: it runs on the build host (phoenix-device-config.bb) and on
# the Mac or Linux computer that starts the VM (scripts/vm.sh).
#
#   device-profiles.py list [TABLE]
#       the profiles' ids, one a line
#   device-profiles.py get ID FIELD [TABLE]
#       one value: name, config, cpus, memoryMiB, width, height, orientation,
#       diagonal; exits 2 for an unknown id or field
#   device-profiles.py install FILES DEST [TABLE]
#       for the VM image: DEST/<id>/device.json (FILES/<config>/device.json)
#       and DEST/<id>/compositor.env (the panel's geometry, upright, as
#       virtio-gpu shows it: no turn; and the pointer's cursor shown), and
#       DEST/default/ from FILES/'s own device.json and compositor.env
#       (everything detected)
#
# TABLE defaults to device-profiles.json beside this file.

import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load(table):
    with open(table or os.path.join(HERE, "device-profiles.json")) as f:
        profiles = json.load(f)["profiles"]
    ids = [p["id"] for p in profiles]
    if len(set(ids)) != len(ids):
        raise SystemExit("device-profiles.json: an id is there twice")
    return profiles


def find(profiles, pid):
    for p in profiles:
        if p["id"] == pid:
            return p
    sys.stderr.write("no device profile \"%s\"; there are: %s\n" % (pid, " ".join(p["id"] for p in profiles)))
    raise SystemExit(2)


def field(p, name):
    if name in ("width", "height"):
        return p["panel"][name]
    if name in ("name", "config", "cpus", "memoryMiB", "orientation", "diagonal"):
        return p[name]
    sys.stderr.write("no field \"%s\"\n" % name)
    raise SystemExit(2)


def geometry(p):
    return "%dx%d+0+0r0s1" % (p["panel"]["width"], p["panel"]["height"])


def install(files, dest, profiles):
    os.makedirs(os.path.join(dest, "default"), exist_ok=True)
    shutil.copyfile(os.path.join(files, "device.json"), os.path.join(dest, "default", "device.json"))
    shutil.copyfile(os.path.join(files, "compositor.env"), os.path.join(dest, "default", "compositor.env"))
    for p in profiles:
        d = os.path.join(dest, p["id"])
        os.makedirs(d, exist_ok=True)
        src = os.path.join(files, p["config"], "device.json")
        with open(src) as f:
            json.load(f)  # a broken device.json fails the build, not the boot
        shutil.copyfile(src, os.path.join(d, "device.json"))
        with open(os.path.join(d, "compositor.env"), "w") as f:
            f.write("# %s in the ARM64 VM (phoenix-vm-arm64): the panel, upright, as\n"
                    "# virtio-gpu shows it (device-profiles.py).\n"
                    "export WEBOS_COMPOSITOR_GEOMETRY=%s\n"
                    "# The VM is driven with a mouse or a trackpad as often as by touch:\n"
                    "# the pointer's cursor shows (product.env hides it on the devices).\n"
                    "unset WEBOS_CURSOR_HIDE\n" % (p["name"], geometry(p)))


def main(argv):
    if len(argv) >= 2 and argv[1] == "list" and len(argv) <= 3:
        for p in load(argv[2] if len(argv) == 3 else None):
            print(p["id"])
    elif len(argv) >= 4 and argv[1] == "get" and len(argv) <= 5:
        print(field(find(load(argv[4] if len(argv) == 5 else None), argv[2]), argv[3]))
    elif len(argv) >= 4 and argv[1] == "install" and len(argv) <= 5:
        install(argv[2], argv[3], load(argv[4] if len(argv) == 5 else None))
    else:
        sys.stderr.write("usage: device-profiles.py list | get ID FIELD | install FILES DEST [TABLE]\n")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
