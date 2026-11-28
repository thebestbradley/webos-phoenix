#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""The connectors' registrations (/etc/palm/<name>/clients.json,
OPEN-QUESTIONS Q76), without building an image:

  - tools/connector-clients.py: what it writes from the build's file, and
    what it refuses (a client secret, an unknown connector or provider, an
    entry without a client id);
  - every clients.json a connector reads is one it knows, and the
    simulator serves from runtime/connector-settings/clients/ (rootfs.json);
  - meta-phoenix phoenix-apps' do_install, run in sh as BitBake would with
    PHOENIX_CONNECTOR_CLIENTS set and unset: install-rootfs.py is given the
    file, or nothing; its task signature follows the variable and the file;
  - tools/install-rootfs.py --connector-clients places the files, 0644, and
    installs none without it;
  - the simulator: --sim, and serve-rootfs.py serving the file.

    python3 tools/test-connector-clients.py
"""

import importlib.util
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(REPO, "tools", "connector-clients.py")
RECIPE = os.path.join(REPO, "meta-phoenix", "recipes-phoenix", "phoenix-apps", "phoenix-apps_git.bb")
failures = []


def check(cond, what):
    print(("ok   " if cond else "FAIL ") + what)
    if not cond:
        failures.append(what)


spec = importlib.util.spec_from_file_location("connector_clients", TOOL)
lib = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lib)

GOOD = {
    "//": "a comment is left out",
    "drives": {"dropbox": {"clientId": "dbx-id"}, "box": {"clientId": "box-id", "relay": True},
               "googledrive": {"clientId": "g-id.apps.googleusercontent.com", "clientSecret": "GOCSPX-installed-app"}},
    "microsoft": {"microsoft": {"clientId": "00000000-0000-0000-0000-000000000000", "tokenEndpoint": "https://login.example/token"}},
}


def refused(config, what):
    try:
        lib.files(config)
    except lib.Invalid as e:
        return what in str(e)
    return False


# ---- What connector-clients.py writes, and refuses ---------------------------------------
made = lib.files(GOOD)
check(sorted(made) == ["/etc/palm/drives/clients.json", "/etc/palm/microsoft/clients.json"], "one file per connector named, at /etc/palm/<name>/clients.json")
drives = json.loads(made["/etc/palm/drives/clients.json"])
check(drives["box"] == {"clientId": "box-id", "relay": True} and drives["dropbox"] == {"clientId": "dbx-id"}, "each file is the connector's entries as given")
check(drives["googledrive"]["clientSecret"] == "GOCSPX-installed-app", "Google's installed-app secret, which is not confidential, is kept")
check(refused({"drives": {"box": {"clientId": "box-id", "clientSecret": "s3cret"}}}, "token relay"), "a Box client secret is refused, pointing to the relay")
check(refused({"todoist": {"todoist": {"clientId": "t", "clientSecret": "s"}}}, "no secrets"), "a Todoist client secret is refused")
check(refused({"slack": {"slack": {"clientId": "t", "extra": {"apiKey": "k"}}}}, "apiKey"), "a secret nested anywhere is refused")
check(refused({"drive": {"dropbox": {"clientId": "x"}}}, "not a connector"), "an unknown connector (a typo) is refused")
check(refused({"drives": {"icloud": {"clientId": "x"}}}, "holds"), "a provider the connector does not read is refused")
check(refused({"drives": {"dropbox": {"clientId": ""}}}, "clientId"), "an entry without a client id is refused")
check(refused({"drives": {"box": {"clientId": "b", "relay": "https://relay.example/"}}}, "relay is true"), "relay is only true")
check(refused([], "object"), "the file holds an object")

# ---- Every clients.json a connector reads is known, and the simulator serves it ------------
read = set()
for top in ("apps", "services"):
    for root, dirs, fns in os.walk(os.path.join(REPO, top)):
        dirs[:] = [d for d in dirs if d not in ("node_modules", "dist", "test", "testing", "lib-esm")]
        for fn in fns:
            if fn.endswith((".js", ".ts")) and not fn.endswith((".test.ts", ".d.ts")):
                with open(os.path.join(root, fn), encoding="utf-8", errors="replace") as f:
                    read.update(re.findall(r"[\"']([a-z0-9-]+)/clients\.json[\"']", f.read()))
check(read and read <= set(lib.CONNECTORS), "every clients.json the connectors read is known (%s)" % ", ".join(sorted(read - set(lib.CONNECTORS)) or "all"))
with open(os.path.join(REPO, "runtime", "rootfs.json"), encoding="utf-8") as f:
    mounts = json.load(f)["mounts"]
for name in sorted(lib.CONNECTORS):
    check(mounts.get("/etc/palm/%s/" % name) == "runtime/connector-settings/clients/%s/" % name,
          "the simulator's /etc/palm/%s/ is runtime/connector-settings/clients/%s/" % (name, name))

# ---- The recipe's do_install, as BitBake runs it -------------------------------------------
with open(RECIPE, encoding="utf-8") as f:
    recipe = f.read()
check(re.search(r'^PHOENIX_CONNECTOR_CLIENTS \?\?= ""$', recipe, re.M) is not None, "recipe: PHOENIX_CONNECTOR_CLIENTS is empty unless set")
check(re.search(r'^do_install\[vardeps\] \+= "PHOENIX_CONNECTOR_CLIENTS"$', recipe, re.M) is not None, "recipe: do_install's signature follows the variable")
m = re.search(r"^do_install\[file-checksums\] \+= \"\$\{@(.*)\}\"$", recipe, re.M)
check(m is not None, "recipe: and the file's contents (file-checksums)")


class D:
    def __init__(self, v):
        self.v = v

    def getVar(self, name):
        return self.v.get(name)


if m:
    expr = m.group(1)
    check(eval(expr, {}, {"d": D({"PHOENIX_CONNECTOR_CLIENTS": "/x/c.json"})}) == "/x/c.json:True"
          and eval(expr, {}, {"d": D({"PHOENIX_CONNECTOR_CLIENTS": ""})}) == "", "recipe: the file's checksum only when it is set")
body = re.search(r"^do_install\(\) \{\n(.*?)^\}", recipe, re.M | re.S).group(1)


def run_do_install(value):
    """do_install with BitBake's variables expanded and PYTHON a stand-in that
    records each call: install-rootfs.py's arguments."""
    tmp = tempfile.mkdtemp()
    calls = os.path.join(tmp, "calls")
    stub = os.path.join(tmp, "python")
    with open(stub, "w") as f:
        f.write("#!/bin/sh\nfor a in \"$@\"; do printf '%s\\n' \"$a\"; done >> '" + calls + "'\necho --- >> '" + calls + "'\n")
    os.chmod(stub, 0o755)
    known = {"PYTHON": stub, "S": "/src", "D": os.path.join(tmp, "image"), "PHOENIX_CONNECTOR_CLIENTS": value,
             "STAGING_BINDIR_NATIVE": "/native", "prefix": "/usr", "datadir": "/usr/share", "sysconfdir": "/etc",
             "DISTRO_NAME": "Phoenix", "MACHINE": "qemux86-64"}
    script = re.sub(r"\$\{([A-Za-z0-9_]+)\}", lambda x: known.get(x.group(1), ""), body)
    r = subprocess.run(["sh", "-e", "-c", script], capture_output=True, text=True)
    out = open(calls).read().split("---\n") if os.path.exists(calls) else []
    shutil.rmtree(tmp)
    return r.returncode, [c.split("\n")[:-1] for c in out if c]


code, calls = run_do_install("/home/builder/connector-clients.json")
first = calls[0] if calls else []
check(code == 0 and first[:1] == ["/src/tools/install-rootfs.py"] and first[-2:] == ["--connector-clients", "/home/builder/connector-clients.json"],
      "do_install with the file: install-rootfs.py ... --connector-clients FILE (%s)" % " ".join(first[1:]))
code, calls = run_do_install("")
first = calls[0] if calls else []
check(code == 0 and first[:1] == ["/src/tools/install-rootfs.py"] and "--connector-clients" not in first and "" not in first,
      "do_install without it: install-rootfs.py is given nothing for it (%s)" % " ".join(first[1:]))

# ---- install-rootfs.py places them ---------------------------------------------------------
tmp = tempfile.mkdtemp()
try:
    conf = os.path.join(tmp, "connector-clients.json")
    with open(conf, "w") as f:
        json.dump(GOOD, f)
    dest = os.path.join(tmp, "image")
    wanted = "/etc/palm/drives/clients.json\n/etc/palm/microsoft/clients.json\n"
    r = subprocess.run([sys.executable, os.path.join(REPO, "tools", "install-rootfs.py"), dest, "--only", "-", "--connector-clients", conf],
                       input=wanted, capture_output=True, text=True)
    placed = os.path.join(dest, "etc/palm/drives/clients.json")
    check(r.returncode == 0 and os.path.isfile(placed), "install-rootfs.py --connector-clients places /etc/palm/drives/clients.json" + (" (%s)" % r.stderr.strip() if r.returncode else ""))
    if os.path.isfile(placed):
        check(stat.S_IMODE(os.stat(placed).st_mode) == 0o644, "it is 0644: a client id is public, and every connector reads it")
        with open(placed, "rb") as f:
            check(f.read() == made["/etc/palm/drives/clients.json"], "it holds what connector-clients.py makes")
    r = subprocess.run([sys.executable, os.path.join(REPO, "tools", "install-rootfs.py"), os.path.join(tmp, "none"), "--only", "-"],
                       input=wanted, capture_output=True, text=True)
    check(r.returncode != 0 and "not something the checkout installs" in r.stderr, "without --connector-clients there is no clients.json to install")
    bad = os.path.join(tmp, "bad.json")
    with open(bad, "w") as f:
        json.dump({"drives": {"box": {"clientId": "b", "clientSecret": "s"}}}, f)
    r = subprocess.run([sys.executable, os.path.join(REPO, "tools", "install-rootfs.py"), os.path.join(tmp, "bad"), "--only", "-", "--connector-clients", bad],
                       input="/etc/palm/drives/clients.json\n", capture_output=True, text=True)
    check(r.returncode != 0 and "no secrets" in r.stderr and not os.path.exists(os.path.join(tmp, "bad")), "a secret in the file stops the install")

    # ---- The simulator --------------------------------------------------------------------
    sim_file = os.path.join(lib.SIM_DIR, "microsoft", "clients.json")
    if os.path.exists(sim_file):
        print("skip the simulator's part: %s is your own (it is left as it is)" % os.path.relpath(sim_file, REPO))
    else:
        try:
            r = subprocess.run([sys.executable, TOOL, conf, "--sim"], capture_output=True, text=True)
            check(r.returncode == 0 and os.path.isfile(sim_file), "--sim writes runtime/connector-settings/clients/microsoft/clients.json")
            r = subprocess.run(["git", "-C", REPO, "check-ignore", "-q", sim_file])
            check(r.returncode == 0, "git ignores it")
            s = socket.socket()
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
            s.close()
            srv = subprocess.Popen([sys.executable, os.path.join(REPO, "tools", "serve-rootfs.py"), "--port", str(port), "--no-tcp",
                                    "--installed-dir", os.path.join(tmp, "installed")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                body = None
                for _ in range(100):
                    try:
                        body = urllib.request.urlopen("http://127.0.0.1:%d/etc/palm/microsoft/clients.json" % port, timeout=2).read()
                        break
                    except Exception:
                        time.sleep(0.1)
                check(body is not None and json.loads(body)["microsoft"]["clientId"] == "00000000-0000-0000-0000-000000000000",
                      "the simulator serves it at /etc/palm/microsoft/clients.json")
            finally:
                srv.terminate()
                srv.wait()
        finally:
            if os.path.exists(sim_file):
                os.remove(sim_file)
            for d in (os.path.dirname(sim_file), lib.SIM_DIR):
                if os.path.isdir(d) and not os.listdir(d):
                    os.rmdir(d)
finally:
    shutil.rmtree(tmp)

if failures:
    print("%d failed" % len(failures))
    sys.exit(1)
print("all passed")
