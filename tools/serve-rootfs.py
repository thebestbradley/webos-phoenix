#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Serve the virtual webOS filesystem (runtime/rootfs.json) over HTTP.

Opens the original webOS apps in any desktop browser, with
runtime/phoenix-runtime.js added to every app page so they get PalmSystem
and the simulated service bus.

    tools/serve-rootfs.py [--port 8765]
    open http://127.0.0.1:8765/

/ lists the installed apps; /apps.json returns them as JSON.

POST /__phoenix/proxy forwards one HTTP request for the simulated services
that talk to servers (the CardDAV and CalDAV account): the page sends
{method, url, headers, body} and gets {status, headers, body} back, without
redirects followed. Browsers would refuse these cross-origin requests.
"""

import argparse
import html
import http.client
import http.server
import json
import mimetypes
import os
import re
import socket
import ssl
import sys
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
    for app_id, (_, info) in sorted(APPS.items()):
        base = "/usr/palm/applications/%s/" % app_id
        main = base + info.get("main", "index.html")
        phoenix = info.get("phoenix") or {}
        tab = phoenix.get("launcherTab", 0)
        out.append({
            "id": app_id,
            "title": info.get("title", app_id),
            "type": info.get("type", "web"),
            "main": main,
            "icon": base + info.get("icon", "icon.png"),
            "tab": tab,
            "hidden": bool(phoenix.get("hidden", False)),
            "quickLaunch": int(phoenix.get("quickLaunch", 0)),
            "noWindow": bool(info.get("noWindow", False)),
        })
        for lp in phoenix.get("launchPoints", []):
            params = lp.get("params", {})
            out.append({
                "id": lp["id"],
                "appId": app_id,
                "title": lp.get("title", info.get("title", app_id)),
                "type": info.get("type", "web"),
                "main": main + "?launchParams=" + urllib.parse.quote(json.dumps(params, separators=(",", ":"))),
                "icon": base + lp.get("icon", info.get("icon", "icon.png")),
                "tab": lp.get("launcherTab", tab),
                "params": params,
            })
    return out


def launch_points():
    """The launch point records the simulated applicationManager returns
    (phoenix-runtime.js reads them from /usr/share/phoenix/apps.json;
    shell/sim/rootfs.cpp serves the same)."""
    out = []
    for a in app_list():
        app_id = a.get("appId", a["id"])
        rec = {
            "id": app_id,
            "launchPointId": a["id"] if "appId" in a else app_id + "_default",
            "title": a["title"],
            "icon": a["icon"],
            "params": a.get("params", {}),
            "hidden": a.get("hidden", False),
        }
        if "appId" not in a:
            rec["universalSearch"] = APPS[app_id][1].get("universalSearch")
        out.append(rec)
    return out


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
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
            return self.send(404, "text/plain", b"not found")
        with open(f, "rb") as fh:
            data = fh.read()
        ctype = mimetypes.guess_type(f)[0] or "application/octet-stream"
        if path.startswith("/usr/palm/applications/") and f.endswith(".html"):
            data = inject_runtime(data)
            ctype = "text/html; charset=utf-8"
        self.send(200, ctype, data)

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/__phoenix/proxy":
            return self.send(404, "text/plain", b"not found")
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            reply = proxy(req)
        except ValueError as e:
            reply = {"error": "bad proxy request: %s" % e, "code": "BAD_REQUEST"}
        self.send(200, "application/json", json.dumps(reply).encode())

    def send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        if self.server.verbose:
            sys.stderr.write("%s\n" % (fmt % args))


def proxy(req):
    """One HTTP request for the page: {method, url, headers, body} ->
    {status, headers (lower-case names), body} or {error, code}."""
    url = urllib.parse.urlsplit(req.get("url", ""))
    if url.scheme not in ("http", "https") or not url.hostname:
        return {"error": "unsupported URL: %s" % req.get("url"), "code": "BAD_SERVER"}
    cls = http.client.HTTPSConnection if url.scheme == "https" else http.client.HTTPConnection
    target = url.path or "/"
    if url.query:
        target += "?" + url.query
    body = req.get("body")
    try:
        conn = cls(url.hostname, url.port, timeout=60)
        conn.request(req.get("method", "GET"), target, body=body.encode("utf-8") if body is not None else None,
                     headers=req.get("headers") or {})
        res = conn.getresponse()
        data = res.read().decode("utf-8", "replace")
        headers = {k.lower(): v for k, v in res.getheaders()}
        conn.close()
        return {"status": res.status, "headers": headers, "body": data}
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
    args = ap.parse_args()
    srv = http.server.ThreadingHTTPServer((args.host, args.port), Handler)
    srv.verbose = args.verbose
    print("Serving %d apps at http://%s:%d/" % (len(APPS), args.host, args.port))
    srv.serve_forever()


if __name__ == "__main__":
    main()
