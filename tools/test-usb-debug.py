#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""meta-phoenix's phoenix-usb-debug (Developer Mode's USB debugging link,
docs/DEV-PUSH.md 6.2) against a pretend configfs, a pretend USB device
controller and stand-ins for ip and udhcpd that record their calls: the
gadget it makes (CDC NCM, stable addresses, bound to the controller), the
addresses and the DHCP server's one lease, another gadget on the port left
alone, no controller, down taking away what up made."""

import os
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(REPO, "meta-phoenix", "recipes-phoenix", "phoenix-devmode", "files", "phoenix-usb-debug")
failures = 0


def check(cond, what):
    global failures
    print(("ok   " if cond else "FAIL ") + what)
    if not cond:
        failures += 1


def world(tmp, udc=True):
    cfs = os.path.join(tmp, "configfs")
    os.makedirs(os.path.join(cfs, "usb_gadget"), exist_ok=True)
    udcd = os.path.join(tmp, "udc")
    os.makedirs(udcd, exist_ok=True)
    if udc:
        open(os.path.join(udcd, "fe800000.usb"), "w").close()
    binp = os.path.join(tmp, "bin")
    os.makedirs(binp, exist_ok=True)
    log = os.path.join(tmp, "calls.log")
    for tool in ("ip", "udhcpd"):
        p = os.path.join(binp, tool)
        with open(p, "w") as f:
            f.write('#!/bin/sh\necho "%s $*" >> "%s"\n' % (tool, log))
        os.chmod(p, 0o755)
    env = dict(os.environ, PHOENIX_CONFIGFS=cfs, PHOENIX_UDC_DIR=udcd, PHOENIX_RUN_DIR=os.path.join(tmp, "run"),
               PATH=binp + os.pathsep + os.environ["PATH"])
    return cfs, env, log


def run(env, *args):
    return subprocess.run(["sh", SCRIPT] + list(args), env=env, capture_output=True, text=True)


with tempfile.TemporaryDirectory() as tmp:
    cfs, env, log = world(tmp)
    r = run(env, "up")
    g = os.path.join(cfs, "usb_gadget", "phoenix-debug")
    read = lambda p: open(os.path.join(g, p)).read().strip()
    check(r.returncode == 0 and "up on usb0" in r.stdout, "up: " + r.stdout.strip())
    check(read("idVendor") == "0x1d6b" and read("UDC") == "fe800000.usb", "a gadget bound to the device controller")
    check(os.path.islink(os.path.join(g, "configs/c.1/ncm.usb0")), "one CDC NCM function in its configuration")
    mac1 = read("functions/ncm.usb0/host_addr")
    check(mac1.startswith("06:") and len(mac1.split(":")) == 6, "a stable host address: " + mac1)
    calls = open(log).read()
    check("ip addr add 172.16.42.1/24 dev usb0" in calls and "ip link set usb0 up" in calls, "the device at 172.16.42.1")
    conf = open(os.path.join(tmp, "run", "usb-debug-udhcpd.conf")).read()
    check("interface usb0" in conf and "start 172.16.42.2" in conf and "end 172.16.42.2" in conf and "udhcpd " in calls,
          "the computer given 172.16.42.2 (one lease)")
    check(run(env, "status").stdout.strip() == "up" and "already up" in run(env, "up").stdout, "status up; up again changes nothing")
    open(os.path.join(tmp, "run", "usb-debug-udhcpd.pid"), "w").write("999999\n")
    r = run(env, "down")
    check(r.returncode == 0 and read("UDC") == "" and not os.path.lexists(os.path.join(g, "configs/c.1/ncm.usb0"))
          and not os.path.exists(os.path.join(tmp, "run", "usb-debug-udhcpd.pid")), "down: unbound, the function out, the DHCP server stopped")
    check(run(env, "status").stdout.strip() == "down", "status down")

with tempfile.TemporaryDirectory() as tmp:
    cfs, env, log = world(tmp)
    other = os.path.join(cfs, "usb_gadget", "g1")
    os.makedirs(other)
    open(os.path.join(other, "UDC"), "w").write("fe800000.usb\n")
    r = run(env, "up")
    check(r.returncode == 3 and "in use by another gadget (g1)" in r.stdout
          and not os.path.exists(os.path.join(cfs, "usb_gadget", "phoenix-debug")),
          "another gadget on the port (a phone's own, tethering's) is left alone")

with tempfile.TemporaryDirectory() as tmp:
    cfs, env, log = world(tmp, udc=False)
    r = run(env, "up")
    check(r.returncode == 2 and "no USB device controller" in r.stdout, "no device controller (the VM): says so")
    check(run(env, "down").returncode == 0, "down when it was never up")
    check(run(env, "bogus").returncode == 64, "usage")

print("all passed" if not failures else "%d failed" % failures)
sys.exit(1 if failures else 0)
