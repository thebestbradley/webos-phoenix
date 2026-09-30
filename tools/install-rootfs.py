#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Install the virtual webOS filesystem (runtime/rootfs.json) into DESTDIR.

Produces the same layout the simulator serves, for a device image:

    /usr/palm/applications/<id>/     apps (original Open webOS apps, Phoenix apps)
    /usr/palm/frameworks/...         Enyo 1.0, MojoLoader, foundation frameworks
    /usr/share/phoenix/runtime/      phoenix-runtime.js
    /etc/palm/db/kinds, permissions  db8 kinds the apps declare
    /usr/palm/services/<id>/         Node.js services apps carry in service/
                                     (run by run-js-service), with their
    /usr/share/luna-service2/...     roles, permissions and service files

compat/rootfs overlays are applied on top, app pages get the runtime
<script> tag (as tools/serve-rootfs.py and phoenix-sim add it), and
development-only files (specs, tests, build tooling) are left out.

    tools/install-rootfs.py DESTDIR [--list]
"""

import argparse
import json
import os
import shutil
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME_TAG = b'<script src="/usr/share/phoenix/runtime/phoenix-runtime.js"></script>'

# Not needed on a device.
SKIP_NAMES = {".git", ".gitignore", ".gitmodules", "node_modules", "spec", "specs", "tests", "test",
              "Gemfile", "Gemfile.lock", "Rakefile", "ci_build.sh", "ci_local.sh", "jslint-ignore",
              "eris_config.json", "runner.html", "jasminerunner.html", ".DS_Store"}


def load_config():
    with open(os.path.join(REPO, "runtime", "rootfs.json")) as f:
        return json.load(f)


def find_apps(cfg):
    apps = []
    seen = set()
    # systemApps (Just Type, the system UI) are single app directories.
    candidates = [(os.path.join(REPO, rel, name), name)
                  for rel in cfg["applicationDirs"] if os.path.isdir(os.path.join(REPO, rel))
                  for name in sorted(os.listdir(os.path.join(REPO, rel)))]
    candidates += [(os.path.join(REPO, rel), os.path.basename(rel)) for rel in cfg.get("systemApps", [])]
    for app_dir, name in candidates:
        if not os.path.isfile(os.path.join(app_dir, "appinfo.json")):
            app_dir = os.path.join(app_dir, "dist")
        info = os.path.join(app_dir, "appinfo.json")
        if not os.path.isfile(info):
            continue
        with open(info, encoding="utf-8-sig") as f:
            app_id = json.load(f).get("id", name)
        if app_id not in seen:
            seen.add(app_id)
            apps.append((app_id, app_dir))
    return apps


# Luna service files (an app's service/sysbus/) by suffix -> luna-service2
# directory, as OSE's webos_system_bus class installs them.
SYSBUS_DIRS = [
    (".role.json", "roles.d"),
    (".api.json", "api-permissions.d"),
    (".perm.json", "client-permissions.d"),
    (".groups.json", "groups.d"),
    (".manifest.json", "manifests.d"),
    (".service", "services.d"),
]


def find_services(cfg):
    """Node.js Luna services that apps carry in service/ (e.g. apps/files/service)."""
    services = []
    for rel in cfg["applicationDirs"]:
        base = os.path.join(REPO, rel)
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            svc_dir = os.path.join(base, name, "service")
            pkg = os.path.join(svc_dir, "package.json")
            if os.path.isfile(pkg):
                with open(pkg, encoding="utf-8") as f:
                    services.append((json.load(f)["name"], svc_dir))
    return services


def plan_service(svc_id, svc_dir, plan):
    """/usr/palm/services/<id>/ (run-js-service) and its ls2 files under /usr/share/luna-service2."""
    for fn in sorted(os.listdir(svc_dir)):
        src = os.path.join(svc_dir, fn)
        if fn == "sysbus" or fn in SKIP_NAMES or ".test." in fn:
            continue
        copy_tree(src, "/usr/palm/services/%s/%s" % (svc_id, fn), plan)
    sysbus = os.path.join(svc_dir, "sysbus")
    if os.path.isdir(sysbus):
        for fn in sorted(os.listdir(sysbus)):
            for suffix, sub in SYSBUS_DIRS:
                if fn.endswith(suffix):
                    plan.append((os.path.join(sysbus, fn), "/usr/share/luna-service2/%s/%s" % (sub, fn)))
                    break


def copy_tree(src, dst, plan, skip_top=()):
    if os.path.isfile(src):
        plan.append((src, dst))
        return
    for root, dirs, files in os.walk(src):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_NAMES and not (root == src and d in skip_top))
        for fn in sorted(files):
            if fn in SKIP_NAMES:
                continue
            s = os.path.join(root, fn)
            plan.append((s, os.path.join(dst, os.path.relpath(s, src))))


def inject_runtime(data):
    low = data.lower()
    i = low.find(b"<head")
    if i >= 0:
        j = low.find(b">", i)
        return data[:j + 1] + RUNTIME_TAG + data[j + 1:]
    return RUNTIME_TAG + data


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("destdir")
    ap.add_argument("--list", action="store_true", help="print what would be installed and exit")
    args = ap.parse_args()

    cfg = load_config()
    plan = []   # (source file, device path)
    for prefix, target in cfg["mounts"].items():
        if prefix == "/usr/palm/frameworks/enyo/1.0/framework/":
            continue   # installed once, as 0.10, and symlinked below
        copy_tree(os.path.join(REPO, target), prefix.rstrip("/"), plan)
    for app_id, app_dir in find_apps(cfg):
        # An app's service/ is installed on its own, below (apps/dav keeps
        # its appinfo.json at the top, so its whole folder is the app).
        copy_tree(app_dir, "/usr/palm/applications/" + app_id, plan, skip_top=("service",))
        # db8 kinds and permissions the app declares (as openwebos/build-desktop did).
        for kind in ("kinds", "permissions"):
            d = os.path.join(app_dir, "configuration", "db", kind)
            if os.path.isdir(d):
                copy_tree(d, "/etc/palm/db/" + kind, plan)
    for svc_id, svc_dir in find_services(cfg):
        plan_service(svc_id, svc_dir, plan)
    for overlay in cfg.get("overlays", []):
        base = os.path.join(REPO, overlay)
        for root, dirs, files in os.walk(base):
            for fn in files:
                if fn == ".gitkeep":
                    continue
                s = os.path.join(root, fn)
                plan.append((s, "/" + os.path.relpath(s, base)))

    # Later entries (overlays) win.
    final = {}
    for src, dev in plan:
        final[dev] = src
    # Files of the original apps we do not redistribute (docs/LEGAL.md).
    for dev in cfg.get("exclude", []):
        final.pop(dev, None)

    if args.list:
        for dev in sorted(final):
            print(dev)
        return

    for dev, src in sorted(final.items()):
        dst = os.path.join(args.destdir, dev.lstrip("/"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        # App pages, and Enyo 1.0's framework pages an app opens as a
        # window (dashboard-window), as in phoenix-sim and serve-rootfs.py.
        if dev.startswith(("/usr/palm/applications/", "/usr/palm/frameworks/enyo/")) and dev.endswith(".html"):
            with open(src, "rb") as f:
                data = inject_runtime(f.read())
            with open(dst, "wb") as f:
                f.write(data)
            shutil.copymode(src, dst)
        else:
            shutil.copy2(src, dst)

    # Enyo 1.0 was published as "0.10"; apps use either path.
    enyo = os.path.join(args.destdir, "usr/palm/frameworks/enyo")
    if os.path.isdir(os.path.join(enyo, "0.10")) and not os.path.lexists(os.path.join(enyo, "1.0")):
        os.symlink("0.10", os.path.join(enyo, "1.0"))
    print("Installed %d files into %s" % (len(final), args.destdir), file=sys.stderr)


if __name__ == "__main__":
    main()
