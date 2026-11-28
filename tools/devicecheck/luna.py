# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Luna calls against their providers and the callers' permissions.

Every luna:// and palm:// call in code that runs on a device (the image's
apps and their compat overlays, the frameworks, Phoenix's Node and native
services, the device shell's QML, the runtime's device half) is checked:

  unknown-service    no provider on an OSE image: neither an OSE component
                     (ose-services.json, from OSE's own sysbus files) nor a
                     Phoenix service whose sysbus files the image installs
  unknown-method     the provider's api-permissions file has no such method
                     (the hub refuses it, or the service answers "unknown
                     method")
  missing-permission the caller holds none of the ACG groups the provider's
                     api file allows for the method: an app's appinfo.json
                     requiredPermissions, a service's .perm.json, the shell's
                     perm files (luna-surfacemanager's and Phoenix's)
  no-permissions     an app calls services with ACG groups but declares no
                     requiredPermissions (OSE gives it none)
  outbound           a Phoenix service calls a service its role file's
                     "outbound" list does not allow
  unknown-group      a perm file or requiredPermissions names a group no
                     provider defines

An account template's sign-in page (validator.customUI) is checked as
Accounts (com.palm.app.accounts), whose card shows it in a frame: on a
device the hub sees Accounts calling.

Web apps' calls go through the runtime's serviceAliases first (the names
OSE renamed: com.palm.systemservice and so on), as on a device. URIs built
at run time from parts the checker cannot follow are not checked; a
service named in a literal URI with its method elsewhere ("palm://x/",
{method: "y"}; call("luna://x", "/y")) is followed within the call.
"""

import fnmatch
import json
import os
import re

from . import Findings, finish, parser, read, read_json, walk, line_of, rel, HERE, SKIP_DIRS

CHECKER = "luna"
SOURCE_EXTS = (".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".qml", ".html", ".cpp", ".cc", ".c", ".h", ".json")

URI = re.compile(r"""(["'`])(?:luna|palm)://([A-Za-z0-9_.\-]+)(/[A-Za-z0-9_./\-]*)?(\$\{[^}`]*\})?([^"'`]*)\1""")
CONST = re.compile(r"""(?:\b(?:const|var|let)\s+|readonly\s+property\s+string\s+|property\s+string\s+|\b)([A-Za-z_$][\w$]*)\s*[:=]\s*(["'])(?:luna|palm)://([A-Za-z0-9_.\-]+)/?\2""")
METHOD_AFTER = re.compile(r"""^\s*(?:,\s*(?:\{[^{}]{0,200}?\bmethod\s*:\s*|)|[^;]{0,300}?\bmethod\s*:\s*)(["'])/?([A-Za-z0-9_./\-]+)\1""", re.S)
QML_SECOND = re.compile(r"""^\s*,\s*(["'])(/[A-Za-z0-9_./\-]+)\1""")
COMMENT_LINE = re.compile(r"^\s*(//|\*|/\*|#)")
SET_METHOD = re.compile(r"""\.setMethod\(\s*(["'])([A-Za-z0-9_./\-]+)\1\s*\)""")
PALM_COMPONENT = re.compile(r"""\{[^{}]*\bkind\s*:\s*(["'])PalmService\1[^{}]*\}""")
SIGNAL_SEND = re.compile(r"\b(?:LSSignalSend\w*|signal)\s*\(\s*(?:[\w.\->]+\s*,\s*)?$")


def strip_comment_lines(text):
    """Comment lines blanked, keeping every offset (URIs contain //, so only
    whole comment lines go)."""
    return "\n".join(" " * len(l) if COMMENT_LINE.match(l) else l for l in text.split("\n"))


def calls_in(text):
    """[(service, method or None, pos)] of the Luna calls in a source text."""
    text = strip_comment_lines(text)
    out = []
    for m in URI.finditer(text):
        svc, path, templ, rest = m.group(2), m.group(3) or "", m.group(4), m.group(5)
        if SIGNAL_SEND.search(text[max(0, m.start() - 80):m.start()]):
            # A signal the service sends (LSSignalSend, or its wrapper): a
            # publish through the hub, not a call of that method; the hub
            # checks it as com.webos.service.bus/signal/publish/<category>
            # (luna-service2 src/ls-hubd/security.cpp:861-887), whose group
            # servicebus.signal luna-service2.perm.json gives com.palm.*,
            # com.webos.* and com.lge.*.
            continue
        if templ or rest:
            # "luna://x/" + ... or `luna://x/${...}`: the method is built at run time.
            out.append((svc, None, m.start()))
            continue
        # Mojo's Service.Request, Enyo's PalmService and the shell's
        # call(service, method) join a base URI ("palm://x/category/") and
        # a method given beside it; a full URI has none beside it.
        base = path.strip("/")
        after = text[m.end():m.end() + 400]
        mm = QML_SECOND.match(after) or METHOD_AFTER.match(after)
        before = text[max(0, m.start() - 40):m.start()]
        if mm and (not base or path.endswith("/") or QML_SECOND.match(after) or "Request" in before
                   or re.search(r"\bservice\s*:\s*$", before)):
            method = (base + "/" if base else "") + mm.group(2).strip("/")
        elif path.endswith("/") and base:
            # A base URI ("palm://x/category/") with no method beside it:
            # the method is joined to it elsewhere, at run time.
            method = None
        else:
            method = base or None
        out.append((svc, method, m.start()))
    consts = {}
    for m in CONST.finditer(text):
        consts[m.group(1)] = m.group(3)
    for name, svc in consts.items():
        n = re.escape(name)
        for m in re.finditer(r"\$\{%s\}/?([A-Za-z0-9_./\-]+)`" % n, text):
            out.append((svc, m.group(1).strip("/"), m.start()))
        for m in re.finditer(r"""\b%s\s*\+\s*(["'])/?([A-Za-z0-9_./\-]+)\1""" % n, text):
            out.append((svc, m.group(2).strip("/"), m.start()))
        for m in re.finditer(r"""\b%s\s*,\s*(["'])/([A-Za-z0-9_./\-]+)\1""" % n, text):
            out.append((svc, m.group(2).strip("/"), m.start()))
    # Enyo's PalmService components given the service at run time from one
    # property of the kind (SERVICE: "palm://x/" ... this.$.call.setService(this.SERVICE))
    # and their methods beside it: setMethod("y"), or a component's own
    # method: "y" (one with a service of its own is a literal URI above).
    used = [name for name in consts if re.search(r"\.setService\(\s*this\.%s\s*\)" % re.escape(name), text)]
    if len(used) == 1:
        svc = consts[used[0]]
        for m in SET_METHOD.finditer(text):
            out.append((svc, m.group(2).strip("/"), m.start()))
        for m in PALM_COMPONENT.finditer(text):
            body = m.group(0)
            mm = re.search(r"""\bmethod\s*:\s*(["'])([A-Za-z0-9_./\-]+)\1""", body)
            if mm and not re.search(r"\bservice\s*:", body):
                out.append((svc, mm.group(2).strip("/"), m.start()))
    return out


# ---- Providers -------------------------------------------------------------------------

def load_ose():
    with open(os.path.join(HERE, "ose-services.json"), encoding="utf-8") as f:
        ose = json.load(f)
    extra_path = os.path.join(HERE, "ose-extra.json")
    if os.path.isfile(extra_path):
        with open(extra_path, encoding="utf-8") as f:
            extra = json.load(f)
        for name, entry in extra.get("services", {}).items():
            ose["services"].setdefault(name, {}).update(entry)
        for name in extra.get("notInImage", []):
            ose["services"].pop(name, None)
        for name, why in extra.get("pageServices", {}).items():
            ose["services"].setdefault(name, {"source": "in the page (phoenix-runtime.js): %s" % why})
    return ose


def sysbus_files(root):
    """The repository's sysbus directories that the image installs: each
    Node service's (install-rootfs.py), the native services' (their CMake
    installs them), Open webOS's app services' (OSE's bus files for them in
    compat/app-services: install-rootfs.py APP_SERVICES_SYSBUS) and the
    shell's; and Phoenix's own catalog connectors' (connector_dirs), whose
    sysbus files a device installs with the package."""
    dirs = []
    app_services = os.path.join(root, "compat", "app-services")
    if os.path.isdir(app_services):
        for name in sorted(os.listdir(app_services)):
            d = os.path.join(app_services, name, "sysbus")
            if os.path.isdir(d):
                dirs.append(d)
    for base in ("services", "apps"):
        b = os.path.join(root, base)
        if not os.path.isdir(b):
            continue
        for name in sorted(os.listdir(b)):
            for sub in ("sysbus", os.path.join("service", "sysbus")):
                d = os.path.join(b, name, sub)
                if os.path.isdir(d):
                    dirs.append(d)
    for c in connector_dirs(root):
        d = os.path.join(c, "service", "sysbus")
        if d not in dirs:
            dirs.append(d)
    d = os.path.join(root, "shell", "sysbus")
    if os.path.isdir(d):
        dirs.append(d)
    return dirs


def connector_dirs(root):
    """Phoenix's own connector packages under apps/connectors (Bluesky, the
    drives, Matrix and the rest), one folder deeper than applicationDirs.
    The catalog's Connections install them, and the Marketplace installs a
    package's service with its sysbus files (role, api, groups, perm), so
    their groups are defined on a device that has them, as Accounts' sign-in
    groups for their pages (phoenix.<name>.signin) expect."""
    base = os.path.join(root, "apps", "connectors")
    if not os.path.isdir(base):
        return []
    return [os.path.join(base, n) for n in sorted(os.listdir(base))
            if os.path.isdir(os.path.join(base, n, "service", "sysbus"))]


def load_phoenix(root):
    """{service: {"methods": {method: [groups]}, "outbound": [...], "dir": ...}},
    {client: set(groups)} from the repository's sysbus files."""
    services, perms = {}, {}
    for d in sysbus_files(root):
        for fn in sorted(os.listdir(d)):
            p = os.path.join(d, fn)
            try:
                data = read_json(p)
            except ValueError:
                continue
            if fn.endswith(".role.json"):
                for n in data.get("allowedNames", []):
                    e = services.setdefault(n, {"methods": {}, "outbound": [], "dir": rel(root, d)})
                    e["role"] = True
                    for perm in data.get("permissions", []):
                        if fnmatch.fnmatchcase(n, perm.get("service", "")):
                            e["outbound"] += perm.get("outbound", [])
            elif fn.endswith(".api.json"):
                for group, entries in data.items():
                    for entry in entries if isinstance(entries, list) else []:
                        svc, _, method = entry.partition("/")
                        e = services.setdefault(svc, {"methods": {}, "outbound": [], "dir": rel(root, d)})
                        e["methods"].setdefault(method, [])
                        if group not in e["methods"][method]:
                            e["methods"][method].append(group)
            elif fn.endswith(".perm.json"):
                for client, groups in data.items():
                    if isinstance(groups, list):
                        perms.setdefault(client, set()).update(groups)
    return services, perms


def runtime_aliases(root):
    path = os.path.join(root, "runtime", "phoenix-runtime.js")
    if not os.path.isfile(path):
        return {}
    m = re.search(r"var serviceAliases = \{(.*?)\};", read(path), re.S)
    return dict(re.findall(r'"([^"]+)"\s*:\s*"([^"]+)"', m.group(1))) if m else {}


def runtime_device_part(root):
    """The runtime's device half (installDevice): what runs in every page on
    a device. The rest is the simulator's service implementations."""
    path = os.path.join(root, "runtime", "phoenix-runtime.js")
    if not os.path.isfile(path):
        return ""
    text = read(path)
    i = text.find("function installDevice()")
    if i < 0:
        return ""
    j = text.find("\n    }\n", i)
    return text[i:j if j > 0 else len(text)]


# ---- Phoenix's shared client library ------------------------------------------------------

EXPORT = re.compile(r"^export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)", re.M)
IMPORT = re.compile(r"""import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']@phoenix/luna(?:/src/[\w-]+)?["']""")


def shared_luna_calls(root):
    """{exported name: [(service, method, where)]} for @phoenix/luna: the
    calls each exported object or function makes, so an app is charged
    with the calls of what it imports."""
    out = {}
    src = os.path.join(root, "apps", "shared", "luna", "src")
    if not os.path.isdir(src):
        return out
    for path in walk(root, rel(root, src), (".ts", ".tsx")):
        text = read(path)
        exports = [(m.start(), m.group(1)) for m in EXPORT.finditer(text)]
        if not exports:
            continue
        for svc, method, pos in calls_in(text):
            owner = None
            for start, name in exports:
                if start <= pos:
                    owner = name
            if owner:
                out.setdefault(owner, []).append((svc, method, "%s:%d" % (rel(root, path), line_of(text, pos))))
    return out


def imported_luna_names(files):
    names = set()
    for p in files:
        if not p.endswith((".ts", ".tsx", ".js", ".jsx")):
            continue
        for m in IMPORT.finditer(read(p)):
            for part in m.group(1).split(","):
                part = part.strip()
                if part.startswith("type "):
                    continue
                n = part.split(" as ")[0].strip()
                if n:
                    names.add(n)
    return names


# ---- Clients ---------------------------------------------------------------------------

class Client:
    def __init__(self, name, kind, files, groups=None, outbound=None, alias=False):
        self.name = name            # bus name (app id, service name)
        self.kind = kind            # app, service, shell, shared
        self.files = files
        self.groups = groups        # None: not checked (shared code)
        self.outbound = outbound    # None: not checked
        self.alias = alias          # the runtime's aliases apply (pages)
        self.declared = True


def app_dirs(root):
    cfg_path = os.path.join(root, "runtime", "rootfs.json")
    cfg = read_json(cfg_path) if os.path.isfile(cfg_path) else {"applicationDirs": ["apps"]}
    dirs = []
    for r in cfg.get("applicationDirs", []):
        base = os.path.join(root, r)
        if os.path.isdir(base):
            dirs += [os.path.join(base, n) for n in sorted(os.listdir(base)) if os.path.isdir(os.path.join(base, n))]
    dirs += [os.path.join(root, r) for r in cfg.get("systemApps", []) if os.path.isdir(os.path.join(root, r))]
    return dirs


def app_info(d):
    for p in (os.path.join(d, "appinfo.json"), os.path.join(d, "public", "appinfo.json")):
        if os.path.isfile(p):
            try:
                return read_json(p), p
            except ValueError:
                return None, p
    return None, None


def clients(root, phoenix_perms):
    out = []
    compat_perms = compat_permissions(root)
    shared_calls = shared_luna_calls(root)
    overlay_apps = os.path.join(root, "compat", "rootfs", "usr", "palm", "applications")
    for d in app_dirs(root):
        info, info_path = app_info(d)
        if not info:
            continue
        app_id = info.get("id") or os.path.basename(d)
        files = [f for f in walk(root, rel(root, d), SOURCE_EXTS,
                                 skip_dirs=SKIP_DIRS | {"service", "mock", "mocks"})
                 if not f.endswith(("appinfo.json", "package.json", "package-lock.json", "tsconfig.json"))]
        ov = os.path.join(overlay_apps, app_id)
        ov_info = os.path.join(ov, "appinfo.json")
        if os.path.isdir(ov):
            files += list(walk(root, rel(root, ov), SOURCE_EXTS))
        if os.path.isfile(ov_info):
            try:
                info = read_json(ov_info)
            except ValueError:
                pass
        c = Client(app_id, "app", files, alias=True)
        req = info.get("requiredPermissions")
        if req is None and app_id in compat_perms:
            req = compat_perms[app_id]
        c.declared = isinstance(req, list)
        c.groups = set(req or [])
        c.info_path = rel(root, info_path)
        c.via = [(svc, method, where, name) for name in sorted(imported_luna_names(files))
                 for svc, method, where in shared_calls.get(name, [])]
        out.append(c)
    # Shared code: the frameworks every old app loads, Phoenix's shared
    # packages, the runtime's device half. Providers only: who calls depends
    # on the app.
    fw = [os.path.join("third_party", n) for n in ("enyo-1.0", "enyo-2", "enyo-webos", "foundation-frameworks",
                                                  "loadable-frameworks", "mojoloader")]
    fw.append(os.path.join("compat", "rootfs", "usr", "palm", "frameworks"))
    files = []
    for r in fw:
        if os.path.exists(os.path.join(root, r)):
            files += list(walk(root, r, (".js", ".html")))
    out.append(Client("frameworks", "shared", files, alias=True))
    shared = os.path.join(root, "apps", "shared")
    for name in sorted(os.listdir(shared)) if os.path.isdir(shared) else []:
        src = os.path.join("apps", "shared", name, "src")
        if os.path.isdir(os.path.join(root, src)):
            out.append(Client("@phoenix/" + name, "shared", list(walk(root, src, SOURCE_EXTS)), alias=True))
    rt = runtime_device_part(root)
    if rt:
        c = Client("runtime (device part)", "shared", [], alias=True)
        c.text = rt
        out.append(c)
    # Phoenix's services, by the name their role file gives them.
    for d in sysbus_files(root):
        if os.path.basename(os.path.dirname(d)) == "shell":
            continue
        svc_dir = os.path.dirname(d)
        roles = [f for f in os.listdir(d) if f.endswith(".role.json")]
        if not roles:
            continue
        role = read_json(os.path.join(d, roles[0]))
        names = role.get("allowedNames", [])
        if not names:
            continue
        name = names[0]
        outbound = []
        for p in role.get("permissions", []):
            outbound += p.get("outbound", [])
        files = list(walk(root, rel(root, svc_dir), SOURCE_EXTS))
        files = [f for f in files if "/sysbus/" not in f and not f.endswith(("package.json", "package-lock.json"))]
        groups = set()
        for n in names:
            groups |= phoenix_perms.get(n, set())
        out.append(Client(name, "service", files, groups=groups, outbound=outbound))
    # The device shell: luna-surfacemanager running Phoenix's QML.
    files = []
    for r in (os.path.join("shell", "qml", "Phoenix", "Lsm"), os.path.join("shell", "qml", "Phoenix", "Shell"),
              os.path.join("shell", "native")):
        if os.path.isdir(os.path.join(root, r)):
            files += list(walk(root, r, (".qml", ".js", ".cpp", ".h")))
    out.append(Client("com.webos.surfacemanager", "shell", files, groups=set()))
    out += frame_clients(root, out, compat_perms)
    return out


ACCOUNTS = "com.palm.app.accounts"


def package_dirs(root):
    """The folders of the connector packages the image comes with
    (runtime/rootfs.json "preinstalled": installed apps, not in
    applicationDirs), whose account templates Accounts shows too."""
    cfg_path = os.path.join(root, "runtime", "rootfs.json")
    cfg = read_json(cfg_path) if os.path.isfile(cfg_path) else {}
    path = os.path.join(root, cfg.get("preinstalled") or "")
    if not cfg.get("preinstalled") or not os.path.isfile(path):
        return []
    data = read_json(path)
    out = []
    for e in data.get("packages") or []:
        d = os.path.join(root, e.get("from") or "")
        if e.get("from") and os.path.isdir(d) and d not in out:
            out.append(d)
    return out


def frame_clients(root, out, compat_perms):
    """The account templates' sign-in pages (validator.customUI {appId,
    name}), as Accounts: Accounts shows each in a frame of its own card
    (Enyo's CrossAppUI), and WebAppMgr's bridge gives the frame's calls
    Accounts' name, so the hub checks them against Accounts' groups, not the
    page's own app's (docs/DEVICE-AUDIT.md, "Accounts and their connectors
    on Revision 22"). The page's folder is charged (a wizard's scripts sit
    beside its page)."""
    accounts = [c for c in out if c.kind == "app" and c.name == ACCOUNTS]
    if accounts:
        groups = set(accounts[0].groups or ())
    elif ACCOUNTS in compat_perms:
        groups = set(compat_perms[ACCOUNTS])
    else:
        return []
    dirs = {}
    for d in app_dirs(root) + package_dirs(root):
        info, _ = app_info(d)
        if info:
            dirs[info.get("id") or os.path.basename(d)] = d
    pages = {}
    for app_id, d in sorted(dirs.items()):
        tdir = os.path.join(d, "public", "accounts")
        if not os.path.isdir(tdir):
            continue
        for t in sorted(os.listdir(tdir)):
            path = os.path.join(tdir, t, t + ".json")
            if not os.path.isfile(path):
                continue
            try:
                ui = (read_json(path).get("validator") or {}).get("customUI") or {}
            except (ValueError, AttributeError):
                continue
            if not isinstance(ui, dict) or ui.get("appId") not in dirs or not ui.get("name"):
                continue
            page_dir = os.path.dirname(os.path.join(dirs[ui["appId"]], str(ui["name"])))
            if os.path.isdir(page_dir):
                pages.setdefault(page_dir, ui["appId"])
    res = []
    for page_dir, app_id in sorted(pages.items()):
        files = list(walk(root, rel(root, page_dir), SOURCE_EXTS))
        c = Client(ACCOUNTS, "app", files, groups=set(groups), alias=True)
        c.info_path = "%s (the sign-in page of %s, in Accounts' frame)" % (rel(root, page_dir), app_id)
        c.frame = True
        res.append(c)
    return res


def method_groups(methods, method):
    """The groups for a method, from an api file's patterns; None if no
    pattern matches. Every group whose pattern matches may call it, the
    method's own and a wildcard's (com.palm.service.accounts/listAccounts is
    phoenix.accounts.list's and phoenix.appservices.accounts' "/*"), as
    luna-hub joins them."""
    found = None
    for pat, groups in methods.items():
        if pat == method or fnmatch.fnmatchcase(method, pat) or fnmatch.fnmatchcase("/" + method, pat):
            found = (found or []) + [g for g in groups if g not in (found or [])]
    return found


SUGGEST = {}   # app id -> the groups its calls need (--suggest)


def compat_permissions(root):
    """compat/app-permissions.json: the ACG groups the original apps (which
    predate ACG and declare none) get on the image, {app id: [groups]}."""
    path = os.path.join(root, "compat", "app-permissions.json")
    if not os.path.isfile(path):
        return {}
    data = read_json(path)
    return {k: v for k, v in data.items() if not k.startswith("//") and isinstance(v, list)}


def model(root):
    """The bus as the hub sees it, from the sysbus files: what check() checks
    the code against and bus_table() gives the simulator's runtime, so the
    two cannot disagree. {ose, ose_services, phoenix, phoenix_perms,
    aliases, all_groups, clients, everyone, provider}."""
    ose = load_ose()
    ose_services = ose["services"]
    phoenix, phoenix_perms = load_phoenix(root)
    aliases = runtime_aliases(root)
    all_groups = set()
    for e in ose_services.values():
        for gs in e.get("methods", {}).values():
            all_groups.update(gs)
    for e in phoenix.values():
        for gs in e["methods"].values():
            all_groups.update(gs)
    # Groups the bus itself knows (luna-service2's own and the legacy pair
    # the OSE app class writes for apps without requiredPermissions).
    all_groups.update({"public", "private", "all", "service.communication", "servicebus.communication",
                       "servicebus.signal", "service.monitor"})

    cl = clients(root, phoenix_perms)
    shell = [c for c in cl if c.kind == "shell"][0]
    for pat, entry in ose.get("clients", {}).items():
        if fnmatch.fnmatchcase(shell.name, pat) and pat != "*" and not pat.endswith(".*"):
            shell.groups.update(entry["groups"])
    shell.groups |= phoenix_perms.get(shell.name, set())
    # What luna-service2.perm.json gives every client ("*": service.communication,
    # servicebus.communication: signal/addmatch and the like), the hub's own.
    everyone = set(ose.get("clients", {}).get("*", {}).get("groups", []))
    for c in cl:
        if c.groups is not None and (c.kind != "app" or c.declared):
            c.groups |= everyone

    def provider(name):
        if name in phoenix:
            return "phoenix", phoenix[name]
        if name in ose_services:
            return "ose", ose_services[name]
        return None, None

    return {"ose": ose, "ose_services": ose_services, "phoenix": phoenix, "phoenix_perms": phoenix_perms,
            "aliases": aliases, "all_groups": all_groups, "clients": cl, "shell": shell,
            "everyone": everyone, "provider": provider}


def check(root):
    SUGGEST.clear()
    f = Findings(CHECKER)
    m = model(root)
    ose_services, phoenix, phoenix_perms = m["ose_services"], m["phoenix"], m["phoenix_perms"]
    aliases, all_groups, cl, shell, provider = m["aliases"], m["all_groups"], m["clients"], m["shell"], m["provider"]

    for c in cl:
        needs = {}
        calls = []
        texts = [(getattr(c, "text", None), "runtime/phoenix-runtime.js")] if getattr(c, "text", None) else []
        texts += [(None, p) for p in c.files]
        for text, path in texts:
            if text is None:
                text = read(path)
                where_file = rel(root, path)
            else:
                where_file = path
            if "luna://" not in text and "palm://" not in text:
                continue
            for svc, method, pos in calls_in(text):
                calls.append((svc, method, "%s:%d" % (where_file, line_of(text, pos))))
        # What the app imports from @phoenix/luna calls on its behalf.
        for svc, method, where, via in getattr(c, "via", []):
            calls.append((svc, method, "%s (%s)" % (where, via)))
        for svc, method, where in calls:
                name = aliases.get(svc, svc) if c.alias else svc
                shown = svc + ("/" + method if method else "")
                as_ = " (as %s)" % name if name != svc else ""
                kind, prov = provider(name)
                if not kind:
                    f.add("unknown-service", name,
                          "%s: no provider on the image for %s%s (not an OSE service, no Phoenix sysbus files)"
                          % (c.name, name, as_), where)
                    continue
                if c.outbound is not None and name != c.name and not any(
                        fnmatch.fnmatchcase(name, o) for o in c.outbound):
                    f.add("outbound", "%s->%s" % (c.name, name),
                          "%s calls %s, which its role file's outbound list does not allow" % (c.name, name), where)
                if not method:
                    continue
                methods = prov.get("methods")
                if not methods:
                    continue
                groups = method_groups(methods, method)
                if groups is None:
                    f.add("unknown-method", "%s/%s" % (name, method),
                          "%s/%s%s is not in the provider's api-permissions file (%s)"
                          % (name, method, " (called as %s)" % shown if as_ else "",
                             prov.get("dir") or prov.get("source")), where)
                    continue
                if c.groups is None:
                    continue
                if c.kind == "app":
                    held = [g for g in groups if g in c.groups]
                    SUGGEST.setdefault(c.name, set()).add(held[0] if held else sorted(groups)[0])
                if c.kind == "app" and not c.declared:
                    needs.setdefault(tuple(sorted(groups)), []).append((name, method, where))
                    continue
                if not set(groups) & c.groups:
                    f.add("missing-permission", "%s->%s/%s" % (c.name, name, method),
                          "%s%s calls %s/%s, which needs one of the groups %s; it has %s"
                          % (c.name, " (%s)" % c.info_path if getattr(c, "frame", False) else "",
                             name, method, ", ".join(sorted(groups)),
                             ", ".join(sorted(c.groups)) or "none"), where)
        if needs:
            minimal = sorted({"|".join(gs) for gs in needs})
            first = sorted(needs.items())[0][1][0]
            f.add("no-permissions", c.name,
                  "%s declares no requiredPermissions (%s) but calls %d ACG-guarded methods; it needs at least: %s"
                  % (c.name, getattr(c, "info_path", "appinfo.json"), sum(len(v) for v in needs.values()),
                     ", ".join(minimal)), first[2])
        if c.groups is not None and c.kind != "shell" and not getattr(c, "frame", False):
            for g in sorted(c.groups - all_groups):
                f.add("unknown-group", "%s:%s" % (c.name, g),
                      "%s holds the group %s, which no provider's api file defines" % (c.name, g),
                      getattr(c, "info_path", None))
    # Only the groups Phoenix's own files give the shell: luna-surfacemanager's
    # name services an OSE image may not have (account.query).
    for g in sorted(phoenix_perms.get(shell.name, set()) - all_groups):
        f.add("unknown-group", "%s:%s" % (shell.name, g),
              "the shell's permissions name the group %s, which no provider's api file defines" % g,
              "shell/sysbus")
    return f


# ---- The simulator's table ------------------------------------------------------------

def bus_table(root):
    """What the simulator's runtime checks each call against, as ls-hubd
    does on a device (runtime/phoenix-runtime.js, "Bus permissions";
    docs/SIM-PARITY.md): the model check() checks the code against, as
    data. tools/gen-bus-permissions.py writes it.

      services  {name: {"methods": {method or pattern: [groups]}}}: each
                provider's api files (Phoenix's sysbus files win over OSE's,
                as provider() has it); a service without api files is not
                listed (its calls are not checked)
      apps      {id: {"groups": [...]}}: each app's groups (requiredPermissions,
                or compat/app-permissions.json)
      clients   {bus name: {"groups": [...], "outbound": [...]}}: each Phoenix
                service's (its perm files, every name its role allows) with
                its role's outbound list, and the shell's
                (every one of both with what luna-service2.perm.json gives
                everyone)
      everyone  the groups of a client the table does not list (an app
                installed later adds its appinfo's requiredPermissions)
      aliases   the runtime's serviceAliases (the hub sees the new name)
      allow     sim-bus-allowlist.json: refusals the simulator lets through
                for now, {id pattern: why}; ids "missing-permission:<caller>->
                <service>/<method>", "unknown-method:<service>/<method>",
                "outbound:<caller>-><service>"
    """
    m = model(root)
    everyone = sorted(m["everyone"])
    services = {}
    for name in sorted(set(m["ose_services"]) | set(m["phoenix"])):
        _, prov = m["provider"](name)
        methods = (prov or {}).get("methods")
        if methods:
            services[name] = {"methods": {k: sorted(v) for k, v in sorted(methods.items())}}
    # Apps and services apart: on a device an app's pages are on the bus as
    # "<id>-<n>" (its client-permissions key "<id>-*", install-rootfs.py
    # security_files), a service under its own name, and the two may share
    # an id (the Clipboard app and org.webosphoenix.clipboard).
    apps, clients = {}, {}
    for c in m["clients"]:
        if c.groups is None or getattr(c, "frame", False):
            continue
        if c.kind == "app":
            apps[c.name] = {"groups": sorted(set(apps.get(c.name, {}).get("groups", [])) | c.groups | m["everyone"])}
            continue
        e = clients.setdefault(c.name, {"groups": []})
        e["groups"] = sorted(set(e["groups"]) | c.groups | m["everyone"])
        if c.outbound is not None:
            e["outbound"] = sorted(set(e.get("outbound", [])) | set(c.outbound))
    # A service may take several names (its role's allowedNames): each
    # calls with the groups the perm files give it, and the role's
    # outbound list.
    for name, entry in sorted(m["phoenix"].items()):
        if name in clients or "*" in name or not entry.get("role"):
            continue
        groups = m["phoenix_perms"].get(name, set())
        clients[name] = {"groups": sorted(groups | m["everyone"]), "outbound": sorted(set(entry["outbound"]))}
    allow = {}
    path = os.path.join(HERE, "sim-bus-allowlist.json")
    if os.path.isfile(path):
        allow = {k: v for k, v in read_json(path).items() if not k.startswith("//")}
    return {
        "//": ["Generated by tools/gen-bus-permissions.py from tools/devicecheck/luna.py's model (the sysbus "
               "files, ose-services.json, the apps' requiredPermissions and compat/app-permissions.json). "
               "Do not edit; regenerate it. The simulator's runtime checks each call against it "
               "(runtime/phoenix-runtime.js, \"Bus permissions\")."],
        "everyone": everyone,
        "aliases": dict(sorted(m["aliases"].items())),
        "services": services,
        "apps": dict(sorted(apps.items())),
        "clients": dict(sorted(clients.items())),
        "allow": dict(sorted(allow.items())),
    }


def main(argv=None):
    ap = parser(__doc__.splitlines()[0])
    ap.add_argument("--suggest", action="store_true",
                    help="print, for each app, the ACG groups its calls need (for requiredPermissions)")
    args = ap.parse_args(argv)
    findings = check(os.path.abspath(args.root))
    if args.suggest:
        print(json.dumps({k: sorted(v) for k, v in sorted(SUGGEST.items())}, indent=1))
        return 0
    return finish(CHECKER, findings, args)
