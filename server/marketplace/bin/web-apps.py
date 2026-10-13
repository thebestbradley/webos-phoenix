#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""The packages the Marketplace hosts itself, made from their makers' own builds.

Two kinds (docs/APP-STORE.md "Open-source web apps" and "The 2.0 apps"):

  * open-source web apps that run entirely in the browser, from their
    upstream's own release (catalog/web-apps.json pins each one: its
    download and SHA-256, its licence, source and homepage, its icon and
    licence files, our own description of it; docs/WEB-APP-CATALOG.md says
    why each app is in it, a link or left out);
  * webOS Phoenix 2.0's built-in apps, from a phoenix-default-apps checkout
    (--from PATH or PHOENIX_DEFAULT_APPS; skipped, saying so, without one),
    which a 1.0 device installs as updates of its own (docs/APP-STORE.md
    "Updating a built-in app").

Nothing of either is in this repository: downloads and packages go to a
cache outside it (--cache, PHOENIX_WEB_APPS_CACHE, else
~/.cache/phoenix-marketplace/web-apps). Every download is checked against
its pinned SHA-256 (and upstream's own sums file where there is one) and
treated as untrusted data: each goes into a new empty folder, archives are
unpacked by this script with every path checked (no links, nothing outside
its folder, a size cap), and this script runs Python isolated (-I; it
restarts itself so when it was not). Re-running is safe and is how apps
are updated: change the pins in web-apps.json, then publish again.

  python3 -I server/marketplace/bin/web-apps.py list
  python3 -I server/marketplace/bin/web-apps.py check          the manifest, offline
  python3 -I server/marketplace/bin/web-apps.py fetch [ID ...]
  python3 -I server/marketplace/bin/web-apps.py pack [ID ...]  fetch, then the .ipk
  python3 -I server/marketplace/bin/web-apps.py publish [ID ...]
                 pack, then into the catalog: php bin/marketplace.php upload
                 --phoenix --listing (the admin's upload; a version published
                 already gets its listing again)
  python3 -I server/marketplace/bin/web-apps.py shoot ID [...] [--sim PATH] [--delay MS]
                 screenshots in phoenix-sim (the app from --extra-rootfs, a
                 fresh HOME, under xvfb-run without a display), kept in the
                 cache for publish; --software-gl for WebGL 2 apps on a machine
                 without a GPU
  python3 -I server/marketplace/bin/web-apps.py default-apps [ID ...] [--from PATH] [--publish]
                 the 2.0 apps of a phoenix-default-apps checkout, each built
                 app's dist/, packed (and published)

Options: --cache DIR; --data DIR (the catalog's data folder, as
MARKETPLACE_DATA; default the catalog's own); --php PHP.
"""

import gzip
import hashlib
import io
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

if not sys.flags.isolated:
    # Isolated: nothing from the current folder or the environment is imported.
    os.execv(sys.executable, [sys.executable, "-I", os.path.abspath(__file__)] + sys.argv[1:])

HERE = os.path.dirname(os.path.abspath(__file__))
MARKETPLACE = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(MARKETPLACE))
MANIFEST = os.path.join(MARKETPLACE, "catalog", "web-apps.json")

# What the catalog and devices take (Ipk::MAX_SIZE, packagesservice.js MAX_PACKAGE).
MAX_PACKAGE = 64 * 1024 * 1024
# An archive unpacks to at most this much.
MAX_UNPACKED = 512 * 1024 * 1024
MAX_DOWNLOAD = 256 * 1024 * 1024
APP_ID = re.compile(r"^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+$")
# The licences under which the Marketplace hosts a package (docs/LEGAL.md
# "Marketplace"): permissive ones. A copyleft app (GPL, AGPL, MPL as its own
# licence) is a link to its official site instead (catalog/curated-sites.json).
PERMISSIVE = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "0BSD", "Unlicense", "CC0-1.0"}
# Every packed file gets this time, so the same inputs make the same package.
EPOCH = 315532800  # 1980-01-01, the earliest a zip can say
UA = "phoenix-marketplace-web-apps/1 (+https://github.com/thebestbradley/webos-phoenix)"


def die(msg):
    print("web-apps: " + msg, file=sys.stderr)
    sys.exit(1)


def say(msg):
    print(msg, flush=True)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


# ---- The manifest ------------------------------------------------------------------------

def load_manifest():
    with open(MANIFEST, encoding="utf-8") as f:
        return json.load(f)["apps"]


def spdx_ids(expr):
    return [t for t in re.split(r"[\s()]+", expr or "") if t and t not in ("OR", "AND", "WITH")]


def check_entry(a):
    """What is wrong with an entry of web-apps.json, or []."""
    errs = []
    need = ["id", "title", "version", "developer", "license", "homepage", "source", "categories", "summary", "description",
            "download", "main", "icon", "notices"]
    for k in need:
        if k not in a:
            errs.append("no " + k)
    if errs:
        return errs
    if not APP_ID.match(a["id"]) or a["id"].startswith(("org.webosphoenix.", "com.webosphoenix.")):
        errs.append("id: the upstream's own reverse-DNS id, never Phoenix's")
    if not re.match(r"^\d+\.\d+\.\d+$", a["version"]):
        errs.append("version: major.minor.micro (the upstream's own, else in upstreamVersion)")
    bad = [i for i in spdx_ids(a["license"]) if i not in PERMISSIVE]
    if bad:
        errs.append("license %s: not one the Marketplace hosts (%s); list it as a link to its official site instead"
                    % (a["license"], ", ".join(bad)))
    for k in ("homepage", "source", "developerUrl"):
        if k in a and not str(a[k]).startswith("https://"):
            errs.append(k + ": an https:// address")
    if not isinstance(a["categories"], list) or not 1 <= len(a["categories"]) <= 5:
        errs.append("categories: 1 to 5")
    if len(a["summary"]) > 300 or len(a["title"]) > 80:
        errs.append("summary at most 300 characters, title 80")
    d = a["download"]
    if not str(d.get("url", "")).startswith("https://") or not re.match(r"^[0-9a-f]{64}$", d.get("sha256", "")):
        errs.append("download: an https:// url and its sha256")
    if d.get("format", "zip") not in ("zip", "tar.gz"):
        errs.append("download.format: zip or tar.gz")
    pics = [a["icon"]] if "url" in a["icon"] else []
    for n in pics + a["notices"]:
        if not str(n.get("url", "")).startswith("https://") or not re.match(r"^[0-9a-f]{64}$", n.get("sha256", "")):
            errs.append("icon and notices: an https:// url and its sha256 each")
    if "url" not in a["icon"] and "path" not in a["icon"]:
        errs.append("icon: {url, sha256} or {path} (a PNG in the download)")
    for n in a["notices"]:
        if not re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]*$", n.get("as", "")):
            errs.append("notices: each with a plain file name (as)")
    return errs


def pick(apps, ids):
    if not ids:
        return apps
    by = {a["id"]: a for a in apps}
    short = {a["id"].split(".")[-1]: a for a in apps}
    out = []
    for i in ids:
        a = by.get(i) or short.get(i)
        if not a:
            die("no app %s in %s" % (i, os.path.relpath(MANIFEST, REPO)))
        out.append(a)
    return out


# ---- The cache ---------------------------------------------------------------------------

def cache_dir(opts):
    d = opts.get("cache") or os.environ.get("PHOENIX_WEB_APPS_CACHE") \
        or os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "phoenix-marketplace", "web-apps")
    d = os.path.realpath(d)
    if d == REPO or d.startswith(REPO + os.sep):
        die("the cache must be outside the repository (%s): downloads are never kept in it" % d)
    os.makedirs(d, exist_ok=True)
    return d


def version_dir(cache, a):
    return os.path.join(cache, a["id"], a["version"])


# ---- Downloads: untrusted data ---------------------------------------------------------------

def download(url, into_parent, name):
    """url -> its bytes, written to a new empty folder under into_parent."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        chunks, n = [], 0
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            n += len(b)
            if n > MAX_DOWNLOAD:
                raise ValueError("larger than %d MB" % (MAX_DOWNLOAD >> 20))
            chunks.append(b)
    data = b"".join(chunks)
    folder = tempfile.mkdtemp(prefix="dl-", dir=into_parent)
    with open(os.path.join(folder, name), "wb") as f:
        f.write(data)
    return data, os.path.join(folder, name)


def fetch_checked(url, want, into_parent, name):
    """A download whose SHA-256 must be want (kept: fetched again only when missing or changed)."""
    keep = os.path.join(into_parent, "checked", name)
    if os.path.isfile(keep):
        with open(keep, "rb") as f:
            data = f.read()
        if sha256(data) == want:
            return data
    data, path = download(url, into_parent, name)
    got = sha256(data)
    if got != want:
        shutil.rmtree(os.path.dirname(path), ignore_errors=True)
        raise ValueError("%s: SHA-256 %s, not the pinned %s" % (url, got, want))
    os.makedirs(os.path.dirname(keep), exist_ok=True)
    os.replace(path, keep)
    os.rmdir(os.path.dirname(path))
    return data


def upstream_sums(url, into_parent, file_name, want):
    """The release's own sums file (sha256sum's format) must list file_name with want."""
    data, path = download(url, into_parent, "SHA256SUMS.txt")
    shutil.rmtree(os.path.dirname(path), ignore_errors=True)
    for line in data.decode("utf-8", "replace").splitlines():
        parts = line.strip().split()
        if len(parts) == 2 and parts[1].lstrip("*") == file_name:
            if parts[0].lower() != want:
                raise ValueError("upstream's %s gives %s for %s, not the pinned %s" % (url, parts[0], file_name, want))
            return True
    raise ValueError("upstream's %s does not list %s" % (url, file_name))


def safe_rel(name):
    """An archive member's path, checked: relative, no .., no empty parts; else None."""
    name = name.replace("\\", "/")
    if name.startswith("/") or re.match(r"^[A-Za-z]:", name):
        return None
    parts = [p for p in name.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        return None
    return "/".join(parts)


def unpack(data, fmt, root, include, dest):
    """The archive's files under its folder root (a prefix such as "photocraft-web-0.8.2/"), those
    include names (folders end with /; none: all), into dest, a new folder. Links, devices, paths
    out of it and archives larger than MAX_UNPACKED are refused."""
    root = (root or "").strip("/")
    if os.path.exists(dest):
        shutil.rmtree(dest)
    os.makedirs(dest)
    total = 0
    members = []
    if fmt == "zip":
        zf = zipfile.ZipFile(io.BytesIO(data))
        for info in zf.infolist():
            mode = (info.external_attr >> 16) & 0o170000
            if info.is_dir():
                continue
            if mode and mode != stat.S_IFREG:
                raise ValueError("the archive has a link or special file: %s" % info.filename)
            members.append((info.filename, info.file_size, lambda i=info: zf.read(i)))
    else:
        tf = tarfile.open(fileobj=io.BytesIO(data), mode="r:gz")
        for m in tf.getmembers():
            if m.isdir():
                continue
            if not m.isreg():
                raise ValueError("the archive has a link or special file: %s" % m.name)
            members.append((m.name, m.size, lambda m=m: tf.extractfile(m).read()))
    out = 0
    for name, size, read in members:
        rel = safe_rel(name)
        if rel is None:
            raise ValueError("the archive has a path out of its folder: %r" % name)
        if root:
            if not rel.startswith(root + "/"):
                continue
            rel = rel[len(root) + 1:]
        if include and not any(rel == i or (i.endswith("/") and rel.startswith(i)) for i in include):
            continue
        total += size
        if total > MAX_UNPACKED:
            raise ValueError("the archive unpacks to more than %d MB" % (MAX_UNPACKED >> 20))
        body = read()
        path = os.path.join(dest, *rel.split("/"))
        if not os.path.realpath(path).startswith(os.path.realpath(dest) + os.sep):
            raise ValueError("the archive has a path out of its folder: %r" % name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(body)
        out += 1
    if not out:
        raise ValueError("nothing under %s/ in the archive" % root)
    return out


def fetch(a, cache):
    """Download and check an app's release, icon and licence files; unpack the release."""
    vd = version_dir(cache, a)
    os.makedirs(vd, exist_ok=True)
    d = a["download"]
    name = os.path.basename(d["url"].split("?")[0])
    data = fetch_checked(d["url"], d["sha256"], vd, name)
    if d.get("sums"):
        upstream_sums(d["sums"], vd, name, d["sha256"])
    files = {}
    if "url" in a["icon"]:
        files["icon.png"] = fetch_checked(a["icon"]["url"], a["icon"]["sha256"], vd, "icon.png")
    for n in a["notices"]:
        files["licenses/" + n["as"]] = fetch_checked(n["url"], n["sha256"], vd, "notice-" + n["as"])
    app_dir = os.path.join(vd, "app")
    count = unpack(data, d.get("format", "zip"), d.get("root", ""), d.get("include"), app_dir)
    if not os.path.isfile(os.path.join(app_dir, *a["main"].split("/"))):
        raise ValueError("the release has no %s" % a["main"])
    if "path" in a["icon"]:
        with open(os.path.join(app_dir, *a["icon"]["path"].split("/")), "rb") as f:
            files["icon.png"] = f.read()
    if not files["icon.png"].startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("the icon is not a PNG")
    return app_dir, files, count


# ---- Packages ------------------------------------------------------------------------------

def tar_gz(entries):
    """entries: [(path, bytes, mode)] -> a deterministic .tar.gz (sorted, root-owned, one time)."""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.GNU_FORMAT) as tf:
        dirs = set()
        for path, body, mode in sorted(entries, key=lambda e: e[0]):
            parts = path.split("/")
            for i in range(1, len(parts)):
                dpath = "./" + "/".join(parts[:i]) + "/"
                if dpath in dirs:
                    continue
                dirs.add(dpath)
                ti = tarfile.TarInfo(dpath)
                ti.type, ti.mode, ti.mtime, ti.uname, ti.gname = tarfile.DIRTYPE, 0o755, EPOCH, "root", "root"
                tf.addfile(ti)
            ti = tarfile.TarInfo("./" + path)
            ti.size, ti.mode, ti.mtime, ti.uname, ti.gname = len(body), mode, EPOCH, "root", "root"
            tf.addfile(ti, io.BytesIO(body))
    out = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=out, mtime=0, compresslevel=9) as gz:
        gz.write(raw.getvalue())
    return out.getvalue()


def ar(members):
    out = [b"!<arch>\n"]
    for name, body in members:
        out.append(("%-16s%-12d%-6d%-6d%-8s%-10d`\n" % (name, 0, 0, 0, "100644", len(body))).encode())
        out.append(body)
        if len(body) % 2:
            out.append(b"\n")
    return b"".join(out)


def ipk(app_id, version, control, files):
    """files: {path in the app's folder: bytes} -> the .ipk's bytes."""
    lines = ["Package: " + app_id, "Version: " + version, "Section: web", "Priority: optional", "Architecture: all"]
    lines += ["%s: %s" % (k, v.replace("\n", " ")) for k, v in control.items() if v]
    size = sum(len(b) for b in files.values())
    lines.append("Installed-Size: %d" % ((size + 1023) // 1024))
    ctl = tar_gz([("control", ("\n".join(lines) + "\n").encode(), 0o644)])
    prefix = "usr/palm/applications/%s/" % app_id
    data = tar_gz([(prefix + p, b, 0o644) for p, b in files.items()])
    return ar([("debian-binary", b"2.0\n"), ("control.tar.gz", ctl), ("data.tar.gz", data)])


def files_under(folder):
    out = {}
    for base, dirs, names in os.walk(folder):
        dirs.sort()
        for n in sorted(names):
            full = os.path.join(base, n)
            if os.path.islink(full) or not os.path.isfile(full):
                raise ValueError("not a plain file: %s" % full)
            rel = os.path.relpath(full, folder).replace(os.sep, "/")
            with open(full, "rb") as f:
                out[rel] = f.read()
    return out


def package_rootfs(ipk_path, dest):
    """A package's app laid out as a device's root in dest (phoenix-sim --extra-rootfs, for shoot)."""
    with open(ipk_path, "rb") as f:
        data = f.read()
    if not data.startswith(b"!<arch>\n"):
        raise ValueError("not an .ipk: " + ipk_path)
    pos, members = 8, {}
    while pos + 60 <= len(data):
        name = data[pos:pos + 16].decode().strip().rstrip("/")
        size = int(data[pos + 48:pos + 58].decode().strip())
        members[name] = data[pos + 60:pos + 60 + size]
        pos += 60 + size + (size % 2)
    tf = tarfile.open(fileobj=io.BytesIO(members["data.tar.gz"]), mode="r:gz")
    for m in tf.getmembers():
        if m.isdir():
            continue
        rel = safe_rel(m.name)
        if not m.isreg() or rel is None:
            raise ValueError("unexpected entry in the package: %s" % m.name)
        path = os.path.join(dest, *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(tf.extractfile(m).read())
    return dest


def appinfo_for(a):
    info = {
        "id": a["id"], "version": a["version"], "vendor": a["developer"], "type": "web", "main": a["main"],
        "title": a["title"], "icon": "icon.png", "largeIcon": "icon.png",
        # An installed app is removable (OSE's SAM reads this for the apps in its store folder).
        "removable": True,
        # Installed apps go to the launcher's Downloads tab (docs/APP-STORE.md 1.5).
        "phoenix": {"launcherTab": 1},
    }
    if a.get("developerUrl"):
        info["vendorurl"] = a["developerUrl"]
    return info


def pack(a, cache):
    vd = version_dir(cache, a)
    app_dir, extra, count = fetch(a, cache)
    files = files_under(app_dir)
    for rel in list(files):
        if rel == "appinfo.json":
            raise ValueError("the release has an appinfo.json of its own; this script writes it")
    files.update(extra)
    files["appinfo.json"] = (json.dumps(appinfo_for(a), indent=4, ensure_ascii=False) + "\n").encode()
    control = {"Maintainer": "Phoenix Marketplace (repackaged, unmodified, from the upstream release)",
               "Description": "%s: %s" % (a["title"], a["summary"]), "Homepage": a["homepage"], "Source": a["source"],
               "License": a["license"]}
    body = ipk(a["id"], a["version"], control, files)
    if len(body) > MAX_PACKAGE:
        raise ValueError("the package is %.1f MB, more than the catalog takes (%d MB)" % (len(body) / 1048576, MAX_PACKAGE >> 20))
    path = os.path.join(vd, "%s_%s_all.ipk" % (a["id"], a["version"]))
    with open(path, "wb") as f:
        f.write(body)
    with open(os.path.join(vd, "icon.png"), "wb") as f:
        f.write(extra["icon.png"])
    # The unpacked release is in the package now; the checked download stays.
    shutil.rmtree(app_dir, ignore_errors=True)
    say("%s %s: %s (%.1f MB, %d files from upstream, sha256 %s)" % (a["id"], a["version"], path, len(body) / 1048576, count, sha256(body)))
    return path


# ---- Publishing ------------------------------------------------------------------------------

def screenshots_of(cache, app_id):
    d = os.path.join(cache, app_id, "screenshots")
    return [os.path.join(d, n) for n in sorted(os.listdir(d)) if n.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))][:8] \
        if os.path.isdir(d) else []


def listing_for(a, cache):
    upstream = a.get("upstreamVersion", a["version"])
    about = ("%s\n\n%s %s from %s's own release (%s), unmodified; packed for Phoenix by the Marketplace. "
             "Licence: %s. Source: %s") % (a["description"], a["title"], upstream, a["developer"], a["download"]["url"],
                                           a["license"], a["source"])
    if a.get("needs"):
        about += "\n\nNeeds: " + ", ".join(a["needs"]) + "."
    out = {"title": a["title"], "developer": a["developer"], "summary": a["summary"], "description": about,
           "categories": a["categories"], "license": a["license"], "homepage": a["homepage"], "source": a["source"],
           "icon": os.path.join(version_dir(cache, a), "icon.png"), "screenshots": screenshots_of(cache, a["id"])}
    if a.get("developerUrl"):
        out["developerUrl"] = a["developerUrl"]
    return out


def upload(opts, ipk_path, listing, listing_dir):
    path = os.path.join(listing_dir, "listing.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(listing, f, indent=1, ensure_ascii=False)
    env = dict(os.environ)
    if opts.get("data"):
        env["MARKETPLACE_DATA"] = os.path.abspath(opts["data"])
    cmd = [opts.get("php") or "php", os.path.join(HERE, "marketplace.php"), "upload", "--phoenix", "--listing", path, ipk_path]
    r = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if r.returncode:
        raise ValueError((r.stderr or r.stdout).strip())
    return r.stdout.strip()


# ---- Screenshots in the simulator -------------------------------------------------------------

def shoot(a, cache, opts):
    """Screenshots of the packed app in phoenix-sim: launched from --extra-rootfs (its package's files
    laid out as a device's root), in a fresh HOME, kept as <cache>/<id>/screenshots/<n>.png."""
    vd = version_dir(cache, a)
    package = os.path.join(vd, "%s_%s_all.ipk" % (a["id"], a["version"]))
    if not os.path.isfile(package):
        die("%s is not packed yet: run pack %s first" % (a["id"], a["id"]))
    sim = opts.get("sim") or os.path.join(REPO, "build", "phoenix-sim")
    if not os.access(sim, os.X_OK):
        die("no phoenix-sim at %s (build it, or give --sim PATH)" % sim)
    out_dir = os.path.join(cache, a["id"], "screenshots")
    os.makedirs(out_dir, exist_ok=True)
    n = len([x for x in os.listdir(out_dir) if x.endswith(".png")]) + 1
    out = os.path.join(out_dir, "%d.png" % n)
    home = tempfile.mkdtemp(prefix="phoenix-shoot-home-")
    rootfs = package_rootfs(package, tempfile.mkdtemp(prefix="phoenix-shoot-rootfs-"))
    env = dict(os.environ, HOME=home)
    if opts.get("software_gl"):
        # No GPU here: WebGL 2 in software (not needed with a real GPU).
        env["QTWEBENGINE_CHROMIUM_FLAGS"] = (env.get("QTWEBENGINE_CHROMIUM_FLAGS", "") + " --ignore-gpu-blocklist --enable-unsafe-swiftshader").strip()
    cmd = [sim, "--" + (opts.get("size") or "tablet"), "--extra-rootfs", rootfs, "--launch", a["id"],
           "--screenshot", out, "--delay", str(opts.get("delay") or 15000)]
    if not env.get("DISPLAY") and not env.get("WAYLAND_DISPLAY") and sys.platform.startswith("linux"):
        env["QTWEBENGINE_DISABLE_SANDBOX"] = "1"
        cmd = ["xvfb-run", "-a", "-s", "-screen 0 1920x1200x24"] + cmd
    try:
        r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=300)
    finally:
        shutil.rmtree(home, ignore_errors=True)
        shutil.rmtree(rootfs, ignore_errors=True)
    if r.returncode or not os.path.isfile(out):
        raise ValueError("phoenix-sim failed (%d): %s" % (r.returncode, (r.stderr or "")[-600:]))
    say("%s: %s" % (a["id"], out))


# ---- webOS Phoenix 2.0's apps (phoenix-default-apps) ---------------------------------------------

# Their second category in the catalog, by folder (the first is "Phoenix 2.0").
DEFAULT_CATEGORIES = {
    "memos": "Productivity", "notes": "Productivity", "tasks": "Productivity", "agenda": "Productivity", "calendar": "Productivity",
    "contacts": "Communication", "email": "Communication", "messaging": "Communication", "phone": "Communication",
    "photos": "Photography", "camera": "Photography", "music": "Music", "podcasts": "Music", "videos": "Entertainment",
    "maps": "Navigation", "weather": "Weather", "browser": "Utilities", "calculator": "Utilities", "clock": "Utilities",
    "files": "Utilities", "docview": "Productivity", "pdfview": "Productivity", "passwords": "Utilities",
    "authenticator": "Utilities", "terminal": "Developer", "help": "Reference", "assistant": "Productivity",
}


def default_apps_dir(opts):
    d = opts.get("from") or os.environ.get("PHOENIX_DEFAULT_APPS")
    if not d:
        return None, "no phoenix-default-apps checkout given (--from PATH or PHOENIX_DEFAULT_APPS)"
    d = os.path.realpath(os.path.expanduser(d))
    if not os.path.isfile(os.path.join(d, "package.json")) or not os.path.isdir(os.path.join(d, "apps")):
        return None, "%s is not a phoenix-default-apps checkout" % d
    return d, ""


def checkout_commit(d):
    """The checkout's commit, read from .git (no git run)."""
    try:
        head = open(os.path.join(d, ".git", "HEAD")).read().strip()
        if head.startswith("ref: "):
            ref = head[5:]
            p = os.path.join(d, ".git", *ref.split("/"))
            if os.path.isfile(p):
                return open(p).read().strip()[:7]
            for line in open(os.path.join(d, ".git", "packed-refs")):
                if line.strip().endswith(" " + ref):
                    return line.split()[0][:7]
        return head[:7]
    except OSError:
        return ""


def default_apps(opts, ids):
    d, why = default_apps_dir(opts)
    if not d:
        say("The 2.0 apps are skipped: " + why + ".")
        return 0
    cache = cache_dir(opts)
    commit = checkout_commit(d)
    failed = 0
    for name in sorted(os.listdir(os.path.join(d, "apps"))):
        src = os.path.join(d, "apps", name)
        try:
            info = json.load(open(os.path.join(src, "public", "appinfo.json"), encoding="utf-8-sig"))
        except (OSError, ValueError):
            continue
        if ids and name not in ids and info.get("id") not in ids:
            continue
        dist = os.path.join(src, "dist")
        try:
            built = json.load(open(os.path.join(dist, "appinfo.json"), encoding="utf-8-sig"))
        except (OSError, ValueError):
            say("%s: skipped, not built (npm run build -w apps/%s in %s)" % (name, name, d))
            continue
        if not os.path.isfile(os.path.join(dist, built.get("main", "index.html"))):
            say("%s: skipped, its build has no %s" % (name, built.get("main", "index.html")))
            continue
        try:
            app_id, version = built["id"], built["version"]
            if not APP_ID.match(app_id):
                raise ValueError("not a valid app id: " + app_id)
            files = files_under(dist)
            # Installed, it is an update of the built-in app of its id: removable, so the
            # built-in one can come back (OSE's SAM reads "removable" for its store apps).
            built["removable"] = True
            files["appinfo.json"] = (json.dumps(built, indent=4, ensure_ascii=False) + "\n").encode()
            try:
                pkg = json.load(open(os.path.join(src, "package.json"), encoding="utf-8"))
            except (OSError, ValueError):
                pkg = {}
            summary = re.sub(r"^[^:]{1,80}\([^)]*\):\s*", "", pkg.get("description") or "").strip() or built.get("title", app_id)
            if summary[:1].islower() and not summary.startswith("webOS"):
                summary = summary[0].upper() + summary[1:]
            title = built.get("title", app_id)
            control = {"Maintainer": "webOS Phoenix", "Description": "%s (webOS Phoenix 2.0)" % title,
                       "License": pkg.get("license") or "Apache-2.0"}
            body = ipk(app_id, version, control, files)
            if len(body) > MAX_PACKAGE:
                raise ValueError("%.1f MB, more than the catalog takes" % (len(body) / 1048576))
            vd = os.path.join(cache, "phoenix-2.0", app_id, version)
            os.makedirs(vd, exist_ok=True)
            path = os.path.join(vd, "%s_%s_all.ipk" % (app_id, version))
            with open(path, "wb") as f:
                f.write(body)
            icon_name = next((n for n in ("icon-256x256.png", built.get("largeIcon") or "", built.get("icon") or "icon.png")
                              if n and n in files and files[n].startswith(b"\x89PNG")), None)
            say("%s %s: %s (%.1f MB)" % (app_id, version, path, len(body) / 1048576))
            if not opts.get("publish"):
                continue
            listing = {
                "title": title, "developer": "webOS Phoenix", "developerUrl": "https://github.com/thebestbradley/webos-phoenix",
                "summary": summary[:300],
                "description": ("%s\n\nThe webOS Phoenix 2.0 version of %s, rebuilt on Enact. On a 1.0 device it installs in place "
                                "of the %s it came with; removing it brings that version back.%s")
                               % (summary, title, title, (" Built from phoenix-default-apps %s." % commit) if commit else ""),
                "categories": ["Phoenix 2.0", DEFAULT_CATEGORIES.get(name, "Utilities")],
                "license": pkg.get("license") or "Apache-2.0", "homepage": "https://github.com/thebestbradley/webos-phoenix",
            }
            if icon_name:
                with open(os.path.join(vd, "icon.png"), "wb") as f:
                    f.write(files[icon_name])
                listing["icon"] = os.path.join(vd, "icon.png")
            shots = screenshots_of(os.path.join(cache, "phoenix-2.0"), app_id)
            if shots:
                listing["screenshots"] = shots
            say("  " + upload(opts, path, listing, vd))
        except (OSError, ValueError, KeyError) as e:
            failed += 1
            say("%s: failed: %s" % (name, e))
    return 1 if failed else 0


# ---- Commands ----------------------------------------------------------------------------------

def parse(argv):
    opts, args = {}, []
    takes = {"--cache": "cache", "--data": "data", "--php": "php", "--sim": "sim", "--delay": "delay", "--from": "from", "--size": "size"}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in takes and i + 1 < len(argv):
            opts[takes[a]] = argv[i + 1]
            i += 2
            continue
        if a in ("--publish", "--software-gl"):
            opts[a[2:].replace("-", "_")] = True
        elif a in ("-h", "--help"):
            print(__doc__)
            sys.exit(0)
        elif a.startswith("--"):
            die("unknown option " + a)
        else:
            args.append(a)
        i += 1
    return opts, args


def main(argv):
    opts, args = parse(argv)
    if not args:
        print(__doc__)
        return 2
    cmd, ids = args[0], args[1:]
    if cmd == "default-apps":
        return default_apps(opts, ids)
    apps = load_manifest()
    seen, errs = set(), []
    for a in apps:
        errs += ["%s: %s" % (a.get("id"), e) for e in check_entry(a)]
        if a.get("id") in seen:
            errs.append("%s: listed twice" % a["id"])
        seen.add(a.get("id"))
    if errs:
        die("catalog/web-apps.json:\n  " + "\n  ".join(errs))
    if cmd == "check":
        say("catalog/web-apps.json: %d apps, all hosted under permissive licences" % len(apps))
        return 0
    if cmd == "list":
        cache = cache_dir(opts)
        for a in apps:
            vd = version_dir(cache, a)
            packed = os.path.isfile(os.path.join(vd, "%s_%s_all.ipk" % (a["id"], a["version"])))
            say("%-34s %-10s %-22s %s" % (a["id"], a["version"], a["license"], "packed" if packed else "-"))
        return 0
    cache = cache_dir(opts)
    failed = 0
    for a in pick(apps, ids):
        try:
            if cmd == "fetch":
                _, _, count = fetch(a, cache)
                say("%s %s: %d files, checked" % (a["id"], a["version"], count))
            elif cmd == "pack":
                pack(a, cache)
            elif cmd == "publish":
                path = pack(a, cache)
                say("  " + upload(opts, path, listing_for(a, cache), version_dir(cache, a)))
            elif cmd == "shoot":
                shoot(a, cache, opts)
            else:
                die("unknown command %s (list, check, fetch, pack, publish, shoot, default-apps)" % cmd)
        except (OSError, ValueError, zipfile.BadZipFile, tarfile.TarError, urllib.error.URLError) as e:
            failed += 1
            say("%s: failed: %s" % (a["id"], e))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
