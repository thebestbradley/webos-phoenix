#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""What tools/install-rootfs.py puts in a device image, checked without
building one (its --list): every bus service it installs has its
luna-service2 files (role, API groups, client permissions, manifest,
service file) and the code its service file runs; Open webOS's app
services come with OSE's bus files (compat/app-services); db8 kinds and
activities go where db8 and activitymanager read them.

    python3 tools/test-install-rootfs.py
"""

import json
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
failures = 0


def check(cond, what):
    global failures
    print(("ok   " if cond else "FAIL ") + what)
    if not cond:
        failures += 1


listed = subprocess.run([sys.executable, os.path.join(REPO, "tools", "install-rootfs.py"), "/nonexistent", "--list"],
                        check=True, capture_output=True, text=True).stdout.split()
paths = set(listed)
services = sorted(p for p in paths if p.startswith("/usr/share/luna-service2/services.d/"))
check(len(services) >= 20, "%d bus services are installed" % len(services))

for dev in services:
    base = os.path.basename(dev)[:-len(".service")]
    for sub, suffix in (("roles.d", ".role.json"), ("api-permissions.d", ".api.json"), ("groups.d", ".groups.json"),
                        ("client-permissions.d", ".perm.json"), ("manifests.d", ".manifest.json")):
        check("/usr/share/luna-service2/%s/%s%s" % (sub, base, suffix) in paths, "%s: %s" % (base, sub))

# The names each service file declares are allowed by its role, and what it
# runs is installed.
SYSBUS_SOURCES = []
for root, dirs, files in os.walk(REPO):
    dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "build", "third_party", "dist")]
    if os.path.basename(root) == "sysbus":
        SYSBUS_SOURCES.append(root)
for d in SYSBUS_SOURCES:
    for fn in os.listdir(d):
        if not fn.endswith(".service"):
            continue
        base = fn[:-len(".service")]
        if "/usr/share/luna-service2/services.d/" + fn not in paths:
            continue
        text = open(os.path.join(d, fn)).read()
        names = sum((m.split(";") for m in re.findall(r"^Name=(.*)$", text, re.M)), [])
        role = json.load(open(os.path.join(d, base + ".role.json")))
        check(all(n in role["allowedNames"] for n in names), "%s: its role allows %s" % (base, ", ".join(names)))
        for m in re.findall(r"run-js-service -n (\S+)", text):
            check(any(p.startswith(m + "/") for p in paths), "%s: %s is installed" % (base, m))

# Open webOS's app services.
for svc in ("com.palm.service.accounts", "com.palm.service.contacts", "com.palm.service.contacts.linker",
            "com.palm.service.calendar.reminders"):
    check("/usr/palm/services/%s/services.json" % svc in paths, svc + ": installed for mojoservicelauncher")
    check("/usr/share/luna-service2/roles.d/%s.role.json" % svc in paths, svc + ": with OSE's bus files")
    check(not any(p.startswith("/usr/palm/services/%s/files/" % svc) or "/tests/" in p and svc in p for p in paths),
          svc + ": not its luna-service 1 files or tests")
check("/etc/palm/db/kinds/com.palm.service.accounts/com.palm.account" in paths, "app services: db8 kinds in /etc/palm/db")
check("/etc/palm/tempdb/kinds/com.palm.service.accounts/com.palm.signaling" in paths, "app services: tempdb kinds")
check("/etc/palm/activities/applications/com.palm.app.clock/com.palm.app.clock.update.json" in paths
      and "/etc/palm/activities/services/com.palm.service.contacts/com.palm.service.contacts.sortorder.json" in paths,
      "activities: apps' and services' where the configurator reads them")

# The device services this work added.
for name in ("org.webosphoenix.shellhost", "com.palm.applicationManager", "org.webosphoenix.dropshare",
             "org.webosphoenix.accessories"):
    check("/usr/share/luna-service2/services.d/%s.service" % name in paths, name + ": installed")
check(not any(".test." in p for p in paths), "no tests in the image")

# The platform's servers and keys (docs/PLATFORM-CLIENT.md): servers.json,
# the account service and the shared client package each service carries.
check("/etc/palm/phoenix/servers.json" in paths, "servers.json: installed (the recipe writes the image's over it)")
check("/usr/share/luna-service2/services.d/org.webosphoenix.service.account.service" in paths, "org.webosphoenix.service.account: installed")
for svc in ("com.palm.update", "org.webosphoenix.service.packages", "org.webosphoenix.hardware", "org.webosphoenix.service.account"):
    check("/usr/palm/services/%s/node_modules/@phoenix/platform/src/index.js" % svc in paths, svc + ": carries @phoenix/platform")
check("/etc/palm/updates.json" not in paths, "no second place for the update feed (servers.json)")

# tools/servers-json.py: what the recipe runs, and what it refuses.
import base64  # noqa: E402
import tempfile  # noqa: E402
with tempfile.TemporaryDirectory() as tmp:
    root = base64.b64encode(os.urandom(32)).decode()
    out = os.path.join(tmp, "servers.json")
    r = subprocess.run([sys.executable, os.path.join(REPO, "tools", "servers-json.py"), out, "--feeds", "https://feeds.example.org",
                        "--api", "https://api.example.org/", "--issuer", "https://api.example.org", "--catalog-root", root, "--updates-root", root],
                       capture_output=True, text=True)
    made = json.load(open(out)) if r.returncode == 0 else {}
    check(r.returncode == 0 and made.get("feeds") == "https://feeds.example.org/" and made["catalog"]["root"] == root
          and made["updates"]["channels"] == ["stable", "beta", "dev"] and made["account"]["issuer"] == "https://api.example.org",
          "servers-json.py: an image's file, roots pinned")
    r = subprocess.run([sys.executable, os.path.join(REPO, "tools", "servers-json.py"), out, "--feeds", "http://feeds.example.org/"],
                       capture_output=True, text=True)
    check(r.returncode != 0 and "https" in r.stderr, "servers-json.py: plain HTTP refused for an image")
    r = subprocess.run([sys.executable, os.path.join(REPO, "tools", "servers-json.py"), out, "--feeds", "https://f.example.org/",
                        "--catalog-root", "c2hvcnQ="], capture_output=True, text=True)
    check(r.returncode != 0 and "Ed25519" in r.stderr, "servers-json.py: a key that is not one refused")
    r = subprocess.run([sys.executable, os.path.join(REPO, "tools", "servers-json.py"), "--check",
                        os.path.join(REPO, "services", "account", "etc", "palm", "phoenix", "servers.json")], capture_output=True, text=True)
    check(r.returncode == 0, "servers-json.py --check: the simulator's file")

if failures:
    print("%d failed" % failures)
    sys.exit(1)
print("all passed")
