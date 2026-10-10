#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Write tools/devicecheck/ose-services.json: the Luna services webOS OSE
provides, with each one's methods and the ACG groups that may call them,
read from the OSE sources' own sysbus files (role, api-permissions and
client-permissions files, as webos_system_bus.bbclass installs them).

    tools/devicecheck/gen_ose_services.py SRC_DIR [SRC_DIR...]

Each SRC_DIR is a checkout of one OSE component (github.com/webosose/<name>,
at the commit meta-webosose's recipe pins, or near it) or a directory of
such checkouts. Only the sysbus files are read, so a sparse checkout is
enough:

    git clone --depth 1 --filter=blob:none --no-checkout https://github.com/webosose/db8
    git -C db8 sparse-checkout set --no-cone '*.api.json*' '*.role.json*' '*.perm.json*' '*.groups.json*'
    git -C db8 checkout

Whether an image installs a component is not read from meta-webosose's
packagegroups (many come in through VIRTUAL-RUNTIME settings);
ose-extra.json lists the ones known to be left out.

The list is checked in; tools/check-luna.py reads it in CI, where the OSE
sources are not. Regenerate it when setup-build.sh's build-webos pin moves.
"""

import argparse
import glob
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "ose-services.json")

# Sysbus files of tests, examples and mock services are not on an image.
SKIP_PARTS = ("/test/", "/tests/", "/examples/", "/mock", "sysbus_mockplugin", "/unittest", ".test.",
              "_test.", "apitest", "test.role", "/desktop-support/", "/sysbus_new/")


def read_json(path):
    """A sysbus file: JSON with //-comments, CMake @VARS@ and, in qmake-built
    components (ime-manager), escaped quotes."""
    text = open(path, encoding="utf-8", errors="replace").read()
    if '\\"' in text and text.lstrip().startswith("{\n    \\\""):
        text = text.replace('\\"', '"')
    text = re.sub(r"\$\$[A-Z_]+", "x", text)
    text = re.sub(r"@[A-Za-z_]+@", "x", text)
    text = re.sub(r'//[^"\n]*$', "", text, flags=re.M)
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    return json.loads(text)


def git_head(path):
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=path, capture_output=True,
                              text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def component_roots(srcs):
    roots = []
    for s in srcs:
        s = os.path.abspath(s)
        if os.path.isdir(os.path.join(s, ".git")) or glob.glob(os.path.join(s, "files")):
            roots.append(s)
        else:
            roots += sorted(os.path.join(s, d) for d in os.listdir(s)
                            if os.path.isdir(os.path.join(s, d)) and not d.startswith("."))
    return roots



def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("src", nargs="+")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    services = {}
    clients = {}
    for root in component_roots(args.src):
        comp = os.path.basename(root)
        head = git_head(root)
        where = "webosose/%s%s" % (comp, "@" + head if head else "")
        files = [f for f in glob.glob(os.path.join(root, "**", "*.json*"), recursive=True)
                 if "/.git/" not in f and not any(p in f.replace(root, "") for p in SKIP_PARTS)]
        roles = [f for f in files if re.search(r"\.role\.json(\.in)?$", f)]
        apis = [f for f in files if re.search(r"\.api\.json(\.in)?$", f)]
        perms = [f for f in files if re.search(r"\.perm\.json(\.in)?$", f)]
        if not roles and not apis:
            continue
        names = {}
        for f in roles:
            try:
                d = read_json(f)
            except ValueError as e:
                print("%s: %s" % (f, e), file=sys.stderr)
                continue
            for n in d.get("allowedNames", []) or []:
                # Patterns (clients' per-process names) and clients are not services.
                if not n or "*" in n or n.endswith(".") or "client" in n or "." not in n:
                    continue
                names[n] = os.path.relpath(f, root)
        methods = {}
        for f in apis:
            try:
                d = read_json(f)
            except ValueError as e:
                print("%s: %s" % (f, e), file=sys.stderr)
                continue
            for group, entries in d.items():
                if not isinstance(entries, list):
                    continue
                for e in entries:
                    if "/" not in e:
                        continue
                    svc, method = e.split("/", 1)
                    if "*" in svc or "." not in svc or svc.endswith("."):
                        continue
                    methods.setdefault(svc, {}).setdefault(method, [])
                    if group not in methods[svc][method]:
                        methods[svc][method].append(group)
        for f in perms:
            try:
                d = read_json(f)
            except ValueError:
                continue
            for client, groups in d.items():
                if isinstance(groups, list):
                    clients.setdefault(client, {"groups": [], "source": []})
                    clients[client]["groups"] = sorted(set(clients[client]["groups"]) | set(groups))
                    clients[client]["source"].append("%s %s" % (where, os.path.relpath(f, root)))
        for n in sorted(set(names) | set(methods)):
            entry = services.setdefault(n, {"component": comp, "source": where, "files": []})
            if n in names:
                entry["files"].append(names[n])
            if n in methods:
                entry.setdefault("methods", {}).update(methods[n])
    out = {
        "//": ["Generated by tools/devicecheck/gen_ose_services.py from webOS OSE's sources: the Luna "
               "services an OSE image provides, each with its methods (from its api-permissions file) "
               "and the ACG groups that may call each one. Do not edit; add what the sources lack to "
               "ose-extra.json."],
        "services": dict(sorted(services.items())),
        "clients": dict(sorted(clients.items())),
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, sort_keys=False)
        f.write("\n")
    print("%d services, %d clients -> %s" % (len(services), len(clients), args.out), file=sys.stderr)


if __name__ == "__main__":
    main()
