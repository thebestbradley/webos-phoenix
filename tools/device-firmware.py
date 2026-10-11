#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""The firmware a phone brings with it, put into a Phoenix image at install.

Qualcomm phones' DSP, modem, Wi-Fi, Bluetooth, GPU and video firmware is the
maker's, signed for that phone, and comes with no licence to redistribute it,
so Phoenix's images do not carry it (docs/LEGAL.md, "Firmware and drivers";
docs/HARDWARE.md, "Firmware the phone brings"). This takes it from the
owner's own copy (the maker's factory image, or a folder copied off the
device) at install time, lays it out where the device tree asks for it, and
writes it into the root image before it is flashed.

  tools/device-firmware.py extract fairphone-fp6 --factory-zip FP6-....zip --out DIR
  tools/device-firmware.py extract ayn-odin2portal --from-dir BLOBS --out DIR
  tools/device-firmware.py inject --image webos-phoenix-image-<machine>.ext4 --firmware DIR

extract writes DIR/<path under /lib/firmware>. inject copies DIR into the
ext4 image's /lib/firmware/updates (the kernel looks there first) with
debugfs, as root:root 0644; no root rights, no mounting.

fairphone-fp6 reads what FairBlobs/FP6-firmware's extract.sh (cb1e77c) reads
from the factory zip: images/NON-HLOS.bin (the modem partition: FAT, read
with mtools' mcopy), images/BTFM.bin (Bluetooth, FAT) and images/super.img
(vendor_a's firmware/, through simg2img, lpunpack and debugfs or
fsck.erofs), and installs it where postmarketOS's firmware-fairphone-fp6
(pmaports 2116628) does and the device tree (milos-fairphone-fp6.dts) asks.
Split firmware (name.mdt + name.bNN) is joined into name.mbn as
linux-msm's pil-squasher does.

Host tools: unzip is not needed (Python's zipfile); mtools (mcopy),
android-sdk-libsparse-utils (simg2img), lpunpack (android-tools or
otatools), e2fsprogs (debugfs), erofs-utils (fsck.erofs) when vendor is
EROFS.

STATUS: written, not run against a real factory image yet
(docs/PRE-IMAGE-CHECKLIST.md, H5).
"""

import argparse
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile

FP6_DIR = "qcom/milos/fairphone/fp6"

# Odin 2 Portal: the device tree's firmware-name properties
# (qcs8550-ayn-common.dtsi, qcs8550-ayn-odin2portal.dts in AYN's ayn/v7.0)
# and the Adreno 740's microcode (the msm driver's names; also in
# linux-firmware, under LICENSE.qcom).
ODIN2PORTAL = {
    "a740_zap.mbn": "qcom/sm8550/ayn/a740_zap.mbn",
    "cdsp.mbn": "qcom/sm8550/ayn/cdsp.mbn",
    "cdsp_dtb.mbn": "qcom/sm8550/ayn/cdsp_dtb.mbn",
    "adsp.mbn": "qcom/sm8550/ayn/odin2portal/adsp.mbn",
    "adsp_dtb.mbn": "qcom/sm8550/ayn/odin2portal/adsp_dtb.mbn",
    "aw883xx_acf.bin": "qcom/sm8550/ayn/odin2portal/aw883xx_acf.bin",
    "a740_sqe.fw": "qcom/a740_sqe.fw",
    "gmu_gen70200.bin": "qcom/gmu_gen70200.bin",
}


def die(msg):
    sys.exit("device-firmware: " + msg)


def run(*cmd, **kw):
    try:
        return subprocess.run(list(cmd), check=True, capture_output=True, text=True, **kw)
    except FileNotFoundError:
        die("%s is not installed (see --help for the host tools)" % cmd[0])
    except subprocess.CalledProcessError as e:
        die("%s failed: %s" % (" ".join(cmd), (e.stderr or e.stdout).strip()[-400:]))


def squash(mdt, out):
    """name.mdt + name.bNN -> one ELF, each segment at its file offset.

    linux-msm/pil-squasher (pil-squasher.c): the .mdt holds the ELF header
    and program headers; segment i with p_filesz > 0 is name.b<i> (two
    digits), written at p_offset.
    """
    with open(mdt, "rb") as f:
        head = f.read()
    if head[:4] != b"\x7fELF":
        die("%s is not an ELF file" % mdt)
    is64 = head[4] == 2
    little = head[5] == 1
    e = "<" if little else ">"
    if is64:
        phoff, = struct.unpack_from(e + "Q", head, 0x20)
        phentsize, phnum = struct.unpack_from(e + "HH", head, 0x36)
    else:
        phoff, = struct.unpack_from(e + "I", head, 0x1C)
        phentsize, phnum = struct.unpack_from(e + "HH", head, 0x2A)
    base = mdt[:-len(".mdt")]
    with open(out, "wb") as o:
        o.write(head)
        for i in range(phnum):
            at = phoff + i * phentsize
            if is64:
                _, _, offset, _, _, filesz = struct.unpack_from(e + "IIQQQQ", head, at)
            else:
                _, offset, _, _, filesz = struct.unpack_from(e + "IIIII", head, at)
            if not filesz:
                continue
            seg = "%s.b%02d" % (base, i)
            if not os.path.exists(seg):
                if i == 0 or offset + filesz <= len(head):
                    continue  # the headers (and a hash segment) already in the .mdt
                die("%s: segment %d (%d bytes) has no %s" % (mdt, i, filesz, os.path.basename(seg)))
            with open(seg, "rb") as s:
                data = s.read()
            o.seek(offset)
            o.write(data)


def place(src, out, rel):
    dst = os.path.join(out, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, dst)


def place_blob(folder, name, out, reldir):
    """name (.mbn as is, or .mdt + .bNN joined) from folder into out/reldir/<stem>.mbn."""
    stem, ext = os.path.splitext(name)
    mbn, mdt = os.path.join(folder, stem + ".mbn"), os.path.join(folder, stem + ".mdt")
    dst = os.path.join(out, reldir, stem + ".mbn")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.exists(mbn):
        shutil.copyfile(mbn, dst)
    elif os.path.exists(mdt):
        squash(mdt, dst)
    else:
        die("%s: neither %s.mbn nor %s.mdt" % (folder, stem, stem))


def mcopy_all(img, src, dest):
    """Copy a FAT image's directory (mtools, no mounting)."""
    os.makedirs(dest, exist_ok=True)
    run("mcopy", "-s", "-n", "-i", img, "::" + src + "/", dest + "/")


def vendor_firmware(super_img, work):
    raw = os.path.join(work, "super.raw")
    with open(super_img, "rb") as f:
        sparse = f.read(4) == b"\x3a\xff\x26\xed"
    if sparse:
        run("simg2img", super_img, raw)
    else:
        raw = super_img
    parts = os.path.join(work, "lp")
    os.makedirs(parts, exist_ok=True)
    run("lpunpack", "--partition=vendor_a", raw, parts)
    vendor = os.path.join(parts, "vendor_a.img")
    dest = os.path.join(work, "vendor")
    os.makedirs(dest, exist_ok=True)
    with open(vendor, "rb") as f:
        f.seek(1024)
        erofs = f.read(4) == b"\xe2\xe1\xf5\xe0"
    if erofs:
        run("fsck.erofs", "--extract=" + dest, vendor)
        return os.path.join(dest, "firmware")
    run("debugfs", "-R", "rdump /firmware " + dest, vendor)
    return os.path.join(dest, "firmware")


def extract_fp6(zip_path, out):
    with tempfile.TemporaryDirectory() as work, zipfile.ZipFile(zip_path) as z:
        want = {"NON-HLOS.bin", "BTFM.bin", "super.img"}
        got = {}
        for info in z.infolist():
            name = os.path.basename(info.filename)
            if name in want and "/images/" in "/" + info.filename:
                got[name] = z.extract(info, work)
        missing = want - set(got)
        if missing:
            die("%s has no images/%s: is it Fairphone's factory image for the FP6?" % (zip_path, ", ".join(sorted(missing))))
        modem = os.path.join(work, "modem")
        mcopy_all(got["NON-HLOS.bin"], "/image", modem)
        img = os.path.join(modem, "image")
        for blob in ("adsp", "adsp_dtb", "cdsp", "cdsp_dtb", "ipa_fws", "modem"):
            place_blob(img, blob + ".mdt", out, FP6_DIR)
        place_blob(os.path.join(img, "qca6750"), "wpss.mdt", out, FP6_DIR)
        for name in sorted(os.listdir(img)):
            if name.endswith(".jsn") and name.startswith(("adsp", "cdsp", "modem", "battmgr")):
                place(os.path.join(img, name), out, os.path.join(FP6_DIR, name))
        if os.path.isdir(os.path.join(img, "modem_pr")):
            shutil.copytree(os.path.join(img, "modem_pr"), os.path.join(out, FP6_DIR, "modem_pr"), dirs_exist_ok=True)
        bt = os.path.join(work, "bt")
        mcopy_all(got["BTFM.bin"], "/image", bt)
        for name in ("msbtfw12.mbn", "msnv12.bin"):
            place(os.path.join(bt, "image", name), out, os.path.join("qca", name))
        fw = vendor_firmware(got["super.img"], work)
        place(os.path.join(fw, "gen80300_zap.mbn"), out, os.path.join(FP6_DIR, "gen80300_zap.mbn"))
        place(os.path.join(fw, "vpu20_2v.mbn"), out, os.path.join(FP6_DIR, "vpu20_2v.mbn"))
        # The GPU's microcode: postmarketOS puts it on its own search path
        # until linux-firmware has it; the msm driver asks for qcom/<name>.
        for name in ("gen80300_gmu.bin", "gen80300_sqe.fw"):
            place(os.path.join(fw, name), out, os.path.join("qcom", name))


def extract_odin2portal(folder, out):
    for name, rel in ODIN2PORTAL.items():
        stem = os.path.splitext(name)[0]
        if name.endswith(".mbn") and not os.path.exists(os.path.join(folder, name)) \
                and os.path.exists(os.path.join(folder, stem + ".mdt")):
            dst = os.path.join(out, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            squash(os.path.join(folder, stem + ".mdt"), dst)
        elif os.path.exists(os.path.join(folder, name)):
            place(os.path.join(folder, name), out, rel)
        else:
            die("%s: %s (or %s.mdt) is missing" % (folder, name, stem))


def inject(image, firmware):
    cmds = []
    made = set()
    for d, _, files in sorted(os.walk(firmware)):
        rel = os.path.relpath(d, firmware)
        target = "/lib/firmware/updates" + ("" if rel == "." else "/" + rel.replace(os.sep, "/"))
        parts = target.strip("/").split("/")
        for i in range(1, len(parts) + 1):
            p = "/" + "/".join(parts[:i])
            if p not in made:
                cmds.append("mkdir %s" % p)  # an existing directory only warns
                made.add(p)
        for name in sorted(files):
            path = target + "/" + name
            cmds.append("rm %s" % path)  # a file from an earlier run only warns
            cmds.append("write %s %s" % (os.path.join(d, name), path))
            cmds.append("sif %s uid 0" % path)
            cmds.append("sif %s gid 0" % path)
            cmds.append("sif %s mode 0100644" % path)
    with tempfile.NamedTemporaryFile("w", suffix=".debugfs", delete=False) as f:
        f.write("\n".join(cmds) + "\n")
        script = f.name
    try:
        run("debugfs", "-w", "-f", script, image)
    finally:
        os.remove(script)
    print("%d files written into %s:/lib/firmware/updates" % (sum(c.startswith("write ") for c in cmds), image))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    ex = sub.add_parser("extract")
    ex.add_argument("machine", choices=["fairphone-fp6", "ayn-odin2portal"])
    ex.add_argument("--factory-zip")
    ex.add_argument("--from-dir")
    ex.add_argument("--out", required=True)
    ij = sub.add_parser("inject")
    ij.add_argument("--image", required=True)
    ij.add_argument("--firmware", required=True)
    a = ap.parse_args()
    if a.cmd == "extract":
        os.makedirs(a.out, exist_ok=True)
        if a.machine == "fairphone-fp6":
            if not a.factory_zip:
                die("fairphone-fp6 needs --factory-zip (Fairphone's factory image for the FP6)")
            extract_fp6(a.factory_zip, a.out)
        else:
            if not a.from_dir:
                die("ayn-odin2portal needs --from-dir (the blobs copied off the device)")
            extract_odin2portal(a.from_dir, a.out)
        print("firmware for %s in %s" % (a.machine, a.out))
    else:
        inject(a.image, a.firmware)


if __name__ == "__main__":
    main()
