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
    args = ap.parse_args()
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
