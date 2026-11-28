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

    # The connectors' sign-in pages run in Accounts' frame, so their calls go
    # out as Accounts' (check-luna charges each page to Accounts, the fixture's
    # apps/connector above). Accounts holds each page's methods and none of
    # the connectors' others: posting, sending, syncing, files (the owner's
    # decision, 27 November 2026: narrow sign-in groups, least privilege).
    with open(os.path.join(REPO, "compat", "app-permissions.json"), encoding="utf-8") as f:
        accounts = set(json.load(f)["com.palm.app.accounts"])
    pages = {
        "apps/dav/service/sysbus/org.webosphoenix.service.dav":
            (["checkCredentials", "accountSettings"], ["onCreate", "onDelete", "sync"]),
        "apps/fediverse/service/sysbus/org.webosphoenix.service.fediverse":
            (["signIn"], ["share", "outbox", "sync", "onDelete"]),
        "apps/telegram/service/sysbus/org.webosphoenix.service.telegram":
            (["available", "signIn", "checkCredentials"], ["markRead", "setPresence", "outbox", "connect", "sync"]),
        "apps/connectors/drives/service/sysbus/org.webosphoenix.service.drives":
            (["providerInfo", "checkCredentials", "signIn", "loginFlowStart", "loginFlowPoll", "sftpHostKey",
              "sftpMakeKey", "sftpImportKey", "sftpForgetKey", "sftpPublicKey"],
             ["listFiles", "uploadFile", "removeFile", "driveQuota", "sync", "onDelete"]),
        # Phoenix's own catalog connectors (preinstalled.json firstParty).
        # The kit's ConnectorWizard.js pages: providerInfo, checkCredentials, signIn.
        "apps/connectors/bluesky/service/sysbus/org.webosphoenix.service.bluesky":
            (["providerInfo", "checkCredentials", "signIn"], ["share", "outbox", "sync", "onDelete"]),
        "apps/connectors/google/service/sysbus/org.webosphoenix.service.google":
            (["providerInfo", "checkCredentials", "signIn"], ["sync", "onDelete"]),
        "apps/connectors/linkedin/service/sysbus/org.webosphoenix.service.linkedin":
            (["providerInfo", "checkCredentials", "signIn"], ["share", "importConnections", "sync", "onDelete"]),
        "apps/connectors/microsoft/service/sysbus/org.webosphoenix.service.microsoft":
            (["providerInfo", "checkCredentials", "signIn"], ["sync", "onDelete"]),
        "apps/connectors/slack/service/sysbus/org.webosphoenix.service.slack":
            (["providerInfo", "checkCredentials", "signIn"], ["outbox", "sync", "onDelete"]),
        "apps/connectors/todoist/service/sysbus/org.webosphoenix.service.todoist":
            (["providerInfo", "checkCredentials", "signIn"], ["share", "sync", "onDelete"]),
        "apps/connectors/zoom/service/sysbus/org.webosphoenix.service.zoom":
            (["providerInfo", "checkCredentials", "signIn"], ["createMeeting", "sync", "onDelete"]),
        "apps/connectors/matrix/service/sysbus/org.webosphoenix.service.matrix":
            (["signInOptions", "checkCredentials", "signIn"], ["markRead", "setPresence", "outbox", "connect", "sync"]),
        "apps/connectors/xmpp/service/sysbus/org.webosphoenix.service.xmpp":
            (["checkCredentials"], ["setPresence", "markRead", "chatState", "enablePush", "outbox", "connect", "sync"]),
        "apps/connectors/deltachat/service/sysbus/org.webosphoenix.service.deltachat":
            (["available", "checkCredentials"], ["markRead", "setPresence", "outbox", "connect", "sync"]),
    }
    for base, (signin, others) in sorted(pages.items()):
        with open(os.path.join(REPO, base + ".api.json"), encoding="utf-8") as f:
            api = json.load(f)
        svc = os.path.basename(base)

        def held(method):
            return sorted(g for g, ms in api.items() if svc + "/" + method in ms and g in accounts)
        for m in signin:
            ok(held(m), "Accounts may call %s/%s (its sign-in page)" % (svc, m))
        for m in others:
            ok(not held(m), "Accounts may not call %s/%s (%s)" % (svc, m, ", ".join(held(m)) or "refused"))

    # check-luna reads the catalog connectors' sysbus files too (apps/connectors:
    # a device installs them with the package), so every sign-in group Accounts
    # holds is one a provider defines, and their services are checked as callers.
    from devicecheck import luna
    services, _ = luna.load_phoenix(REPO)
    defined = {g for e in services.values() for gs in e["methods"].values() for g in gs}
    for g in sorted(x for x in accounts if x.startswith("phoenix.") and x.endswith(".signin")):
        ok(g in defined, "check-luna knows the group %s Accounts holds" % g)
    callers = {os.path.relpath(d, REPO) for d in luna.sysbus_files(REPO)}
    for base in sorted(pages):
        ok(os.path.dirname(base) in callers, "check-luna reads %s" % os.path.dirname(base))

    # A method listed on its own and under a wildcard is callable with either
    # group, as luna-hub joins every api group whose pattern matches.
    got = sorted(luna.method_groups({"org.example.s/*": ["example.all"], "org.example.s/m": ["example.m"]},
                                    "org.example.s/m"))
    ok(got == ["example.all", "example.m"], "an exact method is callable with its wildcard's group too: %s" % got)

    # The catalog connectors list their own accounts and read each account
    # and its credentials (the kit does for every account context: service.ts
    # accountContext) through the accounts service's narrow groups, never the
    # whole service (phoenix.appservices.accounts can create, change and
    # delete any account). The read-only groups hold nothing that writes;
    # which accounts a caller may read is still each template's
    # readPermissions (the accounts service's Utils.hasPermission, in both
    # readCredentials and getAccountInfo).
    acct = os.path.join(REPO, "compat", "app-services", "com.palm.service.accounts", "sysbus",
                        "com.palm.service.accounts.api.json")
    with open(acct, encoding="utf-8") as f:
        acct = json.load(f)
    ok(sorted(acct.get("phoenix.accounts.list") or []) == ["com.palm.service.accounts/listAccountTemplates",
                                                           "com.palm.service.accounts/listAccounts"],
       "phoenix.accounts.list is listAccounts and listAccountTemplates alone: %s" % acct.get("phoenix.accounts.list"))
    ok(acct.get("phoenix.accounts.read-credentials") == ["com.palm.service.accounts/readCredentials"],
       "phoenix.accounts.read-credentials is readCredentials alone: %s" % acct.get("phoenix.accounts.read-credentials"))
    ok(acct.get("phoenix.accounts.info") == ["com.palm.service.accounts/getAccountInfo"],
       "phoenix.accounts.info is getAccountInfo alone: %s" % acct.get("phoenix.accounts.info"))
    reads = {"phoenix.accounts.info", "phoenix.accounts.read-credentials"}
    lists = {"bluesky", "deltachat", "drives", "matrix", "slack", "xmpp"}
    for name in sorted(os.listdir(os.path.join(REPO, "apps", "connectors"))):
        perm = os.path.join(REPO, "apps", "connectors", name, "service", "sysbus",
                            "org.webosphoenix.service.%s.perm.json" % name)
        if not os.path.isfile(perm):
            continue
        with open(perm, encoding="utf-8") as f:
            groups = set(json.load(f).get("org.webosphoenix.service." + name) or [])
        want = reads | ({"phoenix.accounts.list"} if name in lists else set())
        has = groups & {"phoenix.accounts.list", "phoenix.accounts.info", "phoenix.accounts.read-credentials",
                        "phoenix.appservices.accounts"}
        ok(has == want, "the %s connector's service holds the accounts groups %s: %s"
           % (name, ", ".join(sorted(want)), ", ".join(sorted(has)) or "none"))

    # check-luna charges the connector kit's calls (one shared library, which
    # no service's own folder holds) to each service that runs on it, and
    # synckit's bus helpers to DAV, which uses them alone; every literal call
    # in the kit is in its table (no kit-call finding).
    found = luna.check(REPO)
    ids = list(found.items)
    ok(not [i for i in ids if ":kit-call:" in i], "check-luna's KIT_CALLS names every call in the kit: %s"
       % [i for i in ids if ":kit-call:" in i])
    kit = luna.kit_calls(REPO)
    cl = {c.name: c for c in luna.clients(REPO, luna.load_phoenix(REPO)[1]) if c.kind == "service"}
    kit_users = sorted(n for n, c in cl.items() if luna.kit_charges(c, kit))
    for name in ["org.webosphoenix.service." + n for n in ("xmpp", "deltachat", "bluesky", "telegram", "fediverse",
                                                           "drives", "dav")]:
        charged = {(s, m) for s, m, _ in luna.kit_charges(cl[name], kit)} if name in cl else set()
        ok({("com.palm.service.accounts", "getAccountInfo"), ("com.palm.service.accounts", "readCredentials")} <= charged,
           "check-luna charges %s with the kit's getAccountInfo and readCredentials" % name)
        ok(reads <= cl[name].groups if name in cl else False,
           "%s holds phoenix.accounts.info and phoenix.accounts.read-credentials" % name)
        ok("phoenix.appservices.accounts" not in (cl[name].groups if name in cl else set()),
           "%s does not hold the whole accounts service" % name)
    ok("org.webosphoenix.service.files" not in kit_users or
       {(s, m) for s, m, _ in luna.kit_charges(cl["org.webosphoenix.service.files"], kit)} <=
       {("com.palm.service.accounts", "listAccounts"), ("com.palm.service.accounts", "listAccountTemplates")},
       "the Files service is charged only the drive router's calls, not a connector's")
    ok(("org.webosphoenix.ongoing", "set") not in
       {(s, m) for s, m, _ in luna.kit_charges(cl["org.webosphoenix.service.bluesky"], kit)},
       "a connector without a drive is not charged the drives' transfer rows")
    fake = luna.Client("org.example.k", "service", [], groups=set())
    ok(luna.kit_charges(fake, kit) == [], "a service that does not run on the kit is charged nothing")

    # Messaging's presence, typing and read markers on each IM transport:
    # a group of those methods alone (not the transport's other account
    # methods: sign-in, push, availability), defined where the service is.
    for name, d, methods in (("xmpp", "apps/connectors/xmpp", ["chatState", "markRead", "setPresence"]),
                             ("matrix", "apps/connectors/matrix", ["markRead", "setPresence"]),
                             ("deltachat", "apps/connectors/deltachat", ["markRead", "setPresence"]),
                             ("telegram", "apps/telegram", ["markRead", "setPresence"])):
        svc = "org.webosphoenix.service." + name
        group = "phoenix.%s.messaging" % name
        base = os.path.join(REPO, d, "service", "sysbus", svc)
        with open(base + ".api.json", encoding="utf-8") as f:
            api = json.load(f)
        with open(base + ".groups.json", encoding="utf-8") as f:
            trust = json.load(f)
        ok(sorted(api.get(group) or []) == [svc + "/" + m for m in methods],
           "%s is %s alone: %s" % (group, ", ".join(methods), api.get(group)))
        ok(trust.get(group) == ["oem"], "%s is defined for oem callers: %s" % (group, trust.get(group)))
        ok(group not in accounts, "Accounts does not hold %s" % group)

    # OSE's installer checks no signature, so only the Marketplace's service
    # may reach it: it checks who publishes each package (nova install comes
    # to it too, packagesservice.js "Who may update an installed app"). No
    # app, no other service and not nova luna-send's developer role holds
    # its groups.
    holders = set()
    for d in luna.sysbus_files(REPO):
        for fn in os.listdir(d):
            if fn.endswith(".perm.json"):
                with open(os.path.join(d, fn), encoding="utf-8") as f:
                    for client, groups in json.load(f).items():
                        if any(str(g).startswith("applicationinstall.") for g in groups if isinstance(groups, list)):
                            holders.add(client)
    for d in luna.app_dirs(REPO):
        info, _ = luna.app_info(d)
        if info and any(str(g).startswith("applicationinstall.") for g in info.get("requiredPermissions") or []):
            holders.add(info.get("id"))
    with open(os.path.join(REPO, "compat", "app-permissions.json"), encoding="utf-8") as f:
        for client, groups in json.load(f).items():
            if isinstance(groups, list) and any(str(g).startswith("applicationinstall.") for g in groups):
                holders.add(client)
    ok(holders == {"org.webosphoenix.service.packages"},
       "only the Marketplace's service holds OSE's installer groups (%s)" % ", ".join(sorted(holders)))

    # This repository, with its allowlist, as CI runs it.
    for c in CHECKERS:
        status, out = run(c, REPO)
        ok(status == 0, "%s passes on the repository (%d new)" % (c, len(out["new"]) if out else -1))

    print("\n%d failed" % len(failures) if failures else "\nall passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
