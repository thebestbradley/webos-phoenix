#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Install the virtual webOS filesystem (runtime/rootfs.json) into DESTDIR.

Produces the same layout the simulator serves, for a device image:

    /usr/palm/applications/<id>/     apps (original Open webOS apps, Phoenix apps)
    /media/cryptofs/apps/usr/palm/applications/<id>/
                                     the connector packages Phoenix comes with
                                     (rootfs.json "preinstalled"): installed
                                     apps the user may remove, as a package
                                     from the Marketplace is (its service/ with
                                     the @phoenix packages it needs)
    /usr/palm/frameworks/...         Enyo 1.0, MojoLoader, foundation frameworks
    /usr/share/phoenix/runtime/      phoenix-runtime.js
    /usr/share/phoenix/product.json  the product: the version the system reports
    /usr/share/phoenix/release-notes.json   the release notes product.json names (not "unreleased")
    /etc/palm/db/kinds, permissions  db8 kinds the apps declare
    /usr/palm/services/<id>/         Node.js services apps carry in service/, and services/*/
                                     (run by run-js-service), with their
    /usr/share/luna-service2/...     roles, permissions and service files
    /etc/...                         a service's etc/ (e.g. the backup
                                     registrations in /etc/palm/backup)

compat/rootfs overlays are applied on top, app pages get the runtime
<script> tag (as tools/serve-rootfs.py and phoenix-sim add it), and
development-only files (specs, tests, build tooling) are left out.

The image's manifest (docs/DEV-PUSH.md 8), /usr/share/phoenix/manifest.json:
the build, the product line and every file Phoenix ships that a dev bundle
may change (the developer overlay's directories, without the refused
paths: apps/shared/platform/src/devpush-paths.json), with its size, SHA-256
and mode, the shell's QML and assets (phoenix-shell) included. The nova
command compares the checkout's against it to put only what changed in a
dev bundle.

    tools/install-rootfs.py DESTDIR [--list]
    tools/install-rootfs.py DESTDIR --manifest [--build ID] [--compatible NAME]
                                     also write DESTDIR/usr/share/phoenix/manifest.json
    tools/install-rootfs.py --stamp ROOTFS [--build ID] [--compatible NAME]
                                     at image time: the manifest's sizes and hashes
                                     from the image's own copies, its build from
                                     ROOTFS/etc/os-release BUILD_ID
    tools/install-rootfs.py --print-manifest [--build ID]
                                     the checkout's manifest, to standard output
    tools/install-rootfs.py DESTDIR --only LIST
                                     only the device paths in LIST (a file, - for
                                     standard input), the shell's too (nova's staging)
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME_TAG = b'<script src="/usr/share/phoenix/runtime/phoenix-runtime.js"></script>'

# Not needed on a device.
SKIP_NAMES = {".git", ".gitignore", ".gitmodules", "node_modules", "spec", "specs", "tests", "test",
              "Gemfile", "Gemfile.lock", "Rakefile", "ci_build.sh", "ci_local.sh", "jslint-ignore",
              "eris_config.json", "runner.html", "jasminerunner.html", ".DS_Store"}


def macos_file(name):
    """A file macOS's Finder leaves in a folder a Mac has shown: .DS_Store
    (the folder's view), AppleDouble ._* files (metadata, on a disk that is
    not APFS or HFS+) and .localized. Never installed: a stray one stopped
    phoenix-apps' do_package (installed-vs-shipped) twice on 28 November
    2026 (meta-phoenix's phoenix-no-macos-files.bbclass deletes them too)."""
    return name in (".DS_Store", ".localized") or name.startswith("._")


def load_config():
    with open(os.path.join(REPO, "runtime", "rootfs.json")) as f:
        return json.load(f)


def product_files(cfg):
    """rootfs.json "product" (product.json): {device path: file in the checkout} of the product
    file and the release notes it names, which the image gets at /usr/share/phoenix/ (as
    phoenix-sim and tools/serve-rootfs.py serve them). The notes must be there: an image
    without them would have no "What's New in This Version"."""
    rel = cfg.get("product")
    if not rel:
        return {}
    path = os.path.join(REPO, rel)
    try:
        with open(path, encoding="utf-8") as f:
            product = json.load(f)
    except (OSError, ValueError) as e:
        sys.exit("install-rootfs: %s: %s" % (rel, e))
    notes = os.path.join(os.path.dirname(rel), product.get("releaseNotes") or "")
    if not product.get("releaseNotes") or not os.path.isfile(os.path.join(REPO, notes)):
        sys.exit("install-rootfs: %s names no release notes file there is (releaseNotes)" % rel)
    return {"/usr/share/phoenix/product.json": rel, RELEASE_NOTES: notes}


RELEASE_NOTES = "/usr/share/phoenix/release-notes.json"


def shipped_notes(src):
    """The release notes as the image ships them: without "unreleased", the
    items collected for the next version while work goes on, which never
    ship (docs/APP-STORE.md 3.15, "Update logs"; a package's changelog.json
    is packed without them too)."""
    with open(src, encoding="utf-8") as f:
        notes = json.load(f)
    notes.pop("unreleased", None)
    return (json.dumps(notes, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def load_preinstalled(cfg):
    """rootfs.json "preinstalled": the connector packages Phoenix comes with, {id: folder}."""
    rel = cfg.get("preinstalled")
    if not rel:
        return {}
    with open(os.path.join(REPO, rel)) as f:
        return {p["id"]: os.path.join(REPO, p["from"]) for p in json.load(f).get("packages", []) if p.get("id") and p.get("from")}


def find_apps(cfg):
    apps = []
    seen = set()
    pre_dirs = set(os.path.normpath(d) for d in load_preinstalled(cfg).values())
    # systemApps (Just Type, the system UI) are single app directories.
    candidates = [(os.path.join(REPO, rel, name), name)
                  for rel in cfg["applicationDirs"] if os.path.isdir(os.path.join(REPO, rel))
                  for name in sorted(os.listdir(os.path.join(REPO, rel)))]
    candidates += [(os.path.join(REPO, rel), os.path.basename(rel)) for rel in cfg.get("systemApps", [])]
    for app_dir, name in candidates:
        if os.path.normpath(app_dir) in pre_dirs:
            continue   # installed as a package (main)
        if not os.path.isfile(os.path.join(app_dir, "appinfo.json")):
            app_dir = os.path.join(app_dir, "dist")
        info = os.path.join(app_dir, "appinfo.json")
        if not os.path.isfile(info):
            # An app that is built (React, Enact, Flutter: a package.json or
            # pubspec.yaml beside public/appinfo.json) and was not: the image
            # would quietly lack it.
            src_dir = os.path.dirname(app_dir)
            if os.path.isfile(os.path.join(src_dir, "public", "appinfo.json")):
                not_built("%s: the app is not built (no dist/appinfo.json; cd apps && npm run build)"
                          % os.path.relpath(src_dir, REPO))
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
    """Node.js Luna services that apps carry in service/ (e.g. apps/files/service),
    and the system's own in services/ (e.g. services/updates)."""
    services = []
    top = os.path.join(REPO, "services")
    for name in sorted(os.listdir(top)) if os.path.isdir(top) else []:
        pkg = os.path.join(top, name, "package.json")
        if os.path.isfile(pkg):
            with open(pkg, encoding="utf-8") as f:
                services.append((json.load(f)["name"], os.path.join(top, name)))
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


# Phoenix's shared packages a service may depend on (its package.json
# "dependencies"): apps/shared/<dir>, by package name. What of each is
# installed: its package.json and the folder its "main" is in (src/ for
# the plain CommonJS sync layer, lib/ for the connector kit, which
# `npm run build` compiles from TypeScript), without tests.
def shared_packages():
    out = {}
    base = os.path.join(REPO, "apps", "shared")
    for name in sorted(os.listdir(base)) if os.path.isdir(base) else []:
        pkg = os.path.join(base, name, "package.json")
        if os.path.isfile(pkg):
            with open(pkg, encoding="utf-8") as f:
                info = json.load(f)
            out[info["name"]] = (os.path.join(base, name), info)
    return out


def npm_package_dir(name, start):
    """Where Node would find npm package `name` from folder `start` (its
    node_modules, then each folder up), or None. The system's own services
    (services/*) are outside the apps' npm workspace: their packages are
    apps/node_modules', as their tests find them (NODE_PATH)."""
    d = os.path.realpath(start)
    while True:
        cand = os.path.join(d, "node_modules", name)
        if os.path.isfile(os.path.join(cand, "package.json")):
            return os.path.realpath(cand)
        up = os.path.dirname(d)
        if up == d:
            break
        d = up
    cand = os.path.join(REPO, "apps", "node_modules", name)
    return os.path.realpath(cand) if os.path.isfile(os.path.join(cand, "package.json")) else None


def plan_npm_package(name, start, dest, plan, seen):
    """A service's own npm dependency (plain JavaScript: the drives' SSH
    client's @noble packages) into its node_modules, as phoenix-connector
    pack vendors it (connector-kit tools/package.ts dependencyFiles): its
    CommonJS, licence and package.json, not its sources, ES module copy,
    source maps or type files; then its own dependencies."""
    src = npm_package_dir(name, start)
    if not src:
        not_built("%s: the npm package %s is not installed (cd apps && npm ci)" % (os.path.relpath(start, REPO), name))
        return
    if src not in NPM_PACKAGES:
        NPM_PACKAGES.append(src)
    with open(os.path.join(src, "package.json"), encoding="utf-8") as f:
        info = json.load(f)
    main_dir = os.path.dirname(os.path.normpath(info.get("main", "index.js"))) or "."
    target = "%s/node_modules/%s" % (dest, name)
    for root, dirs, files in os.walk(src):
        rel_root = os.path.relpath(root, src)
        top = rel_root.split(os.sep)[0]
        if rel_root != "." and (top == "src" or (top == "esm" and main_dir.split("/")[0] != "esm")):
            dirs[:] = []
            continue
        dirs[:] = sorted(d for d in dirs if d not in SKIP_NAMES)
        for fn in sorted(files):
            if fn.endswith((".map", ".ts", ".tsx", ".mts", ".cts", ".node")) or fn == "binding.gyp" or re.match(r"(README|CHANGELOG)", fn, re.I):
                continue
            full = os.path.join(root, fn)
            plan.append((full, target + "/" + os.path.relpath(full, src).replace(os.sep, "/")))
    for dep in sorted(info.get("dependencies") or {}):
        if dep not in seen:
            seen.add(dep)
            plan_npm_package(dep, src, dest, plan, seen)


def plan_dependencies(svc_dir, dest, plan, shared, seen=None):
    """A service's @phoenix/* dependencies into its node_modules, as npm would
    put them there, so require("@phoenix/synckit") works under run-js-service,
    and its own npm dependencies (plan_npm_package)."""
    seen = set() if seen is None else seen
    with open(os.path.join(svc_dir, "package.json"), encoding="utf-8") as f:
        deps = json.load(f).get("dependencies") or {}
    for name in sorted(deps):
        if name in seen:
            continue
        if name not in shared:
            if not name.startswith("@phoenix/"):
                seen.add(name)
                plan_npm_package(name, svc_dir, dest, plan, seen)
            continue
        seen.add(name)
        src, info = shared[name]
        main_dir = os.path.dirname(os.path.normpath(info.get("main", "index.js"))) or "."
        if not os.path.isdir(os.path.join(src, main_dir)):
            not_built("%s: %s is not built (cd apps && npm run build -w %s)"
                      % (os.path.relpath(svc_dir, REPO), os.path.relpath(os.path.join(src, main_dir), REPO), name))
            continue
        target = "%s/node_modules/%s" % (dest, name)
        plan.append((os.path.join(src, "package.json"), target + "/package.json"))
        for root, dirs, files in os.walk(os.path.join(src, main_dir)):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_NAMES)
            for fn in sorted(files):
                if ".test." in fn or fn.endswith((".ts", ".map")):
                    continue
                full = os.path.join(root, fn)
                plan.append((full, target + "/" + os.path.relpath(full, src)))
        plan_dependencies(src, dest, plan, shared, seen)


def plan_service(svc_id, svc_dir, plan):
    """/usr/palm/services/<id>/ (run-js-service) and its ls2 files under /usr/share/luna-service2."""
    plan_dependencies(svc_dir, "/usr/palm/services/%s" % svc_id, plan, shared_packages())
    for fn in sorted(os.listdir(svc_dir)):
        src = os.path.join(svc_dir, fn)
        if fn == "sysbus" or fn in SKIP_NAMES or ".test." in fn:
            continue
        if fn == "etc":
            # Files the service puts in the system's /etc (e.g. the backup
            # registrations in /etc/palm/backup).
            copy_tree(src, "/etc", plan)
            continue
        copy_tree(src, "/usr/palm/services/%s/%s" % (svc_id, fn), plan)
    sysbus = os.path.join(svc_dir, "sysbus")
    if os.path.isdir(sysbus):
        for fn in sorted(os.listdir(sysbus)):
            for suffix, sub in SYSBUS_DIRS:
                if fn.endswith(suffix):
                    plan.append((os.path.join(sysbus, fn), "/usr/share/luna-service2/%s/%s" % (sub, fn)))
                    break


# Open webOS's app services (the core apps' accounts, contacts, linker and
# calendar reminders), Mojo-era Node services OSE's mojoservicelauncher
# runs as they are, with OSE's bus files from compat/app-services (theirs
# are luna-service 1's): compat/app-services/README.md.
APP_SERVICES_DIR = os.path.join("third_party", "app-services")
APP_SERVICES_SYSBUS = os.path.join("compat", "app-services")
APP_SERVICE_SKIP = {"files", "desktop", "desktop-support", "test.sh", "run_tests.sh", "all-tests.json", "testSpec.json",
                    "jslint-ignore", ".project", "README.md"}


def plan_app_services(plan):
    base = os.path.join(REPO, APP_SERVICES_DIR)
    for name in sorted(os.listdir(base)) if os.path.isdir(base) else []:
        src = os.path.join(base, name)
        sysbus = os.path.join(REPO, APP_SERVICES_SYSBUS, name, "sysbus")
        if not os.path.isfile(os.path.join(src, "services.json")) or not os.path.isdir(sysbus):
            continue
        dest = "/usr/palm/services/" + name
        for fn in sorted(os.listdir(src)):
            if fn in APP_SERVICE_SKIP or fn in SKIP_NAMES or fn.endswith(".service"):
                continue
            path = os.path.join(src, fn)
            if fn in ("db", "tempdb"):
                # db8's kinds and permissions, where db8 reads them.
                for kind in ("kinds", "permissions"):
                    if os.path.isdir(os.path.join(path, kind)):
                        copy_tree(os.path.join(path, kind), "/etc/palm/%s/%s" % (fn, kind), plan)
                continue
            if fn == "activities":
                # activities/<id>/<activity>.json: OSE's configurator registers
                # services' from /etc/palm/activities/services/ (configurator
                # src/ActivityConfigurator.cpp:37, SERVICE_DIR).
                copy_tree(path, "/etc/palm/activities/services", plan)
                continue
            copy_tree(path, dest + "/" + fn, plan)
        # Phoenix's additions to the service's code (accounts'
        # listMyAccounts: its services.json and sources.json, with the
        # original's entries, and the new handler), beside the bus files in
        # compat/app-services/<id>/: later entries win, as overlays do.
        overlay = os.path.dirname(sysbus)
        for fn in sorted(os.listdir(overlay)):
            if fn in ("sysbus", "README.md") or fn in SKIP_NAMES:
                continue
            copy_tree(os.path.join(overlay, fn), dest + "/" + fn, plan, skip_tests=True)
        for fn in sorted(os.listdir(sysbus)):
            for suffix, sub in SYSBUS_DIRS:
                if fn.endswith(suffix):
                    plan.append((os.path.join(sysbus, fn), "/usr/share/luna-service2/%s/%s" % (sub, fn)))
                    break


def copy_tree(src, dst, plan, skip_top=(), skip_tests=False):
    if os.path.isfile(src):
        plan.append((src, dst))
        return
    for root, dirs, files in os.walk(src):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_NAMES and not (root == src and d in skip_top))
        for fn in sorted(files):
            if fn in SKIP_NAMES or (skip_tests and ".test." in fn):
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


APPINFO = re.compile(r"^(/media/cryptofs/apps)?/usr/palm/applications/[^/]+/appinfo\.json$")


def device_appinfo(data):
    """An app's appinfo.json for WebAppMgr: disableBackHistoryAPI true unless
    the app says otherwise. webOS 1-3 apps, and Phoenix's, take Back in the
    page (Mojo and Enyo 1.0 as Escape / U+1200001, @phoenix/ui's useBack as
    Escape; phoenix-runtime.js gives them those for the webOS Back key on a
    device). With the history API on, WebAppMgr would give the page the key
    only while its history can go back (_WEBOS_ACCESS_POLICY_KEYS_BACK,
    wam src/platform/web_app_wayland.cc:725-733), so a page's own Back (a
    dialog, a view) would never run. Text that is not JSON is left as it is."""
    try:
        info = json.loads(data.decode("utf-8-sig"))
    except (ValueError, UnicodeDecodeError):
        return data
    if not isinstance(info, dict) or "disableBackHistoryAPI" in info:
        return data
    info["disableBackHistoryAPI"] = True
    return (json.dumps(info, indent=4, ensure_ascii=False) + "\n").encode("utf-8")


STRICT = True
UNBUILT = []   # what plan(strict=False) could not install: apps and packages not built
# The npm packages the services carry (plan_npm_package), from the
# checkout's node_modules: not in git, so tools/pack-apps-dist.sh packs
# them for the recipe with the built apps (--npm-packages).
NPM_PACKAGES = []


def not_built(message):
    if STRICT:
        sys.exit(message)
    UNBUILT.append(message)


def plan(repo=None, strict=True):
    """({device path: source file} of everything the image gets, [what is
    missing because it was not built]). strict: stop at the first thing not
    built, as the recipe must (tools/devicecheck reads the plan without)."""
    global REPO, STRICT
    saved = REPO, STRICT
    if repo:
        REPO = os.path.abspath(repo)
    STRICT = strict
    del UNBUILT[:]
    del NPM_PACKAGES[:]
    try:
        final = build_plan()
    finally:
        REPO, STRICT = saved
    return final, list(UNBUILT)


# Device paths phoenix-shell installs itself (shell/CMakeLists.txt) that the
# simulator serves through rootfs.json's mounts: on the image only one
# package may own a path, and phoenix-apps' FILES does not take these.
SHELL_OWNS = {"/usr/share/fonts/open-sans/"}


def build_plan():
    cfg = load_config()
    plan = []   # (source file, device path)
    services = find_services(cfg)
    service_dirs = [os.path.realpath(d) + os.sep for _, d in services]
    for prefix, target in cfg["mounts"].items():
        if prefix == "/usr/palm/frameworks/enyo/1.0/framework/":
            continue   # installed once, as 0.10, and symlinked below
        # A mount into an app's service/ is there for the simulator, which
        # reads the service from its device path; the service itself is
        # installed below, with its sysbus files and without its tests.
        src = os.path.realpath(os.path.join(REPO, target)) + os.sep
        if any(src.startswith(d) for d in service_dirs):
            continue
        # The simulator's stand-ins for what servers hold (the sample driver
        # catalog, server/drivers/sample) are not part of a device.
        if target.startswith("server/"):
            continue
        # The simulator's demo servers (chat.example: the Jabber connector's
        # fake server) and its connector settings (runtime/connector-settings:
        # a device's come from the image's recipe, never from the tree).
        if prefix.startswith("/usr/share/phoenix/demo/") or prefix == "/etc/phoenix/connectors/":
            continue
        # The shared packages the simulator's service loader finds by name:
        # a device has a copy in each service that needs one (plan_service).
        if prefix.startswith("/usr/lib/phoenix/node_modules/"):
            continue
        if prefix in SHELL_OWNS:
            continue
        copy_tree(os.path.join(REPO, target), prefix.rstrip("/"), plan)
    # The product file and its release notes (product.json).
    for device_path, target in product_files(cfg).items():
        copy_tree(os.path.join(REPO, target), device_path, plan)
    for app_id, app_dir in find_apps(cfg):
        # An app's service/ is installed on its own, below (apps/dav keeps
        # its appinfo.json at the top, so its whole folder is the app).
        copy_tree(app_dir, "/usr/palm/applications/" + app_id, plan, skip_top=("service",))
        # db8 kinds and permissions the app declares (as openwebos/build-desktop did).
        for kind in ("kinds", "permissions"):
            d = os.path.join(app_dir, "configuration", "db", kind)
            if os.path.isdir(d):
                copy_tree(d, "/etc/palm/db/" + kind, plan)
        # Activities the app schedules from the start (the Clock's alarm
        # updates, the Calendar's reminders): OSE's configurator registers
        # them with the activity manager from /etc/palm/activities/applications/
        # <id>/ (configurator src/ActivityConfigurator.cpp:36, APP_DIR), where
        # openwebos/build-desktop put them; in the app's folder nobody reads them.
        for sub in (os.path.join("configuration", "activities"), "activities"):
            d = os.path.join(app_dir, sub)
            if os.path.isdir(d):
                copy_tree(d, "/etc/palm/activities/applications", plan)
    # The connector packages Phoenix comes with: in the apps the user may
    # remove, the whole package's app (its service/ too, with what it needs
    # in service/node_modules, as `phoenix-connector pack` packs it), so the
    # Marketplace removes it and installs it again like any other. Its kinds
    # go to /etc/palm/db as a built-in app's; its service is also registered
    # with the system below (find_services), until a device runs the
    # services of installed connectors itself (docs/SYNERGY-CONNECTORS.md C5).
    for app_id, app_dir in sorted(load_preinstalled(cfg).items()):
        if not os.path.isfile(os.path.join(app_dir, "appinfo.json")):
            app_dir = os.path.join(app_dir, "dist")
        dest = "/media/cryptofs/apps/usr/palm/applications/" + app_id
        # Its service's tests stay out, as plan_service leaves them out.
        copy_tree(app_dir, dest, plan, skip_tests=True)
        if os.path.isfile(os.path.join(app_dir, "service", "package.json")):
            plan_dependencies(os.path.join(app_dir, "service"), dest + "/service", plan, shared_packages())
        for kind in ("kinds", "permissions"):
            d = os.path.join(app_dir, "configuration", "db", kind)
            if os.path.isdir(d):
                copy_tree(d, "/etc/palm/db/" + kind, plan)
    for svc_id, svc_dir in services:
        plan_service(svc_id, svc_dir, plan)
    plan_app_services(plan)
    for overlay in cfg.get("overlays", []):
        base = os.path.join(REPO, overlay)
        for root, dirs, files in os.walk(base):
            for fn in files:
                if fn == ".gitkeep":
                    continue
                s = os.path.join(root, fn)
                plan.append((s, "/" + os.path.relpath(s, base)))

    # Later entries (overlays) win. No Finder files, from any tree.
    final = {}
    for src, dev in plan:
        if macos_file(os.path.basename(dev)):
            continue
        final[dev] = src
    # Files of the original apps we do not redistribute (docs/LEGAL.md).
    for dev in cfg.get("exclude", []):
        final.pop(dev, None)
    GENERATED.clear()
    # The release notes without their unreleased notes (shipped_notes).
    if RELEASE_NOTES in final:
        GENERATED[RELEASE_NOTES] = shipped_notes(final[RELEASE_NOTES])
        final[RELEASE_NOTES] = "generated: %s without its unreleased notes" % os.path.relpath(final[RELEASE_NOTES], REPO)
    # Each app's luna-service2 role and client permissions, which an OSE
    # image's own apps get from webos_app_generate_security_files.bbclass
    # (meta-webos): without them luna-hub refuses the app's every call.
    compat_perms = {}
    cp = os.path.join(REPO, "compat", "app-permissions.json")
    if os.path.isfile(cp):
        with open(cp, encoding="utf-8") as f:
            compat_perms = {k: v for k, v in json.load(f).items() if not k.startswith("//")}
    for dev in sorted(final):
        m = APPINFO.match(dev)
        if not m:
            continue
        try:
            with open(final[dev], encoding="utf-8-sig") as f:
                info = json.loads(f.read())
        except (ValueError, OSError):
            continue
        # The original apps predate ACG: compat/app-permissions.json gives them their groups.
        if isinstance(info, dict) and "requiredPermissions" not in info and info.get("id") in compat_perms:
            info["requiredPermissions"] = compat_perms[info["id"]]
        for path, data in security_files(info).items():
            if path not in final and path.replace(".app.json", ".role.json") not in final:
                GENERATED[path] = data
                final[path] = "generated: %s's ACG files (webos_app_generate_security_files)" % info.get("id")
    return final


GENERATED = {}   # device path -> bytes, for plan entries made here, not copied


def security_files(info):
    """The role and client-permission files meta-webos writes for an app at
    build time (webos_app_generate_security_files.bbclass,
    WEBOS_SYSTEM_BUS_ACG_ENABLED "FALSE" as OSE builds): the appinfo's
    requiredPermissions, plus "public" (and "private" for com.palm. and
    com.webos. web apps), and a role that lets the app's processes
    ("<id>-*") onto the bus."""
    app_id, kind = info.get("id"), info.get("type")
    if not app_id or kind not in ("web", "qml", "native"):
        return {}
    key = app_id if kind == "native" else app_id + "-*"
    groups = list(info.get("requiredPermissions") or [])
    trust = info.get("trustLevel", "default")
    pub = trust in ("default", "trusted")
    prv = trust == "trusted"
    if kind == "web" and ("com.palm." in app_id or "com.webos." in app_id):
        prv = True
    elif kind == "qml":
        prv = pub = True
    elif kind == "native":
        pub = True
    if prv:
        pub = True
        if "private" not in groups:
            groups.append("private")
    if pub and "public" not in groups:
        groups.append("public")
    if kind == "native":
        role = {"exeName": "/usr/palm/applications/%s/%s" % (app_id, info.get("main", "")), "type": "regular",
                "allowedNames": [app_id + "*"], "permissions": [{"service": app_id, "outbound": ["*"]}],
                "trustLevel": "oem"}
    else:
        role = {"appId": app_id, "type": "regular", "allowedNames": [app_id + "-*"],
                "permissions": [{"service": app_id + "-*", "outbound": ["*"]}], "trustLevel": "oem"}

    def dump(obj):
        return (json.dumps(obj, indent=4) + "\n").encode("utf-8")
    return {
        "/usr/share/luna-service2/roles.d/%s.app.json" % app_id: dump(role),
        "/usr/share/luna-service2/client-permissions.d/%s.app.json" % app_id: dump({key: groups}),
    }


def content(dev, src):
    """The bytes the image gets at device path dev from src, as installed below."""
    if dev in GENERATED:
        return GENERATED[dev]
    with open(src, "rb") as f:
        data = f.read()
    # App pages, and Enyo 1.0's framework pages an app opens as a
    # window (dashboard-window), as in phoenix-sim and serve-rootfs.py.
    if dev.startswith(("/usr/palm/applications/", "/media/cryptofs/apps/usr/palm/applications/", "/usr/palm/frameworks/enyo/")) \
            and dev.endswith(".html"):
        return inject_runtime(data)
    if APPINFO.match(dev):
        return device_appinfo(data)
    return data


# ---- The image's manifest (docs/DEV-PUSH.md 8) ------------------------------------------

DEVPUSH_PATHS = os.path.join("apps", "shared", "platform", "src", "devpush-paths.json")
# The manifest's format and the image-time stamp: meta-phoenix's library,
# which the image's class (phoenix-devpush.bbclass) uses too.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "meta-phoenix", "lib"))
from phoenix.devpush import MANIFEST, dump_manifest, file_mode, stamp as _stamp  # noqa: E402


def stamp(rootfs, build=None, compatible=None):
    try:
        return _stamp(rootfs, build, compatible)
    except ValueError as e:
        sys.exit("install-rootfs --stamp: %s (or give --build)" % e)


def devpush_rules():
    """The rules of this checkout's tools (not of the checkout installed from: --repo)."""
    with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), DEVPUSH_PATHS), encoding="utf-8") as f:
        return json.load(f)


def overlayable(path, rules):
    """A device path a dev bundle may change (devpush.js pathProblem: in the
    overlay's directories, not refused)."""
    if not any(path.startswith(m + "/") for m in rules["mounts"]):
        return False
    for r in rules["refused"]:
        if (path.startswith(r) if r.endswith("/") else path == r):
            return False
    return not any(re.search(p, path) for p in rules["refusedPatterns"])


def shell_plan(repo=None):
    """{device path: source} of what phoenix-shell installs that a dev bundle
    may change: shell/qml and shell/assets at /usr/share/phoenix (without
    the colour emoji font, which goes to the system's fonts and is linked
    there), and its client permissions (shell/CMakeLists.txt, install())."""
    shell = os.path.join(repo or REPO, "shell")
    out = {}
    for sub, skip in (("qml", ()), ("assets", ("noto-color-emoji",))):
        base = os.path.join(shell, sub)
        for root, dirs, files in os.walk(base):
            dirs[:] = sorted(d for d in dirs if d not in skip)
            for fn in sorted(files):
                if fn in skip or macos_file(fn):
                    continue
                full = os.path.join(root, fn)
                out["/usr/share/phoenix/%s/%s" % (sub, os.path.relpath(full, base).replace(os.sep, "/"))] = full
    perm = os.path.join(shell, "sysbus", "com.webos.surfacemanager.phoenix.perm.json")
    if os.path.isfile(perm):
        out["/usr/share/luna-service2/client-permissions.d/com.webos.surfacemanager.phoenix.perm.json"] = perm
    return out


def product_info(repo=None):
    """{name, version, line}: the product the checkout builds (product.json);
    line is its major version as "1.0": 2.0 devices take no 1.0 bundles."""
    try:
        with open(os.path.join(repo or REPO, "product.json"), encoding="utf-8") as f:
            p = json.load(f)
    except (OSError, ValueError) as e:
        sys.exit("install-rootfs: product.json: %s" % e)
    m = re.match(r"^(\d+)\.", str(p.get("version", "")))
    if not m:
        sys.exit("install-rootfs: product.json has no version such as 1.0.0")
    return {"name": p.get("name", ""), "version": p["version"], "line": "%s.0" % m.group(1)}


def source_info(repo=None):
    """The checkout's commit and whether it has changes, when it is a git checkout."""
    repo = repo or REPO
    try:
        commit = subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "-C", repo, "status", "--porcelain", "--untracked-files=no"],
                               capture_output=True, text=True, check=True).stdout.strip() != ""
    except (OSError, subprocess.CalledProcessError):
        return None
    return {"repo": "webos-phoenix", "commit": commit, "dirty": dirty}


def make_manifest(final, build="unstamped", compatible=None, repo=None):
    """The manifest of the apps' plan (final) and the shell's: format 1,
    {format, build, product, compatible, source, files: [{path, size,
    sha256, mode}]}, the files sorted by path (docs/platform-api/
    devpush.schema.json, imageManifest)."""
    rules = devpush_rules()
    everything = dict(shell_plan(repo))
    everything.update(final)
    files = []
    for dev in sorted(everything):
        if not overlayable(dev, rules):
            continue
        src = everything[dev]
        data = content(dev, src)
        mode = "0644" if dev in GENERATED else file_mode(os.stat(src).st_mode)
        files.append({"path": dev, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "mode": mode})
    out = {"format": 1, "build": build, "product": product_info(repo), "compatible": compatible}
    src = source_info(repo)
    if src:
        out["source"] = src
    out["files"] = files
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("destdir", nargs="?")
    ap.add_argument("--list", action="store_true", help="print what would be installed and exit")
    ap.add_argument("--manifest", action="store_true", help="also write DESTDIR" + MANIFEST + " (docs/DEV-PUSH.md 8)")
    ap.add_argument("--print-manifest", action="store_true", help="print the checkout's manifest and exit")
    ap.add_argument("--stamp", metavar="ROOTFS", help="at image time: hash the image's own files into its manifest, with its BUILD_ID")
    ap.add_argument("--only", metavar="LIST", help="install only the device paths in LIST (- for standard input), the shell's too")
    ap.add_argument("--build", help="the manifest's build id (default: unstamped; --stamp reads /etc/os-release)")
    ap.add_argument("--compatible", help="the manifest's device type (RAUC's compatible), if it is for one")
    ap.add_argument("--repo", help="the checkout to install from (default: this one)")
    ap.add_argument("--npm-packages", action="store_true",
                    help="print the folders of the npm packages the services carry (for tools/pack-apps-dist.sh) and exit")
    args = ap.parse_args()
    global REPO
    if args.repo:
        REPO = os.path.abspath(args.repo)

    if args.stamp:
        m = stamp(args.stamp, args.build, args.compatible)
        print("Stamped %s: build %s, %d files" % (MANIFEST, m["build"], len(m["files"])), file=sys.stderr)
        return
    if args.npm_packages:
        plan()
        for d in NPM_PACKAGES:
            print(os.path.relpath(d, REPO))
        return
    if args.print_manifest:
        # What is not built is named ("unbuilt"), not fatal: nova decides.
        final, unbuilt = plan(strict=False)
        m = make_manifest(final, args.build or "checkout", args.compatible)
        if unbuilt:
            m["unbuilt"] = unbuilt
        sys.stdout.buffer.write(dump_manifest(m))
        return
    if not args.destdir:
        ap.error("DESTDIR is needed")

    final, _ = plan(strict=not args.only)

    if args.list:
        for dev in sorted(final):
            print(dev)
        return

    if args.only:
        with (sys.stdin if args.only == "-" else open(args.only, encoding="utf-8")) as f:
            wanted = [line.strip() for line in f if line.strip()]
        everything = dict(shell_plan())
        everything.update(final)
        missing = [d for d in wanted if d not in everything]
        if missing:
            sys.exit("install-rootfs --only: not something the checkout installs: %s" % ", ".join(missing[:5]))
        for dev in wanted:
            dst = os.path.join(args.destdir, dev.lstrip("/"))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, "wb") as f:
                f.write(content(dev, everything[dev]))
            if dev not in GENERATED:
                os.chmod(dst, 0o755 if file_mode(os.stat(everything[dev]).st_mode) == "0755" else 0o644)
        return

    for dev, src in sorted(final.items()):
        dst = os.path.join(args.destdir, dev.lstrip("/"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if dev in GENERATED:
            with open(dst, "wb") as f:
                f.write(GENERATED[dev])
            continue
        if dev.startswith(("/usr/palm/applications/", "/media/cryptofs/apps/usr/palm/applications/", "/usr/palm/frameworks/enyo/")) \
                and dev.endswith(".html") or APPINFO.match(dev):
            with open(dst, "wb") as f:
                f.write(content(dev, src))
            shutil.copymode(src, dst)
        else:
            shutil.copy2(src, dst)

    # Enyo 1.0 was published as "0.10"; apps use either path.
    enyo = os.path.join(args.destdir, "usr/palm/frameworks/enyo")
    if os.path.isdir(os.path.join(enyo, "0.10")) and not os.path.lexists(os.path.join(enyo, "1.0")):
        os.symlink("0.10", os.path.join(enyo, "1.0"))
    if args.manifest:
        dst = os.path.join(args.destdir, MANIFEST.lstrip("/"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as f:
            f.write(dump_manifest(make_manifest(final, args.build or "unstamped", args.compatible)))
    print("Installed %d files into %s" % (len(final), args.destdir), file=sys.stderr)


if __name__ == "__main__":
    main()
