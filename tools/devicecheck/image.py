# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""What the image must contain, against what its recipes install.

  unpackaged     a file tools/install-rootfs.py installs (phoenix-apps'
                 do_install) under a path phoenix-apps' FILES does not
                 package: do_package stops with "installed-vs-shipped"
  conflict       a path both phoenix-apps and phoenix-shell (shell/CMakeLists.txt's
                 install rules) install: the rootfs step stops on two
                 packages owning one file
  missing-path   code that runs on a device names a read-only device path
                 (/usr/palm, /usr/share/phoenix, /etc/phoenix, /etc/palm, ...)
                 that no recipe installs
  require        a Node service's require() that does not resolve inside the
                 image: not a Node built-in, not a module OSE installs
                 (webos-service), not a file or package the service carries
  dev-dependency a Node service's package.json lists devDependencies or a
                 workspace link the image does not have
  qml-import     a QML module the device shell imports that the image's Qt
                 does not have (OSE leaves out Qt WebEngine and Multimedia
                 6.x, for one) or that phoenix-shell does not RDEPEND on
  not-built      (a note, not a finding) what install-rootfs.py could not
                 install because it was not built in this tree
"""

import os
import re

from . import Findings, finish, parser, read, read_json, walk, line_of, rel, recipe_vars, install_plan, SKIP_DIRS

CHECKER = "image"

# BitBake's paths on webOS OSE (webos_filesystem_paths.bbclass, bitbake.conf).
PATHS = {"prefix": "/usr", "exec_prefix": "/usr", "datadir": "/usr/share", "sysconfdir": "/etc",
         "bindir": "/usr/bin", "sbindir": "/usr/sbin", "libdir": "/usr/lib", "localstatedir": "/var",
         "systemd_system_unitdir": "/usr/lib/systemd/system", "systemd_unitdir": "/usr/lib/systemd",
         "QT6_INSTALL_QMLDIR": "/usr/lib/qml", "webos_sysbus_datadir": "/usr/share/luna-service2",
         "nonarch_base_libdir": "/usr/lib", "base_libdir": "/usr/lib"}

# Node.js modules a webOS OSE image installs globally (meta-webos:
# nodejs-module-webos-service, -webos-pmlog, -webos-dynaload, palmbus).
OSE_NODE_MODULES = {"webos-service", "palmbus", "pmloglib", "webos-dynaload", "webos-sysbus"}
NODE_BUILTINS = set("""assert async_hooks buffer child_process cluster console constants crypto dgram
diagnostics_channel dns domain events fs fs/promises http http2 https inspector module net os path
path/posix path/win32 perf_hooks process punycode querystring readline readline/promises repl stream
stream/promises stream/web string_decoder sys timers timers/promises tls trace_events tty url util
util/types v8 vm wasi worker_threads zlib test""".split())

# QML modules: who provides each on an OSE image, and whether OSE builds it
# (meta-webos webos-recipe-blacklist.inc skips qtwebengine, meta-qt6's
# qtmultimedia, qtpdf; luna-surfacemanager and qml-webos-* bring WebOS*).
QML_PROVIDERS = [
    ("Phoenix.", None),
    ("WebOS", "luna-surfacemanager-base"),
    ("Eos", "luna-surfacemanager-base"),
    ("QtQuick.Shapes", "qtdeclarative-qmlplugins"),
    ("QtQuick.Controls", "qtdeclarative-qmlplugins"),
    ("QtQuick.Layouts", "qtdeclarative-qmlplugins"),
    ("QtQuick.Window", "qtdeclarative-qmlplugins"),
    ("QtQuick.Particles", "qtdeclarative-qmlplugins"),
    ("QtQuick.Effects", "qtdeclarative-qmlplugins"),
    ("QtQuick", "qtdeclarative-qmlplugins"),
    ("QtQml", "qtdeclarative-qmlplugins"),
    ("Qt5Compat.GraphicalEffects", "qt5compat-qmlplugins"),
    ("Qt.labs", "qtdeclarative-qmlplugins"),
    ("QtPositioning", "qtpositioning-qmlplugins"),
    ("QtWebEngine", "!qtwebengine is skipped by meta-webos (webos-recipe-blacklist.inc)"),
    ("QtWebView", "!qtwebview is skipped by meta-webos (webos-recipe-blacklist.inc)"),
    ("QtMultimedia", "!OSE builds its own Qt Multimedia 6.0 fork (meta-webos qtmultimedia_6.0.0.bb), not the 6.8 API"),
    ("QtWayland", "qtwayland-qmlplugins"),
]


def expand(value):
    def sub(m):
        return PATHS.get(m.group(1), m.group(0))
    prev = None
    while prev != value:
        prev, value = value, re.sub(r"\$\{([A-Za-z0-9_]+)\}", sub, value)
    return value


def recipe(root, name):
    for d, dirs, files in os.walk(os.path.join(root, "meta-phoenix")):
        for fn in files:
            if fn.startswith(name + "_") and fn.endswith(".bb") or fn == name + ".bb":
                return os.path.join(d, fn)
    return None


def files_of(path):
    v, _, _, _ = recipe_vars(path)
    out = []
    for k, val in v.items():
        if k.startswith("FILES:${PN}") or k == "FILES_${PN}":
            out += [expand(x) for x in val.split()]
    return out


def covered(path, patterns):
    for p in patterns:
        p = p.rstrip("/")
        if path == p or path.startswith(p + "/"):
            return True
        if "*" in p and re.match("^" + re.escape(p).replace(r"\*", "[^/]*") + "($|/)", path):
            return True
    return False


def shell_installs(root):
    """Device paths shell/CMakeLists.txt (and native/, services/tts,
    services/wakeword) install, roughly: (path, is_dir)."""
    out = []
    cm = os.path.join(root, "shell", "CMakeLists.txt")
    if not os.path.isfile(cm):
        return out
    text = read(cm)
    vars_ = {"PHOENIX_DATA_DIR": "/usr/share/phoenix", "CMAKE_INSTALL_DATADIR": "/usr/share",
             "CMAKE_INSTALL_SYSCONFDIR": "/etc", "CMAKE_INSTALL_BINDIR": "/usr/bin"}

    def cm_expand(s):
        return re.sub(r"\$\{([A-Za-z0-9_]+)\}", lambda m: vars_.get(m.group(1), m.group(0)), s)
    for m in re.finditer(r"install\(\s*DIRECTORY\s+(\S+)\s+DESTINATION\s+([^\s)]+)", text):
        src, dst = m.group(1), cm_expand(m.group(2))
        src_dir = os.path.join(root, "shell", src.rstrip("/"))
        if src.endswith("/"):
            if os.path.isdir(src_dir):
                for n in os.listdir(src_dir):
                    out.append((dst.rstrip("/") + "/" + n, os.path.isdir(os.path.join(src_dir, n))))
        else:
            out.append((dst.rstrip("/") + "/" + os.path.basename(src), True))
    for m in re.finditer(r"install\(\s*FILES\s+(.*?)\s+DESTINATION\s+(\S+?)\)", text, re.S):
        dst = cm_expand(m.group(2))
        for f in m.group(1).split():
            out.append((dst.rstrip("/") + "/" + os.path.basename(f), False))
    return out


DEVICE_PATH = re.compile(r"""["'`](/(?:usr/palm|usr/share/phoenix|usr/lib/phoenix|etc/phoenix|etc/palm|usr/share/fonts)(?:/[^"'`\s$*{}]*)?)["'`]""")


def recipe_installs(root):
    """Device paths the layer's recipes and classes install themselves
    (do_install's ${D}..., an image class's ${IMAGE_ROOTFS}...)."""
    out = set()
    base = os.path.join(root, "meta-phoenix")
    for d, dirs, files in os.walk(base):
        for fn in files:
            if not fn.endswith((".bb", ".bbappend", ".bbclass", ".inc")):
                continue
            text = read(os.path.join(d, fn))
            for m in re.finditer(r"\$\{(?:D|IMAGE_ROOTFS)\}((?:\$\{[A-Za-z0-9_]+\}|/[^\s\"'$;)]*)+)", text):
                # `install -d` and `mkdir` make an empty folder: they install
                # nothing in it (a file named under it is still missing).
                line = text[text.rfind("\n", 0, m.start()) + 1:m.start()]
                if re.search(r"\binstall\b[^\n]*\s-d\b|\bmkdir\b", line):
                    continue
                p = expand(m.group(1)).rstrip("/")
                if p.startswith("/") and "${" not in p:
                    out.add(p)
            # Python image classes: os.path.join(rootfs, "usr/share/...").
            for m in re.finditer(r"""["'](usr/share/phoenix/[^"']+|etc/phoenix/[^"']+)["']""", text):
                out.add("/" + m.group(1).rstrip("/"))
    return out


def public_files(root):
    """{app id: its public/ directory}: a built app's dist/ holds public/
    as it is (Vite), so paths into an app need no build to be checked."""
    out = {}
    apps = os.path.join(root, "apps")
    for n in sorted(os.listdir(apps)) if os.path.isdir(apps) else []:
        info = os.path.join(apps, n, "public", "appinfo.json")
        if os.path.isfile(info):
            try:
                out[read_json(info).get("id")] = os.path.join(apps, n, "public")
            except ValueError:
                pass
    return out


def device_code(root):
    """Code that runs on a device and may name device paths."""
    rels = [os.path.join("shell", "qml", "Phoenix", "Shell"), os.path.join("shell", "qml", "Phoenix", "Lsm"),
            os.path.join("shell", "native"), "services"]
    apps = os.path.join(root, "apps")
    for n in sorted(os.listdir(apps)) if os.path.isdir(apps) else []:
        for sub in ("service", "src"):
            if os.path.isdir(os.path.join(apps, n, sub)):
                rels.append(os.path.join("apps", n, sub))
    for r in rels:
        if os.path.isdir(os.path.join(root, r)):
            for p in walk(root, r, (".qml", ".js", ".cpp", ".h", ".c", ".ts", ".tsx", ".mjs", ".cjs")):
                yield p


def check(root):
    f = Findings(CHECKER)
    plan, unbuilt = install_plan(root)
    notes = list(unbuilt)

    # Packaging: phoenix-apps' FILES against what its do_install installs.
    apps_recipe = recipe(root, "phoenix-apps")
    if apps_recipe:
        pats = files_of(apps_recipe)
        groups = {}
        for dev in sorted(plan):
            if not covered(dev, pats):
                key = "/".join(dev.split("/")[:4])
                groups.setdefault(key, []).append(dev)
        for key, devs in groups.items():
            f.add("unpackaged", key, "phoenix-apps installs %d files under %s that its FILES does not package "
                  "(do_package: installed-vs-shipped)" % (len(devs), key), devs[0])

    # Conflicts: the same path from phoenix-apps and phoenix-shell.
    shell = shell_installs(root)
    for path, is_dir in shell:
        hits = [d for d in plan if d == path or (is_dir and d.startswith(path + "/"))]
        if hits:
            f.add("conflict", path, "both phoenix-shell (shell/CMakeLists.txt) and phoenix-apps "
                  "(tools/install-rootfs.py) install %s (%d files): two packages may not own one path"
                  % (path, len(hits)), hits[0])

    # Device paths the code reads.
    shipped = set(plan)
    shipped_dirs = set()
    for p in list(shipped) + [s for s, _ in shell]:
        parts = p.split("/")
        for i in range(2, len(parts)):
            shipped_dirs.add("/".join(parts[:i]))
    shell_dirs = [s for s, d in shell if d] + sorted(recipe_installs(root))
    shell_files = {s for s, d in shell if not d}
    public = public_files(root)
    for p in device_code(root):
        text = read(p)
        for m in DEVICE_PATH.finditer(text):
            path = m.group(1).rstrip("/")
            if "..." in path or path.count("/") < 3:
                continue
            # A folder something is installed into exists too (`qml/` installs
            # qml's children, so /usr/share/phoenix/qml is there).
            if path in shipped or path in shipped_dirs or path in shell_files \
                    or any(path == d or path.startswith(d + "/") or d.startswith(path + "/")
                           for d in list(shell_dirs) + list(shell_files)):
                continue
            am = re.match(r"^/usr/palm/applications/([^/]+)(/.*)?$", path)
            if am and am.group(1) in public and os.path.exists(public[am.group(1)] + (am.group(2) or "")):
                continue
            f.add("missing-path", path, "%s names %s, which no recipe installs" % (rel(root, os.path.dirname(p)), path),
                  "%s:%d" % (rel(root, p), line_of(text, m.start())))

    # Node services: what they require, inside the image.
    services = {}
    for dev in plan:
        m = re.match(r"^/usr/palm/services/([^/]+)/", dev)
        if m:
            services.setdefault(m.group(1), []).append(dev)
    for svc, devs in sorted(services.items()):
        base = "/usr/palm/services/%s" % svc
        for dev in devs:
            if not dev.endswith((".js", ".cjs", ".mjs")) or "/node_modules/" in dev:
                continue
            src = plan[dev]
            text = read(src)
            for m in re.finditer(r"""\brequire\(\s*["']([^"']+)["']\s*\)|^\s*import\s[^;]*?from\s+["']([^"']+)["']""", text, re.M):
                spec = m.group(1) or m.group(2)
                where = "%s:%d" % (rel(root, src), line_of(text, m.start()))
                name = spec[5:] if spec.startswith("node:") else spec
                if name in NODE_BUILTINS:
                    continue
                if spec.startswith("."):
                    target = os.path.normpath(os.path.join(os.path.dirname(dev), spec))
                    if any(t in shipped for t in (target, target + ".js", target + ".json", target + ".cjs",
                                                  target + "/index.js")):
                        continue
                    f.add("require", "%s:%s" % (svc, spec), "%s requires %s, which is not in the image (%s)"
                          % (svc, spec, target), where)
                    continue
                pkg = "/".join(spec.split("/")[:2]) if spec.startswith("@") else spec.split("/")[0]
                if pkg in OSE_NODE_MODULES:
                    continue
                if "%s/node_modules/%s/package.json" % (base, pkg) in shipped:
                    continue
                if pkg.startswith("@phoenix/") and any("not built" in n for n in notes):
                    # A shared package not built in this tree: install-rootfs.py
                    # stops on it (strict) in the recipe; noted above.
                    continue
                f.add("require", "%s:%s" % (svc, pkg), "%s requires the package %s, which the image does not have "
                      "(not a Node built-in, not one of OSE's modules, not in its node_modules)" % (svc, pkg), where)
        pkg_dev = base + "/package.json"
        if pkg_dev in plan:
            info = read_json(plan[pkg_dev])
            for k in ("devDependencies",):
                if info.get(k):
                    pass  # not installed, and fine as long as nothing requires them (checked above)
            for dep, ver in (info.get("dependencies") or {}).items():
                if str(ver).startswith(("file:", "link:", "workspace:")) and \
                        "%s/node_modules/%s/package.json" % (base, dep) not in shipped:
                    f.add("dev-dependency", "%s:%s" % (svc, dep), "%s depends on %s (%s), a link the image "
                          "does not resolve" % (svc, dep, ver), rel(root, plan[pkg_dev]))

    # QML imports of the device shell.
    shell_recipe = recipe(root, "phoenix-shell")
    rdepends = ""
    if shell_recipe:
        v, _, _, _ = recipe_vars(shell_recipe)
        rdepends = " ".join(val for k, val in v.items() if k.startswith("RDEPENDS"))
    for r in (os.path.join("shell", "qml", "Phoenix", "Shell"), os.path.join("shell", "qml", "Phoenix", "Lsm")):
        if not os.path.isdir(os.path.join(root, r)):
            continue
        for p in walk(root, r, (".qml", ".js")):
            text = read(p)
            for m in re.finditer(r"^\s*import\s+([A-Za-z][\w.]*)", text, re.M):
                mod = m.group(1)
                prov = None
                for prefix, pkg in QML_PROVIDERS:
                    if mod == prefix.rstrip(".") or mod.startswith(prefix):
                        prov = pkg or ""
                        break
                where = "%s:%d" % (rel(root, p), line_of(text, m.start()))
                if prov is None:
                    f.add("qml-import", mod, "the device shell imports %s, which no known package provides" % mod, where)
                elif prov.startswith("!"):
                    f.add("qml-import", mod, "the device shell imports %s: %s" % (mod, prov[1:]), where)
                elif prov and prov not in rdepends and prov != "luna-surfacemanager-base" or \
                        prov == "luna-surfacemanager-base" and prov not in rdepends:
                    f.add("qml-import", mod, "the device shell imports %s (from %s), which phoenix-shell does "
                          "not RDEPEND on" % (mod, prov), where)
    return f, notes


def main(argv=None):
    ap = parser(__doc__.splitlines()[0])
    args = ap.parse_args(argv)
    findings, notes = check(os.path.abspath(args.root))
    return finish(CHECKER, findings, args, notes=notes)
