#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# scripts/make-vm-packages.sh (docs/VIRTUALIZATION.md): every target, for an
# arm64 and an x86-64 disk, from a stand-in disk. Each converted disk is
# checked by qemu-img and compared with the source block for block; each
# hypervisor's config is parsed and held to the disk it names, the firmware
# (EFI), the controller the kernel has built in (phoenix-vm-hypervisors.cfg)
# and the disk's architecture; the OVA's tar order, manifest and OVF; the
# libvirt domain against libvirt's schema where virt-xml-validate is there;
# the shell scripts with sh -n; SHA256SUMS; --dry-run writes nothing.
#
#   python3 tools/test-make-vm-packages.py
#   python3 tools/test-make-vm-packages.py --boot DISK.wic --arch arm64|x86-64
#                                         [--targets T,T] [--timeout S]
#
# --boot makes each target from DISK (any UEFI-bootable disk; the image's
# .wic, or a stand-in such as Debian's nocloud image as raw) and starts its
# converted disk under QEMU with UEFI firmware (AAVMF or OVMF, from
# qemu-efi-aarch64 / ovmf) on the controller that target's config gives it
# (NVMe for VMware and Parallels, AHCI for the OVA (NVMe on arm64), virtio-scsi for
# VirtualBox and Proxmox, virtio-blk for libvirt and raw; Hyper-V's storvsc
# has no QEMU model, so its VHDX goes on virtio-blk), until the serial
# console shows a login prompt (or "phoenix" in the journal's console
# lines: the image's own). One target at a time, deleted after its boot.

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import xml.etree.ElementTree as ET

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAKE = os.path.join(REPO, "scripts", "make-vm-packages.sh")
QEMU_IMG = os.environ.get("PHOENIX_QEMU_IMG", "qemu-img")
ALL = ["vmware", "ova", "virtualbox", "parallels", "libvirt", "proxmox", "hyperv", "raw"]
failures = []
checks = 0


def check(name, ok, detail=""):
    global checks
    checks += 1
    if not ok:
        failures.append(name)
        print("FAIL %s%s" % (name, (": " + detail) if detail else ""))
    return ok


def run(cmd, **kw):
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, **kw)


def make(disk, out, arch, targets=(), extra=()):
    return run(["sh", MAKE, "--disk", disk, "--arch", arch, "--name", "t", "--out", out, *extra, *targets])


def img_info(path, fmt=None):
    r = run([QEMU_IMG, "info", "--output=json"] + (["-f", fmt] if fmt else []) + [path])
    return json.loads(r.stdout) if r.returncode == 0 else {}


def same(src, fmt, out, name):
    """qemu-img check (where the format has one) and compare with the source."""
    info = img_info(out, fmt)
    check(name + ": format", info.get("format") == fmt, str(info.get("format")))
    check(name + ": size", info.get("virtual-size") == os.path.getsize(src),
          "%s vs %s" % (info.get("virtual-size"), os.path.getsize(src)))
    if fmt != "raw":
        r = run([QEMU_IMG, "check", "-f", fmt, out])
        check(name + ": qemu-img check", r.returncode == 0, r.stdout.strip()[-300:])
    r = run([QEMU_IMG, "compare", "-f", "raw", "-F", fmt, src, out])
    check(name + ": same blocks as the source", r.returncode == 0, r.stdout.strip()[-300:])
    return info


def sh_ok(path, name):
    r = run(["sh", "-n", path])
    check(name + ": sh -n", r.returncode == 0, r.stdout)
    check(name + ": executable", os.access(path, os.X_OK))


def standin(path, size=64 << 20):
    """A disk with data in a few places and holes between: what a
    conversion must keep, block for block."""
    with open(path, "wb") as f:
        f.truncate(size)
        for off in (0, 1 << 20, 17 << 20 | 4096, size - 65536):
            f.seek(off)
            f.write(hashlib.sha256(str(off).encode()).digest() * 2048)


def vmx(path):
    d = {}
    for line in open(path, encoding="utf-8"):
        m = re.match(r'^([A-Za-z0-9_.:]+) = "(.*)"$', line.rstrip("\n"))
        if check("vmx: line %r" % line.strip(), bool(m)):
            d[m.group(1)] = m.group(2)
    return d


def test_packages(tmp, arch):
    disk = os.path.join(tmp, "disk-%s.wic" % arch)
    standin(disk)
    out = os.path.join(tmp, "out-" + arch)
    r = make(disk, out, arch)
    if not check("%s: make-vm-packages runs" % arch, r.returncode == 0, r.stdout[-800:]):
        return
    A = arch

    # VMware
    p = os.path.join(out, "Phoenix-t-vmware.vmwarevm")
    info = same(disk, "vmdk", os.path.join(p, "phoenix.vmdk"), A + " vmware")
    check(A + " vmware: monolithic sparse",
          info.get("format-specific", {}).get("data", {}).get("create-type") == "monolithicSparse")
    v = vmx(os.path.join(p, "phoenix.vmx"))
    check(A + " vmware: EFI", v.get("firmware") == "efi")
    check(A + " vmware: no Secure Boot", v.get("uefi.secureBoot.enabled") == "FALSE")
    check(A + " vmware: the disk on NVMe", v.get("nvme0:0.fileName") == "phoenix.vmdk" and v.get("nvme0.present") == "TRUE")
    check(A + " vmware: guest type", v.get("guestOS") == ("arm-other6xlinux-64" if arch == "arm64" else "other6xlinux-64"),
          v.get("guestOS", ""))

    # OVA
    ova = os.path.join(out, "Phoenix-t.ova")
    with tarfile.open(ova) as t:
        names = t.getnames()
        check(A + " ova: the OVF first, then the manifest, then the disk",
              names == ["Phoenix-t.ovf", "Phoenix-t.mf", "phoenix-disk1.vmdk"], str(names))
        check(A + " ova: ustar", all(m.isfile() and len(m.name) < 100 for m in t.getmembers()))
        ovf = t.extractfile("Phoenix-t.ovf").read()
        mf = t.extractfile("Phoenix-t.mf").read().decode()
        vmdk = os.path.join(tmp, "ova-%s.vmdk" % arch)
        with open(vmdk, "wb") as f:
            shutil.copyfileobj(t.extractfile("phoenix-disk1.vmdk"), f)
    want = {"Phoenix-t.ovf": hashlib.sha256(ovf).hexdigest(),
            "phoenix-disk1.vmdk": hashlib.sha256(open(vmdk, "rb").read()).hexdigest()}
    got = dict(re.findall(r"^SHA256\(([^)]+)\)= ([0-9a-f]{64})$", mf, re.M))
    check(A + " ova: the manifest's SHA256s", got == want, mf)
    ns = {"o": "http://schemas.dmtf.org/ovf/envelope/1",
          "rasd": "http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ResourceAllocationSettingData",
          "vmw": "http://www.vmware.com/schema/ovf"}
    O = "{%s}" % ns["o"]
    env = ET.fromstring(ovf)
    fi = env.find("o:References/o:File", ns)
    check(A + " ova: References name the disk with its size",
          fi.get(O + "href") == "phoenix-disk1.vmdk" and int(fi.get(O + "size")) == os.path.getsize(vmdk))
    dk = env.find("o:DiskSection/o:Disk", ns)
    check(A + " ova: the disk's capacity", int(dk.get(O + "capacity")) == os.path.getsize(disk)
          and dk.get(O + "fileRef") == fi.get(O + "id"))
    check(A + " ova: stream-optimized", dk.get(O + "format").endswith("#streamOptimized"))
    items = env.findall("o:VirtualSystem/o:VirtualHardwareSection/o:Item", ns)
    by = {}
    for it in items:
        by.setdefault(it.find("rasd:ResourceType", ns).text, []).append(it)
    ids = [it.find("rasd:InstanceID", ns).text for it in items]
    check(A + " ova: InstanceIDs unique", len(ids) == len(set(ids)))
    ctl = by.get("20", [None])[0]
    check(A + " ova: the controller (AHCI; NVMe for arm64, whose UEFI has no AHCI)", ctl is not None and
          ctl.find("rasd:ResourceSubType", ns).text == ("vmware.nvme.controller" if arch == "arm64" else "AHCI"))
    hd = by.get("17", [None])[0]
    check(A + " ova: the disk on it", hd is not None and hd.find("rasd:Parent", ns).text == ctl.find("rasd:InstanceID", ns).text
          and hd.find("rasd:HostResource", ns).text == "ovf:/disk/" + dk.get(O + "diskId"))
    check(A + " ova: CPUs and memory", by["3"][0].find("rasd:VirtualQuantity", ns).text == "4"
          and by["4"][0].find("rasd:VirtualQuantity", ns).text == "4096")
    fw = [c.get("{%s}value" % ns["vmw"]) for c in env.iter("{%s}Config" % ns["vmw"]) if c.get("{%s}key" % ns["vmw"]) == "firmware"]
    check(A + " ova: EFI", fw == ["efi"])
    info = same(disk, "vmdk", vmdk, A + " ova")
    check(A + " ova: VMDK stream-optimized",
          info.get("format-specific", {}).get("data", {}).get("create-type") == "streamOptimized")
    os.remove(vmdk)

    # VirtualBox
    p = os.path.join(out, "Phoenix-t-virtualbox")
    same(disk, "vdi", os.path.join(p, "phoenix.vdi"), A + " virtualbox")
    s = os.path.join(p, "install-virtualbox.sh")
    sh_ok(s, A + " virtualbox")
    txt = open(s).read()
    check(A + " virtualbox: platform", ("--platform-architecture " + ("arm" if arch == "arm64" else "x86")) in txt)
    check(A + " virtualbox: EFI, virtio-scsi", "--firmware efi" in txt and "--add virtio" in txt)
    check(A + " virtualbox: a COM1 port only on x86", ("--uart1" in txt) == (arch == "x86-64"))

    # Parallels
    p = os.path.join(out, "Phoenix-t-parallels")
    hdd = os.path.join(p, "phoenix.hdd")
    dd = ET.parse(os.path.join(hdd, "DiskDescriptor.xml")).getroot()
    sectors = int(dd.findtext("Disk_Parameters/Disk_size"))
    check(A + " parallels: the descriptor's size", sectors * 512 == os.path.getsize(disk))
    check(A + " parallels: its geometry", int(dd.findtext("Disk_Parameters/Cylinders")) == sectors // (16 * 32))
    check(A + " parallels: one storage over the disk", dd.findtext("StorageData/Storage/End") == str(sectors))
    guid = dd.findtext("StorageData/Storage/Image/GUID")
    check(A + " parallels: the image is the top snapshot", guid == dd.findtext("Snapshots/Shot/GUID"))
    hds = dd.findtext("StorageData/Storage/Image/File")
    check(A + " parallels: the image beside it", os.listdir(hdd) == sorted(["DiskDescriptor.xml", hds]) or
          sorted(os.listdir(hdd)) == sorted(["DiskDescriptor.xml", hds]))
    same(disk, "parallels", os.path.join(hdd, hds), A + " parallels")
    sh_ok(os.path.join(p, "install-parallels.sh"), A + " parallels")
    txt = open(os.path.join(p, "install-parallels.sh")).read()
    check(A + " parallels: EFI, NVMe", "--efi-boot on" in txt and "--iface nvme" in txt)

    # libvirt
    p = os.path.join(out, "Phoenix-t-libvirt")
    same(disk, "qcow2", os.path.join(p, "phoenix.qcow2"), A + " libvirt")
    x = open(os.path.join(p, "phoenix.xml")).read().replace("@DISK@", "/var/lib/libvirt/images/phoenix-t.qcow2")
    dom = ET.fromstring(x)
    ty = dom.find("os/type")
    check(A + " libvirt: arch and machine", (ty.get("arch"), ty.get("machine")) ==
          (("aarch64", "virt") if arch == "arm64" else ("x86_64", "q35")))
    check(A + " libvirt: EFI", dom.find("os").get("firmware") == "efi")
    check(A + " libvirt: virtio-blk", dom.find("devices/disk/target").get("bus") == "virtio")
    if shutil.which("virt-xml-validate"):
        f = os.path.join(tmp, "dom-%s.xml" % arch)
        open(f, "w").write(x)
        r = run(["virt-xml-validate", f, "domain"])
        check(A + " libvirt: libvirt's domain schema", r.returncode == 0, r.stdout)
    sh_ok(os.path.join(p, "install.sh"), A + " libvirt")

    # Proxmox
    p = os.path.join(out, "Phoenix-t-proxmox")
    same(disk, "qcow2", os.path.join(p, "phoenix.qcow2"), A + " proxmox")
    s = os.path.join(p, "install-proxmox.sh")
    sh_ok(s, A + " proxmox")
    txt = open(s).read()
    check(A + " proxmox: OVMF, virtio-scsi, the disk imported",
          "--bios ovmf" in txt and "virtio-scsi-pci" in txt and "import-from=" in txt)
    check(A + " proxmox: the architecture", ("--arch aarch64" in txt) == (arch == "arm64") and
          ("--machine q35" in txt) == (arch == "x86-64"))

    # Hyper-V
    p = os.path.join(out, "Phoenix-t-hyperv")
    info = same(disk, "vhdx", os.path.join(p, "phoenix.vhdx"), A + " hyperv")
    txt = open(os.path.join(p, "Install-Phoenix.ps1")).read()
    check(A + " hyperv: Generation 2, Secure Boot off", "-Generation 2" in txt and "-EnableSecureBoot Off" in txt)

    # raw
    same(disk, "raw", os.path.join(out, "Phoenix-t-raw", "disk.img"), A + " raw")

    # SHA256SUMS: every file made, each sum right
    lines = open(os.path.join(out, "SHA256SUMS")).read().split("\n")
    sums = dict((l.split("  ", 1)[1], l.split("  ", 1)[0]) for l in lines if l)
    made = sorted(os.path.relpath(os.path.join(d, f), out) for d, _, fs in os.walk(out) for f in fs if f != "SHA256SUMS")
    check(A + " SHA256SUMS: every file", sorted(sums) == made, "%s vs %s" % (sorted(sums), made))
    bad = [f for f, h in sums.items() if hashlib.sha256(open(os.path.join(out, f), "rb").read()).hexdigest() != h]
    check(A + " SHA256SUMS: right", not bad, str(bad))

    # Again without --force: refused, nothing changed; with it: made anew
    r = make(disk, out, arch, ["vmware"])
    check(A + " a package already there is refused", r.returncode != 0 and "--force" in r.stdout)
    r = make(disk, out, arch, ["vmware", "ova"], ["--force"])
    check(A + " --force makes it anew", r.returncode == 0, r.stdout[-400:])
    shutil.rmtree(out)


def test_cli(tmp):
    disk = os.path.join(tmp, "phoenix-vm-x86-64.wic")
    standin(disk, 4 << 20)
    out = os.path.join(tmp, "dry")
    r = run(["sh", MAKE, "--disk", disk, "--out", out, "--dry-run"])
    check("dry run: succeeds", r.returncode == 0, r.stdout[-400:])
    check("dry run: writes nothing", not os.path.exists(out))
    check("dry run: names every target", all(("Phoenix-phoenix-" + t) in r.stdout or (t == "ova" and "Phoenix-phoenix.ova" in r.stdout)
                                             for t in ALL), r.stdout[:600])
    check("the architecture from the name", "x86-64" in r.stdout and "other6xlinux-64" in r.stdout
          and "arm-other6xlinux-64" not in r.stdout)
    r = run(["sh", MAKE, "--disk", disk, "nosuch"])
    check("an unknown target is refused", r.returncode != 0 and "unknown target" in r.stdout)
    r = run(["sh", MAKE, "--disk", os.path.join(tmp, "missing.wic")])
    check("a missing disk is refused", r.returncode != 0 and "no disk" in r.stdout)
    r = run(["sh", MAKE, "--disk", disk, "--arch", "riscv64"])
    check("an unknown architecture is refused", r.returncode != 0)
    r = run(["sh", MAKE, "--help"])
    check("--help is the header", r.returncode == 0 and "TARGET" in r.stdout and "qemu-img" in r.stdout
          and "set -eu" not in r.stdout)


# ---- --boot: each converted disk under QEMU with UEFI ----------------------------

FIRMWARE = {
    "arm64": ("qemu-system-aarch64", ["/usr/share/AAVMF/AAVMF_CODE.no-secboot.fd", "/usr/share/AAVMF/AAVMF_CODE.fd",
                                       "/opt/homebrew/share/qemu/edk2-aarch64-code.fd", "/usr/local/share/qemu/edk2-aarch64-code.fd"]),
    "x86-64": ("qemu-system-x86_64", ["/usr/share/OVMF/OVMF_CODE_4M.fd", "/usr/share/OVMF/OVMF_CODE.fd",
                                      "/opt/homebrew/share/qemu/edk2-x86_64-code.fd"]),
}
# target: (the converted disk in its package, its format, QEMU's controller)
BOOT = {
    "vmware": ("Phoenix-t-vmware.vmwarevm/phoenix.vmdk", "vmdk", "nvme"),
    "ova": (None, "vmdk", "ahci"),  # nvme for arm64: boot() below
    "virtualbox": ("Phoenix-t-virtualbox/phoenix.vdi", "vdi", "virtio-scsi"),
    "parallels": (None, "parallels", "nvme"),
    "libvirt": ("Phoenix-t-libvirt/phoenix.qcow2", "qcow2", "virtio-blk"),
    "proxmox": ("Phoenix-t-proxmox/phoenix.qcow2", "qcow2", "virtio-scsi"),
    "hyperv": ("Phoenix-t-hyperv/phoenix.vhdx", "vhdx", "virtio-blk"),
    "raw": ("Phoenix-t-raw/disk.img", "raw", "virtio-blk"),
}


def boot(disk, arch, targets, timeout, keep):
    qemu, fws = FIRMWARE[arch]
    fw = next((f for f in fws if os.path.exists(f)), None)
    if not check("boot: UEFI firmware for " + arch, fw is not None, "install qemu-efi-aarch64 / ovmf"):
        return
    work = tempfile.mkdtemp(prefix="vmboot-", dir=os.path.dirname(os.path.abspath(disk)))
    results = []
    try:
        for t in targets:
            out = os.path.join(work, t)
            r = make(disk, out, arch, [t])
            if not check("boot %s: made" % t, r.returncode == 0, r.stdout[-400:]):
                continue
            rel, fmt, ctl = BOOT[t]
            if t == "ova" and arch == "arm64":
                ctl = "nvme"
            if t == "ova":
                with tarfile.open(os.path.join(out, "Phoenix-t.ova")) as tf:
                    tf.extract("phoenix-disk1.vmdk", out)
                path = os.path.join(out, "phoenix-disk1.vmdk")
            elif t == "parallels":
                hdd = os.path.join(out, "Phoenix-t-parallels", "phoenix.hdd")
                path = os.path.join(hdd, ET.parse(os.path.join(hdd, "DiskDescriptor.xml")).findtext("StorageData/Storage/Image/File"))
            else:
                path = os.path.join(out, rel)
            # The disk first (bootindex), as each hypervisor's config has
            # it, not the network card's PXE. A throwaway overlay: the boot writes, the package stays as made.
            ov = os.path.join(out, "boot.qcow2")
            run([QEMU_IMG, "create", "-q", "-f", "qcow2", "-F", fmt, "-b", path, ov])
            vars_ = os.path.join(out, "vars.fd")
            with open(vars_, "wb") as f:
                f.truncate(os.path.getsize(fw))
            serial = os.path.join(out, "serial.log")
            if arch == "arm64":
                cmd = [qemu, "-machine", "virt", "-cpu", "max", "-smp", "2", "-m", "2048"]
            else:
                cmd = [qemu, "-machine", "q35", "-cpu", "max", "-smp", "2", "-m", "2048"]
            cmd += ["-accel", "tcg,thread=multi", "-nographic", "-monitor", "none", "-serial", "file:" + serial,
                    "-drive", "if=pflash,format=raw,readonly=on,file=" + fw,
                    "-drive", "if=pflash,format=raw,file=" + vars_,
                    "-drive", "if=none,id=d0,format=qcow2,file=" + ov,
                    "-netdev", "user,id=n0", "-device", "virtio-net-pci,netdev=n0,romfile="]
            cmd += {"nvme": ["-device", "nvme,serial=phoenix0,drive=d0,bootindex=0"],
                    "ahci": ["-device", "ich9-ahci,id=sata", "-device", "ide-hd,bus=sata.0,drive=d0,bootindex=0"],
                    "virtio-scsi": ["-device", "virtio-scsi-pci,id=scsi", "-device", "scsi-hd,bus=scsi.0,drive=d0,bootindex=0"],
                    "virtio-blk": ["-device", "virtio-blk-pci,drive=d0,bootindex=0"]}[ctl]
            t0 = time.time()
            q = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            ok = False
            try:
                while time.time() - t0 < timeout and q.poll() is None:
                    time.sleep(2)
                    log = open(serial, errors="replace").read() if os.path.exists(serial) else ""
                    if re.search(r"login: *$", log, re.M) or "webOS Phoenix: slot" in log and "Reached target" in log:
                        ok = True
                        break
            finally:
                q.kill()
                q.wait()
            secs = time.time() - t0
            log = open(serial, errors="replace").read() if os.path.exists(serial) else ""
            dev = sorted(set(re.findall(r"\b(nvme0n1|sda|vda)\b", log)))
            results.append((t, fmt, ctl, ok, round(secs), dev))
            check("boot %s (%s on %s): to a login prompt in %ds" % (t, fmt, ctl, secs), ok,
                  "the serial console's end: " + log[-600:].replace("\n", " | "))
            if keep:
                shutil.copy(serial, os.path.join(keep, "serial-%s-%s.log" % (arch, t)))
            shutil.rmtree(out)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print("\nboot results (%s, %s):" % (arch, os.path.basename(disk)))
    for t, fmt, ctl, ok, secs, dev in results:
        print("  %-10s %-9s %-11s %-5s %4ds  %s" % (t, fmt, ctl, "ok" if ok else "FAIL", secs, ",".join(dev)))


def main():
    sys.stdout.reconfigure(line_buffering=True)  # a long --boot shows each result as it comes
    ap = argparse.ArgumentParser()
    ap.add_argument("--boot", metavar="DISK")
    ap.add_argument("--arch", choices=["arm64", "x86-64"], default="arm64")
    ap.add_argument("--targets", default=",".join(ALL))
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--keep-logs", metavar="DIR")
    a = ap.parse_args()
    if not shutil.which(QEMU_IMG):
        print("test-make-vm-packages: needs qemu-img (qemu-utils; brew install qemu)")
        return 1
    if a.boot:
        ts = [t for t in a.targets.split(",") if t]
        bad = [t for t in ts if t not in BOOT]
        if bad:
            print("unknown targets: " + ",".join(bad))
            return 2
        boot(a.boot, a.arch, ts, a.timeout, a.keep_logs)
    else:
        with tempfile.TemporaryDirectory() as tmp:
            test_cli(tmp)
            for arch in ("arm64", "x86-64"):
                test_packages(tmp, arch)
    print("\n%d checks, %d failed" % (checks, len(failures)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
