#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The Mac's image build (docs/BUILDING-MAC.md) without a Mac or a build:
# scripts/mac-build.sh with stand-ins for Apple's `container` and macOS's
# sysctl (what it would start, for each stack and mode), and
# scripts/container-build.sh in a temporary build volume with a stand-in
# for bitbake: the layers' configuration it writes for each stack
# (setup-build-luneos.sh's for real, without fetching the layers:
# PHOENIX_LUNEOS_COMMAND=configure), the environment bitbake runs in, and
# where the ARM64 VM's kernel and root image are copied from.
#
#   python3 tools/test-mac-build.py

import os
import shutil
import stat
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
failures = []
checks = 0


def check(name, ok, detail=""):
    global checks
    checks += 1
    if not ok:
        failures.append(name)
        print("FAIL %s%s" % (name, (": " + str(detail)) if detail else ""))
    return ok


def write(path, text, mode=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)
    if mode:
        os.chmod(path, mode)


def read(path):
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return ""


def stub(bindir, name, body):
    write(os.path.join(bindir, name), "#!/bin/sh\n" + body, 0o755)


def run(cmd, env, cwd=None):
    p = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=cwd)
    return p.returncode, p.stdout, p.stderr


TMP = tempfile.mkdtemp(prefix="test-mac-build-")
try:
    # ---- scripts/mac-build.sh: a pretend Mac ----------------------------------
    # `container` logs each call, one per line; `image inspect` fails when
    # $T/no-image exists (the image is built then). sysctl: 12 CPUs, 32 GB.
    MAC = os.path.join(TMP, "mac")
    BIN = os.path.join(MAC, "bin")
    LOG = os.path.join(MAC, "container.log")
    stub(BIN, "container", 'echo "$*" >> "%s"\n'
         'case "$1 $2" in "image inspect") [ ! -e "%s/no-image" ] ;; *) exit 0 ;; esac\n' % (LOG, MAC))
    stub(BIN, "sysctl", 'case "$2" in hw.ncpu) echo 12 ;; hw.memsize) echo 34359738368 ;; esac\n')
    base_env = {k: v for k, v in os.environ.items() if not k.startswith("PHOENIX_")}
    base_env["PATH"] = BIN + os.pathsep + base_env.get("PATH", "")

    def mac(args, stack_env=None):
        if os.path.exists(LOG):
            os.remove(LOG)
        env = dict(base_env)
        if stack_env is not None:
            env["PHOENIX_STACK"] = stack_env
        code, out, err = run(["sh", os.path.join(REPO, "scripts", "mac-build.sh")] + args, env)
        calls = read(LOG).splitlines()
        runs = [c for c in calls if c.startswith("run -it ")]
        return code, out, err, calls, (runs[-1] if runs else "")

    cases = [
        ([], None, "ose", "container-build.sh qemux86-64 webos-phoenix-image", False),
        (["phoenix-vm-arm64"], None, "ose", "container-build.sh phoenix-vm-arm64 webos-phoenix-image", False),
        (["--stack", "luneos", "phoenix-vm-arm64"], None, "luneos",
         "container-build.sh phoenix-vm-arm64 webos-phoenix-image", False),
        (["--stack=luneos", "raspberrypi4-64", "phoenix-shell"], None, "luneos",
         "container-build.sh raspberrypi4-64 phoenix-shell", False),
        (["phoenix-vm-arm64"], "luneos", "luneos", "container-build.sh phoenix-vm-arm64 webos-phoenix-image", False),
        (["--stack", "ose", "phoenix-vm-arm64"], "luneos", "ose",
         "container-build.sh phoenix-vm-arm64 webos-phoenix-image", False),
        (["--check"], None, "ose", "container-build.sh qemux86-64 webos-phoenix-image", True),
        (["--stack", "luneos", "--check"], None, "luneos", "container-build.sh qemux86-64 webos-phoenix-image", True),
        (["--check", "--stack", "luneos", "phoenix-vm-arm64"], None, "luneos",
         "container-build.sh phoenix-vm-arm64 webos-phoenix-image", True),
        (["--shell"], "luneos", "luneos", "/bin/bash", False),
    ]
    for args, env_stack, stack, command, graph in cases:
        tag = "mac-build.sh %s%s" % ("PHOENIX_STACK=%s " % env_stack if env_stack else "", " ".join(args) or "(no arguments)")
        code, out, err, calls, line = mac(args, env_stack)
        if not check("%s: starts the build container" % tag, code == 0 and line, err or calls):
            continue
        check("%s: the %s layers" % (tag, stack), " --env PHOENIX_STACK=%s " % stack in line
              and line.count("PHOENIX_STACK") == 1, line)
        full = command if command.startswith("/") else "/src/webos-phoenix/scripts/" + command
        check("%s: runs %s" % (tag, command), line.endswith(" " + full), line)
        check("%s: %s" % (tag, "only resolves the graph (-g)" if graph else "a full build"),
              (" --env BITBAKE_ARGS=-g " in line) == graph, line)
        check("%s: the volume, the checkout, the machine's share" % tag,
              " --volume webos-phoenix-work:/work " in line and " --volume %s:/src/webos-phoenix " % REPO in line
              and " --cpus 10 --memory 24g " in line, line)
        check("%s: says which layers" % tag, "Starting build container: %s layers," % stack in out, out)

    # The build image is named after its Containerfile: a changed package
    # list builds a new one.
    cksum = subprocess.run("cksum < '%s'" % os.path.join(REPO, "tools", "build-container", "Containerfile"),
                           shell=True, capture_output=True, text=True).stdout.split()[0]
    image = "webos-phoenix-build:" + cksum
    write(os.path.join(MAC, "no-image"), "")
    code, out, err, calls, line = mac(["--stack", "luneos", "phoenix-vm-arm64"])
    check("mac-build.sh without the build image: builds it, tagged with the Containerfile's checksum",
          any(c.startswith("build --arch amd64 --tag %s --file %s" % (image, os.path.join(REPO, "tools", "build-container",
                                                                                           "Containerfile")))
              for c in calls), calls)
    check("mac-build.sh: runs that image", (" %s /src/webos-phoenix/scripts/container-build.sh" % image) in line, line)
    os.remove(os.path.join(MAC, "no-image"))
    code, out, err, calls, line = mac(["phoenix-vm-arm64"])
    check("mac-build.sh with the build image: does not build it again", not any(c.startswith("build ") for c in calls), calls)

    # What it refuses, before starting anything.
    for args, env_stack, says in [
        (["--stack", "yocto"], None, 'the stack is ose or luneos, not "yocto"'),
        ([], "webos", 'the stack is ose or luneos, not "webos"'),
        (["--stack"], None, "--stack needs ose or luneos"),
        (["--check", "qemux86-64", "raspberrypi4-64"], None, "--check takes one MACHINE at most"),
        (["--shell", "qemux86-64"], None, "--shell takes no arguments"),
        (["phoenix-vm-arm64", "webos-phoenix-image", "extra"], None, "too many arguments"),
        (["--fresh"], None, "unknown option --fresh"),
    ]:
        tag = "mac-build.sh %s%s" % ("PHOENIX_STACK=%s " % env_stack if env_stack else "", " ".join(args) or "(no arguments)")
        code, out, err, calls, line = mac(args, env_stack)
        check("%s: refused (%s), nothing started" % (tag, says), code == 2 and says in err and not calls, (code, err, calls))
    code, out, err, calls, line = mac(["--help"])
    check("mac-build.sh --help: the usage, with --stack, without starting anything",
          code == 0 and "--stack S" in out and "luneos  LuneOS's layer stack" in out and not calls, (code, out, calls))

    # ---- scripts/container-build.sh: a pretend build volume -------------------
    # A checkout with the build scripts (container-build.sh resolves the
    # setup scripts beside itself), meta-phoenix, a submodule, and an
    # install-rootfs.py that says whether the apps are built.
    CO = os.path.join(TMP, "checkout")
    for f in ("container-build.sh", "setup-build-luneos.sh", "setup-build.sh", "luneos-layers.txt"):
        dst = os.path.join(CO, "scripts", f)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(REPO, "scripts", f), dst)
    os.symlink(os.path.join(REPO, "meta-phoenix"), os.path.join(CO, "meta-phoenix"))
    write(os.path.join(CO, "third_party", "enyo-1.0", "README"), "enyo\n")
    write(os.path.join(CO, "shell", "CMakeLists.txt"), "# the shell\n")
    write(os.path.join(CO, "tools", "install-rootfs.py"),
          "import os, sys\n"
          "if not os.path.exists(os.path.join(os.path.dirname(__file__), '..', 'apps', 'built')):\n"
          "    sys.exit('apps/agenda: the app is not built (no dist/appinfo.json; cd apps && npm run build)')\n")
    # What the copy must leave out: the script's own output, worktrees.
    write(os.path.join(CO, "out", "phoenix-vm-arm64", "old.ext4"), "an old image\n")
    write(os.path.join(CO, ".claude", "worktrees", "x", "README"), "a worktree\n")

    # bitbake: logs where it runs and with what, then makes what a build
    # deploys, as the real ones do: a versioned file, and the links
    # container-build.sh copies through.
    BB_BIN = os.path.join(TMP, "bb-bin")
    BB_LOG = os.path.join(TMP, "bitbake.log")
    stub(BB_BIN, "bitbake",
         'echo "pwd=$PWD args=$* MACHINE=$MACHINE passthrough=${BB_ENV_PASSTHROUGH_ADDITIONS:+yes} ose=${OSE_ENV:-no}"'
         ' >> "%s"\n'
         'case " $* " in *" -g "*) exit 0 ;; esac\n'
         'tmp=tmp; [ -n "${OSE_ENV:-}" ] && tmp=BUILD\n'
         'd=$PWD/$tmp/deploy/images/$MACHINE; mkdir -p "$d"\n'
         'echo "kernel $MACHINE" > "$d/Image-6.18-r0-$MACHINE-wrynose-1.bin"\n'
         'ln -sf "Image-6.18-r0-$MACHINE-wrynose-1.bin" "$d/Image"\n'
         'echo "root $MACHINE" > "$d/webos-phoenix-image-$MACHINE.rootfs-wrynose-1.ext4"\n'
         'ln -sf "webos-phoenix-image-$MACHINE.rootfs-wrynose-1.ext4" "$d/webos-phoenix-image-$MACHINE.rootfs.ext4"\n'
         % BB_LOG)

    def build(work, args, stack=None, extra=None):
        for p in (BB_LOG,):
            if os.path.exists(p):
                os.remove(p)
        env = {k: v for k, v in os.environ.items() if not k.startswith(("PHOENIX_", "BB_", "BITBAKE"))}
        env.update({"PATH": BB_BIN + os.pathsep + env.get("PATH", ""), "PHOENIX_WORK": work,
                    "PHOENIX_LUNEOS_COMMAND": "configure"})
        if stack:
            env["PHOENIX_STACK"] = stack
        env.update(extra or {})
        code, out, err = run(["sh", os.path.join(CO, "scripts", "container-build.sh")] + args, env)
        return code, out, err, read(BB_LOG).splitlines()

    # LuneOS's layers, the ARM64 VM: the image for vm.sh and make-utm.sh.
    WORK = os.path.join(TMP, "work")
    os.makedirs(os.path.join(WORK, "phoenix-src", "out"))
    write(os.path.join(WORK, "phoenix-src", "out", "stale.ext4"), "copied by an older container-build.sh\n")
    write(os.path.join(CO, "apps", "built"), "")
    code, out, err, bb = build(WORK, ["phoenix-vm-arm64"], "luneos")
    tag = "container-build.sh phoenix-vm-arm64 on LuneOS's layers"
    BD = os.path.join(WORK, "build-phoenix-luneos")
    if check("%s: builds" % tag, code == 0 and len(bb) == 1, (code, out[-2000:], err[-2000:], bb)):
        check("%s: bitbake in its own build directory, the machine, LuneOS's environment" % tag,
              bb[0] == "pwd=%s args=webos-phoenix-image MACHINE=phoenix-vm-arm64 passthrough=yes ose=no" % BD, bb[0])
    local = read(os.path.join(BD, "conf", "local.conf"))
    check("%s: setup-build-luneos.sh's configuration: LuneOS's distro, the machine" % tag,
          'DISTRO ?= "luneos"' in local and 'MACHINE ??= "phoenix-vm-arm64"' in local
          and local.rstrip().endswith("include phoenix-local.conf"), local)
    check("%s: the build's codename, the layers' branch, not git's <unknown>" % tag,
          'WEBOS_DISTRO_TOPDIR_BRANCH = "wrynose"' in local, local)
    check("%s: Chromium and V8 a job per CPU, not LuneOS's 64 and 48" % tag,
          'PARALLEL_MAKE:pn-webruntime-clang = "-j ${@oe.utils.cpu_count()}"' in local
          and 'PARALLEL_MAKE:pn-mksnapshot-cross-${TARGET_ARCH} = "-j ${@oe.utils.cpu_count()}"' in local, local)
    check("%s: meta-phoenix first in the layers" % tag,
          "${TOPDIR}/meta-phoenix \\\n  ${TOPDIR}/meta-webos-ports/meta-luneos-holdbacks-5.3" in
          read(os.path.join(BD, "conf", "bblayers.conf")), read(os.path.join(BD, "conf", "bblayers.conf")))
    conf = read(os.path.join(BD, "phoenix-local.conf"))
    src = os.path.join(WORK, "phoenix-src")
    check("%s: the shell and apps from the checkout's copy (phoenix-local.conf, which local.conf includes)" % tag,
          'EXTERNALSRC:pn-phoenix-shell = "%s/shell"' % src in conf and 'EXTERNALSRC:pn-phoenix-apps = "%s"' % src in conf
          and 'INHERIT += "externalsrc"' in conf, conf)
    check("%s: no OSE build directory, no webos-local.conf" % tag,
          not os.path.exists(os.path.join(WORK, "build-webos-phoenix")) and not os.path.exists(os.path.join(BD, "webos-local.conf")))
    check("%s: the copy has the sources" % tag, os.path.exists(os.path.join(src, "shell", "CMakeLists.txt")))
    check("%s: the copy leaves out out/ and .claude/, and drops an older copy's out/" % tag,
          not os.path.exists(os.path.join(src, "out")) and not os.path.exists(os.path.join(src, ".claude")),
          sorted(os.listdir(src)))
    vm = os.path.join(CO, "out", "phoenix-vm-arm64")
    kernel, root = os.path.join(vm, "Image"), os.path.join(vm, "webos-phoenix-image-phoenix-vm-arm64.rootfs.ext4")
    check("%s: the kernel and root image from tmp/deploy, as files, where vm.sh and make-utm.sh look" % tag,
          read(kernel) == "kernel phoenix-vm-arm64\n" and read(root) == "root phoenix-vm-arm64\n"
          and not os.path.islink(kernel) and not os.path.islink(root), sorted(os.listdir(vm)) if os.path.isdir(vm) else vm)
    check("%s: says where the images are, and which layers" % tag,
          "Done (luneos layers). Images: %s/tmp/deploy/images/phoenix-vm-arm64/" % BD in out
          and "Copied for scripts/vm.sh and scripts/make-utm.sh: out/phoenix-vm-arm64/" in out
          and "luneos layers)" in out, out[-800:])
    check("%s: vm.sh finds them" % tag,
          run(["sh", os.path.join(REPO, "scripts", "vm.sh"), "pinetab2", "--image", vm, "--dry-run"],
              dict(os.environ, PHOENIX_VM_HOST_OS="Darwin", PHOENIX_VM_HOST_ARCH="arm64",
                   XDG_STATE_HOME=os.path.join(TMP, "state")))[0] == 0)

    # The quick check on LuneOS's layers: the graph only, nothing copied.
    shutil.rmtree(vm)
    code, out, err, bb = build(WORK, ["phoenix-vm-arm64"], "luneos", {"BITBAKE_ARGS": "-g"})
    tag = "container-build.sh phoenix-vm-arm64 with BITBAKE_ARGS=-g on LuneOS's layers"
    check("%s: bitbake -g, nothing copied" % tag,
          code == 0 and bb == ["pwd=%s args=-g webos-phoenix-image MACHINE=phoenix-vm-arm64 passthrough=yes ose=no" % BD]
          and not os.path.exists(vm) and "Done (bitbake -g; luneos layers)." in out, (code, bb, err[-1000:]))

    # The web apps not built: a real build stops before bitbake; the quick
    # check does not need them.
    os.remove(os.path.join(CO, "apps", "built"))
    code, out, err, bb = build(WORK, ["phoenix-vm-arm64"], "luneos")
    check("container-build.sh with the apps not built: stops before bitbake, and says how to build them",
          code == 1 and not bb and "apps/agenda: the app is not built" in err
          and "./phoenix, or cd apps && npm ci && npm run build" in err, (code, bb, err[-1000:]))
    code, out, err, bb = build(WORK, ["pinetab2"], "luneos", {"BITBAKE_ARGS": "-g"})
    check("container-build.sh --check's graph with the apps not built: runs",
          code == 0 and len(bb) == 1 and "args=-g webos-phoenix-image MACHINE=pinetab2" in bb[0], (code, bb, err[-1500:]))
    write(os.path.join(CO, "apps", "built"), "")

    # OSE's build-webos (the default): its own directory, webos-local.conf,
    # BUILD/deploy. A directory set up already (setup-build.sh would clone
    # build-webos), with an oe-init-build-env that marks the environment.
    OSE_WORK = os.path.join(TMP, "work-ose")
    OBD = os.path.join(OSE_WORK, "build-webos-phoenix")
    write(os.path.join(OBD, "oe-init-build-env"), 'OSE_ENV=1; export OSE_ENV; cd "%s"\n' % OBD)
    code, out, err, bb = build(OSE_WORK, ["phoenix-vm-arm64"])
    tag = "container-build.sh phoenix-vm-arm64 on OSE's layers (no PHOENIX_STACK)"
    check("%s: bitbake in OSE's build directory, with its environment" % tag,
          code == 0 and bb == ["pwd=%s args=webos-phoenix-image MACHINE=phoenix-vm-arm64 passthrough= ose=1" % OBD],
          (code, bb, err[-1500:]))
    check("%s: webos-local.conf, not LuneOS's directory" % tag,
          'EXTERNALSRC:pn-phoenix-apps = "%s/phoenix-src"' % OSE_WORK in read(os.path.join(OBD, "webos-local.conf"))
          and not os.path.exists(os.path.join(OSE_WORK, "build-phoenix-luneos")))
    check("%s: the kernel and root image from BUILD/deploy" % tag,
          read(os.path.join(vm, "Image")) == "kernel phoenix-vm-arm64\n"
          and read(os.path.join(vm, "webos-phoenix-image-phoenix-vm-arm64.rootfs.ext4")) == "root phoenix-vm-arm64\n"
          and "Done (ose layers). Images: %s/BUILD/deploy/images/phoenix-vm-arm64/" % OBD in out, out[-800:])

    code, out, err, bb = build(WORK, ["phoenix-vm-arm64"], "yocto")
    check("container-build.sh with PHOENIX_STACK=yocto: refused before anything",
          code == 2 and 'PHOENIX_STACK is ose or luneos, not "yocto"' in err and not bb, (code, err))
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print("%d checks, %d failed" % (checks, len(failures)))
sys.exit(1 if failures else 0)
