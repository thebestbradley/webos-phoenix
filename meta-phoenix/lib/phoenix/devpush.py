# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Dev push at image time (docs/DEV-PUSH.md 8.1, 12 P3): the image's build id
# and its manifest, stamped from the image's own files. One copy for both:
# classes/phoenix-devpush.bbclass (the image's ROOTFS_POSTPROCESS_COMMAND)
# and tools/install-rootfs.py --stamp (its tests), which imports it from
# here. Standard library only.

import hashlib
import json
import os

MANIFEST = "/usr/share/phoenix/manifest.json"
OS_RELEASE = ("etc/os-release", "usr/lib/os-release")


def file_mode(st_mode):
    """0755 for an executable, else 0644: the only two a bundle carries."""
    return "0755" if st_mode & 0o111 else "0644"


def dump_manifest(m):
    return (json.dumps(m, indent=1, sort_keys=False) + "\n").encode("utf-8")


def _inside(rootfs, rel):
    """ROOTFS/rel with its links followed inside ROOTFS (/etc/os-release is
    a link to ../usr/lib/os-release in OE's images)."""
    path = os.path.join(rootfs, rel)
    for _ in range(8):
        if not os.path.islink(path):
            return path
        target = os.readlink(path)
        path = os.path.join(rootfs, target.lstrip("/")) if target.startswith("/") \
            else os.path.normpath(os.path.join(os.path.dirname(path), target))
    return path


def os_release_build(rootfs):
    """BUILD_ID from ROOTFS's /etc/os-release (or /usr/lib/os-release), or None."""
    for rel in OS_RELEASE:
        try:
            with open(_inside(rootfs, rel), encoding="utf-8") as f:
                for line in f:
                    k, _, v = line.strip().partition("=")
                    if k == "BUILD_ID" and v.strip().strip("\"'"):
                        return v.strip().strip("\"'")
        except OSError:
            continue
    return None


def set_build_id(rootfs, build):
    """BUILD_ID=build in ROOTFS's os-release (the file /etc/os-release is,
    or names), replacing one already there. OSE's and LuneOS's os-release
    carry none; the updates service (no older build) and novad (the
    overlay's build) read it. -> the file written, or None without one."""
    for rel in OS_RELEASE:
        path = _inside(rootfs, rel)
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as f:
            lines = [l for l in f.read().splitlines() if not l.startswith("BUILD_ID=")]
        lines.append('BUILD_ID="%s"' % build)
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        return path
    return None


def stamp(rootfs, build=None, compatible=None):
    """ROOTFS's manifest.json with each file's size, hash and mode read from
    the image's own copy (what other recipes changed after phoenix-apps
    installed it shows as it is; a file no longer there is dropped), and the
    image's build id. Raises ValueError without a manifest or a build id."""
    path = os.path.join(rootfs, MANIFEST.lstrip("/"))
    try:
        with open(path, encoding="utf-8") as f:
            m = json.load(f)
    except (OSError, ValueError) as e:
        raise ValueError("%s: %s" % (path, e))
    build = build or os_release_build(rootfs)
    if not build:
        raise ValueError("no BUILD_ID in %s/etc/os-release" % rootfs)
    files = []
    for f in m.get("files", []):
        full = os.path.join(rootfs, f["path"].lstrip("/"))
        if os.path.islink(full) or not os.path.isfile(full):
            continue
        with open(full, "rb") as fh:
            data = fh.read()
        files.append({"path": f["path"], "size": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                      "mode": file_mode(os.stat(full).st_mode)})
    m["build"] = build
    if compatible is not None:
        m["compatible"] = compatible
    m["files"] = files
    with open(path, "wb") as f:
        f.write(dump_manifest(m))
    return m


# Developer Mode's flag and OSE's markers beside it (com.palm.service.devmode
# devmode_service.js:20-27, 81-110 at 94b6921). OSE's recipe writes the flag
# into OSE images (com.palm.service.devmode.bb do_install:append:webos), so
# they start in Developer Mode; Phoenix's start with it off.
DEVMODE_FILES = ["var/luna/preferences/devmode_enabled"] + ["var/luna/preferences/dc%d" % i for i in range(10)]


def devmode_off(rootfs):
    """Developer Mode off in ROOTFS as built. -> the files removed."""
    gone = []
    for rel in DEVMODE_FILES:
        p = os.path.join(rootfs, rel)
        if os.path.lexists(p):
            os.remove(p)
            gone.append("/" + rel)
    return gone
