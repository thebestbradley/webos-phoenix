#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for tools/device-firmware.py: split firmware joined as pil-squasher
joins it, the Odin 2 Portal's layout, and the injection into an ext4 image
(when mke2fs and debugfs are installed).

    python3 tools/test-device-firmware.py
"""

import importlib.util
import os
import shutil
import struct
import subprocess
import sys
import tempfile

TOOLS = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("device_firmware", os.path.join(TOOLS, "device-firmware.py"))
df = importlib.util.module_from_spec(spec)
spec.loader.exec_module(df)

failures = []


def ok(cond, what):
    print("%s  %s" % ("ok  " if cond else "FAIL", what))
    if not cond:
        failures.append(what)


def elf64(segments):
    """An ELF64 header and program headers for (offset, filesz) segments."""
    phoff, phentsize = 64, 56
    ident = b"\x7fELF" + bytes([2, 1, 1]) + bytes(9)
    head = ident + struct.pack("<HHIQQQIHHHHHH", 2, 164, 1, 0, phoff, 0, 0, 64, phentsize, len(segments), 0, 0, 0)
    for off, size in segments:
        head += struct.pack("<IIQQQQQQ", 1, 0, off, 0, 0, size, size, 0x1000)
    return head


def main():
    with tempfile.TemporaryDirectory() as t:
        # Segment 0: the headers (in the .mdt); 1 and 2 in .b01 and .b02.
        head = elf64([(0, 64 + 3 * 56), (0x1000, 16), (0x2000, 8)])
        src = os.path.join(t, "src")
        os.makedirs(src)
        with open(os.path.join(src, "adsp.mdt"), "wb") as f:
            f.write(head)
        with open(os.path.join(src, "adsp.b01"), "wb") as f:
            f.write(b"H" * 16)
        with open(os.path.join(src, "adsp.b02"), "wb") as f:
            f.write(b"C" * 8)
        out = os.path.join(t, "adsp.mbn")
        df.squash(os.path.join(src, "adsp.mdt"), out)
        data = open(out, "rb").read()
        ok(data[:len(head)] == head, "the joined file starts with the ELF headers")
        ok(data[0x1000:0x1010] == b"H" * 16 and data[0x2000:0x2008] == b"C" * 8,
           "each segment sits at its p_offset")
        ok(len(data) == 0x2008, "and nothing follows the last one (%d bytes)" % len(data))

        # The Odin 2 Portal: .mbn as is, .mdt joined, each where the DT asks.
        blobs = os.path.join(t, "odin")
        os.makedirs(blobs)
        for name in df.ODIN2PORTAL:
            if name == "adsp.mbn":
                continue
            with open(os.path.join(blobs, name), "wb") as f:
                f.write(name.encode())
        for n in ("adsp.mdt", "adsp.b01", "adsp.b02"):
            shutil.copyfile(os.path.join(src, n), os.path.join(blobs, n))
        fw = os.path.join(t, "fw")
        df.extract_odin2portal(blobs, fw)
        ok(open(os.path.join(fw, "qcom/sm8550/ayn/odin2portal/adsp.mbn"), "rb").read() == data,
           "the Portal's adsp.mdt is joined into qcom/sm8550/ayn/odin2portal/adsp.mbn")
        ok(open(os.path.join(fw, "qcom/sm8550/ayn/a740_zap.mbn"), "rb").read() == b"a740_zap.mbn",
           "its zap shader goes to qcom/sm8550/ayn/a740_zap.mbn")

        # Injection into an ext4 image, as root:root 0644.
        if shutil.which("mke2fs") and shutil.which("debugfs"):
            img = os.path.join(t, "root.ext4")
            subprocess.run(["mke2fs", "-q", "-t", "ext4", "-F", img, "8M"], check=True)
            df.inject(img, fw)
            df.inject(img, fw)  # a second run replaces the files
            p = subprocess.run(["debugfs", "-R", "stat /lib/firmware/updates/qcom/sm8550/ayn/odin2portal/adsp.mbn", img],
                               capture_output=True, text=True)
            ok("User:     0   Group:     0" in p.stdout and "Mode:  0644" in p.stdout and
               ("Size: %d" % len(data)) in p.stdout, "inject writes the file into the image, root:root 0644")
        else:
            print("skip  injection (no mke2fs/debugfs)")

    print("\n%d failed" % len(failures) if failures else "\nall passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
