#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""bin/web-apps.py without the network: the manifest's rules, unpacking an
untrusted archive, deterministic packages, the 2.0 apps from a checkout.
tests/run.php runs it (python3 -I) and checks the package it writes with
the catalog's own reader (Ipk::check):

    python3 -I server/marketplace/tests/web-apps-test.py OUT_DIR
"""

import contextlib
import importlib.util
import io
import json
import os
import shutil
import stat
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("webapps", os.path.join(HERE, "..", "bin", "web-apps.py"))
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)

failures = 0


def check(ok, what):
    global failures
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        failures += 1


def raises(f):
    try:
        f()
    except (ValueError, SystemExit) as e:
        return str(e) or "raised"
    return ""


def zip_of(entries, links=()):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name, body in entries.items():
            z.writestr(name, body)
        for name in links:
            info = zipfile.ZipInfo(name)
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            z.writestr(info, "/etc/passwd")
    return out.getvalue()


out_dir = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()
os.makedirs(out_dir, exist_ok=True)
tmp = tempfile.mkdtemp(prefix="web-apps-test-")

# ---- The manifest's rules ----
good = {"id": "org.example.paint", "title": "Paint", "version": "1.2.3", "developer": "Example", "license": "MIT OR Apache-2.0",
        "homepage": "https://example.org/", "source": "https://example.org/src", "categories": ["Graphics"], "summary": "Paint",
        "description": "Paint pictures.", "download": {"url": "https://example.org/paint.zip", "sha256": "0" * 64},
        "main": "index.html", "icon": {"path": "icon.png"}, "notices": []}
check(w.check_entry(good) == [], "a permissive app with every field passes")
check(any("not one the Marketplace hosts" in e for e in w.check_entry(dict(good, license="GPL-3.0-or-later"))),
      "a GPL app is refused: a link instead")
check(any("not one the Marketplace hosts" in e for e in w.check_entry(dict(good, license="MIT OR AGPL-3.0"))),
      "... and any expression naming a copyleft licence")
check(any("never Phoenix's" in e for e in w.check_entry(dict(good, id="org.webosphoenix.paint"))), "Phoenix's ids are not upstream's")
check(any("major.minor.micro" in e for e in w.check_entry(dict(good, version="2026.10.09.febb38d"))), "versions as SAM reads them")
check(any("https" in e for e in w.check_entry(dict(good, source="http://example.org/"))), "https addresses only")
real = w.load_manifest()
check(len(real) >= 12 and all(w.check_entry(a) == [] for a in real), "catalog/web-apps.json passes (%d apps)" % len(real))

# ---- Unpacking an untrusted archive ----
data = zip_of({"app-1/index.html": "<h1>x</h1>", "app-1/js/a.js": "1", "app-1/LICENSE": "MIT", "other/x": "y"})
dest = os.path.join(tmp, "u1")
n = w.unpack(data, "zip", "app-1/", None, dest)
check(n == 3 and open(os.path.join(dest, "js", "a.js")).read() == "1" and not os.path.exists(os.path.join(dest, "x")),
      "the files under the archive's folder, nothing else")
check(w.unpack(data, "zip", "app-1/", ["index.html", "js/"], os.path.join(tmp, "u2")) == 2, "... or only those included")
check("out of its folder" in raises(lambda: w.unpack(zip_of({"../evil": "x"}), "zip", "", None, os.path.join(tmp, "u3"))),
      "a path with .. is refused")
check("out of its folder" in raises(lambda: w.unpack(zip_of({"/etc/x": "x"}), "zip", "", None, os.path.join(tmp, "u4"))),
      "an absolute path is refused")
check("link" in raises(lambda: w.unpack(zip_of({"a/index.html": "x"}, links=["a/l"]), "zip", "a/", None, os.path.join(tmp, "u5"))),
      "a link is refused")
check("nothing under" in raises(lambda: w.unpack(zip_of({"b/index.html": "x"}), "zip", "a/", None, os.path.join(tmp, "u6"))),
      "an archive without the folder is refused")
check(w.safe_rel("a/./b//c") == "a/b/c" and w.safe_rel("a/../b") is None and w.safe_rel("C:/x") is None, "paths are checked")
check("SHA-256" in raises(lambda: w.fetch_checked("file:///dev/null", "f" * 64, tmp, "x")), "a download not as pinned is refused")
check(not any(n.startswith("dl-") for n in os.listdir(tmp)), "... and not kept")

# ---- Packages: the same bytes every time, as the catalog reads them ----
files = {"index.html": b"<h1>x</h1>", "icon.png": b"\x89PNG\r\n\x1a\n" + b"\0" * 24, "licenses/LICENSE": b"MIT",
         "appinfo.json": json.dumps(w.appinfo_for(good)).encode()}
one = w.ipk("org.example.paint", "1.2.3", {"Description": "Paint", "Source": "https://example.org/src"}, files)
two = w.ipk("org.example.paint", "1.2.3", {"Description": "Paint", "Source": "https://example.org/src"}, dict(reversed(list(files.items()))))
check(one == two, "a package is the same bytes from the same files")
info = w.appinfo_for(good)
check(info["vendor"] == "Example" and info["removable"] is True and info["type"] == "web" and info["phoenix"]["launcherTab"] == 1,
      "its appinfo.json: the upstream as vendor, a removable web app in Downloads")
with open(os.path.join(out_dir, "sample.ipk"), "wb") as f:
    f.write(one)
root = w.package_rootfs(os.path.join(out_dir, "sample.ipk"), os.path.join(tmp, "rootfs"))
check(open(os.path.join(root, "usr/palm/applications/org.example.paint/licenses/LICENSE")).read() == "MIT",
      "its files laid out as a device's root, for the simulator's screenshots")

# ---- The 2.0 apps from a checkout ----
os.environ.pop("PHOENIX_DEFAULT_APPS", None)
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    code = w.default_apps({"cache": os.path.join(tmp, "cache")}, [])
check(code == 0 and "skipped" in buf.getvalue(), "without a phoenix-default-apps checkout the 2.0 apps are skipped, saying why")
pda = os.path.join(tmp, "pda")
for rel, body in {"package.json": "{}", "apps/calc/public/appinfo.json": '{"id": "com.example.calc"}',
                  "apps/calc/package.json": '{"description": "Calc (com.example.calc): sums, rebuilt", "license": "Apache-2.0"}',
                  "apps/calc/dist/appinfo.json": '{"id": "com.example.calc", "version": "4.0.0", "title": "Calc", "removable": false, "main": "index.html"}',
                  "apps/calc/dist/index.html": "<h1>calc</h1>", "apps/unbuilt/public/appinfo.json": '{"id": "com.example.unbuilt"}',
                  # A Marketplace-only app (Home): left out of the 2.0 image, offered in the catalog.
                  "apps/homeassistant/public/appinfo.json": '{"id": "org.webosphoenix.home"}',
                  "apps/homeassistant/package.json": '{"description": "Home (org.webosphoenix.home): a companion for Home Assistant, '
                                                     'installed from the Marketplace", "license": "Apache-2.0"}',
                  "apps/homeassistant/dist/appinfo.json": '{"id": "org.webosphoenix.home", "version": "1.0.0", "title": "Home", '
                                                          '"removable": true, "main": "index.html", "icon": "icon.png", '
                                                          '"phoenix": {"launcherTab": 0, "catalogOnly": true}}',
                  "apps/homeassistant/dist/index.html": "<h1>home</h1>"}.items():
    path = os.path.join(pda, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(body)
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    code = w.default_apps({"cache": os.path.join(tmp, "cache"), "from": pda}, [])
packed = os.path.join(tmp, "cache", "phoenix-2.0", "com.example.calc", "4.0.0", "com.example.calc_4.0.0_all.ipk")
check(code == 0 and os.path.isfile(packed) and "unbuilt: skipped, not built" in buf.getvalue(),
      "a checkout's built apps are packed; one not built is skipped with the command that builds it")
calc = w.package_rootfs(packed, os.path.join(tmp, "calc"))
check(json.load(open(os.path.join(calc, "usr/palm/applications/com.example.calc/appinfo.json")))["removable"] is True,
      "... its appinfo.json removable: installed, it is an update of the built-in app")
os.replace(packed, os.path.join(out_dir, "default-app.ipk"))
home = os.path.join(tmp, "cache", "phoenix-2.0", "org.webosphoenix.home", "1.0.0", "org.webosphoenix.home_1.0.0_all.ipk")
check(os.path.isfile(home) and "org.webosphoenix.home 1.0.0" in buf.getvalue() and "Marketplace only" in buf.getvalue(),
      "a Marketplace-only app (phoenix.catalogOnly) is packed with the rest, saying so")
home_info = json.load(open(os.path.join(w.package_rootfs(home, os.path.join(tmp, "home")),
                                        "usr/palm/applications/org.webosphoenix.home/appinfo.json")))
check(home_info["removable"] is True and home_info["phoenix"]["catalogOnly"] is True, "... its appinfo.json as the app has it")
home_built = json.load(open(os.path.join(pda, "apps", "homeassistant", "dist", "appinfo.json")))
home_listing = w.default_listing("homeassistant", home_built, {"license": "Apache-2.0"}, "b16c471")
check("a companion for home assistant, not affiliated with the open home foundation" in home_listing["summary"].lower()
      and home_listing["categories"] == ["Phoenix 2.0", "Utilities"] and home_listing["title"] == "Home"
      and home_listing["developer"] == "webOS Phoenix",
      "Home's listing: a companion for Home Assistant, not affiliated with the Open Home Foundation, under Utilities")
check("Marketplace only" in home_listing["description"] and "in place of" not in home_listing["description"]
      and "b16c471" in home_listing["description"],
      "... a new app, not an update of a built-in one")
calc_listing = w.default_listing("calc", {"id": "com.example.calc", "title": "Calc"},
                                 {"description": "Calc (com.example.calc): sums, rebuilt"}, "")
check(calc_listing["summary"] == "Sums, rebuilt" and "in place of that version" in calc_listing["description"]
      and calc_listing["categories"] == ["Phoenix 2.0", "Utilities"],
      "a built-in 2.0 app's listing: its package.json summary, an update in place of the version a device came with")
# For tests/run.php: Home's package and listing, uploaded as bin/web-apps.py uploads them.
os.replace(home, os.path.join(out_dir, "home.ipk"))
with open(os.path.join(out_dir, "home-listing.json"), "w", encoding="utf-8") as f:
    json.dump(home_listing, f)

shutil.rmtree(tmp, ignore_errors=True)
print("%d failed" % failures if failures else "all passed")
sys.exit(1 if failures else 0)
