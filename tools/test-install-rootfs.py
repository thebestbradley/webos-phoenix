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
                        check=True, capture_output=True, text=True).stdout.splitlines()  # one path a line: some have spaces
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
# Phoenix's additions to their code (compat/app-services/<id>/ beside
# sysbus/): accounts' listMyAccounts, its handler loaded by the overlaid
# sources.json and named by the overlaid services.json.
ACCT = os.path.join(REPO, "compat", "app-services", "com.palm.service.accounts")
ORIGINAL = os.path.join(REPO, "third_party", "app-services", "com.palm.service.accounts")
check("/usr/palm/services/com.palm.service.accounts/handlers/list-my-accounts.js" in paths,
      "accounts: Phoenix's listMyAccounts handler is installed")
with open(os.path.join(ACCT, "sources.json"), encoding="utf-8") as f:
    srcs = [e.get("source") for e in json.load(f)]
with open(os.path.join(ACCT, "services.json"), encoding="utf-8") as f:
    cmds = {c["name"]: c for c in json.load(f)["services"][0]["commands"]}
check("handlers/list-my-accounts.js" in srcs and srcs.index("handlers/list-my-accounts.js") > srcs.index("handlers/list-accounts.js")
      and all(os.path.isfile(os.path.join(ACCT, s)) or os.path.isfile(os.path.join(ORIGINAL, s)) for s in srcs if s),
      "accounts: the overlaid sources.json loads the handler after list-accounts.js, and every source exists")
check(cmds.get("listMyAccounts", {}).get("assistant") == "ListMyAccountsCommandAssistant" and not cmds["listMyAccounts"].get("public")
      and "listAccounts" in cmds and "readCredentials" in cmds,
      "accounts: the overlaid services.json keeps the original's commands and adds listMyAccounts")
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

# Every wallpaper Settings offers (its albums, apps/settings/src/WallpaperPicker.tsx),
# picture and thumbnail, is installed where the picker sets it, and the
# shell's default (Theme.defaultWallpaperPath) is among them.
WP_DIR = "/usr/palm/applications/org.webosphoenix.settings/wallpapers/"
with open(os.path.join(REPO, "apps", "settings", "src", "WallpaperPicker.tsx"), encoding="utf-8") as f:
    picker = f.read()
albums = re.findall(r'album\("(\w+)", \[([^\]]*)\]\)', picker)
names = [n for _, ns in albums for n in re.findall(r'"([^"]+)"', ns)]
check([a for a, _ in albums] == ["Artistic", "Nature"] and len(names) == 21,
      "Settings' wallpapers: %d in albums %s" % (len(names), ", ".join(a for a, _ in albums)))
slugs = [n.lower().replace(" ", "-") for n in names]
missing = [s for s in slugs if WP_DIR + s + ".jpg" not in paths or WP_DIR + "thumbs/" + s + ".jpg" not in paths]
check(not missing, "every wallpaper and its thumbnail is installed (missing: %s)" % (", ".join(missing) or "none"))
on_disk = sorted(f[:-4] for f in os.listdir(os.path.join(REPO, "apps", "settings", "public", "wallpapers")) if f.endswith(".jpg"))
check(on_disk == sorted(slugs), "every wallpaper in public/wallpapers is offered in an album")
with open(os.path.join(REPO, "shell", "qml", "Phoenix", "Shell", "Theme.qml"), encoding="utf-8") as f:
    default = re.search(r'defaultWallpaperPath: "([^"]+)"', f.read()).group(1)
check(default == WP_DIR + "northern-lights.jpg" and default in paths, "the shell's default wallpaper is installed: " + default)
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
    nk = [base64.b64encode(os.urandom(32)).decode() for _ in range(2)]
    r = subprocess.run([sys.executable, os.path.join(REPO, "tools", "servers-json.py"), out, "--feeds", "https://feeds.example.org",
                        "--notices-key", ",".join(nk), "--site", "https://example.org"], capture_output=True, text=True)
    made = json.load(open(out)) if r.returncode == 0 else {}
    check(r.returncode == 0 and made.get("notices") == {"url": "notices/v1/notices.json", "keys": nk, "site": "https://example.org/"}
          and "notices" in r.stdout, "servers-json.py: the notices feed, its keys pinned (docs/NOTICES.md)")
    r = subprocess.run([sys.executable, os.path.join(REPO, "tools", "servers-json.py"), out, "--feeds", "https://f.example.org/",
                        "--notices-key", nk[0] + ",c2hvcnQ="], capture_output=True, text=True)
    check(r.returncode != 0 and "Ed25519" in r.stderr, "servers-json.py: a notices key that is not one refused")
    r = subprocess.run([sys.executable, os.path.join(REPO, "tools", "servers-json.py"), out, "--feeds", "http://feeds.example.org/"],
                       capture_output=True, text=True)
    check(r.returncode != 0 and "https" in r.stderr, "servers-json.py: plain HTTP refused for an image")
    r = subprocess.run([sys.executable, os.path.join(REPO, "tools", "servers-json.py"), out, "--feeds", "https://f.example.org/",
                        "--catalog-root", "c2hvcnQ="], capture_output=True, text=True)
    check(r.returncode != 0 and "Ed25519" in r.stderr, "servers-json.py: a key that is not one refused")
    dk = base64.b64encode(os.urandom(32)).decode()
    r = subprocess.run([sys.executable, os.path.join(REPO, "tools", "servers-json.py"), out, "--feeds", "https://f.example.org/",
                        "--devpush-key", dk], capture_output=True, text=True)
    made = json.load(open(out)) if r.returncode == 0 else {}
    check(r.returncode == 0 and made.get("devpush") == {"key": dk} and "devpush" in r.stdout,
          "servers-json.py: dev push's platform key pinned (docs/DEV-PUSH.md 9.1)")
    r = subprocess.run([sys.executable, os.path.join(REPO, "tools", "servers-json.py"), out, "--feeds", "https://f.example.org/"],
                       capture_output=True, text=True)
    check(r.returncode == 0 and json.load(open(out)).get("devpush") == {"key": None}, "servers-json.py: no dev push key unless given")
    r = subprocess.run([sys.executable, os.path.join(REPO, "tools", "servers-json.py"), out, "--feeds", "https://f.example.org/",
                        "--devpush-key", "c2hvcnQ="], capture_output=True, text=True)
    check(r.returncode != 0 and "Ed25519" in r.stderr, "servers-json.py: a dev push key that is not one refused")
    r = subprocess.run([sys.executable, os.path.join(REPO, "tools", "servers-json.py"), "--check",
                        os.path.join(REPO, "services", "account", "etc", "palm", "phoenix", "servers.json")], capture_output=True, text=True)
    check(r.returncode == 0, "servers-json.py --check: the simulator's file")

# meta-phoenix's lib/phoenix/devpush.py at image time (phoenix-devpush.bbclass):
# BUILD_ID written through OE's /etc/os-release link, Developer Mode off as
# built (OSE's recipe writes its flag into the image).
sys.path.insert(0, os.path.join(REPO, "meta-phoenix", "lib"))
from phoenix import devpush as dp  # noqa: E402
with tempfile.TemporaryDirectory() as tmp:
    os.makedirs(os.path.join(tmp, "usr/lib"))
    os.makedirs(os.path.join(tmp, "etc"))
    with open(os.path.join(tmp, "usr/lib/os-release"), "w") as f:
        f.write('ID=webos\nVERSION_ID="1.0.0"\nBUILD_ID="old"\n')
    os.symlink("../usr/lib/os-release", os.path.join(tmp, "etc/os-release"))
    written = dp.set_build_id(tmp, "20261126051500")
    text = open(os.path.join(tmp, "usr/lib/os-release")).read()
    check(written == os.path.join(tmp, "usr/lib/os-release") and os.path.islink(os.path.join(tmp, "etc/os-release"))
          and text.count("BUILD_ID=") == 1 and 'BUILD_ID="20261126051500"' in text and 'VERSION_ID="1.0.0"' in text
          and dp.os_release_build(tmp) == "20261126051500",
          "devpush.py: BUILD_ID into os-release through /etc/os-release's link, replacing one there")
    check(dp.set_build_id(os.path.join(tmp, "nothing"), "x") is None, "devpush.py: no os-release, nothing written")
    prefs = os.path.join(tmp, "var/luna/preferences")
    os.makedirs(prefs)
    for fn in ("devmode_enabled", "dc0", "other"):
        open(os.path.join(prefs, fn), "w").close()
    gone = dp.devmode_off(tmp)
    check(sorted(gone) == ["/var/luna/preferences/dc0", "/var/luna/preferences/devmode_enabled"]
          and os.listdir(prefs) == ["other"] and dp.devmode_off(tmp) == [],
          "devpush.py: Developer Mode off as built (OSE's flag and its dc markers gone)")
    try:
        dp.stamp(tmp)
        stamped = False
    except ValueError as e:
        stamped = "manifest.json" in str(e)
    check(stamped, "devpush.py: stamping without a manifest says so")

# meta-phoenix's lib/phoenix/developerapps.py at image time
# (phoenix-developer-apps.bbclass): the platform's test apps listed in
# conf/developer-apps.json get Phoenix's developer flag in their appinfo.json
# (docs/APP-RUNTIME.md "Developer apps").
from phoenix import developerapps as da  # noqa: E402
dev_listed = da.load(os.path.join(REPO, "meta-phoenix", "conf", "developer-apps.json"))
check("com.webos.app.test.youtube" in dev_listed and not any(i.startswith("org.webosphoenix.") for i in dev_listed),
      "developer-apps.json: the platform's test apps, none of Phoenix's own (their appinfo.json says so)")
with tempfile.TemporaryDirectory() as tmp:
    def appinfo(app_id, text):
        os.makedirs(os.path.join(tmp, da.APPS_DIR, app_id))
        with open(os.path.join(tmp, da.APPS_DIR, app_id, "appinfo.json"), "w") as f:
            f.write(text)
    appinfo("com.webos.app.test.youtube", '{"id": "com.webos.app.test.youtube", "title": "YouTube", "visible": true}')
    appinfo("org.example.flagged", '{"id": "org.example.flagged", "phoenix": {"developer": true, "launcherTab": 1}}')
    appinfo("org.example.broken", '{"id": ')
    appinfo("org.example.odd", '{"id": "org.example.odd", "phoenix": "yes"}')
    marked, missing, failed = da.mark(tmp, ["com.webos.app.test.youtube", "org.example.flagged", "org.example.gone",
                                            "org.example.broken", "org.example.odd"])
    yt = json.load(open(os.path.join(tmp, da.APPS_DIR, "com.webos.app.test.youtube", "appinfo.json")))
    flagged = json.load(open(os.path.join(tmp, da.APPS_DIR, "org.example.flagged", "appinfo.json")))
    check(marked == ["com.webos.app.test.youtube", "org.example.flagged"] and missing == ["org.example.gone"]
          and [f[0] for f in failed] == ["org.example.broken", "org.example.odd"],
          "developerapps.py: listed apps marked, a missing one skipped, a bad appinfo.json reported")
    check(yt == {"id": "com.webos.app.test.youtube", "title": "YouTube", "visible": True, "phoenix": {"developer": True}}
          and flagged["phoenix"] == {"developer": True, "launcherTab": 1},
          "developerapps.py: the flag added beside what the appinfo.json had")
    bad = os.path.join(tmp, "list.json")
    for text, why in (('{"apps": {"org.webosphoenix.notificationlab": "x"}}', "Phoenix's own"),
                      ('{"apps": {"com.example.test": ""}}', "a reason"), ('{"apps": {"bad id": "x"}}', "not an app id")):
        with open(bad, "w") as f:
            f.write(text)
        try:
            da.load(bad)
            refused = False
        except ValueError as e:
            refused = why in str(e)
        check(refused, "developerapps.py: a list naming %s refused" % ("an app without " + why if why == "a reason" else why))

# The release notes ship without "unreleased", the next version's notes
# while work goes on (docs/APP-STORE.md 3.15); the versions as they are.
import importlib.util  # noqa: E402
spec = importlib.util.spec_from_file_location("install_rootfs", os.path.join(REPO, "tools", "install-rootfs.py"))
ir = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ir)
ir.plan(strict=False)
shipped = json.loads(ir.GENERATED.get(ir.RELEASE_NOTES, b"{}"))
product = json.load(open(os.path.join(REPO, "product.json")))
source = json.load(open(os.path.join(REPO, product["releaseNotes"])))
check(ir.RELEASE_NOTES in paths and "unreleased" not in shipped and shipped.get("versions") == source["versions"],
      "release notes: installed without their unreleased notes, the versions as written")
with tempfile.TemporaryDirectory() as tmp:
    notes = os.path.join(tmp, "notes.json")
    json.dump({"format": 1, "unreleased": {"new": ["Next."]}, "versions": source["versions"]}, open(notes, "w"))
    check(json.loads(ir.shipped_notes(notes)) == {"format": 1, "versions": source["versions"]}, "release notes: unreleased notes dropped")

# The image's manifest (docs/DEV-PUSH.md 8; tools/test-nova-bundle.cjs tests
# --manifest, --stamp and the bundle maker on a small checkout): this
# checkout's, every file a dev bundle may change and nothing else.
import hashlib  # noqa: E402
final, _ = ir.plan(strict=False)
man = ir.make_manifest(final, "test-build")
mpaths = [f["path"] for f in man["files"]]
rules = ir.devpush_rules()
check(man["format"] == 1 and man["build"] == "test-build" and man["product"]["line"] == "1.0"
      and man["product"]["version"] == product["version"], "manifest: format 1, the build, the product line 1.0")
check(mpaths == sorted(mpaths) and len(set(mpaths)) == len(mpaths), "manifest: %d files, sorted, each once" % len(mpaths))
check(all(ir.overlayable(p, rules) for p in mpaths), "manifest: only paths the developer overlay covers")
check(not any(p.startswith(("/etc/palm/phoenix/", "/usr/palm/services/com.palm.update/", "/media/")) for p in mpaths)
      and "/etc/palm/marketplace/sources.json" not in mpaths and "/etc/palm/hardware/catalog.json" not in mpaths
      and ir.MANIFEST not in mpaths, "manifest: no trust anchors, com.palm.update, /media or itself")
check("/usr/share/phoenix/qml/Phoenix/Shell/Shell.qml" in mpaths and "/usr/share/phoenix/runtime/phoenix-runtime.js" in mpaths
      and not any("noto-color-emoji" in p for p in mpaths), "manifest: the shell's QML and the runtime, not the emoji font")
check(set(mpaths) >= {p for p in paths if ir.overlayable(p, rules)}, "manifest: every overlayable file install-rootfs.py installs")
page = "/usr/palm/applications/org.webosphoenix.settings/index.html"
entry = next((f for f in man["files"] if f["path"] == page), None)
want = ir.inject_runtime(open(final[page], "rb").read()) if page in final else b""
check(entry is not None and entry["sha256"] == hashlib.sha256(want).hexdigest() and entry["size"] == len(want),
      "manifest: an app page's hash is of the page with the runtime's tag, as the image holds it")
check(all(f["mode"] in ("0644", "0755") for f in man["files"]), "manifest: modes 0644 or 0755")

# No macOS Finder files reach ${D} (Revisions 41 and 43 stopped in
# phoenix-apps' do_package, installed-vs-shipped, on /.DS_Store and
# /usr/.DS_Store): install-rootfs.py leaves them out of every tree, and
# phoenix-no-macos-files.bbclass deletes any under ${D} after do_install.
import shutil  # noqa: E402
MACOS_NAMES = re.compile(r"(^|/)(\.DS_Store|\._[^/]*|\.localized)$")
check(not [p for p in paths if MACOS_NAMES.search(p)], "Finder files: none in this checkout's plan")
check(not [p for p in ir.shell_plan() if MACOS_NAMES.search(p)], "Finder files: none in the shell's plan")
with tempfile.TemporaryDirectory() as tmp:
    fixture = os.path.join(tmp, "repo")
    shutil.copytree(os.path.join(REPO, "tools", "fixtures", "devicecheck", "bad"), fixture)
    shutil.rmtree(os.path.join(fixture, "services"))   # a service whose npm package is not installed
    with open(os.path.join(fixture, "runtime", "rootfs.json")) as f:
        cfg = json.load(f)
    cfg["overlays"] = ["compat/rootfs"]
    with open(os.path.join(fixture, "runtime", "rootfs.json"), "w") as f:
        json.dump(cfg, f)
    os.makedirs(os.path.join(fixture, "compat", "rootfs", "usr", "lib"))
    os.makedirs(os.path.join(fixture, "shell", "qml", "Phoenix"), exist_ok=True)
    planted = ["compat/rootfs/.DS_Store", "compat/rootfs/usr/.DS_Store", "compat/rootfs/usr/lib/._x.conf",
               "apps/.DS_Store", "apps/demo/.DS_Store", "apps/demo/._index.html", "apps/demo/.localized",
               "shell/qml/.DS_Store", "shell/qml/Phoenix/._Thing.qml"]
    for name in planted + ["compat/rootfs/usr/lib/x.conf"]:
        with open(os.path.join(fixture, name), "w") as f:
            f.write("x\n")
    dest = os.path.join(tmp, "D")
    run = subprocess.run([sys.executable, os.path.join(REPO, "tools", "install-rootfs.py"), dest, "--repo", fixture],
                         capture_output=True, text=True)
    installed = []
    for root, dirs, files in os.walk(dest):
        installed += ["/" + os.path.relpath(os.path.join(root, fn), dest) for fn in files]
    check(run.returncode == 0 and "/usr/lib/x.conf" in installed
          and "/usr/palm/applications/org.example.demo/index.html" in installed,
          "Finder files: a checkout with them planted installs (%s)" % (run.stderr.strip() or "ok"))
    check(not [p for p in installed if MACOS_NAMES.search(p)],
          "Finder files: none planted in compat/rootfs, apps or the shell reach ${D}: %s"
          % [p for p in installed if MACOS_NAMES.search(p)])
    check(not [p for p in ir.shell_plan(fixture) if MACOS_NAMES.search(p)], "Finder files: none in the shell's plan")

    # The bbclass's own function, run as do_install:append runs it, over a
    # ${D} with them planted (and a folder named like one, which stays).
    bbclass = open(os.path.join(REPO, "meta-phoenix", "classes", "phoenix-no-macos-files.bbclass")).read()
    func = re.search(r"^phoenix_remove_macos_files\(\) \{\n.*?^\}", bbclass, re.M | re.S).group(0)
    d = os.path.join(tmp, "image")
    keep = ["usr/palm/applications/a/index.html", "usr/share/phoenix/qml/._folder/Kept.qml", "etc/DS_Store.txt"]
    gone = [".DS_Store", "usr/.DS_Store", "usr/palm/applications/a/._index.html", "usr/share/.localized",
            "usr/palm/services/s/node_modules/p/.DS_Store"]
    for name in keep + gone:
        os.makedirs(os.path.dirname(os.path.join(d, name)), exist_ok=True)
        with open(os.path.join(d, name), "w") as f:
            f.write("x\n")
    os.symlink("nowhere", os.path.join(d, "usr", "._link"))
    gone.append("usr/._link")
    sh = subprocess.run(["sh", "-ec", 'bbnote() { echo "$*"; }\n%s\nphoenix_remove_macos_files "$1"' % func, "sh", d],
                        capture_output=True, text=True)
    left = [n for n in gone if os.path.lexists(os.path.join(d, n))]
    check(sh.returncode == 0 and not left and all(os.path.isfile(os.path.join(d, n)) for n in keep),
          "phoenix-no-macos-files.bbclass: removes .DS_Store, ._* and .localized under ${D}, nothing else (%s%s)"
          % (sh.stderr.strip(), left))
    check(sh.stdout.count("removing") == len(gone), "phoenix-no-macos-files.bbclass: names each one in the log")

if failures:
    print("%d failed" % failures)
    sys.exit(1)
print("all passed")
