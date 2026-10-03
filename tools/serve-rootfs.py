#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Serve the virtual webOS filesystem (runtime/rootfs.json) over HTTP.

Opens the original webOS apps in any desktop browser, with
runtime/phoenix-runtime.js added to every app page (and framework window
page) so they get PalmSystem and the simulated service bus.

    tools/serve-rootfs.py [--port 8765]
    open http://127.0.0.1:8765/

/ lists the installed apps; /apps.json returns them as JSON.

POST /__phoenix/proxy forwards one HTTP request for the simulated services
that talk to servers (the CardDAV and CalDAV account): the page sends
{method, url, headers, body} and gets {status, headers, body} back, without
redirects followed. Browsers would refuse these cross-origin requests.

POST /__phoenix/installer installs or removes an app for the simulated
com.webos.appInstallService (runtime/phoenix-runtime.js, which unpacks the
.ipk): {op: "install", appId, files: [{path, data (base64)}]} or {op:
"remove", appId} -> {ok, error}. Installed apps live in --installed-dir (a
new temporary folder by default), laid out like a device's
/media/cryptofs/apps, and are served and listed like the others, as
phoenix-sim's SimInstaller does. It also does the application manager's
host work (runtime.hostOp): {op: "addLaunchPoint", launchPoint} ->
{launchPointId}, {op: "removeLaunchPoint", launchPointId}, {op:
"rescan"}, {op: "capacity"} -> {freeKB}; "running" and "close" need a
shell and are refused. /var/luna/ (the launch points apps add, as
/var/luna/launchpoints/<id>) is the folder "data" in --installed-dir.

--terminal gives the Terminal app (apps/terminal) a real shell on this
computer, as phoenix-sim does: a WebSocket per session at /__phoenix/pty
speaking the org.webosphoenix.pty protocol (docs/TERMINAL.md) over Python's
pty module. It is off by default. The page learns the WebSocket's address
and a random token from /usr/share/phoenix/host.json; connections without
the token, or from another origin, are refused, so other web pages cannot
open shells. It is YOUR shell with YOUR rights: only serve on 127.0.0.1.
--terminal-shell PATH runs that program instead (the tests use /bin/sh).
Without --terminal the runtime's simulated shell answers.
"""

import argparse
import base64
import errno
import fcntl
import hashlib
import html
import http.client
import http.server
import json
import mimetypes
import os
import re
import secrets
import tempfile
import select
import shutil
import signal
import socket
import ssl
import struct
import sys
import termios
import time
import urllib.parse

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME_TAG = b'<script src="/usr/share/phoenix/runtime/phoenix-runtime.js"></script>'


def load_rootfs():
    with open(os.path.join(REPO, "runtime", "rootfs.json")) as f:
        cfg = json.load(f)
    mounts = sorted(cfg["mounts"].items(), key=lambda kv: -len(kv[0]))
    overlays = [os.path.join(REPO, o) for o in cfg.get("overlays", [])]
    apps = {}
    # systemApps (Just Type, the system UI) are single app directories that
    # never appear in the launcher.
    candidates = [(os.path.join(REPO, rel, name), name, False)
                  for rel in cfg["applicationDirs"] if os.path.isdir(os.path.join(REPO, rel))
                  for name in sorted(os.listdir(os.path.join(REPO, rel)))]
    candidates += [(os.path.join(REPO, rel), os.path.basename(rel), True) for rel in cfg.get("systemApps", [])]
    for app_dir, name, system in candidates:
        if not os.path.isfile(os.path.join(app_dir, "appinfo.json")):
            app_dir = os.path.join(app_dir, "dist")
        info_path = os.path.join(app_dir, "appinfo.json")
        if os.path.isfile(info_path):
            try:
                with open(info_path, encoding="utf-8-sig") as f:
                    info = json.load(f)
            except ValueError as e:
                print("warning: bad %s: %s" % (info_path, e), file=sys.stderr)
                continue
            if system:
                info = dict(info, phoenix=dict(info.get("phoenix") or {}, hidden=True))
            apps.setdefault(info.get("id", name), (app_dir, info))
    return mounts, overlays, apps, set(cfg.get("exclude", []))


MOUNTS, OVERLAYS, APPS, EXCLUDE = load_rootfs()
BUILTIN_APPS = dict(APPS)
INSTALLED_DIR = None
INSTALLED = set()
APP_ID_RE = re.compile(r"^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+$")


def installed_apps_dir():
    return os.path.join(INSTALLED_DIR, "usr", "palm", "applications")


def rescan_installed():
    """The apps in INSTALLED_DIR join the built-in ones (which keep their ids)."""
    APPS.clear()
    APPS.update(BUILTIN_APPS)
    INSTALLED.clear()
    base = installed_apps_dir() if INSTALLED_DIR else None
    if not base or not os.path.isdir(base):
        return
    for name in sorted(os.listdir(base)):
        info_path = os.path.join(base, name, "appinfo.json")
        if name.endswith((".new", ".old")) or name in APPS or not os.path.isfile(info_path):
            continue
        try:
            with open(info_path, encoding="utf-8-sig") as f:
                info = json.load(f)
        except ValueError:
            continue
        APPS[name] = (os.path.join(base, name), info)
        INSTALLED.add(name)


def install_app(app_id, files):
    """What SimInstaller::install does: "" when done, else what is wrong."""
    if not APP_ID_RE.match(app_id or "") or len(app_id) > 128:
        return "Not a valid app id: %s" % app_id
    if app_id in BUILTIN_APPS:
        return "A built-in app has the id %s" % app_id
    dest = os.path.join(installed_apps_dir(), app_id)
    temp, old = dest + ".new", dest + ".old"
    shutil.rmtree(temp, ignore_errors=True)
    os.makedirs(temp)
    has_info = False
    for f in files:
        rel = os.path.normpath(f.get("path", ""))
        if not rel or rel.startswith(("/", "..")) or rel == ".":
            shutil.rmtree(temp, ignore_errors=True)
            return "A file outside the app: %s" % rel
        data = base64.b64decode(f.get("data", ""))
        if rel == "appinfo.json":
            try:
                if json.loads(data.decode("utf-8-sig")).get("id") != app_id:
                    raise ValueError
            except ValueError:
                shutil.rmtree(temp, ignore_errors=True)
                return "appinfo.json does not have the id %s" % app_id
            has_info = True
        path = os.path.join(temp, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as out:
            out.write(data)
    if not has_info:
        shutil.rmtree(temp, ignore_errors=True)
        return "The app has no appinfo.json"
    shutil.rmtree(old, ignore_errors=True)
    if os.path.exists(dest):
        os.rename(dest, old)
    os.rename(temp, dest)
    shutil.rmtree(old, ignore_errors=True)
    rescan_installed()
    return ""


def remove_app(app_id):
    if app_id not in INSTALLED:
        return "No such id"
    shutil.rmtree(os.path.join(installed_apps_dir(), app_id), ignore_errors=True)
    rescan_installed()
    return ""


def data_path(path):
    """A device path under /var/luna/ -> its file here, or None."""
    path = re.sub(r"/{2,}", "/", path or "")
    if not INSTALLED_DIR or not path.startswith("/var/luna/") or ".." in path.split("/"):
        return None
    return os.path.join(INSTALLED_DIR, "data", path.lstrip("/"))


def launch_points_dir():
    return data_path("/var/luna/launchpoints/x")[:-2]


def dynamic_launch_points():
    """The launch points apps added (as shell/sim/rootfs.cpp reads them)."""
    out = []
    d = launch_points_dir()
    if not os.path.isdir(d):
        return out
    for name in sorted(os.listdir(d)):
        try:
            with open(os.path.join(d, name), encoding="utf-8") as f:
                lp = json.load(f)
        except (ValueError, OSError):
            continue
        if lp.get("launchPointId") == name and lp.get("id") in APPS:
            out.append(lp)
    return out


def add_launch_point(lp):
    """What SimInstaller::addLaunchPoint does: ({launchPointId} | {error})."""
    app_id = lp.get("id") or ""
    if app_id not in APPS:
        return {"error": "Unable to find id: %s" % app_id}
    if not lp.get("title"):
        return {"error": "Invalid arguments"}
    icon = lp.get("icon") or ""
    if icon.startswith("file://"):
        icon = urllib.parse.urlparse(icon).path
    if icon and not icon.startswith("/"):
        icon = "/usr/palm/applications/%s/%s" % (app_id, icon)
    params = lp.get("params") or {}
    if isinstance(params, str):
        params = json.loads(params or "{}")
    d = launch_points_dir()
    os.makedirs(d, exist_ok=True)
    while True:
        lp_id = "%08d" % (1 + secrets.randbelow(1000000))
        if not os.path.exists(os.path.join(d, lp_id)):
            break
    rec = {"id": app_id, "launchPointId": lp_id, "title": lp["title"], "appmenu": lp.get("appmenu") or lp["title"],
           "icon": icon, "params": params, "removable": lp.get("removable", True) is not False}
    with open(os.path.join(d, lp_id), "w", encoding="utf-8") as f:
        json.dump(rec, f)
    return {"launchPointId": lp_id}


def remove_launch_point(lp_id):
    lp = next((x for x in dynamic_launch_points() if x["launchPointId"] == lp_id), None) if re.match(r"^[0-9]+$", lp_id or "") else None
    if not lp:
        return "launch point [%s] not found" % lp_id
    if lp.get("removable") is False:
        return "launch point [%s] not marked non-removable" % lp_id
    os.remove(os.path.join(launch_points_dir(), lp_id))
    return ""


def dir_size(path):
    total = 0
    for root, _, files in os.walk(path):
        for name in files:
            p = os.path.join(root, name)
            if not os.path.islink(p):
                total += os.path.getsize(p)
    return total


SIZES = {}


def app_size(app_id):
    """The bytes of an app's files (getSizeOfApps), read once per folder."""
    app_dir = APPS[app_id][0]
    if app_dir not in SIZES:
        SIZES[app_dir] = dir_size(app_dir)
    return SIZES[app_dir]


def installer_op(req):
    """POST /__phoenix/installer: one request of runtime.hostOp."""
    op = req.get("op")
    if op == "install":
        SIZES.pop(os.path.join(installed_apps_dir(), req.get("appId") or ""), None)
        error = install_app(req.get("appId"), req.get("files") or [])
        return {"ok": not error, "error": error}
    if op == "remove":
        error = remove_app(req.get("appId"))
        return {"ok": not error, "error": error, "cause": req.get("cause") or "USER"}
    if op == "addLaunchPoint":
        r = add_launch_point(req.get("launchPoint") or {})
        return {"ok": "error" not in r, "error": r.get("error", ""), "launchPointId": r.get("launchPointId", "")}
    if op == "removeLaunchPoint":
        error = remove_launch_point(req.get("launchPointId"))
        return {"ok": not error, "error": error}
    if op == "rescan":
        rescan_installed()
        return {"ok": True, "error": ""}
    if op == "capacity":
        return {"ok": True, "error": "", "freeKB": shutil.disk_usage(INSTALLED_DIR).free // 1024}
    return {"ok": False, "error": "Not available without the shell: %s" % op}


def resolve(path):
    """Device path -> file in this repository, or None."""
    # Like QDir::cleanPath in phoenix-sim: apps build paths such as
    # ".../com.palm.app.email//mail/index.html".
    path = re.sub(r"/{2,}", "/", path)
    if ".." in path.split("/") or path in EXCLUDE:
        return None
    for overlay in OVERLAYS:
        f = os.path.join(overlay, path.lstrip("/"))
        if os.path.isfile(f):
            return f
    for prefix, target in MOUNTS:
        if path == prefix.rstrip("/") or path.startswith(prefix):
            return os.path.join(REPO, target + path[len(prefix):])
    data = data_path(path)
    if data:
        return data
    pre = "/usr/palm/applications/"
    if path.startswith(pre):
        rest = path[len(pre):]
        app_id, _, sub = rest.partition("/")
        if app_id in APPS:
            return os.path.join(APPS[app_id][0], sub)
    return None


def app_list():
    """Installed apps and their launch points, as the launcher sees them.

    appinfo.json may carry a "phoenix" object (Phoenix launcher metadata):
    launcherTab (0 Apps, 1 Downloads, 2 Settings), hidden (keep the app
    itself out of the launcher), quickLaunch (quick launch slot 1-4) and
    launchPoints: extra launcher icons, each {id, title, icon, params},
    that start the app with those launch params. shell/sim/rootfs.cpp reads
    the same fields.
    """
    out = []
    pages = ["apps", "downloads", "prefs", "favorites"]
    for app_id, (_, info) in sorted(APPS.items()):
        base = "/usr/palm/applications/%s/" % app_id
        main = info.get("main", "index.html")
        # A hosted web app (an installed PWA) starts at its site's URL.
        if not re.match(r"^https?://", main):
            main = base + main
        phoenix = info.get("phoenix") or {}
        tab = phoenix.get("launcherTab", 0)
        page = pages[tab] if "launcherTab" in phoenix and 0 <= tab < len(pages) else ""
        out.append({
            "id": app_id,
            "title": info.get("title", app_id),
            "type": info.get("type", "web"),
            "main": main,
            "icon": base + info.get("icon", "icon.png"),
            "tab": tab,
            "page": page,
            "category": info.get("category", ""),
            "keywords": info.get("keywords", []),
            "installed": app_id in INSTALLED,
            "hidden": bool(phoenix.get("hidden", False)),
            "quickLaunch": int(phoenix.get("quickLaunch", 0)),
            "noWindow": bool(info.get("noWindow", False)),
        })
        for lp in phoenix.get("launchPoints", []):
            params = lp.get("params", {})
            lp_tab = lp.get("launcherTab", tab)
            out.append({
                "id": lp["id"],
                "appId": app_id,
                "title": lp.get("title", info.get("title", app_id)),
                "type": info.get("type", "web"),
                "main": main + "?launchParams=" + urllib.parse.quote(json.dumps(params, separators=(",", ":"))),
                "icon": base + lp.get("icon", info.get("icon", "icon.png")),
                "tab": lp_tab,
                "page": pages[lp_tab] if "launcherTab" in lp and 0 <= lp_tab < len(pages) else page,
                "params": params,
            })
    # Launch points apps added (addLaunchPoint): on Favorites.
    for lp in dynamic_launch_points():
        params = lp.get("params") or {}
        info = APPS[lp["id"]][1]
        main = info.get("main", "index.html")
        if not re.match(r"^https?://", main):
            main = "/usr/palm/applications/%s/%s" % (lp["id"], main)
        out.append({
            "id": lp["launchPointId"], "appId": lp["id"], "title": lp["title"], "type": info.get("type", "web"),
            "main": main + "?launchParams=" + urllib.parse.quote(json.dumps(params, separators=(",", ":"))),
            "icon": lp.get("icon") or "/usr/palm/applications/%s/%s" % (lp["id"], info.get("icon", "icon.png")),
            "tab": 0, "page": "favorites", "dynamic": True, "params": params, "removable": lp.get("removable", True),
        })
    return out


def launch_points():
    """The launch point records the simulated applicationManager returns
    (phoenix-runtime.js reads them from /usr/share/phoenix/apps.json;
    shell/sim/rootfs.cpp serves the same)."""
    out = []
    for a in app_list():
        app_id = a.get("appId", a["id"])
        info = APPS[app_id][1] if app_id in APPS else {}
        rec = {
            "id": app_id,
            "appId": app_id,
            "launchPointId": a["id"] if "appId" in a else app_id + "_default",
            "title": a["title"],
            "appmenu": a["title"],
            "icon": a["icon"],
            "params": a.get("params", {}),
            "hidden": a.get("hidden", False),
            "removable": a.get("removable", True) if a.get("dynamic") else (app_id in INSTALLED and "appId" not in a),
            "version": info.get("version", ""),
        }
        if a.get("dynamic"):
            rec["dynamic"] = True
        if "appId" not in a:
            # LaunchPoint::toJSON: the vendor, the package and its size
            # (user-installed apps; 0 for the built-in ones).
            size = app_size(app_id)
            rec.update({"vendor": info.get("vendor", ""), "vendorUrl": info.get("vendorurl", ""), "packageId": app_id,
                        "size": size if app_id in INSTALLED else 0, "appSize": size,
                        "noWindow": bool(info.get("noWindow", False))})
            dock = info.get("exhibitionMode", info.get("dockMode"))
            if dock is True:
                options = info.get("exhibitionModeOptions") or info.get("dockModeOptions") or {}
                rec["exhibitionMode"] = True
                rec["dockMode"] = True
                rec["exhibitionModeTitle"] = options.get("title") or a["title"]
            rec["universalSearch"] = APPS[app_id][1].get("universalSearch")
            # The types the app opens (appinfo.json "mimeTypes", as on legacy webOS).
            if APPS[app_id][1].get("mimeTypes"):
                rec["mimeTypes"] = APPS[app_id][1]["mimeTypes"]
            # What it takes from the share sheet (appinfo.json "phoenix": {"shareTargets"};
            # docs/SHARE-AND-FILES.md).
            targets = (APPS[app_id][1].get("phoenix") or {}).get("shareTargets")
            if targets:
                rec["shareTargets"] = targets
        out.append(rec)
    return out


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if path == "/usr/share/phoenix/host.json":
            info = {}
            if self.server.terminal:
                info = {"pty": "websocket",
                        "url": "ws://%s/__phoenix/pty?token=%s" % (self.headers.get("Host", ""), self.server.token)}
            return self.send(200, "application/json", json.dumps(info).encode())
        if path in ("/__phoenix/pty", "/__phoenix/pty/shells"):
            return pty_request(self, path)
        if path == "/usr/share/phoenix/apps.json":
            return self.send(200, "application/json", json.dumps(launch_points()).encode())
        if path == "/apps.json":
            return self.send(200, "application/json", json.dumps(app_list(), indent=2).encode())
        if path == "/":
            rows = "".join(
                '<li><a href="%s"><img src="%s" width="32" height="32"> %s</a> <small>%s</small></li>'
                % (html.escape(a["main"]), a["icon"], html.escape(a["title"]), a["id"]) for a in app_list())
            page = "<!doctype html><title>webOS Phoenix apps</title><ul>%s</ul>" % rows
            return self.send(200, "text/html; charset=utf-8", page.encode())
        f = resolve(path)
        if not f or not os.path.isfile(f):
            # No body, like a missing file on the device: Enyo reads a
            # config file's text to decide whether it exists (Tellurium,
            # the test harness, starts on any text).
            return self.send(404, "text/plain", b"")
        with open(f, "rb") as fh:
            data = fh.read()
        ctype = mimetypes.guess_type(f)[0] or "application/octet-stream"
        # App pages, and Enyo 1.0's framework pages an app opens as a
        # window (dashboard-window), as in phoenix-sim (shell/sim/rootfs.cpp).
        if path.startswith(("/usr/palm/applications/", "/usr/palm/frameworks/enyo/")) and f.endswith(".html"):
            data = inject_runtime(data)
            ctype = "text/html; charset=utf-8"
        # Byte ranges, so audio and video can seek (Chromium asks for them).
        m = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range") or "")
        if m and (m.group(1) or m.group(2)) and data:
            size = len(data)
            if m.group(1):
                start, end = int(m.group(1)), min(int(m.group(2)) if m.group(2) else size - 1, size - 1)
            else:
                start, end = max(0, size - int(m.group(2))), size - 1
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%d" % size)
                self.end_headers()
                return
            return self.send(206, ctype, data[start:end + 1], {"Content-Range": "bytes %d-%d/%d" % (start, end, size)})
        self.send(200, ctype, data)

    def do_HEAD(self):
        # The size of a file (the simulated file manager asks for it).
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        f = resolve(path)
        if not f or not os.path.isfile(f):
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(f)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(os.path.getsize(f)))
        self.end_headers()

    def do_POST(self):
        if self.path.split("?", 1)[0] == "/__phoenix/installer":
            try:
                req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                reply = installer_op(req)
            except (ValueError, OSError) as e:
                reply = {"ok": False, "error": "bad installer request: %s" % e}
            return self.send(200, "application/json", json.dumps(reply).encode())
        if self.path.split("?", 1)[0] != "/__phoenix/proxy":
            return self.send(404, "text/plain", b"not found")
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            reply = proxy(req)
        except ValueError as e:
            reply = {"error": "bad proxy request: %s" % e, "code": "BAD_REQUEST"}
        self.send(200, "application/json", json.dumps(reply).encode())

    def send(self, code, ctype, body, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Accept-Ranges", "bytes")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        if self.server.verbose:
            sys.stderr.write("%s\n" % (fmt % args))


def proxy(req):
    """One HTTP request for the page: {method, url, headers, body, binary?,
    follow?} -> {status, headers (lower-case names), body (or bodyBase64 with
    binary), url} or {error, code}. follow: take up to 5 redirects (GET)."""
    url_s = req.get("url", "")
    method = req.get("method", "GET")
    body = req.get("body")
    try:
        for _ in range(6):
            url = urllib.parse.urlsplit(url_s)
            if url.scheme not in ("http", "https") or not url.hostname:
                return {"error": "unsupported URL: %s" % url_s, "code": "BAD_SERVER"}
            cls = http.client.HTTPSConnection if url.scheme == "https" else http.client.HTTPConnection
            target = url.path or "/"
            if url.query:
                target += "?" + url.query
            conn = cls(url.hostname, url.port, timeout=60)
            conn.request(method, target, body=body.encode("utf-8") if body is not None else None,
                         headers=req.get("headers") or {})
            res = conn.getresponse()
            raw = res.read()
            headers = {k.lower(): v for k, v in res.getheaders()}
            conn.close()
            if req.get("follow") and res.status in (301, 302, 303, 307, 308) and headers.get("location"):
                url_s = urllib.parse.urljoin(url_s, headers["location"])
                if res.status == 303:
                    method, body = "GET", None
                continue
            out = {"status": res.status, "headers": headers, "url": url_s}
            if req.get("binary"):
                out["bodyBase64"] = base64.b64encode(raw).decode("ascii")
            else:
                out["body"] = raw.decode("utf-8", "replace")
            return out
        return {"error": "too many redirects", "code": "EREDIRECT"}
    except (socket.gaierror,) as e:
        return {"error": str(e), "code": "ENOTFOUND"}
    except ConnectionRefusedError as e:
        return {"error": str(e), "code": "ECONNREFUSED"}
    except (socket.timeout, TimeoutError) as e:
        return {"error": str(e), "code": "ETIMEDOUT"}
    except ssl.SSLCertVerificationError as e:
        return {"error": str(e), "code": "UNABLE_TO_VERIFY_LEAF_SIGNATURE"}
    except (OSError, http.client.HTTPException) as e:
        return {"error": str(e), "code": "ECONNRESET"}


# ---- The Terminal's shells (--terminal) ----------------------------------------------

PTY_SHELLS = ["bash", "zsh", "fish", "sh"]
PTY_MAX_CHUNK = 64 * 1024
PTY_HIGH_WATER = 256 * 1024
PTY_LOW_WATER = 64 * 1024
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def find_shell(name):
    """A shell by name (never a path), as services/pty's findShell."""
    if name not in PTY_SHELLS:
        return None
    for d in ("/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"):
        f = os.path.join(d, name)
        if os.path.isfile(f) and os.access(f, os.X_OK):
            return f
    return None


def utf8_boundary(buf):
    """(end, valid): hold back a multi-byte sequence buf ends inside of, as
    services/pty/src/ptycore.cpp utf8Boundary does."""
    end = len(buf)
    for back in range(1, min(3, len(buf)) + 1):
        c = buf[len(buf) - back]
        if c & 0xC0 == 0x80:
            continue
        n = 2 if 0xC2 <= c <= 0xDF else 3 if 0xE0 <= c <= 0xEF else 4 if 0xF0 <= c <= 0xF4 else 1
        if n > back:
            end = len(buf) - back
        break
    try:
        buf[:end].decode("utf-8")
        return end, True
    except UnicodeDecodeError:
        return end, False


def pty_request(handler, path):
    srv = handler.server
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query)
    host = handler.headers.get("Host", "")
    origin = handler.headers.get("Origin")
    if not srv.terminal or query.get("token", [""])[0] != srv.token:
        return handler.send(403, "text/plain", b"forbidden")
    # Only pages served here: another site's page cannot open a shell.
    if origin is not None and origin != "http://" + host:
        return handler.send(403, "text/plain", b"forbidden origin")
    if path == "/__phoenix/pty/shells":
        shells = [{"name": n, "path": find_shell(n) or "", "installed": bool(find_shell(n))} for n in PTY_SHELLS]
        return handler.send(200, "application/json",
                            json.dumps({"returnValue": True, "default": "bash", "shells": shells}).encode())
    key = handler.headers.get("Sec-WebSocket-Key")
    if handler.headers.get("Upgrade", "").lower() != "websocket" or not key:
        return handler.send(400, "text/plain", b"WebSocket only")
    accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
    handler.send_response(101, "Switching Protocols")
    handler.send_header("Upgrade", "websocket")
    handler.send_header("Connection", "Upgrade")
    handler.send_header("Sec-WebSocket-Accept", accept)
    handler.end_headers()
    handler.wfile.flush()
    handler.close_connection = True
    PtySession(handler.connection, srv.terminal_shell).run()


class PtySession:
    """One shell on a PTY, spoken to over one WebSocket."""

    def __init__(self, sock, override):
        self.sock = sock
        self.override = override
        self.inbuf = b""
        self.pid = None
        self.fd = None
        self.pending = b""
        self.unacked = 0
        self.paused = False

    # -- WebSocket frames (RFC 6455; the page's frames are masked) --
    def send(self, obj):
        data = json.dumps(obj).encode("utf-8")
        n = len(data)
        head = bytes([0x81]) + (bytes([n]) if n < 126 else bytes([126]) + struct.pack(">H", n) if n < 65536
                                 else bytes([127]) + struct.pack(">Q", n))
        self.sock.sendall(head + data)

    def frames(self):
        """Complete frames in the buffer: [(opcode, payload)]."""
        out = []
        while True:
            b = self.inbuf
            if len(b) < 2:
                return out
            op, n, i = b[0] & 0x0F, b[1] & 0x7F, 2
            if n == 126:
                if len(b) < 4:
                    return out
                n, i = struct.unpack(">H", b[2:4])[0], 4
            elif n == 127:
                if len(b) < 10:
                    return out
                n, i = struct.unpack(">Q", b[2:10])[0], 10
            masked = b[1] & 0x80
            mask = b[i:i + 4] if masked else b""
            i += 4 if masked else 0
            if len(b) < i + n:
                return out
            payload = bytes(c ^ mask[k % 4] for k, c in enumerate(b[i:i + n])) if masked else b[i:i + n]
            self.inbuf = b[i + n:]
            out.append((op, payload))

    # -- The shell --
    def spawn(self, msg):
        name = msg.get("shell") or "bash"
        path = self.override or find_shell(name)
        if not path:
            self.send({"returnValue": False, "errorCode": 4, "errorText": "Shell not installed on this computer: " + name})
            return False
        cols, rows = int(msg.get("cols") or 80), int(msg.get("rows") or 24)
        pid, fd = __import__("pty").fork()
        if pid == 0:
            try:
                os.chdir(os.path.expanduser("~"))
            except OSError:
                pass
            env = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor", SHELL=path,
                       TERM_PROGRAM="Phoenix Terminal", PHOENIX_TERMINAL="1")
            for s in (signal.SIGINT, signal.SIGQUIT, signal.SIGTERM, signal.SIGHUP, signal.SIGPIPE, signal.SIGCHLD):
                signal.signal(s, signal.SIG_DFL)
            try:
                os.execve(path, ["-" + os.path.basename(path)], env)
            finally:
                os._exit(127)
        self.pid, self.fd = pid, fd
        self.resize(cols, rows)
        fcntl.fcntl(fd, fcntl.F_SETFL, fcntl.fcntl(fd, fcntl.F_GETFL) | os.O_NONBLOCK)
        self.send({"returnValue": True, "subscribed": True, "pid": pid, "shell": name, "shellPath": path, "host": True})
        return True

    def resize(self, cols, rows):
        if 0 < cols < 1000 and 0 < rows < 1000:
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    def hangup(self, sig=signal.SIGHUP):
        if self.pid:
            try:
                os.killpg(self.pid, sig)
            except OSError:
                try:
                    os.kill(self.pid, sig)
                except OSError:
                    pass

    def flush(self, eof=False):
        while self.pending:
            chunk = self.pending[:PTY_MAX_CHUNK]
            end, valid = utf8_boundary(chunk)
            if end == 0:
                if not eof and len(chunk) < PTY_MAX_CHUNK:
                    return
                end, valid = len(chunk), False
            data, self.pending = chunk[:end], self.pending[end:]
            reply = {"returnValue": True, "output": data.decode("utf-8") if valid else data.decode("latin-1"), "bytes": end}
            if not valid:
                reply["encoding"] = "latin1"
            self.send(reply)
            self.unacked += end
            if self.unacked >= PTY_HIGH_WATER:
                self.paused = True

    def finish(self):
        code, sig = -1, 0
        try:
            for _ in range(100):
                pid, status = os.waitpid(self.pid, os.WNOHANG)
                if pid == self.pid:
                    code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else -1
                    sig = os.WTERMSIG(status) if os.WIFSIGNALED(status) else 0
                    break
                time.sleep(0.02)
        except ChildProcessError:
            pass
        self.pid = None
        self.send({"returnValue": True, "exited": True, "exitCode": code, "signal": sig})

    def run(self):
        try:
            self.loop()
        except (OSError, ValueError):
            pass
        finally:
            if self.pid:
                self.hangup()
                try:
                    os.waitpid(self.pid, 0)
                except OSError:
                    pass
            if self.fd is not None:
                os.close(self.fd)

    def loop(self):
        while True:
            watch = [self.sock]
            if self.fd is not None and not self.paused and len(self.pending) < PTY_MAX_CHUNK:
                watch.append(self.fd)
            ready, _, _ = select.select(watch, [], [], 0.5)
            if self.sock in ready:
                data = self.sock.recv(65536)
                if not data:
                    return
                self.inbuf += data
                for op, payload in self.frames():
                    if op == 8:
                        return
                    if op == 9:
                        self.sock.sendall(bytes([0x8A, len(payload)]) + payload)
                        continue
                    if op != 1:
                        continue
                    msg = json.loads(payload.decode("utf-8"))
                    what = msg.get("op")
                    if what == "open" and self.pid is None:
                        if not self.spawn(msg):
                            return
                    elif self.fd is None:
                        continue
                    elif what == "write":
                        os.write(self.fd, str(msg.get("data", "")).encode("utf-8"))
                    elif what == "resize":
                        self.resize(int(msg.get("cols", 0)), int(msg.get("rows", 0)))
                    elif what == "ack":
                        self.unacked = max(0, self.unacked - int(msg.get("bytes", 0)))
                        if self.unacked < PTY_LOW_WATER:
                            self.paused = False
                    elif what == "close":
                        sig = {"SIGINT": signal.SIGINT, "SIGTERM": signal.SIGTERM, "SIGKILL": signal.SIGKILL}
                        self.hangup(sig.get(msg.get("signal"), signal.SIGHUP))
            if self.fd is not None and self.fd in ready:
                try:
                    data = os.read(self.fd, 65536)
                except OSError as e:
                    if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                        continue
                    data = b""
                if data:
                    self.pending += data
                    # Let a burst gather for a frame (16 ms), as the service does.
                    time.sleep(0.016)
                    try:
                        self.pending += os.read(self.fd, PTY_MAX_CHUNK)
                    except OSError:
                        pass
                    self.flush()
                else:
                    self.flush(eof=True)
                    self.finish()
                    return


def inject_runtime(data):
    """Put the runtime before any of the page's own scripts."""
    low = data.lower()
    i = low.find(b"<head")
    if i >= 0:
        j = low.find(b">", i)
        return data[:j + 1] + RUNTIME_TAG + data[j + 1:]
    return RUNTIME_TAG + data


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("-v", "--verbose", action="store_true")
    ap.add_argument("--terminal", action="store_true",
                    help="give the Terminal app a real shell on this computer (a WebSocket with a random token)")
    ap.add_argument("--terminal-shell", metavar="PATH", help="run this program in the Terminal instead of the shell it asks for")
    ap.add_argument("--installed-dir", metavar="DIR", help="where installed apps go (default: a new temporary folder)")
    args = ap.parse_args()
    global INSTALLED_DIR
    INSTALLED_DIR = args.installed_dir or tempfile.mkdtemp(prefix="phoenix-installed-")
    rescan_installed()
    srv = http.server.ThreadingHTTPServer((args.host, args.port), Handler)
    srv.daemon_threads = True
    srv.verbose = args.verbose
    srv.terminal = args.terminal
    srv.terminal_shell = args.terminal_shell
    srv.token = secrets.token_urlsafe(24)
    print("Serving %d apps at http://%s:%d/" % (len(APPS), args.host, args.port))
    if args.terminal:
        print("Terminal: real shells on this computer for pages served here (--terminal)")
    srv.serve_forever()


if __name__ == "__main__":
    main()
