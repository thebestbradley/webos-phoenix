#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The device's web app user agent (docs/APP-RUNTIME.md, "The user agent";
# docs/DECISIONS.md, 15 October 2026), without a device:
#
#   - /etc/wam/plugins/conf.sh (meta-phoenix phoenix-wam-conf), sourced by
#     WebAppMgr's start script: the user agent for a date and a form
#     factor, the empty WAM_NAME, and the client-hint switches only where
#     the runtime takes them;
#   - the start line's edit in meta-phoenix's wam bbappend (phoenix-wam.inc),
#     run on the start lines of OSE's and LuneOS's webapp-mgr.sh: the user
#     agent reaches WebAppMgr as one argument, and nothing is added without
#     it;
#   - the patches the bbappends name are there.
#
#   python3 tools/test-wam-user-agent.py

import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META = os.path.join(REPO, "meta-phoenix")
CONF = os.path.join(META, "recipes-phoenix", "phoenix-wam-conf", "files", "phoenix-wam.sh")
WAM_INC = os.path.join(META, "recipes-webos", "wam", "phoenix-wam.inc")
WEBRUNTIME_INC = os.path.join(META, "dynamic-layers", "meta-luneos", "recipes-webos-ose", "chromium",
                              "phoenix-webruntime.inc")

# webapp-mgr.sh's start line, as both stacks have it (meta-webosose d7ed46c
# recipes-webos/wam/wam/webapp-mgr.sh.in:247; meta-webos-ports ec5e878
# recipes-webos-ose/wam/wam/webapp-mgr.sh.in:282, before meta-luneos's
# wam.inc takes $WAM_V8_CODE_CACHE_SWITCHES out of it).
START_LINES = {
    "OSE": 'exec $WAM_EXE_PATH $WAM_SWITCHES $WAM_EXTRA_SKIA_CACHE_SWITCHES $WAM_EXTRA_GPU_TUNING_SWITCHES '
           '$WAM_WATCHDOG_RENDERER_TIMEOUT_SWITCHES $WAM_MEM_FLAGS $WAM_EXTRA_FLAGS $WAM_V8_CODE_CACHE_SWITCHES '
           '--webos-js-flags="$WAM_JS_FLAGS"',
    "LuneOS": 'exec $WAM_EXE_PATH $WAM_SWITCHES $WAM_EXTRA_SKIA_CACHE_SWITCHES $WAM_EXTRA_GPU_TUNING_SWITCHES '
              '$WAM_WATCHDOG_RENDERER_TIMEOUT_SWITCHES $WAM_MEM_FLAGS $WAM_EXTRA_FLAGS  '
              '--webos-js-flags="$WAM_JS_FLAGS"',
}

# The device's /bin/sh may be bash or BusyBox's ash; every POSIX shell
# here runs the battery.
SHELLS = [sh for sh in (["sh"], ["dash"], ["bash", "--posix"], ["busybox", "sh"]) if shutil.which(sh[0])]

failures = []


def check(cond, what):
    if not cond:
        failures.append(what)
        print("FAIL (%s): %s" % (" ".join(SH), what))


def epoch(day):
    return int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp())


def ua(major, mobile):
    return ("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/%d.0.0.0 %sSafari/537.36"
            % (major, "Mobile " if mobile else ""))


def source_conf(tmp, now, form=None, hints=False, extra_flags="--a", override=None):
    """Source conf.sh as webapp-mgr.sh does; what it leaves set."""
    device = os.path.join(tmp, "device.json")
    if form is None:
        if os.path.exists(device):
            os.remove(device)
    else:
        with open(device, "w") as f:
            f.write('{\n    "formFactor": "%s",\n    "density": 1.5\n}\n' % form)
    marker = os.path.join(tmp, "client-hints")
    if hints:
        open(marker, "w").close()
    elif os.path.exists(marker):
        os.remove(marker)
    env = dict(os.environ, PHOENIX_UA_NOW=str(now) if now is not None else "", PHOENIX_DEVICE_JSON=device,
               PHOENIX_UA_CLIENT_HINTS_FILE=marker, WAM_EXTRA_FLAGS=extra_flags, WAM_NAME="WebAppManager")
    env.pop("PHOENIX_UA_CHROME_MAJOR", None)
    if override is not None:
        env["PHOENIX_UA_CHROME_MAJOR"] = override
    script = ('. %s || :\nprintf "%%s\\n" "$PHOENIX_USER_AGENT" "[$WAM_NAME]" "$WAM_EXTRA_FLAGS" '
              '"${phoenix_ua_major-unset}"\n' % shlex.quote(CONF))
    out = subprocess.run(SH + ["-c", script], env=env, capture_output=True, text=True, check=True).stdout
    agent, name, flags, leftover = out.rstrip("\n").split("\n")
    return agent, name, flags, leftover


for SH in SHELLS:
    with tempfile.TemporaryDirectory() as tmp:
        # The major version: 155 from Chrome 155's release, one more every 28
        # days, never lower (a clock not set yet).
        for day, major in [("2026-10-06", 155), ("2026-11-02", 155), ("2026-11-03", 156), ("2026-12-01", 157),
                           ("2027-01-01", 158), ("2027-10-05", 168), ("2026-10-05", 155), ("1970-01-01", 155)]:
            agent, _, _, _ = source_conf(tmp, epoch(day), "tablet")
            check(agent == ua(major, False), "%s: Chrome/%d, got %r" % (day, major, agent))
        agent, _, _, _ = source_conf(tmp, None, "tablet")
        check(re.search(r" Chrome/1[5-9]\d\.0\.0\.0 Safari/537\.36$", agent) is not None,
              "today (date -u +%%s): a current major, got %r" % agent)

        # PHOENIX_UA_CHROME_MAJOR names the major, as in the simulator; a
        # value that is not a plain whole number from 1 to 9999 is ignored.
        for value, major in [("160", 160), ("9999", 9999), ("abc", 155), ("0", 155), ("0160", 155),
                             ("10000", 155), ("-3", 155), ("", 155)]:
            agent, _, _, _ = source_conf(tmp, epoch("2026-10-15"), "tablet", override=value)
            check(agent == ua(major, False), "PHOENIX_UA_CHROME_MAJOR=%r: Chrome/%d, got %r" % (value, major, agent))

        # The form factor: Mobile on a phone only.
        now = epoch("2026-10-15")
        for form, mobile in [("phone", True), ("tablet", False), ("auto", False), (None, False)]:
            agent, name, flags, leftover = source_conf(tmp, now, form)
            check(agent == ua(155, mobile), "%s: %r" % (form, agent))
            check(name == "[]", "%s: WAM_NAME emptied, got %s" % (form, name))
            check(flags == "--a", "%s: no client-hint switches without the runtime's marker, got %r" % (form, flags))
            check(leftover == "unset", "%s: conf.sh leaves its own variables unset" % form)
            for token in ("webOS", "Web0S", "WebAppManager", "QtWebEngine", "  "):
                check(token not in agent, "%s: no %r in the user agent" % (form, token))
            check(agent == agent.strip(), "%s: no space at either end" % form)

        # The client hints, where the runtime takes them.
        _, _, flags, _ = source_conf(tmp, epoch("2026-11-03"), "phone", hints=True)
        check(flags.split() == ["--a", "--enable-neva-user-agent-client-hints",
                                "--neva-user-agent-client-hints-brand-version=156",
                                "--neva-user-agent-client-hints-platform=Android",
                                "--neva-user-agent-client-hints-mobile"], "phone, client hints: %r" % flags)
        _, _, flags, _ = source_conf(tmp, now, "tablet", hints=True)
        check("--neva-user-agent-client-hints-mobile" not in flags and "brand-version=155" in flags,
              "tablet, client hints: %r" % flags)

        # The start line's edit, from the bbappend itself, on both stacks' lines.
        inc = open(WAM_INC).read()
        m = re.search(r"sed -i '([^']+)' \"\$script\"", inc)
        check(m is not None, "phoenix-wam.inc edits the start line with sed")
        grep = re.search(r"grep -q '([^']+)' \"\$script\"", inc)
        check(grep is not None, "phoenix-wam.inc checks the edit")
        if m and grep:
            args = os.path.join(tmp, "args.sh")
            with open(args, "w") as f:
                f.write('#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n')
            os.chmod(args, 0o755)
            for stack, line in START_LINES.items():
                script = os.path.join(tmp, "webapp-mgr.sh")
                with open(script, "w") as f:
                    f.write("#!/bin/sh\n" + line + "\n")
                subprocess.run(["sed", "-i", m.group(1), script], check=True)
                check(subprocess.run(["grep", "-q", grep.group(1), script]).returncode == 0,
                      "%s: the bbappend's own check passes" % stack)
                for agent in (ua(155, True), None):
                    env = dict(os.environ, WAM_EXE_PATH=args, WAM_SWITCHES="--x --y", WAM_EXTRA_FLAGS="--z")
                    env.pop("PHOENIX_USER_AGENT", None)
                    if agent:
                        env["PHOENIX_USER_AGENT"] = agent
                    out = subprocess.run(SH + [script], env=env, capture_output=True, text=True, check=True).stdout
                    argv = out.rstrip("\n").split("\n")
                    want = ["--x", "--y", "--z", "--webos-js-flags="] + (["--user-agent=" + agent] if agent else [])
                    check(argv == want, "%s, %s: WebAppMgr's arguments %r" % (stack, "UA" if agent else "no UA", argv))

        # The patches the bbappends name are beside them.
        for inc_path in (WAM_INC, WEBRUNTIME_INC):
            text = open(inc_path).read()
            names = re.findall(r"file://([^\s\"]+\.patch)", text)
            check(names, "%s names its patch" % os.path.relpath(inc_path, REPO))
            for n in names:
                p = os.path.join(os.path.dirname(inc_path), "files", n)
                check(os.path.isfile(p), "%s: %s is there" % (os.path.relpath(inc_path, REPO), n))
                if os.path.isfile(p):
                    check("Upstream-Status:" in open(p).read(), "%s has an Upstream-Status" % n)

# The web inspector only in Developer Mode, and then on the loopback only
# (conf.sh: webapp-mgr.sh.in turns --remote-debugging-port=9998 on for every
# image, and sources conf.sh after building WAM_SWITCHES).
UPSTREAM_SWITCHES = ("--no-sandbox --ozone-platform=wayland --remote-debugging-port=9998 "
                     "--user-data-dir=/var/lib/wam --webos-wam")
for SH in SHELLS:
    with tempfile.TemporaryDirectory() as tmp:
        flag = os.path.join(tmp, "dev-mode-enabled")
        for devmode in (False, True):
            if devmode:
                open(flag, "w").close()
            env = dict(os.environ, WAM_SWITCHES=UPSTREAM_SWITCHES, WAM_EXTRA_FLAGS="",
                       PHOENIX_DEVMODE_FLAG=flag, PHOENIX_DEVICE_JSON=os.path.join(tmp, "none.json"),
                       PHOENIX_UA_CLIENT_HINTS_FILE=os.path.join(tmp, "none"))
            script = ('. %s || :\nprintf "%%s\\n" "$WAM_SWITCHES" "${phoenix_wam_switches-unset}"\n'
                      % shlex.quote(CONF))
            out = subprocess.run(SH + ["-c", script], env=env, capture_output=True, text=True, check=True).stdout
            switches, leftover = out.rstrip("\n").split("\n")
            words = switches.split()
            what = "%s, Developer Mode %s" % (SH[0], "on" if devmode else "off")
            check([w for w in words if not w.startswith("--remote-debugging")]
                  == UPSTREAM_SWITCHES.replace(" --remote-debugging-port=9998", "").split(),
                  "%s: the other switches kept, in order, got %r" % (what, switches))
            if devmode:
                check("--remote-debugging-port=9998" in words and "--remote-debugging-address=127.0.0.1" in words,
                      "%s: the inspector on port 9998, loopback only, got %r" % (what, switches))
            else:
                check(not any(w.startswith("--remote-debugging") for w in words),
                      "%s: no inspector port, got %r" % (what, switches))
            check(leftover == "unset", "%s: conf.sh leaves no phoenix_wam_ names, got %r" % (what, leftover))

# The tile budget (conf.sh: Android's, 256 MB with 2,000 MB of memory or
# more, else 96, as every open card keeps its own; never below twelve
# screenfuls of the largest connected screen nor the start script's
# --force-gpu-mem-available-mb; a value that is not a plain number stays as
# it is).
GB = 1048576
GPU_CASES = [
    # (MemTotal kB, connectors as (name, status, first mode), start script's value, expected value)
    (3920000, [("card0-Virtual-1", "connected", "2560x1600")], "60", "256"),
    (3920000, [("card0-DSI-1", "connected", "1280x800")], "60", "256"),
    (2048000, [], "60", "256"),
    (2047999, [], "60", "96"),
    (1835008, [("card0-DSI-1", "connected", "720x1440")], "60", "96"),
    (1000000, [("card0-Virtual-1", "connected", "2560x1600")], "60", "188"),
    (1000000, [("card0-HDMI-A-1", "disconnected", "3840x2160"), ("card0-DSI-1", "connected", "1280x800")], "60", "96"),
    (1000000, [("card0-DSI-1", "connected", "1280x800"), ("card0-HDMI-A-1", "connected", "3840x2160i")], "60", "380"),
    (16 * GB, [("card0-HDMI-A-1", "connected", "7680x4320")], "60", "1519"),
    (3920000, [("card0-Virtual-1", "connected", "2560x1600")], "600", "600"),
    (3920000, [("card0-Virtual-1", "connected", "2560x1600")], "lots", "lots"),
    (1000000, [("card0-Virtual-1", "connected", "")], "60", "96"),
    (1000000, [("card0-Virtual-1", "connected", "x1600")], "60", "96"),
    (None, [], "60", "96"),
]
for SH in SHELLS:
    for mem_kb, conns, upstream, want in GPU_CASES:
        with tempfile.TemporaryDirectory() as tmp:
            drm = os.path.join(tmp, "drm")
            os.mkdir(drm)
            for name, status, mode in conns:
                d = os.path.join(drm, name)
                os.mkdir(d)
                open(os.path.join(d, "status"), "w").write(status + "\n")
                open(os.path.join(d, "modes"), "w").write((mode + "\n640x480\n") if mode else "")
            meminfo = os.path.join(tmp, "meminfo")
            open(meminfo, "w").write("MemTotal:       %s kB\nMemFree:         1234 kB\n" % mem_kb if mem_kb else "")
            switches = "--no-sandbox --force-gpu-mem-available-mb=%s --webos-wam" % upstream
            env = dict(os.environ, WAM_SWITCHES=switches, WAM_EXTRA_FLAGS="", PHOENIX_DRM_DIR=drm, PHOENIX_MEMINFO=meminfo,
                       PHOENIX_DEVMODE_FLAG=os.path.join(tmp, "none"),
                       PHOENIX_DEVICE_JSON=os.path.join(tmp, "none.json"),
                       PHOENIX_UA_CLIENT_HINTS_FILE=os.path.join(tmp, "none"))
            script = ('. %s || :\nprintf "%%s\\n" "$WAM_SWITCHES" "${phoenix_wam_gpu_mb-unset}"\n'
                      % shlex.quote(CONF))
            out = subprocess.run(SH + ["-c", script], env=env, capture_output=True, text=True, check=True).stdout
            got, leftover = out.rstrip("\n").split("\n")
            what = "%s, MemTotal %s kB, screens %r, start script %s" % (SH[0], mem_kb, conns, upstream)
            check(got.split() == ["--no-sandbox", "--force-gpu-mem-available-mb=" + want, "--webos-wam"],
                  "%s: --force-gpu-mem-available-mb=%s, got %r" % (what, want, got))
            check(leftover == "unset", "%s: conf.sh leaves no phoenix_wam_ names, got %r" % (what, leftover))

if failures:
    print("%d failed" % len(failures))
    sys.exit(1)
print("test-wam-user-agent: all passed (%s)" % ", ".join(" ".join(sh) for sh in SHELLS))
