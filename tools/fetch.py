# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Downloads for ./phoenix's fetchers (get-base-model.py, get-whisper-model.py,
get-wakeword.py, get-kitten.py): progress as it goes, a connection that
stalls for STALL seconds given up on and tried again (up to TRIES times),
picking up where it stopped (HTTP Range) on a .part file, and the SHA-256
checked at the end. Without the progress a 639 MB model looked hung, and
without a timeout a stalled connection did hang: urlopen waits forever.
"""

import hashlib
import os
import sys
import time
import urllib.error
import urllib.request

STALL = 60          # seconds without a byte
TRIES = 5


def _progress(label, got, total, last):
    """Prints progress; returns when it last printed."""
    now = time.monotonic()
    tty = sys.stdout.isatty()
    if now - last < (0.5 if tty else 10) and got != total:
        return last
    mb = f"{got / 1e6:.0f}/{total / 1e6:.0f} MB ({100 * got // total}%)" if total else f"{got / 1e6:.0f} MB"
    if tty:
        print(f"\r  {label}: {mb}   ", end="" if got != total else "\n", flush=True)
    else:
        print(f"  {label}: {mb}", flush=True)
    return now


def download(url, out, sha256, size=0, label=None):
    """url into out (via out + ".part"), checked; exits with the reason on failure."""
    label = label or os.path.basename(out)
    part = out + ".part"
    print("downloading", url, f"({size / 1e6:.0f} MB)" if size else "", flush=True)
    for attempt in range(1, TRIES + 1):
        have = os.path.getsize(part) if os.path.exists(part) else 0
        req = urllib.request.Request(url, headers={"User-Agent": "webOS-Phoenix-setup"})
        if have:
            req.add_header("Range", f"bytes={have}-")
        try:
            with urllib.request.urlopen(req, timeout=STALL) as r:
                if have and r.status != 206:
                    have = 0            # the server sent it all again
                total = size or (have + int(r.headers.get("Content-Length") or 0))
                last = 0.0
                with open(part, "ab" if have else "wb") as f:
                    got = have
                    while True:
                        chunk = r.read(1 << 20)
                        if not chunk:
                            break
                        f.write(chunk)
                        got += len(chunk)
                        last = _progress(label, got, total, last)
            if size and got < size:
                raise OSError(f"the connection closed at {got} of {size} bytes")
            break
        except (OSError, urllib.error.URLError) as e:
            if attempt == TRIES:
                sys.exit(f"\n{url}: {e} (tried {TRIES} times; run ./phoenix again to go on from here)")
            print(f"\n  {label}: {e}; trying again ({attempt + 1}/{TRIES})", flush=True)
            time.sleep(2 * attempt)
    h = hashlib.sha256()
    with open(part, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    if h.hexdigest() != sha256:
        os.remove(part)
        sys.exit(f"{url}: SHA-256 {h.hexdigest()}, expected {sha256}")
    os.replace(part, out)


def fetch_bytes(url, sha256, size=0, label=None, tmpdir=None):
    """The file's bytes, downloaded as download() does (for the small archives)."""
    import tempfile
    d = tmpdir or tempfile.mkdtemp(prefix="phoenix-fetch-")
    out = os.path.join(d, os.path.basename(url.split("?")[0]) or "download")
    download(url, out, sha256, size, label)
    with open(out, "rb") as f:
        data = f.read()
    os.remove(out)
    return data
