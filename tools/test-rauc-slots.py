#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The A/B layout for system updates without a build (docs/PLATFORM-CLIENT.md,
# "System updates"; meta-phoenix/dynamic-layers/rauc): GRUB's first
# environment, the data partition's mounts at boot (phoenix-slots-generator),
# the build a bundle takes from its image (phoenix.devpush.build_info), and
# that the partition names agree in the wks file, the GRUB script and RAUC's
# system.conf.
#
#   python3 tools/test-rauc-slots.py

import os
import re
import subprocess
import sys
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYER = os.path.join(REPO, "meta-phoenix")
DYN = os.path.join(LAYER, "dynamic-layers", "rauc")
sys.path.insert(0, os.path.join(LAYER, "lib"))
from phoenix import devpush, slots  # noqa: E402

GENERATOR = os.path.join(DYN, "recipes-core", "phoenix-slots", "files", "phoenix-slots-generator")
WAKE = os.path.join(DYN, "recipes-core", "phoenix-slots", "files", "phoenix-update-wake")
WKS = os.path.join(LAYER, "files", "wic", "phoenix-ab-efi.wks.in")
GRUB = os.path.join(LAYER, "files", "wic", "phoenix-ab-grub.cfg")
SYSTEM_CONF = os.path.join(DYN, "recipes-core", "rauc", "files", "phoenix-vm-arm64", "system.conf")
MACHINE = os.path.join(LAYER, "conf", "machine", "phoenix-vm-arm64.conf")
TEST_KEYS = os.path.join(LAYER, "files", "rauc", "test")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


class GrubEnv(unittest.TestCase):
    def test_block(self):
        data = slots.grubenv({"ORDER": "A B", "A_OK": "1", "A_TRY": "0", "B_OK": "0", "B_TRY": "0",
                              "PHOENIX_ARGS": "console=ttyAMA0 phoenix.device=pinephonepro"})
        self.assertEqual(len(data), 1024)
        self.assertTrue(data.startswith(b"# GRUB Environment Block\nORDER=A B\n"))
        self.assertTrue(data.endswith(b"#"))
        env = slots.read_grubenv(data)
        self.assertEqual(env["ORDER"], "A B")
        self.assertEqual(env["A_OK"], "1")
        self.assertEqual(env["PHOENIX_ARGS"], "console=ttyAMA0 phoenix.device=pinephonepro")

    def test_refuses(self):
        with self.assertRaises(ValueError):
            slots.grubenv({"BAD NAME": "x"})
        with self.assertRaises(ValueError):
            slots.grubenv({"A": "line\nbreak"})
        with self.assertRaises(ValueError):
            slots.grubenv({"A": "x" * 1100})


class Generator(unittest.TestCase):
    def run_generator(self, cmdline):
        out = tempfile.mkdtemp(prefix="slots-gen-")
        with tempfile.NamedTemporaryFile("w", delete=False) as f:
            f.write(cmdline + "\n")
        env = dict(os.environ, PHOENIX_CMDLINE=f.name)
        p = subprocess.run(["sh", GENERATOR, out, out + "/early", out + "/late"], env=env,
                           capture_output=True, text=True)
        os.unlink(f.name)
        self.assertEqual(p.returncode, 0, p.stderr)
        return out, p.stderr

    def test_nothing_without_slots(self):
        out, _ = self.run_generator("root=/dev/vda rw console=ttyAMA0 phoenix.device=pinetab2")
        self.assertEqual(os.listdir(out), [])

    def test_ab_boot(self):
        out, _ = self.run_generator("root=PARTLABEL=phoenix-root-b rauc.slot=B "
                                    "phoenix.data=PARTLABEL=phoenix-data phoenix.esp=PARTLABEL=phoenix-boot")
        units = sorted(os.listdir(out))
        self.assertEqual(units, sorted(["data.mount", "phoenix-data-prepare.service", "var.mount", "home.mount",
                                        "media.mount", "var-lib-phoenix.mount", "boot-efi.mount",
                                        "local-fs.target.wants"]))
        wanted = sorted(os.listdir(os.path.join(out, "local-fs.target.wants")))
        self.assertEqual(wanted, sorted(["data.mount", "var.mount", "home.mount", "media.mount",
                                         "var-lib-phoenix.mount", "boot-efi.mount"]))
        data = read(os.path.join(out, "data.mount"))
        self.assertIn("What=/dev/disk/by-partlabel/phoenix-data\n", data)
        self.assertIn("Where=/data\n", data)
        # systemd-escape --path /dev/disk/by-partlabel/phoenix-data
        self.assertIn("Requires=systemd-fsck@dev-disk-by\\x2dpartlabel-phoenix\\x2ddata.service\n", data)
        var = read(os.path.join(out, "var.mount"))
        self.assertIn("Type=overlay\n", var)
        self.assertIn("Options=lowerdir=/var,upperdir=/data/overlay/var/upper,workdir=/data/overlay/var/work\n", var)
        self.assertIn("Requires=phoenix-data-prepare.service\n", var)
        lib = read(os.path.join(out, "var-lib-phoenix.mount"))
        self.assertIn("What=/data/phoenix\n", lib)
        self.assertIn("Options=bind\n", lib)
        prep = read(os.path.join(out, "phoenix-data-prepare.service"))
        for d in ("/data/overlay/var/upper", "/data/overlay/home/work", "/data/overlay/media/upper",
                  "/data/phoenix", "/data/rauc"):
            self.assertIn(d, prep)
        esp = read(os.path.join(out, "boot-efi.mount"))
        self.assertIn("What=/dev/disk/by-partlabel/phoenix-boot\n", esp)
        self.assertIn("Where=/boot/efi\n", esp)
        self.assertIn("Type=vfat\n", esp)

    def test_bad_device(self):
        out, err = self.run_generator("phoenix.data=nonsense")
        self.assertEqual(os.listdir(out), [])
        self.assertIn("not a device", err)


class UpdateWake(unittest.TestCase):
    """phoenix-update-wake: com.palm.update's first call (which marks the
    slot good) only once SAM lists the System UI as running."""

    def run_wake(self, systemui_after, update_ok=True, tries=5, cmdline="root=PARTLABEL=phoenix-root-a rw panic=10 rauc.slot=A"):
        d = tempfile.mkdtemp(prefix="wake-")
        with open(os.path.join(d, "cmdline"), "w") as f:
            f.write(cmdline + "\n")
        fake = os.path.join(d, "luna-send")
        # Answers SAM's running list with the System UI after N asks, and
        # com.palm.update's getStatus; logs every call.
        with open(fake, "w") as f:
            f.write("""#!/bin/sh
echo "$*" >> %(d)s/calls
case "$*" in
  *applicationmanager/running*)
    n=$(cat %(d)s/n 2>/dev/null || echo 0); n=$((n + 1)); echo $n > %(d)s/n
    if [ $n -gt %(after)d ]; then echo '{"returnValue": true, "running": [{"id": "com.palm.systemui"}]}'
    else echo '{"returnValue": true, "running": [{"id": "com.palm.launcher"}]}'; fi ;;
  *com.palm.update/getStatus*)
    echo '{"returnValue": %(ok)s, "state": "idle"}' ;;
esac
""" % {"d": d, "after": systemui_after, "ok": "true" if update_ok else "false"})
        os.chmod(fake, 0o755)
        env = dict(os.environ, PHOENIX_LUNA_SEND=fake, PHOENIX_UPDATE_WAKE_TRIES=str(tries), PHOENIX_UPDATE_WAKE_PAUSE="0",
                   PHOENIX_CMDLINE=os.path.join(d, "cmdline"))
        p = subprocess.run(["sh", WAKE], env=env, capture_output=True, text=True)
        calls = read(os.path.join(d, "calls")).splitlines() if os.path.exists(os.path.join(d, "calls")) else []
        return p.returncode, calls

    def test_waits_for_the_system_ui(self):
        rc, calls = self.run_wake(systemui_after=2)
        self.assertEqual(rc, 0)
        self.assertEqual(sum("applicationmanager/running" in c for c in calls), 3)
        self.assertEqual(sum("com.palm.update/getStatus" in c for c in calls), 1)
        self.assertTrue(calls[-1].endswith("luna://com.palm.update/getStatus {}"))

    def test_never_without_the_system_ui(self):
        rc, calls = self.run_wake(systemui_after=99, tries=4)
        self.assertEqual(rc, 1)
        self.assertFalse(any("com.palm.update" in c for c in calls))

    def test_retries_when_the_service_does_not_answer(self):
        rc, calls = self.run_wake(systemui_after=0, update_ok=False, tries=3)
        self.assertEqual(rc, 1)
        self.assertEqual(sum("com.palm.update/getStatus" in c for c in calls), 3)

    def test_gives_up_after_three_calls(self):
        # Revision 42: it asked com.palm.update for an hour.
        rc, calls = self.run_wake(systemui_after=0, update_ok=False, tries=50)
        self.assertEqual(rc, 1)
        self.assertEqual(sum("com.palm.update/getStatus" in c for c in calls), 3)

    def test_nothing_on_a_boot_without_a_slot(self):
        # A VM started straight from the ext4 (-kernel): no rauc.slot=.
        rc, calls = self.run_wake(systemui_after=0, cmdline="root=/dev/vda rw rootwait console=ttyAMA0")
        self.assertEqual(rc, 0)
        self.assertEqual(calls, [])

    def test_unit_never_holds_up_the_start(self):
        unit = read(WAKE + ".service")
        self.assertIn("\nType=exec\n", unit)
        self.assertNotIn("oneshot", unit.split("[Service]")[1])
        self.assertNotIn("TimeoutStartSec=infinity", unit)
        self.assertIn("\nConditionKernelCommandLine=rauc.slot\n", unit)


class RaucService(unittest.TestCase):
    """RAUC's daemon only on a boot from an update slot: without one it has
    no booted slot, fails, and every D-Bus activation waits 25 s for it
    (Revision 42's regression VM)."""

    def test_condition(self):
        conf = read(os.path.join(DYN, "recipes-core", "rauc", "files", "rauc-phoenix-slot.conf"))
        self.assertIn("[Unit]\nConditionKernelCommandLine=rauc.slot\n", conf)
        bb = read(os.path.join(DYN, "recipes-core", "rauc", "rauc_%.bbappend"))
        self.assertIn("rauc.service.d/phoenix-slot.conf", bb)
        self.assertIn("FILES:${PN}-service", bb)


class BuildInfo(unittest.TestCase):
    def rootfs(self, os_release, product=None):
        r = tempfile.mkdtemp(prefix="rootfs-")
        os.makedirs(os.path.join(r, "usr", "lib"))
        os.makedirs(os.path.join(r, "etc"))
        with open(os.path.join(r, "usr", "lib", "os-release"), "w") as f:
            f.write(os_release)
        os.symlink("../usr/lib/os-release", os.path.join(r, "etc", "os-release"))
        if product is not None:
            os.makedirs(os.path.join(r, "usr", "share", "phoenix"))
            with open(os.path.join(r, "usr", "share", "phoenix", "product.json"), "w") as f:
                f.write(product)
        return r

    def test_build_and_product_version(self):
        r = self.rootfs('ID=luneos\nVERSION_ID=1.0\nBUILD_ID="20261127233233"\n',
                        '{"name": "webOS Phoenix", "version": "2.0.0"}')
        self.assertEqual(devpush.build_info(r), {"build": 20261127233233, "version": "2.0.0"})

    def test_version_from_os_release(self):
        r = self.rootfs('VERSION_ID=1.0\nBUILD_ID="20261128010000"\n')
        self.assertEqual(devpush.build_info(r), {"build": 20261128010000, "version": "1.0"})

    def test_needs_a_number(self):
        with self.assertRaises(ValueError):
            devpush.build_info(self.rootfs("VERSION_ID=1.0\n"))
        with self.assertRaises(ValueError):
            devpush.build_info(self.rootfs('BUILD_ID="abc"\n'))


class Agreement(unittest.TestCase):
    """The partition names, slot names and paths each file relies on."""

    def test_names(self):
        wks = read(WKS)
        names = re.findall(r"--part-name (\S+)", wks)
        self.assertEqual(names, ["phoenix-boot", "phoenix-root-a", "phoenix-root-b", "phoenix-data"])
        grub = read(GRUB)
        conf = read(SYSTEM_CONF)
        # GRUB boots the second and third partitions under these names.
        self.assertIn("set part=gpt2\n        set label=phoenix-root-a", grub)
        self.assertIn("set part=gpt3\n        set label=phoenix-root-b", grub)
        self.assertIn("phoenix.data=PARTLABEL=phoenix-data phoenix.esp=PARTLABEL=phoenix-boot", grub)
        self.assertIn("rauc.slot=$1", grub)
        slots_conf = re.findall(r"device=/dev/disk/by-partlabel/(\S+)\ntype=ext4\nbootname=(\w)", conf)
        self.assertEqual(slots_conf, [("phoenix-root-a", "A"), ("phoenix-root-b", "B")])
        self.assertIn("bootloader=grub\n", conf)
        # RAUC writes the environment GRUB loads: EFI/BOOT/grubenv on the
        # partition phoenix-slots mounts at /boot/efi.
        self.assertIn("grubenv=/boot/efi/EFI/BOOT/grubenv\n", conf)
        self.assertIn("phoenix-grubenv;EFI/BOOT/grubenv", read(MACHINE))
        self.assertIn("data-directory=/data/rauc\n", conf)
        self.assertIn("compatible=phoenix-vm-arm64\n", conf)
        self.assertIn("path=/etc/rauc/keyring.pem\n", conf)

    def test_grub_counts_three_tries(self):
        grub = read(GRUB)
        for a, b in (("0", "1"), ("1", "2"), ("2", "3")):
            self.assertRegex(grub, r'"\$1" = "%s" \]; then set next=%s' % (a, b))
        self.assertIn("save_env A_TRY B_TRY", grub)
        self.assertIn("load_env", grub)

    def test_test_keys(self):
        for name in ("ca.cert.pem", "development-1.cert.pem", "development-1.key.pem"):
            text = read(os.path.join(TEST_KEYS, name))
            self.assertIn("-----BEGIN", text)
        self.assertIn("TEST CA", subprocess.run(
            ["openssl", "x509", "-noout", "-subject", "-in", os.path.join(TEST_KEYS, "ca.cert.pem")],
            capture_output=True, text=True).stdout or "TEST CA")


if __name__ == "__main__":
    unittest.main()
