# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""meta-phoenix's recipes, read for what a first build trips on.

  license        a recipe without LICENSE or LIC_FILES_CHKSUM, or whose
                 checksum does not match the file in this repository
                 (do_populate_lic stops)
  unpinned       a source that is not pinned: a git SRC_URI whose SRCREV
                 defaults to AUTOREV (asks the network at parse time and
                 builds whatever the branch has), an http(s) one without a
                 sha256sum
  missing-file   a file:// in SRC_URI that is not beside the recipe
  network        a task body that fetches (npm install/ci, pip install,
                 curl, wget, git clone): BitBake forbids the network
                 outside do_fetch
  rdepends       a Luna service file whose Exec program the recipe does not
                 bring (run-js-service: mojoservicelauncher; node: nodejs)
  systemd        a Phoenix systemd unit not ordered after the hub
                 (After=/Requires= ls-hubd.service), not WantedBy a target,
                 or not named in its recipe's SYSTEMD_SERVICE
  service-file   a luna-service2 .service file whose Name has no role file,
                 or whose run-js-service path is not where install-rootfs.py
                 puts the service
"""

import hashlib
import os
import re

from . import Findings, finish, parser, read, read_json, recipe_vars, recipe_files, rel

CHECKER = "recipes"
COMMON_LICENSES = {"Apache-2.0": "89aea4e17d99a7cacdbeed46a0096b10", "MIT": "0835ade698e0bcf8506ecda2f7b4f302"}
NETWORK = re.compile(r"\b(npm\s+(?:install|ci|i)\b|yarn\s+install|pnpm\s+install|pip3?\s+install|curl\s|wget\s|git\s+clone|cargo\s+fetch|go\s+get)")
EXEC_PROVIDERS = {"/usr/bin/run-js-service": "mojoservicelauncher", "/usr/bin/node": "nodejs"}


def source_dir(root, vars_):
    """The repository directory a recipe's S is, for one that builds this
    repository (S = ${WORKDIR}/git[/sub])."""
    s = vars_.get("S", "")
    if "github.com/thebestbradley/webos-phoenix" not in vars_.get("SRC_URI", ""):
        return None
    m = re.match(r"^\$\{(?:WORKDIR|UNPACKDIR)\}/git(/.*)?$", s)
    if not m:
        return None
    return os.path.join(root, (m.group(1) or "").lstrip("/"))


def check(root):
    f = Findings(CHECKER)
    units = {}
    for path in recipe_files(root):
        where = rel(root, path)
        name = os.path.basename(path)
        v, funcs, inherits, text = recipe_vars(path)
        is_append = name.endswith(".bbappend")
        # An image that requires another recipe (webos-image.bb) takes its LICENSE.
        if not is_append and "packagegroup" not in inherits and "LICENSE" not in v and not re.search(r"^require\s", text, re.M):
            f.add("license", name, "%s has no LICENSE" % name, where)
        if not is_append and "packagegroup" not in inherits and "image" not in name and "LIC_FILES_CHKSUM" not in v \
                and "nopackages" not in inherits:
            f.add("license", name, "%s has no LIC_FILES_CHKSUM" % name, where)
        src = source_dir(root, v)
        for entry in v.get("LIC_FILES_CHKSUM", "").split():
            m = re.match(r"file://([^;]+);.*md5=([0-9a-f]{32})", entry)
            if not m:
                continue
            fpath, md5 = m.group(1), m.group(2)
            cm = re.match(r"\$\{COMMON_LICENSE_DIR\}/(.+)$", fpath)
            if cm:
                want = COMMON_LICENSES.get(cm.group(1))
                if want and want != md5:
                    f.add("license", "%s:%s" % (name, cm.group(1)), "%s: the md5 of %s is %s, not %s"
                          % (name, cm.group(1), want, md5), where)
                continue
            if src and "${" not in fpath:
                full = os.path.normpath(os.path.join(src, fpath))
                if not os.path.isfile(full):
                    f.add("license", "%s:%s" % (name, fpath), "%s: LIC_FILES_CHKSUM names %s, which is not in "
                          "the source (%s)" % (name, fpath, rel(root, full)), where)
                    continue
                got = hashlib.md5(open(full, "rb").read()).hexdigest()
                if got != md5:
                    f.add("license", "%s:%s" % (name, fpath), "%s: %s has md5 %s, the recipe says %s"
                          % (name, rel(root, full), got, md5), where)
        # Sources.
        uris = v.get("SRC_URI", "").split()
        for u in uris:
            fm = re.match(r"^file://([^;$]+)", u)
            if fm and not fm.group(1).startswith("/"):
                # BitBake looks in FILESPATH: <recipe dir>/<BPN>-<PV>, <BPN>, files.
                rdir = os.path.dirname(path)
                bpn = re.sub(r"_.*$", "", name.rsplit(".", 1)[0])
                if not any(os.path.exists(os.path.join(rdir, d, fm.group(1))) for d in (bpn, "files", ".")):
                    f.add("missing-file", "%s:%s" % (name, fm.group(1)), "%s: SRC_URI names file://%s, which is not "
                          "beside the recipe (files/, %s/): parsing only notes it, the fetch fails"
                          % (name, fm.group(1), bpn), where)
            if u.startswith(("git://", "gitsm://")):
                srcrev = v.get("SRCREV", "")
                resolved = srcrev
                ref = re.match(r"^\$\{([A-Za-z0-9_]+)\}$", srcrev)
                if ref:
                    resolved = v.get(ref.group(1), "")
                if not srcrev or "AUTOREV" in resolved:
                    f.add("unpinned", name, "%s fetches %s at %s: the branch's head when parsed, not a pinned "
                          "commit (local.conf's PHOENIX_SRCREV pins it; a release must)" %
                          (name, u.split(";")[0], srcrev or "no SRCREV"), where)
            elif u.startswith(("http://", "https://")) and "sha256sum=" not in u:
                nm = re.search(r";name=([^;]+)", u)
                key = "SRC_URI[%ssha256sum]" % (nm.group(1) + "." if nm else "")
                if key not in text and not (nm and "${" in nm.group(1) and re.search(r"SRC_URI\[[^]]+\.sha256sum\]", text)):
                    f.add("unpinned", "%s:%s" % (name, u.split(";")[0]), "%s downloads %s without a sha256sum"
                          % (name, u.split(";")[0]), where)
        for task, body in funcs.items():
            if task.startswith("do_fetch") or task.startswith("python"):
                continue
            for line in body.splitlines():
                if line.strip().startswith("#"):
                    continue
                m = NETWORK.search(line)
                if m:
                    f.add("network", "%s:%s" % (name, task), "%s's %s runs '%s': no network outside do_fetch"
                          % (name, task, m.group(1).strip()), where)
        # Units the recipe names.
        for u in v.get("SYSTEMD_SERVICE:${PN}", "").split():
            units[u] = name
        # run-js-service and friends for the services phoenix-apps installs.
        if "install-rootfs.py" in text:
            rdeps = " ".join(val for k, val in v.items() if k.startswith("RDEPENDS"))
            for svc in service_files(root):
                exe = re.search(r"^Exec=(\S+)", read(svc), re.M)
                if exe and exe.group(1) in EXEC_PROVIDERS and EXEC_PROVIDERS[exe.group(1)] not in rdeps:
                    f.add("rdepends", "%s:%s" % (name, EXEC_PROVIDERS[exe.group(1)]),
                          "%s installs services run by %s (%s) but does not RDEPEND on %s"
                          % (name, exe.group(1), rel(root, svc), EXEC_PROVIDERS[exe.group(1)]), where)

    # systemd units in the tree.
    for d, dirs, files in os.walk(os.path.join(root, "services")):
        dirs[:] = [x for x in dirs if x not in ("tests", "node_modules")]
        if os.path.basename(d) != "systemd":
            continue
        for fn in files:
            if not fn.endswith(".service"):
                continue
            p = os.path.join(d, fn)
            t = read(p)
            after = " ".join(re.findall(r"^After=(.*)$", t, re.M))
            requires = " ".join(re.findall(r"^(?:Requires|Wants)=(.*)$", t, re.M))
            if "ls-hubd.service" not in after:
                f.add("systemd", "%s:after" % fn, "%s is not ordered after the hub (After=ls-hubd.service)" % fn,
                      rel(root, p))
            if "ls-hubd.service" not in requires:
                f.add("systemd", "%s:requires" % fn, "%s does not require the hub (Requires=ls-hubd.service)" % fn,
                      rel(root, p))
            if not re.search(r"^WantedBy=\S+", t, re.M):
                f.add("systemd", "%s:install" % fn, "%s has no [Install] WantedBy=: enabling it does nothing" % fn,
                      rel(root, p))
            if fn not in units:
                f.add("systemd", "%s:recipe" % fn, "no recipe names %s in SYSTEMD_SERVICE, so the image never "
                      "starts it" % fn, rel(root, p))

    # luna-service2 .service files against role files and install paths.
    for svc in service_files(root):
        t = read(svc)
        name = re.search(r"^Name=(\S+)", t, re.M)
        exe = re.search(r"^Exec=(.*)$", t, re.M)
        sysbus = os.path.dirname(svc)
        roles = [read_json(os.path.join(sysbus, r)) for r in os.listdir(sysbus) if r.endswith(".role.json")]
        allowed = {n for r in roles for n in r.get("allowedNames", [])}
        # Name is a list: one process may provide several names
        # (luna-service2 src/ls-hubd/file_parser.cpp:469-471, g_key_file_get_string_list).
        missing = [n for n in (name.group(1).split(";") if name else []) if n and n not in allowed]
        if missing:
            f.add("service-file", os.path.basename(svc), "%s names %s, which no role file in %s allows"
                  % (os.path.basename(svc), ";".join(missing), rel(root, sysbus)), rel(root, svc))
        if exe and "run-js-service" in exe.group(1):
            m = re.search(r"(/usr/palm/services/[^\s]+)", exe.group(1))
            pkg = os.path.join(os.path.dirname(sysbus), "package.json")
            if m and os.path.isfile(pkg):
                want = "/usr/palm/services/" + read_json(pkg).get("name", "")
                if m.group(1).rstrip("/") != want:
                    f.add("service-file", os.path.basename(svc), "%s runs %s, but install-rootfs.py installs the "
                          "service in %s (package.json's name)" % (os.path.basename(svc), m.group(1), want),
                          rel(root, svc))
    return f


def service_files(root):
    out = []
    for base in ("services", "apps"):
        b = os.path.join(root, base)
        for n in sorted(os.listdir(b)) if os.path.isdir(b) else []:
            for sub in ("sysbus", os.path.join("service", "sysbus")):
                d = os.path.join(b, n, sub)
                if os.path.isdir(d):
                    out += [os.path.join(d, x) for x in sorted(os.listdir(d)) if x.endswith(".service")]
    return out


def main(argv=None):
    ap = parser(__doc__.splitlines()[0])
    args = ap.parse_args(argv)
    return finish(CHECKER, check(os.path.abspath(args.root)), args)
