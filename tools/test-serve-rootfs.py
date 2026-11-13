#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# tools/serve-rootfs.py takes a browser's burst of connections while it is
# busy. Chromium keeps up to six connections to it open, and as the server
# speaks HTTP/1.0 every request is a new one: a page that writes a dozen
# script tags at once (Enyo 1.0's loader) sends connections faster than
# the server's one accept loop takes them in. Those waiting are its listen
# queue; on a Mac one more than the queue holds is reset (Linux drops it,
# and the browser tries again a second later), and the script it was for
# never runs (tools/test-connectors.cjs's "ConnectorWizard is not defined").
#
# Here the server is stopped (SIGSTOP), as when it is busy, while 16
# connections ask for a file; once it goes on, each must have its answer.
#
#   python3 tools/test-serve-rootfs.py

import errno
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONNECTIONS = 16


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def ask(port, results, i):
    try:
        s = socket.create_connection(("127.0.0.1", port), timeout=20)
        s.settimeout(20)
        s.sendall(b"GET /usr/share/phoenix/host.json HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        data = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            data += chunk
        s.close()
        head, _, body = data.partition(b"\r\n\r\n")
        ok = head.startswith(b"HTTP/1.0 200") and isinstance(json.loads(body), dict)
        results[i] = "ok" if ok else "bad answer: %r" % data[:80]
    except (OSError, ValueError) as e:
        results[i] = errno.errorcode.get(getattr(e, "errno", None), str(e))


def main():
    port = free_port()
    installed = tempfile.mkdtemp(prefix="phoenix-installed-")
    server = subprocess.Popen([sys.executable, os.path.join(REPO, "tools", "serve-rootfs.py"), "--port", str(port),
                               "--installed-dir", installed, "--no-tcp"], stdout=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/apps.json" % port, timeout=2).read()
                break
            except OSError:
                time.sleep(0.1)
        else:
            print("FAIL serve-rootfs.py did not start")
            return 1
        server.send_signal(signal.SIGSTOP)
        results = [None] * CONNECTIONS
        threads = [threading.Thread(target=ask, args=(port, results, i)) for i in range(CONNECTIONS)]
        for t in threads:
            t.start()
        time.sleep(0.5)
        server.send_signal(signal.SIGCONT)
        for t in threads:
            t.join()
        answered = results.count("ok")
        print("%s %d of %d connections made while the server was busy are answered%s" % (
            "ok  " if answered == CONNECTIONS else "FAIL", answered, CONNECTIONS,
            "" if answered == CONNECTIONS else " (%s)" % ", ".join(sorted(set(r for r in results if r != "ok")))))
        return 0 if answered == CONNECTIONS else 1
    finally:
        server.send_signal(signal.SIGCONT)
        server.terminate()
        server.wait()
        shutil.rmtree(installed, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
