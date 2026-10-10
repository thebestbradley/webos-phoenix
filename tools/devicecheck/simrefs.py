# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Simulator-only references reached from code that also runs on a device.

  loopback       127.0.0.1, localhost or 0.0.0.0 in device code: on a device
                 that is the device itself, where the simulator's helper
                 servers (the Marketplace catalog, DropShare, the sample
                 driver catalog) do not run
  phoenix-scheme phoenix:// URLs: phoenix-sim's scheme for the virtual
                 filesystem; a device serves file:// paths
  sim-service    a Luna service only the simulator has
                 (org.webosphoenix.simulator)
  sim-property   one of phoenix-sim's QML context properties (simSettings,
                 simRootfs, ... read from shell/sim/main.cpp) used by the
                 device shell's QML (Phoenix/Shell, Phoenix/Lsm)
  insecure-url   a plain http:// server on the internet in that configuration
  host           a hard-coded server in the device's update, catalog, driver
                 and feed configuration and services: the platform's hosts
                 must be configuration (/etc/palm/*.json), not code, and
                 never a placeholder (example.com, *.test, localhost)
"""

import os
import re

from . import Findings, finish, parser, read, walk, line_of, rel
from .luna import strip_comment_lines, runtime_device_part

CHECKER = "simrefs"
CODE = (".js", ".mjs", ".cjs", ".ts", ".tsx", ".qml", ".cpp", ".h", ".c", ".json", ".html")
LOOPBACK = re.compile(r"""\b(127\.0\.0\.1|localhost|0\.0\.0\.0)\b""")
SCHEME = re.compile(r"""["'`]phoenix://""")
SIM_SERVICES = ("org.webosphoenix.simulator",)
URL = re.compile(r"""https?://([A-Za-z0-9.\-]+\.[A-Za-z]{2,}|localhost|127\.0\.0\.1)(?::\d+)?""")
PLACEHOLDER = re.compile(r"(^|\.)(example\.(com|org|net)|test|invalid|local|localhost)$|^127\.0\.0\.1$")
# Where the platform's servers are named: the configuration and the
# services that read it.
HOST_PLACES = [os.path.join("services", "updates"), os.path.join("services", "hardware"),
               os.path.join("apps", "marketplace", "service"), os.path.join("apps", "settings", "service"),
               os.path.join("compat", "rootfs", "etc")]


def device_files(root):
    """Code that runs on a device: the device shell, Phoenix's services, the
    apps (their sources and overlays) and the shared packages."""
    rels = [os.path.join("shell", "qml", "Phoenix", "Shell"), os.path.join("shell", "qml", "Phoenix", "Lsm"),
            os.path.join("shell", "qml", "WebOSCompositor"), os.path.join("shell", "native"), "services",
            os.path.join("compat", "rootfs")]
    apps = os.path.join(root, "apps")
    for n in sorted(os.listdir(apps)) if os.path.isdir(apps) else []:
        # An app whose folder is the app (Enyo and Mojo apps, appinfo.json at the top).
        if os.path.isfile(os.path.join(apps, n, "appinfo.json")):
            rels.append(os.path.join("apps", n))
            continue
        for sub in ("service", "src", "public"):
            if os.path.isdir(os.path.join(apps, n, sub)):
                rels.append(os.path.join("apps", n, sub))
        if n == "shared":
            for s in sorted(os.listdir(os.path.join(apps, n))):
                if os.path.isdir(os.path.join(apps, n, s, "src")):
                    rels.append(os.path.join("apps", n, s, "src"))
    for r in rels:
        if os.path.isdir(os.path.join(root, r)):
            for p in walk(root, r, CODE):
                yield p


def sim_properties(root):
    path = os.path.join(root, "shell", "sim", "main.cpp")
    if not os.path.isfile(path):
        return set()
    return set(re.findall(r"""setContextProperty\(\s*(?:QStringLiteral\()?"([A-Za-z_]\w*)\"""", read(path)))


def check(root):
    f = Findings(CHECKER)
    props = sim_properties(root)
    prop_re = re.compile(r"\b(%s)\b" % "|".join(sorted(props))) if props else None
    files = [(p, None) for p in device_files(root)]
    rt = runtime_device_part(root)
    if rt:
        files.append(("runtime/phoenix-runtime.js", rt))
    for p, text in files:
        if text is None:
            text = read(p)
            where_file = rel(root, p)
        else:
            where_file = p
        clean = strip_comment_lines(text)
        is_qml_shell = where_file.startswith(os.path.join("shell", "qml"))
        for m in LOOPBACK.finditer(clean):
            # A line that only compares against loopback (a guard) is fine.
            line = clean[clean.rfind("\n", 0, m.start()) + 1:clean.find("\n", m.end())]
            if re.search(r"(===?|!==?|startsWith|includes|indexOf|test\()\s*\(?\s*['\"]" + re.escape(m.group(1)), line) \
                    or re.search(re.escape(m.group(1)) + r"['\"]\s*\)?\s*(===?|!==?)", line) \
                    or re.search(r"/\^?\(?[^/]*" + re.escape(m.group(1)) + r"[^/]*/\.test\(", line):
                continue
            f.add("loopback", "%s:%s" % (where_file.split(os.sep)[0] + "/" + where_file.split(os.sep)[1]
                                         if os.sep in where_file else where_file, m.group(1)),
                  "%s names %s: on a device that is the device itself" % (where_file, m.group(1)),
                  "%s:%d" % (where_file, line_of(clean, m.start())))
        for m in SCHEME.finditer(clean):
            f.add("phoenix-scheme", where_file, "%s uses phoenix:// URLs, the simulator's scheme" % where_file,
                  "%s:%d" % (where_file, line_of(clean, m.start())))
        for s in SIM_SERVICES:
            for m in re.finditer(re.escape(s), clean):
                f.add("sim-service", s, "%s is only in the simulator" % s,
                      "%s:%d" % (where_file, line_of(clean, m.start())))
        if is_qml_shell and prop_re:
            for m in prop_re.finditer(clean):
                f.add("sim-property", m.group(1), "the device shell's QML uses phoenix-sim's context property %s"
                      % m.group(1), "%s:%d" % (where_file, line_of(clean, m.start())))
        if any(where_file.startswith(h) for h in HOST_PLACES):
            for m in URL.finditer(clean):
                host = m.group(1).lower()
                if m.group(0).startswith("http://") and not PLACEHOLDER.search(host):
                    f.add("insecure-url", host, "%s fetches from http://%s: plain HTTP to a server on the "
                          "internet (anyone on the path can change what the device gets)" % (where_file, host),
                          "%s:%d" % (where_file, line_of(clean, m.start())))
                if PLACEHOLDER.search(host):
                    f.add("host", host, "%s names the placeholder host %s where the platform's server belongs"
                          % (where_file, host), "%s:%d" % (where_file, line_of(clean, m.start())))
                elif not where_file.endswith(".json"):
                    f.add("host", host, "%s hard-codes the server %s; it belongs in /etc/palm configuration"
                          % (where_file, host), "%s:%d" % (where_file, line_of(clean, m.start())))
    return f


def main(argv=None):
    ap = parser(__doc__.splitlines()[0])
    args = ap.parse_args(argv)
    return finish(CHECKER, check(os.path.abspath(args.root)), args)
