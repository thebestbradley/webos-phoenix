# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""The device-readiness checkers' shared parts (tools/check-*.py).

Each checker looks at the tree for one kind of problem a device image
would have that the simulator hides, and reports findings. A finding has
an id, "<checker>:<kind>:<key>", which the allowlist
(tools/check-device-allowlist.json) can name with the owner who will fix
it and the row of docs/PRE-IMAGE-CHECKLIST.md that tracks it. A finding
that is not in the allowlist fails the checker (exit 1), so a new gap
fails CI; an allowlist entry that no longer matches anything is reported
as stale (and fails with --strict), so a fixed gap leaves the list.

Every checker takes --root (the tree to check: the repository, or a
fixture under tools/fixtures/devicecheck), --allowlist, --json (the
findings as JSON) and --all (also print allowlisted findings).
"""

import argparse
import fnmatch
import importlib.util
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
ALLOWLIST = os.path.join(REPO, "tools", "check-device-allowlist.json")


class Finding:
    def __init__(self, checker, kind, key, message, where=None):
        self.checker = checker
        self.kind = kind
        self.key = key
        self.message = message
        self.where = list(where or [])

    @property
    def id(self):
        return "%s:%s:%s" % (self.checker, self.kind, self.key)

    def as_json(self):
        return {"id": self.id, "kind": self.kind, "key": self.key, "message": self.message, "where": self.where}


class Findings:
    """Findings by id: the same problem found in several places is one finding."""

    def __init__(self, checker):
        self.checker = checker
        self.items = {}

    def add(self, kind, key, message, where=None):
        f = Finding(self.checker, kind, key, message)
        f = self.items.setdefault(f.id, f)
        if where and where not in f.where:
            f.where.append(where)
        return f

    def __iter__(self):
        return iter(sorted(self.items.values(), key=lambda f: f.id))

    def __len__(self):
        return len(self.items)


def load_allowlist(path, checker):
    """{pattern: entry} for this checker. Keys are finding ids, with fnmatch
    wildcards (* ? [..]); each entry names "owner" and "row"."""
    if not path or not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    out = {}
    for key, entry in data.items():
        if key.startswith("//"):
            continue
        if not key.startswith(checker + ":"):
            continue
        if not isinstance(entry, dict) or not entry.get("owner") or not entry.get("row"):
            sys.exit("%s: %s: each entry needs an owner and a checklist row" % (path, key))
        out[key] = entry
    return out


def match_allowlist(fid, allow):
    for pat, entry in allow.items():
        if fid == pat or fnmatch.fnmatchcase(fid, pat):
            return pat, entry
    return None, None


def parser(description):
    ap = argparse.ArgumentParser(description=description)
    ap.add_argument("--root", default=REPO, help="the tree to check (default: this repository)")
    ap.add_argument("--allowlist", default=None,
                    help="known findings (default: tools/check-device-allowlist.json; 'none' for none)")
    ap.add_argument("--json", action="store_true", help="print the findings as JSON")
    ap.add_argument("--all", action="store_true", help="also list the allowlisted findings")
    ap.add_argument("--strict", action="store_true", help="fail on stale allowlist entries too")
    return ap


def finish(checker, findings, args, notes=()):
    """Print the findings, return the exit status."""
    root = os.path.abspath(args.root)
    path = args.allowlist
    if path is None:
        path = ALLOWLIST if root == REPO else os.path.join(root, "check-device-allowlist.json")
    allow = {} if path == "none" else load_allowlist(path, checker)
    new, known, used = [], [], set()
    for f in findings:
        pat, entry = match_allowlist(f.id, allow)
        if pat:
            used.add(pat)
            known.append((f, entry))
        else:
            new.append(f)
    stale = sorted(set(allow) - used)
    if args.json:
        print(json.dumps({
            "checker": checker,
            "new": [f.as_json() for f in new],
            "allowlisted": [dict(f.as_json(), owner=e.get("owner"), row=e.get("row")) for f, e in known],
            "stale": stale,
            "notes": list(notes),
        }, indent=1))
    else:
        for n in notes:
            print("note: %s" % n)
        for f in new:
            print("NEW  %s\n     %s" % (f.id, f.message))
            for w in f.where[:5]:
                print("       at %s" % w)
            if len(f.where) > 5:
                print("       ... and %d more" % (len(f.where) - 5))
        if args.all:
            for f, e in known:
                print("known %s  [%s; %s]\n     %s" % (f.id, e.get("owner"), e.get("row"), f.message))
                for w in f.where[:3]:
                    print("       at %s" % w)
        for s in stale:
            print("stale allowlist entry (nothing matches it any more; remove it): %s" % s)
        print("%s: %d findings: %d new, %d allowlisted%s" % (
            checker, len(new) + len(known), len(new), len(known),
            ", %d stale allowlist entries" % len(stale) if stale else ""))
    return 1 if new or (stale and args.strict) else 0


# ---- Reading the tree -------------------------------------------------------------

SKIP_DIRS = {".git", "node_modules", "dist", "build", "coverage", "__pycache__", "tests", "test", "spec",
             "specs", "fixtures", "__tests__", "__mocks__", ".dart_tool", "examples"}


def is_test_file(name):
    return bool(re.search(r"(\.test\.|\.spec\.|_test\.|^test-|^tst_)", name))


def walk(root, rel, exts, skip_dirs=SKIP_DIRS):
    """Files under root/rel with one of exts, without tests, builds and modules."""
    base = os.path.join(root, rel)
    if os.path.isfile(base):
        yield base
        return
    for d, dirs, files in os.walk(base):
        dirs[:] = sorted(x for x in dirs if x not in skip_dirs and not x.startswith("."))
        for fn in sorted(files):
            if fn.endswith(exts) and not is_test_file(fn):
                yield os.path.join(d, fn)


def read(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def read_json(path):
    """JSON that may carry //-comments (appinfo.json files of the time do)."""
    text = read(path)
    try:
        return json.loads(text)
    except ValueError:
        text = re.sub(r'^\s*//.*$', "", text, flags=re.M)
        text = re.sub(r",(\s*[}\]])", r"\1", text)
        return json.loads(text)


def line_of(text, pos):
    return text.count("\n", 0, pos) + 1


def rel(root, path):
    return os.path.relpath(path, root)


def load_tool(root, name):
    """A tools/ script as a module (install-rootfs.py), from the tree checked."""
    path = os.path.join(root, "tools", name)
    if not os.path.isfile(path):
        path = os.path.join(REPO, "tools", name)
    spec = importlib.util.spec_from_file_location(name.replace("-", "_").replace(".py", ""), path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def install_plan(root):
    """What tools/install-rootfs.py puts on the image, {device path: source},
    and what it could not install (apps or packages not built)."""
    mod = load_tool(root, "install-rootfs.py")
    return mod.plan(repo=root, strict=False)


# ---- BitBake recipes (a reader, not a parser: enough for the checks) -----------------

def recipe_vars(path):
    """{name: value} of a recipe's plain assignments (=, ?=, ??=, +=, .=,
    :append, :prepend, joined), and its functions {name: body}."""
    text = read(path)
    text = re.sub(r"\\\n", " ", text)
    vars_, funcs = {}, {}
    for m in re.finditer(r'^([A-Za-z0-9_${}:.\-/@]+?)\s*(\?\?=|\?=|\+=|\.=|=\+|=)\s*"(.*?)"\s*$', text, re.M):
        name, op, value = m.group(1), m.group(2), m.group(3)
        if op in ("+=", ".=", "=+") or name.endswith((":append", ":prepend")) or ":append:" in name:
            base = re.sub(r":(append|prepend)(:.*)?$", "", name)
            vars_[base] = (vars_.get(base, "") + " " + value).strip()
        elif op == "=" or name not in vars_:
            vars_[name] = value
    for m in re.finditer(r'^(?:fakeroot\s+)?(?:python\s+)?([A-Za-z0-9_:\-${}]+)\s*\(\)\s*\{\n(.*?)^\}', text, re.M | re.S):
        funcs[m.group(1)] = funcs.get(m.group(1), "") + m.group(2)
    inherits = []
    for m in re.finditer(r"^inherit\s+(.+)$", text, re.M):
        inherits += m.group(1).split()
    return vars_, funcs, inherits, text


def recipe_files(root):
    out = []
    base = os.path.join(root, "meta-phoenix")
    for d, dirs, files in os.walk(base):
        dirs[:] = sorted(dirs)
        for fn in sorted(files):
            if fn.endswith((".bb", ".bbappend")):
                out.append(os.path.join(d, fn))
    return out
