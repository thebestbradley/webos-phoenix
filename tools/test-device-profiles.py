#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The device profiles (docs/HARDWARE.md, "Device profiles" and "Device
# VMs"): the table and the device.json files it names, which phoenix-sim
# --device compiles in and the ARM64 VM image installs; device-profiles.py,
# which installs them into the VM image and answers scripts/vm.sh;
# phoenix-device-select, which picks one at the VM's boot from the kernel's
# command line; and scripts/vm.sh's arguments, through its --dry-run.
#
#   python3 tools/test-device-profiles.py

import json
import math
import os
import shlex
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = os.path.join(REPO, "meta-phoenix", "recipes-phoenix", "phoenix-device-config", "files")
TABLE = os.path.join(FILES, "device-profiles.json")
PROFILES_PY = os.path.join(FILES, "device-profiles.py")
SELECT = os.path.join(FILES, "phoenix-device-select")
VM_SH = os.path.join(REPO, "scripts", "vm.sh")
IDS = ["fairphone-fp6", "ayn-odin2portal", "pinephonepro", "pinetab2", "raspberrypi4-64"]

failures = []
checks = 0


def check(name, ok, detail=""):
    global checks
    checks += 1
    if not ok:
        failures.append(name)
        print("FAIL %s%s" % (name, (": " + detail) if detail else ""))


def run(cmd, env=None, cwd=None):
    e = dict(os.environ)
    e.update(env or {})
    p = subprocess.run(cmd, capture_output=True, text=True, env=e, cwd=cwd)
    return p.returncode, p.stdout, p.stderr


def density_for(ppi):
    # Theme.densityFor (shell/qml/Phoenix/Shell/Theme.qml): 180 legacy
    # pixels an inch, in quarters, never below 1.
    return max(1.0, round(ppi / 180 * 4) / 4)


# ---- The table and the device.json files ----------------------------------
profiles = json.load(open(TABLE))["profiles"]
check("the five first targets, in order", [p["id"] for p in profiles] == IDS, str([p["id"] for p in profiles]))
for p in profiles:
    pid = p["id"]
    cfg_path = os.path.join(FILES, p["config"], "device.json")
    check(pid + ": its device.json exists", os.path.isfile(cfg_path), cfg_path)
    if not os.path.isfile(cfg_path):
        continue
    cfg = json.load(open(cfg_path))
    w, h = p["panel"]["width"], p["panel"]["height"]
    check(pid + ": orientation matches the panel", (p["orientation"] == "portrait") == (h > w), "%dx%d %s" % (w, h, p["orientation"]))
    check(pid + ": a form factor", cfg.get("formFactor") in ("phone", "tablet"), str(cfg.get("formFactor")))
    check(pid + ": no hardware Home button (the gesture bar)", cfg.get("hardwareHomeButton") is False)
    ppi = math.hypot(w, h) / p["diagonal"]
    check(pid + ": density is the shell's rule for its ppi", cfg.get("density") == density_for(ppi),
          "device.json %s, %.0f ppi gives %s" % (cfg.get("density"), ppi, density_for(ppi)))
    check(pid + ": CPUs and memory", p["cpus"] > 0 and p["memoryMiB"] >= 1024)
    check(pid + ": buttons are known ones", all(b in ("power", "volumeUp", "volumeDown") for b in p["buttons"]), str(p["buttons"]))
    r = cfg.get("displayCornerRadius", 0)
    check(pid + ": corner radius fits", 0 <= r < min(w, h) / 2, str(r))
    for c in cfg.get("displayCutouts", []):
        check(pid + ": cutout on the panel", c["shape"] in ("circle", "rect") and c["x"] >= 0 and c["y"] >= 0
              and c["x"] + c["width"] <= w and c["y"] + c["height"] <= h, str(c))
    # The machine's own compositor geometry, where it sets one, is the panel.
    env = os.path.join(FILES, p["config"], "compositor.env")
    if os.path.isfile(env):
        geo = [l.split("=", 1)[1].strip() for l in open(env) if l.startswith("export WEBOS_COMPOSITOR_GEOMETRY=")]
        if geo:
            check(pid + ": the machine's compositor.env is the panel", geo[0] == "%dx%d+0+0r0s1" % (w, h), geo[0])
fp6 = json.load(open(os.path.join(FILES, "fairphone-fp6", "device.json")))
check("fairphone-fp6: the punch hole at the top centre", any(abs(c["x"] + c["width"] / 2 - 558) <= 1 and c["y"] < 70
                                                              for c in fp6.get("displayCutouts", [])))
check("fairphone-fp6: its ringer (Moment) switch", "ringerSwitch" in fp6)
check("the PinePhone is gone", not os.path.exists(os.path.join(FILES, "pinephone")))

# ---- device-profiles.py ------------------------------------------------------
code, out, _ = run([sys.executable, PROFILES_PY, "list"])
check("device-profiles.py list", code == 0 and out.split() == IDS, out)
code, out, _ = run([sys.executable, PROFILES_PY, "get", "fairphone-fp6", "width"])
check("device-profiles.py get width", code == 0 and out.strip() == "1116", out)
code, out, _ = run([sys.executable, PROFILES_PY, "get", "pinetab2", "memoryMiB"])
check("device-profiles.py get memoryMiB", code == 0 and out.strip() == "4096", out)
code, _, err = run([sys.executable, PROFILES_PY, "get", "pinephone", "width"])
check("device-profiles.py get: an unknown device is exit 2", code == 2 and "fairphone-fp6" in err, err)
code, _, _ = run([sys.executable, PROFILES_PY, "get", "fairphone-fp6", "colour"])
check("device-profiles.py get: an unknown field is exit 2", code == 2)
code, _, _ = run([sys.executable, PROFILES_PY, "frobnicate"])
check("device-profiles.py: usage is exit 2", code == 2)

with tempfile.TemporaryDirectory() as tmp:
    dest = os.path.join(tmp, "usr", "share", "phoenix", "devices")
    code, _, err = run([sys.executable, PROFILES_PY, "install", FILES, dest, TABLE])
    check("device-profiles.py install", code == 0, err)
    check("install: every profile and the default", sorted(os.listdir(dest)) == sorted(IDS + ["default"]), str(os.listdir(dest)))
    for p in profiles:
        d = os.path.join(dest, p["id"])
        same = open(os.path.join(d, "device.json")).read() == open(os.path.join(FILES, p["config"], "device.json")).read()
        check("install: %s's device.json is its image's" % p["id"], same)
        geo = "export WEBOS_COMPOSITOR_GEOMETRY=%dx%d+0+0r0s1" % (p["panel"]["width"], p["panel"]["height"])
        env_text = open(os.path.join(d, "compositor.env")).read()
        check("install: %s's geometry is its panel, unturned" % p["id"], geo in env_text)
        check("install: %s shows the pointer's cursor in the VM" % p["id"], "\nunset WEBOS_CURSOR_HIDE\n" in env_text)
    check("install: the default is files/'s own", open(os.path.join(dest, "default", "device.json")).read()
          == open(os.path.join(FILES, "device.json")).read())

    # ---- phoenix-device-select ----------------------------------------------
    def select(cmdline):
        run_dir = os.path.join(tmp, "run", "phoenix")
        if os.path.isdir(run_dir):
            for f in os.listdir(run_dir):
                os.remove(os.path.join(run_dir, f))
        with open(os.path.join(tmp, "cmdline"), "w") as f:
            f.write(cmdline + "\n")
        code, out, err = run(["sh", SELECT], env={"PHOENIX_CMDLINE": os.path.join(tmp, "cmdline"),
                                                   "PHOENIX_DEVICES_DIR": dest, "PHOENIX_RUN_DIR": run_dir})
        chosen = open(os.path.join(run_dir, "device")).read().strip() if os.path.isfile(os.path.join(run_dir, "device")) else None
        return code, chosen, err, run_dir

    code, chosen, err, run_dir = select("root=/dev/vda rw console=ttyAMA0 phoenix.device=fairphone-fp6 quiet")
    check("select: the device the command line names", code == 0 and chosen == "fairphone-fp6", "%s %s %s" % (code, chosen, err))
    check("select: its device.json in /run/phoenix", open(os.path.join(run_dir, "device.json")).read()
          == open(os.path.join(FILES, "fairphone-fp6", "device.json")).read())
    check("select: its geometry in /run/phoenix", "1116x2484+0+0r0s1" in open(os.path.join(run_dir, "compositor.env")).read())
    check("select: nothing left half-written", sorted(os.listdir(run_dir)) == ["compositor.env", "device", "device.json"],
          str(os.listdir(run_dir)))
    code, chosen, err, _ = select("root=/dev/vda phoenix.device=pinetab2 phoenix.device=ayn-odin2portal")
    check("select: the last phoenix.device= wins", code == 0 and chosen == "ayn-odin2portal", str(chosen))
    code, chosen, err, _ = select("root=/dev/vda rw")
    check("select: none named: the default, and says so", code == 0 and chosen == "default" and "no phoenix.device" in err, err)
    code, chosen, err, _ = select("phoenix.device=pinephone")
    check("select: one the image lacks: the default, naming those it has",
          code == 0 and chosen == "default" and "pinephonepro" in err and "has no device" in err, err)
    for bad in ("../../etc", "Fairphone", "-x", "default", "a/b"):
        code, chosen, err, _ = select("phoenix.device=" + bad)
        check("select: %r is not a device name" % bad, code == 0 and chosen == "default", "%s %s" % (chosen, err))

# ---- scripts/vm.sh -------------------------------------------------------------
def vm(args, host_os="Darwin", host_arch="arm64", cpus="10", kvm=None):
    env = {"PHOENIX_VM_HOST_OS": host_os, "PHOENIX_VM_HOST_ARCH": host_arch, "PHOENIX_VM_HOST_CPUS": cpus,
           "PHOENIX_VM_KVM": kvm or "", "XDG_STATE_HOME": "/state"}
    code, out, err = run(["sh", VM_SH] + args, env=env)
    return code, shlex.split(out) if code == 0 and "--dry-run" in args else out, err


def has(cmd, *seq):
    n = len(seq)
    return any(cmd[i:i + n] == list(seq) for i in range(len(cmd) - n + 1))


code, out, _ = vm(["--list"])
check("vm.sh --list", code == 0 and out.split() == IDS, out)
code, cmd, err = vm(["fairphone-fp6", "--dry-run", "--image", "/img"])
check("vm.sh: a Mac on Apple silicon", code == 0 and cmd[0] == "qemu-system-aarch64" and has(cmd, "-accel", "hvf")
      and has(cmd, "-machine", "virt,gic-version=3")
      and has(cmd, "-cpu", "host") and has(cmd, "-smp", "8") and has(cmd, "-m", "8192"), " ".join(cmd) + err)
check("vm.sh: the panel, without GL on a Mac", has(cmd, "-device", "virtio-gpu-pci,xres=1116,yres=2484")
      and has(cmd, "-display", "cocoa,zoom-to-fit=on"), " ".join(cmd))
check("vm.sh: the kernel names the device", has(cmd, "-kernel", "/img/Image")
      and has(cmd, "-append", "root=/dev/vda rw rootwait console=ttyAMA0 phoenix.device=fairphone-fp6"), " ".join(cmd))
check("vm.sh: the device's own disk over the image",
      has(cmd, "-drive", "if=none,id=root,file=/state/webos-phoenix/vm/fairphone-fp6.qcow2,format=qcow2")
      and has(cmd, "-device", "virtio-blk-pci,drive=root"), " ".join(cmd))
check("vm.sh: touch, a pointer, a keyboard", has(cmd, "-device", "virtio-multitouch-pci")
      and has(cmd, "-device", "virtio-tablet-pci") and has(cmd, "-device", "virtio-keyboard-pci"))
check("vm.sh: virtio-net with ssh forwarded", has(cmd, "-netdev", "user,id=net0,hostfwd=tcp:127.0.0.1:2222-:22")
      and has(cmd, "-device", "virtio-net-pci,netdev=net0,romfile="))
check("vm.sh: virtio-sound through Core Audio", has(cmd, "-audiodev", "coreaudio,id=snd0")
      and has(cmd, "-device", "virtio-sound-pci,audiodev=snd0"))

code, cmd, err = vm(["ayn-odin2portal", "--dry-run"], host_os="Linux", host_arch="x86_64", cpus="16")
check("vm.sh: an x86-64 Linux host emulates (TCG) and says so", code == 0 and has(cmd, "-accel", "tcg")
      and has(cmd, "-cpu", "max") and "TCG" in err, " ".join(cmd) + err)
check("vm.sh: Linux has GL (virgl) by default", has(cmd, "-device", "virtio-gpu-gl-pci,xres=1920,yres=1080")
      and has(cmd, "-display", "gtk,gl=on,zoom-to-fit=on") and has(cmd, "-audiodev", "pa,id=snd0"), " ".join(cmd))
check("vm.sh: the default image is out/phoenix-vm-arm64", has(cmd, "-kernel", os.path.join(REPO, "out", "phoenix-vm-arm64", "Image")),
      " ".join(cmd))
code, cmd, _ = vm(["pinephonepro", "--dry-run"], host_os="Linux", host_arch="aarch64", kvm="1")
check("vm.sh: an arm64 Linux host with KVM", code == 0 and has(cmd, "-accel", "kvm") and has(cmd, "-smp", "6")
      and has(cmd, "-machine", "virt,gic-version=host")
      and has(cmd, "-m", "4096") and has(cmd, "-device", "virtio-gpu-gl-pci,xres=720,yres=1440"), " ".join(cmd))
code, cmd, err = vm(["fairphone-fp6", "--dry-run"], cpus="4")
check("vm.sh: no more CPUs than the host has, and says so", code == 0 and has(cmd, "-smp", "4") and "this computer has 4" in err, err)
code, cmd, _ = vm(["raspberrypi4-64", "--dry-run", "--cpus", "2", "--memory", "2048", "--audio", "hda", "--gl", "on",
                   "--ssh-port", "2223", "--", "-snapshot"])
check("vm.sh: options override the device's", code == 0 and has(cmd, "-smp", "2") and has(cmd, "-m", "2048")
      and has(cmd, "-device", "intel-hda") and has(cmd, "-device", "hda-duplex,audiodev=snd0")
      and has(cmd, "-device", "virtio-gpu-gl-pci,xres=1280,yres=720") and has(cmd, "-display", "cocoa,gl=es,zoom-to-fit=on")
      and "hostfwd=tcp:127.0.0.1:2223-:22" in " ".join(cmd) and "-snapshot" in cmd, " ".join(cmd))
code, cmd, _ = vm(["pinetab2", "--dry-run", "--audio", "none"])
check("vm.sh: --audio none", code == 0 and "-audiodev" not in cmd)
code, cmd, _ = vm(["pinetab2", "--dry-run", "--cap-cpu", "50"], host_os="Linux", host_arch="aarch64", kvm="1")
check("vm.sh: --cap-cpu on Linux: a CPU quota of 50% a core", code == 0 and cmd[:3] == ["systemd-run", "--user", "--scope"]
      and "CPUQuota=200%" in cmd and cmd[cmd.index("--") + 1] == "qemu-system-aarch64", " ".join(cmd))
code, cmd, err = vm(["pinetab2", "--dry-run", "--cap-cpu", "50"])
check("vm.sh: --cap-cpu on a Mac: the efficiency cores", code == 0 and cmd[:3] == ["taskpolicy", "-b", "qemu-system-aarch64"]
      and "efficiency" in err, " ".join(cmd))
code, out, _ = vm(["fairphone-fp6", "--utm"])
check("vm.sh --utm: the settings for UTM", code == 0 and "virtio-gpu-gl-pci.xres=1116" in out and "phoenix.device=fairphone-fp6" in out
      and "Memory 8192 MiB" in out, out)
for bad, why in ((["pinephone", "--dry-run"], "an unknown device"), (["--dry-run"], "an option before the device"),
                 (["fairphone-fp6", "--cpus", "eight"], "--cpus not a number"), (["fairphone-fp6", "--gl", "maybe"], "--gl maybe"),
                 (["fairphone-fp6", "--cap-cpu", "150"], "--cap-cpu over 100"), (["fairphone-fp6", "--memory"], "--memory without a value"),
                 (["fairphone-fp6", "--frobnicate"], "an unknown option")):
    code, _, err = vm(bad)
    check("vm.sh: %s is exit 2" % why, code == 2 and err.startswith("vm.sh: "), "%s %s" % (code, err))
code, _, err = vm(["fairphone-fp6", "--image", "/nonexistent"], host_os="Linux", host_arch="aarch64", kvm="1")
check("vm.sh: a missing image says how to build it", code == 2 and "mac-build.sh phoenix-vm-arm64" in err, err)

print("%d checks, %d failed" % (checks, len(failures)))
sys.exit(1 if failures else 0)
