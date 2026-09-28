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
"""

import argparse
import html
import http.server
import json
import mimetypes
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME_TAG = b'<script src="/usr/share/phoenix/runtime/phoenix-runtime.js"></script>'


def load_rootfs():
    with open(os.path.join(REPO, "runtime", "rootfs.json")) as f:
        cfg = json.load(f)
    mounts = sorted(cfg["mounts"].items(), key=lambda kv: -len(kv[0]))
    overlays = [os.path.join(REPO, o) for o in cfg.get("overlays", [])]
    apps = {}
    for rel in cfg["applicationDirs"]:
        base = os.path.join(REPO, rel)
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            app_dir = os.path.join(base, name)
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
                apps.setdefault(info.get("id", name), (app_dir, info))
    return mounts, overlays, apps


MOUNTS, OVERLAYS, APPS = load_rootfs()


def resolve(path):
    """Device path -> file in this repository, or None."""
    # Like QDir::cleanPath in phoenix-sim: apps build paths such as
    # ".../com.palm.app.email//mail/index.html".
    path = re.sub(r"/{2,}", "/", path)
    if ".." in path.split("/"):
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
    out = []
    for app_id, (_, info) in sorted(APPS.items()):
        base = "/usr/palm/applications/%s/" % app_id
        out.append({
            "id": app_id,
            "title": info.get("title", app_id),
            "type": info.get("type", "web"),
            "main": base + info.get("main", "index.html"),
            "icon": base + info.get("icon", "icon.png"),
            "noWindow": bool(info.get("noWindow", False)),
        })
    return out


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if path == "/apps.json":
            return self.send(200, "application/json", json.dumps(app_list(), indent=2).encode())
        if path == "/":
            rows = "".join(
                '<li><a href="%s"><img src="%s" width="32" height="32"> %s</a> <small>%s</small></li>'
                % (a["main"], a["icon"], html.escape(a["title"]), a["id"]) for a in app_list())
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
