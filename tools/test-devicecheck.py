#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for the device-readiness checkers (tools/check-*.py, tools/devicecheck).

Each checker runs over tools/fixtures/devicecheck/bad, a tiny tree with one
of each problem, and must report every finding in its expected.json (and
nothing it does not list); install-rootfs.py's generated ACG files and the
Luna URI parser are checked directly. Then every checker runs over this
repository with its allowlist and must pass, as CI runs them.

    python3 tools/test-devicecheck.py [--print]
"""

import json
import os
import subprocess
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(TOOLS)
FIXTURE = os.path.join(TOOLS, "fixtures", "devicecheck", "bad")
CHECKERS = ("luna", "simrefs", "image", "recipes", "licences")
sys.path.insert(0, TOOLS)

failures = []


def ok(cond, what):
    print("%s  %s" % ("ok  " if cond else "FAIL", what))
    if not cond:
        failures.append(what)


def run(checker, root, *extra):
    p = subprocess.run([sys.executable, os.path.join(TOOLS, "check-%s.py" % checker), "--root", root, "--json"]
                       + list(extra), capture_output=True, text=True)
    if p.returncode not in (0, 1):
        print(p.stdout + p.stderr)
    return p.returncode, (json.loads(p.stdout) if p.stdout.strip().startswith("{") else None)


def main():
    show = "--print" in sys.argv
    with open(os.path.join(FIXTURE, "expected.json"), encoding="utf-8") as f:
        expected = json.load(f)
    for c in CHECKERS:
        status, out = run(c, FIXTURE, "--allowlist", "none")
        ok(out is not None, "%s runs over the fixture" % c)
        if out is None:
            continue
        got = sorted(f["id"] for f in out["new"])
        if show:
            print(json.dumps(got, indent=1))
        want = sorted(expected.get(c, []))
        for fid in want:
            ok(fid in got, "%s finds %s" % (c, fid))
        for fid in got:
            ok(fid in want, "%s finds nothing unexpected (%s)" % (c, fid))
        ok(status == (1 if want else 0), "%s exits %d" % (c, 1 if want else 0))

    # The allowlist: a listed finding passes, an unused entry is stale.
    allow = os.path.join(os.environ.get("TMPDIR", "/tmp"), "devicecheck-allow-%d.json" % os.getpid())
    with open(allow, "w") as f:
        json.dump({"recipes:license:thing_1.0.bb": {"owner": "test", "row": "T1"},
                   "recipes:*:no-such-thing": {"owner": "test", "row": "T2"}}, f)
    try:
        status, out = run("recipes", FIXTURE, "--allowlist", allow)
        ok("recipes:license:thing_1.0.bb" in [f["id"] for f in out["allowlisted"]], "an allowlisted finding is known")
        ok(out["stale"] == ["recipes:*:no-such-thing"], "an unused allowlist entry is stale")
    finally:
        os.remove(allow)

    # Luna URIs: the forms the apps, frameworks and shell use.
    from devicecheck.luna import calls_in
    text = '''
        call("luna://a.b/c/d", {});
        new Mojo.Service.Request("palm://a.b/cat/", { method: "m" });
        x = { kind: "PalmService", service: "palm://a.b/", method: "n" };
        lunaBus.call("luna://a.b", "/q/r", "{}");
        const SVC = "luna://a.c";
        call(`${SVC}/t`, {});
        call(SVC + "/u", {});
        call("luna://a.d/" + name, {});
        LSSignalSend(m_h.power, "luna://a.e/cat/changed", json.c_str(), &err);
        signal("luna://a.e/cat/changedToo", json());
        kAlarmSchedulerUri: "luna://a.f/timeout/",
    '''
    got = sorted((s, m or "") for s, m, _ in calls_in(text))
    ok(got == sorted([("a.b", "c/d"), ("a.b", "cat/m"), ("a.b", "n"), ("a.b", "q/r"), ("a.c", ""),
                      ("a.c", "t"), ("a.c", "u"), ("a.d", ""), ("a.f", "")]),
       "Luna URIs are read in every form (signals sent are not calls; a bare base URI has no method): %s" % got)

    # A luna-service2 .service file may name several services, ';'-separated.
    import tempfile
    with tempfile.TemporaryDirectory() as tree:
        sysbus = os.path.join(tree, "services", "multi", "sysbus")
        os.makedirs(sysbus)
        with open(os.path.join(sysbus, "org.example.multi.service"), "w") as f:
            f.write("[D-BUS Service]\nName=org.example.one;org.example.two\nExec=/usr/sbin/multi\nType=dynamic\n")
        with open(os.path.join(sysbus, "org.example.multi.role.json"), "w") as f:
            json.dump({"allowedNames": ["org.example.one", "org.example.two"], "permissions": []}, f)
        status, out = run("recipes", tree, "--allowlist", "none")
        ok(out is not None and not [x for x in out["new"] if x["id"].startswith("recipes:service-file")],
           "a .service file naming several services its role file allows passes")

    # A download is pinned by a sha256sum, or by a stronger sum BitBake also
    # checks (sha384sum, sha512sum); with none it is not.
    with tempfile.TemporaryDirectory() as tree:
        rdir = os.path.join(tree, "meta-phoenix", "recipes-kernel", "linux")
        os.makedirs(rdir)
        lic = 'LICENSE = "MIT"\nLIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"\n'
        with open(os.path.join(rdir, "strong_1.0.bb"), "w") as f:
            f.write(lic + 'SRC_URI = "https://example.org/k.tar.gz;name=kernel"\nSRC_URI[kernel.sha512sum] = "00"\n')
        with open(os.path.join(rdir, "bare_1.0.bb"), "w") as f:
            f.write(lic + 'SRC_URI = "https://example.org/k.tar.gz;name=kernel"\n')
        status, out = run("recipes", tree, "--allowlist", "none")
        ids = [x["id"] for x in out["new"]] if out else []
        ok(not [i for i in ids if "strong_1.0.bb" in i], "a download with a sha512sum is pinned: %s" % ids)
        ok([i for i in ids if i.startswith("recipes:unpinned:bare_1.0.bb")], "a download without a sum is not")

    # install-rootfs.py: each app gets its ACG files, as meta-webos writes them.
    import importlib.util
    spec = importlib.util.spec_from_file_location("install_rootfs", os.path.join(TOOLS, "install-rootfs.py"))
    ir = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ir)
    files = ir.security_files({"id": "com.palm.app.x", "type": "web", "requiredPermissions": ["a.b"]})
    perm = json.loads(files["/usr/share/luna-service2/client-permissions.d/com.palm.app.x.app.json"])
    role = json.loads(files["/usr/share/luna-service2/roles.d/com.palm.app.x.app.json"])
    ok(perm == {"com.palm.app.x-*": ["a.b", "private", "public"]}, "a com.palm. web app's permissions: %s" % perm)
    ok(role["allowedNames"] == ["com.palm.app.x-*"] and role["appId"] == "com.palm.app.x", "its role")
    files = ir.security_files({"id": "org.example.y", "type": "web"})
    perm = json.loads(files["/usr/share/luna-service2/client-permissions.d/org.example.y.app.json"])
    ok(perm == {"org.example.y-*": ["public"]}, "an app without requiredPermissions: %s" % perm)
    final, unbuilt = ir.plan(repo=FIXTURE, strict=False)
    ok("/usr/share/luna-service2/client-permissions.d/org.example.demo.app.json" in final,
       "the plan has every app's generated permissions")

    # phoenix-diag (the device's diagnostics bundle): it runs here too, with
    # what this machine has, and makes its archive.
    diag = os.path.join(REPO, "meta-phoenix", "recipes-phoenix", "phoenix-diag", "files", "phoenix-diag")
    ok(subprocess.run(["sh", "-n", diag]).returncode == 0, "phoenix-diag parses")
    with tempfile.TemporaryDirectory() as out:
        p = subprocess.run(["sh", diag, "-o", out, "--no-journal"], capture_output=True, text=True, timeout=120)
        made = p.stdout.strip()
        ok(p.returncode == 0 and made.endswith(".tar.gz") and os.path.isfile(made),
           "phoenix-diag makes its archive (%s)" % (made or p.stderr.strip()[-200:]))

    # This repository, with its allowlist, as CI runs it.
    for c in CHECKERS:
        status, out = run(c, REPO)
        ok(status == 0, "%s passes on the repository (%d new)" % (c, len(out["new"]) if out else -1))

    print("\n%d failed" % len(failures) if failures else "\nall passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
