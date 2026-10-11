#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# scripts/make-utm.sh, the UTM bundles it makes, and tools/check-utm-bundle.py
# (docs/BUILDING-MAC.md, "Run it on an iPad with UTM"): every device and
# target as UTM decodes them, the same machine as scripts/vm.sh, the QEMU
# command UTM builds from them, and the script's errors.
#
#   python3 tools/test-make-utm.py
#   python3 tools/test-make-utm.py --boot KERNEL INITRAMFS
#
# --boot also starts bundles with qemu-system-aarch64 (8.2 or later, with
# its SPICE module) and the QEMU command UTM would build for an iPad, a
# stand-in for the image's kernel and root, and checks from inside the
# guest what it got: the command line, CPUs, memory, GICv3 at EL1, the
# panel's mode, the USB tablet and keyboard, the root disk as /dev/vda,
# sound, network. KERNEL is any ARM64 kernel with virtio-pci, INITRAMFS
# one with its modules and a busybox (Alpine's netboot vmlinuz-virt and
# initramfs-virt). Only what UTM's host side has and a container lacks is
# swapped: no -L or -S, files for the SPICE serial, no GL (no GPU here).

import gzip
import importlib.util
import os
import plistlib
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAKE = os.path.join(REPO, "scripts", "make-utm.sh")
VM_SH = os.path.join(REPO, "scripts", "vm.sh")
# check-utm-bundle.py, whose name is not a module's
spec = importlib.util.spec_from_file_location("check_utm_bundle", os.path.join(REPO, "tools", "check-utm-bundle.py"))
cub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cub)

# make-utm.sh makes a qcow2 disk when there is a qemu-img (PHOENIX_UTM_QEMU_IMG)
HAS_QEMU_IMG = shutil.which(os.environ.get("PHOENIX_UTM_QEMU_IMG", "qemu-img"))
IDS = ["fairphone-fp6", "ayn-odin2portal", "pinephonepro", "pinetab2", "raspberrypi4-64"]
failures = []
checks = 0


def check(name, ok, detail=""):
    global checks
    checks += 1
    if not ok:
        failures.append(name)
        print("FAIL %s%s" % (name, (": " + detail) if detail else ""))
    return ok


def run(cmd, env=None):
    e = dict(os.environ)
    e.update(env or {})
    p = subprocess.run(cmd, capture_output=True, text=True, env=e)
    return p.returncode, p.stdout, p.stderr


def make(args, env=None):
    return run(["sh", MAKE] + args, env)


def dry(args):
    """The plan's first line and config.plist, from --dry-run."""
    code, out, err = make(args + ["--dry-run"])
    if code != 0:
        return code, None, None, err
    i = out.index("<?xml")
    return code, out[:i], plistlib.loads(out[i:].encode()), err


def has(cmd, *seq):
    n = len(seq)
    return any(cmd[i:i + n] == list(seq) for i in range(len(cmd) - n + 1))


def after(cmd, flag):
    return [cmd[i + 1] for i in range(len(cmd) - 1) if cmd[i] == flag]


# vm.sh's command line for a device, which the bundle's must start with.
def vm_append(device):
    code, out, _ = run(["sh", VM_SH, device, "--dry-run"], {"PHOENIX_VM_HOST_OS": "Darwin",
                                                            "PHOENIX_VM_HOST_ARCH": "arm64", "XDG_STATE_HOME": "/state"})
    return after(shlex.split(out), "-append")[0] if code == 0 else None


def profile(device, field):
    return run(["python3", os.path.join(REPO, "meta-phoenix", "recipes-phoenix", "phoenix-device-config", "files",
                                        "device-profiles.py"), "get", device, field])[1].strip()


# ---- Every device, every target: what UTM reads -----------------------------
for device in IDS:
    w, h = profile(device, "width"), profile(device, "height")
    dev_cpus, dev_mem = int(profile(device, "cpus")), int(profile(device, "memoryMiB"))
    base = vm_append(device)
    for target in ("ipad", "ipad-se", "mac"):
        code, plan, config, err = dry([device, "--for", target, "--image", "/img"])
        tag = "%s --for %s" % (device, target)
        if not check("make-utm.sh %s: a plan" % tag, code == 0 and config is not None, err):
            continue
        faults = cub.check_config(config)
        check("%s: UTM 4.0 to 5.0.6 decode its config.plist" % tag, not faults, "; ".join(faults))
        user = cub.parse_user_arguments(config["QEMU"]["AdditionalArguments"])
        append = after(user, "-append")
        check("%s: one -append, one argument after UTM splits them" % tag, len(append) == 1, str(user))
        check("%s: the panel is virtio-gpu's mode" % tag,
              has(user, "-global", "virtio-gpu-gl-pci.xres=%s" % w) and has(user, "-global", "virtio-gpu-gl-pci.yres=%s" % h)
              and config["Display"][0]["Hardware"] == "virtio-gpu-gl-pci", str(user))
        suffix = {"ipad": "", "ipad-se": "-se", "mac": "-mac"}[target]
        check("%s: the bundle's name" % tag, ("/out/Phoenix-%s%s.utm:" % (device, suffix)) in plan, plan)
        sysc = config["System"]
        if target == "mac":
            check("%s: the device's CPUs and memory, as vm.sh" % tag,
                  sysc["CPUCount"] == dev_cpus and sysc["MemorySize"] == dev_mem, str(sysc))
            check("%s: vm.sh's command line, exactly" % tag, append == [base], "%s != %s" % (append, base))
        else:
            check("%s: at most 4 CPUs and 3072 MiB on an iPad" % tag,
                  sysc["CPUCount"] == min(dev_cpus, 4) and sysc["MemorySize"] == min(dev_mem, 3072)
                  and sysc["JITCacheSize"] == 384, str(sysc))
            t = 600 if target == "ipad" else 1800
            check("%s: vm.sh's command line, then systemd's timeouts at %d s" % (tag, t),
                  append == ["%s systemd.default_timeout_start_sec=%d systemd.default_device_timeout_sec=%d"
                             % (base, t, t)], str(append))

# ---- The defaults and the options ------------------------------------------
code, plan, config, err = dry([])
check("make-utm.sh with no device: the PineTab2, for an iPad", code == 0 and "the PINE64 PineTab2 for UTM (ipad)" in plan
      and "1280x800, 4 CPUs, 3072 MiB, virtio-gpu-gl-pci, sound intel-hda" in plan, plan or err)
check("the defaults: TCG's CPU picked by UTM, the virt machine as vm.sh's",
      config["System"]["CPU"] == "default" and config["System"]["Target"] == "virt"
      and config["QEMU"]["MachinePropertyOverride"] == "virtualization=off,gic-version=3" and config["QEMU"]["Hypervisor"]
      and not config["QEMU"]["UEFIBoot"] and config["QEMU"]["RNGDevice"], str(config["QEMU"]))
check("the defaults: UTM's USB tablet and keyboard; no SPICE agent features",
      config["Input"]["UsbBusSupport"] == "3.0" and not config["QEMU"]["PS2Controller"]
      and not config["Sharing"]["ClipboardSharing"] and not config["Display"][0]["DynamicResolution"], str(config["Input"]))
net = config["Network"][0]
check("the defaults: user networking, ssh on the host's 127.0.0.1:2222",
      net["Mode"] == "Emulated" and net["Hardware"] == "virtio-net-pci"
      and net["PortForward"] == [{"Protocol": "TCP", "HostAddress": "127.0.0.1", "HostPort": 2222, "GuestPort": 22}]
      and re.fullmatch(r"([0-9A-F]{2}:){5}[0-9A-F]{2}", net["MacAddress"])
      and int(net["MacAddress"][:2], 16) & 3 == 2, str(net))
check("the defaults: the kernel, then the root disk on VirtIO",
      [(d["ImageType"], d["Interface"], d["ImageName"]) for d in config["Drive"]]
      == [("LinuxKernel", "None", "Image"),
          ("Disk", "VirtIO", "webos-phoenix-image-phoenix-vm-arm64.rootfs." + ("qcow2" if HAS_QEMU_IMG else "ext4"))],
      str(config["Drive"]))
check("the defaults: a serial terminal, UTM's webOS icon",
      config["Serial"][0]["Mode"] == "Terminal" and config["Information"]["Icon"] == "webos"
      and config["Information"]["Name"] == "webOS Phoenix: PINE64 PineTab2", str(config["Information"]))
code, _, c2, _ = dry([])
check("each bundle has its own UUIDs and MAC address", c2["Information"]["UUID"] != config["Information"]["UUID"]
      and c2["Drive"][1]["Identifier"] != config["Drive"][1]["Identifier"]
      and c2["Network"][0]["MacAddress"] != config["Network"][0]["MacAddress"])
code, plan, config, err = dry(["--gl", "off", "--audio", "virtio", "--cpus", "2", "--memory", "2048", "--ssh-port", "2299",
                               "--disk", "raw"])
user = cub.parse_user_arguments(config["QEMU"]["AdditionalArguments"])
check("--gl off: virtio-gpu-pci, and its own -global names", config["Display"][0]["Hardware"] == "virtio-gpu-pci"
      and has(user, "-global", "virtio-gpu-pci.xres=1280"), str(user))
check("--audio virtio, --cpus, --memory, --ssh-port, --disk raw",
      config["Sound"] == [{"Hardware": "virtio-sound-pci"}] and config["System"]["CPUCount"] == 2
      and config["System"]["MemorySize"] == 2048 and config["Network"][0]["PortForward"][0]["HostPort"] == 2299
      and config["Drive"][1]["ImageName"].endswith(".rootfs.ext4"), plan)
code, _, config, _ = dry(["--audio", "none"])
check("--audio none: no sound device", config["Sound"] == [])
code, _, config, _ = dry(["--initrd", "/x/initramfs.gz", "--image", "/x/root.ext4"])
check("--initrd: a LinuxInitrd drive between the kernel and the disk; --image a file: its Image beside it",
      [d["ImageType"] for d in config["Drive"]] == ["LinuxKernel", "LinuxInitrd", "Disk"]
      and config["Drive"][1]["ImageName"] == "initramfs.gz", str(config["Drive"]))
code, plan, _, _ = dry(["--image", "/x/root.ext4"])
check("--image FILE: the kernel beside it", "Data/Image from /x/Image" in plan, plan)

# ---- The QEMU command UTM builds -------------------------------------------
code, _, config, _ = dry(["fairphone-fp6", "--for", "ipad"])
for host in ("ios", "ios-se"):
    cmd = cub.qemu_arguments(config, host)
    check("%s: TCG with UTM's cortex-a72, the 384 MiB cache%s" % (host, ", split-wx (JIT through a debugger)" if host == "ios" else ""),
          has(cmd, "-cpu", "cortex-a72")
          and has(cmd, "-accel", "tcg,tb-size=384" + (",split-wx=on" if host == "ios" else "")), " ".join(cmd))
    check("%s: vm.sh's machine (GICv3, no EL2), 4 CPUs, 3072 MiB" % host,
          has(cmd, "-machine", "virt,virtualization=off,gic-version=3")
          and has(cmd, "-smp", "cpus=4,sockets=1,cores=4,threads=1") and has(cmd, "-m", "3072"), " ".join(cmd))
    check("%s: the kernel, its command line as one argument" % host,
          after(cmd, "-kernel") == ["Data/Image"] and len(after(cmd, "-append")) == 1
          and after(cmd, "-append")[0].startswith("root=/dev/vda rw rootwait console=ttyAMA0 phoenix.device=fairphone-fp6 "),
          " ".join(cmd))
    check("%s: the panel, the USB tablet and keyboard, virtio disk, network, sound, rng, serial" % host,
          has(cmd, "-global", "virtio-gpu-gl-pci.xres=1116") and has(cmd, "-global", "virtio-gpu-gl-pci.yres=2484")
          and has(cmd, "-device", "usb-tablet,bus=usb-bus.0") and has(cmd, "-device", "usb-kbd,bus=usb-bus.0")
          and any(a.startswith("virtio-blk-pci,") for a in cmd) and has(cmd, "-device", "intel-hda")
          and has(cmd, "-device", "hda-duplex,audiodev=audio0") and has(cmd, "-device", "virtio-rng-pci")
          and any(a.startswith("user,id=net0,hostfwd=tcp:127.0.0.1:2222-:22") for a in cmd)
          and has(cmd, "-serial", "chardev:term0"), " ".join(cmd))
    check("%s: no virtio multitouch (SPICE carries no touches; UTM's taps are the USB tablet's)" % host,
          not any("multitouch" in a for a in cmd))
code, _, config, _ = dry(["fairphone-fp6", "--for", "mac"])
cmd = cub.qemu_arguments(config, "macos")
check("macos: HVF and the host's CPU, the device's 8 CPUs and 8192 MiB",
      has(cmd, "-cpu", "host") and any(a.startswith("hvf") for a in after(cmd, "-accel"))
      and has(cmd, "-smp", "cpus=8,sockets=1,cores=8,threads=1") and has(cmd, "-m", "8192"), " ".join(cmd))
check("check-utm-bundle.py: UTM's argument splitting",
      cub.parse_user_arguments(['-append', 'root=/dev/vda rw']) == ['-append', 'root=/dev/vda', 'rw']
      and cub.parse_user_arguments(['"root=/dev/vda rw"', '-global a.b=1']) == ['root=/dev/vda rw', '-global', 'a.b=1'])
bad = dict(config)
bad["ConfigurationVersion"] = 5
bad_sys = dict(config["System"])
del bad_sys["JITCacheSize"]
bad["System"] = bad_sys
faults = cub.check_config(bad)
check("check-utm-bundle.py: finds a version UTM refuses and a missing key",
      any("ConfigurationVersion 5" in f for f in faults) and any("System.JITCacheSize: missing" in f for f in faults), str(faults))

# ---- Making a bundle -------------------------------------------------------
tmp = tempfile.mkdtemp(prefix="test-make-utm-")
try:
    img = os.path.join(tmp, "img")
    os.makedirs(img)
    with open(os.path.join(img, "Image"), "wb") as f:
        f.write(b"ARM64 kernel stand-in" * 1000)
    with open(os.path.join(img, "webos-phoenix-image-phoenix-vm-arm64.rootfs.ext4"), "wb") as f:
        f.seek(64 * 1024 * 1024 - 1)
        f.write(b"\0")
    out = os.path.join(tmp, "out")
    code, o, err = make(["--image", img, "--out", out, "--disk", "raw"])
    bundle = os.path.join(out, "Phoenix-pinetab2.utm")
    check("make-utm.sh: a bundle", code == 0 and os.path.isfile(os.path.join(bundle, "config.plist")), o + err)
    config, faults = cub.check_bundle(bundle)
    check("the bundle: UTM reads it; Data/ holds only what it names", not faults, "; ".join(faults))
    check("the bundle: the kernel and the root copied", sorted(os.listdir(os.path.join(bundle, "Data")))
          == ["Image", "webos-phoenix-image-phoenix-vm-arm64.rootfs.ext4"]
          and open(os.path.join(bundle, "Data", "Image"), "rb").read() == open(os.path.join(img, "Image"), "rb").read())
    check("the bundle: no temporary folder left", sorted(os.listdir(out)) == ["Phoenix-pinetab2.utm"], str(os.listdir(out)))
    code, _, err = make(["--image", img, "--out", out, "--disk", "raw"])
    check("an existing bundle is kept without --force", code == 2 and "--force" in err, err)
    code, _, err = make(["--image", img, "--out", out, "--disk", "raw", "--force"])
    _, faults = cub.check_bundle(bundle)
    check("--force replaces it", code == 0 and not faults, err)
    if HAS_QEMU_IMG:
        code, _, err = make(["fairphone-fp6", "--image", img, "--out", out])
        q = os.path.join(out, "Phoenix-fairphone-fp6.utm", "Data", "webos-phoenix-image-phoenix-vm-arm64.rootfs.qcow2")
        check("qemu-img there: a qcow2 root disk by default", code == 0 and os.path.isfile(q)
              and open(q, "rb").read(4) == b"QFI\xfb" and os.path.getsize(q) < 8 * 1024 * 1024, err)
    code, _, err = make(["--image", os.path.join(tmp, "none"), "--out", out])
    check("no image: says how to build it", code == 2 and "mac-build.sh phoenix-vm-arm64" in err, err)
    os.remove(os.path.join(bundle, "Data", "Image"))
    open(os.path.join(bundle, "Data", "notes.txt"), "w").close()
    _, faults = cub.check_bundle(bundle)
    check("check-utm-bundle.py: a missing kernel, a file UTM would delete",
          any("Data/Image is not there" in f for f in faults) and any("Data/notes.txt" in f for f in faults), str(faults))
finally:
    shutil.rmtree(tmp)

for bad, why in ((["pinephone", "--dry-run"], "an unknown device"), (["--for", "iphone", "--dry-run"], "--for iphone"),
                 (["pinetab2", "fairphone-fp6", "--dry-run"], "two devices"), (["--cpus", "0", "--dry-run"], "--cpus 0"),
                 (["--ssh-port", "70000", "--dry-run"], "--ssh-port 70000"), (["--gl"], "--gl without a value"),
                 (["--frobnicate"], "an unknown option")):
    code, _, err = make(bad)
    check("make-utm.sh: %s is exit 2" % why, code == 2 and err.startswith("make-utm.sh: "), "%s %s" % (code, err))
code, out, _ = make(["fairphone-fp6", "--dry-run", "--for", "mac"])
check("make-utm.sh: the device may come after the options", code == 0 and "Fairphone" in out.splitlines()[0])


# ---- Booting it as UTM would ------------------------------------------------
def cpio_newc(files):
    """A newc cpio archive of {name: (mode, bytes)}."""
    out = b""
    for ino, (name, (mode, data)) in enumerate(sorted(files.items()), 1):
        n = name.encode() + b"\0"
        hdr = "070701" + "".join("%08X" % v for v in (ino, mode, 0, 0, 1, 0, len(data), 0, 0, 0, 0, len(n), 0))
        out += hdr.encode() + n
        out += b"\0" * (-len(out) % 4) + data
        out += b"\0" * (-len(out) % 4)
    n = b"TRAILER!!!\0"
    out += ("070701" + "%08X" * 13 % (0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, len(n), 0)).encode() + n
    return out + b"\0" * (-len(out) % 512)


GUEST_INIT = r"""#!/bin/busybox sh
/bin/busybox mkdir -p /proc /sys /dev /usr/bin /usr/sbin /sbin /tmp
/bin/busybox --install -s
mount -t proc proc /proc; mount -t sysfs sysfs /sys; mount -t devtmpfs devtmpfs /dev 2>/dev/null
say() { echo "UTMCHECK $*"; }
say "cmdline $(cat /proc/cmdline)"
say "cpus $(grep -c ^processor /proc/cpuinfo)"
say "cpu-part $(grep -m1 'CPU part' /proc/cpuinfo | awk '{print $NF}')"
say "memtotal-kb $(awk '/MemTotal/ {print $2}' /proc/meminfo)"
say "gic $(grep -o -m1 'GICv[0-9]' /proc/interrupts)"
say "el $(dmesg | grep -o -m1 'started at EL[0-9]')"
for m in virtio_blk virtio-gpu xhci-pci usbhid hid-generic virtio_net; do modprobe $m || say "modprobe-failed $m"; done
i=0; while [ $i -lt 60 ] && ! grep -qs 'Keyboard' /sys/class/input/input*/name; do sleep 1; i=$((i + 1)); done
for d in /sys/bus/pci/devices/*; do say "pci $(cat $d/vendor):$(cat $d/device)"; done
for c in /sys/class/drm/card*-*; do [ -s "$c/modes" ] && say "drm $(head -n 1 $c/modes)"; done
for i in /sys/class/input/input*; do say "input $(cat $i/name)"; done
say "vda-magic $(dd if=/dev/vda bs=1 skip=1080 count=2 2>/dev/null | hexdump -e '2/1 "%02x"')"
say "vda-label $(dd if=/dev/vda bs=1 skip=1144 count=16 2>/dev/null | tr -d '\000')"
say "net $(ls /sys/class/net | tr '\n' ' ')"
say "done"
poweroff -f
"""


def boot(kernel, initramfs):
    qemu = shutil.which("qemu-system-aarch64")
    if not qemu or not shutil.which("mkfs.ext4"):
        check("--boot: qemu-system-aarch64 and mkfs.ext4 are there", False)
        return
    tmp = tempfile.mkdtemp(prefix="test-make-utm-boot-")
    try:
        img = os.path.join(tmp, "img")
        os.makedirs(os.path.join(tmp, "root"))
        os.makedirs(img)
        shutil.copyfile(kernel, os.path.join(img, "Image"))
        with open(os.path.join(tmp, "root", "phoenix-standin"), "w") as f:
            f.write("a stand-in for the image's root\n")
        rootfs = os.path.join(img, "webos-phoenix-image-phoenix-vm-arm64.rootfs.ext4")
        subprocess.run(["mkfs.ext4", "-q", "-F", "-L", "phoenix-standin", "-d", os.path.join(tmp, "root"), rootfs, "64M"],
                       capture_output=True, check=True)
        # The stand-in's initramfs, with this test's /init over its own.
        initrd = os.path.join(tmp, "initramfs-utmcheck")
        with open(initrd, "wb") as f:
            f.write(open(initramfs, "rb").read())
            f.write(gzip.compress(cpio_newc({"init": (0o100755, GUEST_INIT.encode())})))
        for device, target, host in (("pinetab2", "ipad", "ios"), ("fairphone-fp6", "ipad-se", "ios-se")):
            tag = "boot %s --for %s as UTM %s builds it" % (device, target, host)
            out = os.path.join(tmp, "out-" + device)
            port = 20000 + os.getpid() % 20000
            code, o, err = make([device, "--for", target, "--gl", "off", "--image", img, "--initrd", initrd, "--out", out,
                                 "--ssh-port", str(port)])
            bundle = os.path.join(out, "Phoenix-%s%s.utm" % (device, "-se" if target == "ipad-se" else ""))
            config, faults = cub.check_bundle(bundle)
            if not check("%s: the bundle" % tag, code == 0 and not faults, err + "; ".join(faults)):
                continue
            cmd = cub.qemu_arguments(config, host, os.path.join(bundle, "Data"))
            serial = os.path.join(tmp, "serial-%s.log" % device)
            run_cmd = [qemu]
            i = 0
            while i < len(cmd):
                a = cmd[i]
                if a == "-L":
                    i += 2
                    continue
                if a == "-S":
                    i += 1
                    continue
                if a.startswith("unix=on,addr="):
                    a = re.sub(r"addr=[^,]*", "addr=" + os.path.join(tmp, "spice-%s.sock" % device), a)
                if a.startswith("spiceport,id=term0,"):
                    a = "file,id=term0,path=" + serial
                run_cmd.append(a)
                i += 1
            t0 = time.time()
            try:
                p = subprocess.run(run_cmd, capture_output=True, text=True, timeout=600)
                qerr = p.stderr
            except subprocess.TimeoutExpired:
                qerr = "timed out"
            took = time.time() - t0
            log = open(serial, errors="replace").read() if os.path.exists(serial) else ""
            got = {}
            for line in log.splitlines():
                m = re.match(r".*UTMCHECK (\S+) ?(.*)$", line.rstrip("\r"))
                if m:
                    got.setdefault(m.group(1), []).append(m.group(2).strip())
            if not check("%s: QEMU accepts UTM's command and the guest reports (%.0f s)" % (tag, took), "done" in got,
                         qerr[-2000:] + log[-2000:]):
                continue
            print("%s, %.0f s: %s" % (tag, took, "; ".join("%s %s" % (k, ", ".join(v)) for k, v in sorted(got.items())
                                                        if k not in ("pci", "done"))))
            append = cub.parse_user_arguments(config["QEMU"]["AdditionalArguments"])[-1]
            w, h = profile(device, "width"), profile(device, "height")
            check("%s: the kernel's command line" % tag, got["cmdline"] == [append], str(got["cmdline"]))
            check("%s: 4 cortex-a72 CPUs, 3072 MiB" % tag, got["cpus"] == ["4"] and got["cpu-part"] == ["0xd08"]
                  and 2900000 < int(got["memtotal-kb"][0]) <= 3072 * 1024, str(got))
            check("%s: GICv3, the kernel at EL1 (no EL2)" % tag, got["gic"] == ["GICv3"] and got["el"] == ["started at EL1"],
                  str(got.get("gic")) + str(got.get("el")))
            check("%s: virtio-gpu's mode is the panel, %sx%s" % (tag, w, h), got.get("drm") == ["%sx%s" % (w, h)],
                  str(got.get("drm")))
            inputs = got.get("input", [])
            check("%s: UTM's USB tablet, mouse and keyboard" % tag,
                  "QEMU QEMU USB Tablet" in inputs and "QEMU QEMU USB Keyboard" in inputs, str(inputs))
            check("%s: the bundle's root disk is /dev/vda" % tag,
                  got.get("vda-magic") == ["53ef"] and got.get("vda-label") == ["phoenix-standin"], str(got))
            pci = got.get("pci", [])
            check("%s: Intel HDA, the NEC xHCI, virtio devices" % tag,
                  "0x8086:0x2668" in pci and "0x1033:0x0194" in pci and sum(p.startswith("0x1af4:") for p in pci) >= 5,
                  str(pci))
            check("%s: the network" % tag, "eth0" in got.get("net", [""])[0], str(got.get("net")))
            for f in got.get("modprobe-failed", []):
                check("%s: modprobe %s" % (tag, f), False)
    finally:
        shutil.rmtree(tmp)


if len(sys.argv) == 4 and sys.argv[1] == "--boot":
    boot(sys.argv[2], sys.argv[3])
elif len(sys.argv) != 1:
    sys.stderr.write("usage: test-make-utm.py [--boot KERNEL INITRAMFS]\n")
    sys.exit(2)

print("%d checks, %d failed" % (checks, len(failures)))
sys.exit(1 if failures else 0)
