#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Parse and resolve webos-phoenix-image without building it: the first row
# of the device CI matrix (docs/HARDWARE.md, "Device CI matrix").
#
#   scripts/parse-check.sh [MACHINE...]     default: qemux86-64 raspberrypi4-64
#
# For each MACHINE it runs `bitbake -p` (parse every recipe) and
# `bitbake -n webos-phoenix-image torchd whisper-cpp phoenix-driver-feed` (a dry run: resolve the
# whole task graph, every DEPENDS and RDEPENDS, and run nothing). Nothing
# is fetched or built: the network is only used to clone build-webos and its
# layers (about 200 MB). Each machine adds about 300 MB (bitbake's parse
# cache and logs) and takes about 12 minutes on 4 cores.
#
# The layers are cloned without file history (commits only, files fetched
# for the pinned commit), at the commits build-webos pins, the same ones
# scripts/setup-build.sh uses. The meta-phoenix recipes take their source
# revision from this checkout's HEAD, so they parse without asking GitHub.
#
# Environment:
#   PHOENIX_PARSE_DIR     build directory (default: ${TMPDIR:-/tmp}/webos-phoenix-parse);
#                         keep it to rerun quickly, delete it to free the space
#   PHOENIX_PARSE_COMPRESS  firmware compression switches to resolve too, on the
#                         first MACHINE (default: "xz zstd"; "" for none): the
#                         image and linux-firmware again with
#                         PHOENIX_FIRMWARE_COMPRESS set to each
#   PHOENIX_PARSE_TARGET  what to resolve (default: webos-phoenix-image, plus
#                         the torchd stub, which is not in it, whisper-cpp and
#                         phoenix-driver-feed, the Hardware app's firmware packages)
#
# bitbake refuses to run as root (OE's sanity check, with no setting to
# allow it). As root, run it as an ordinary user, or in a user namespace
# that maps root to an ordinary uid (files stay root's):
#   unshare --user --map-user=1000 --map-group=1000 scripts/parse-check.sh

set -eu

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
BUILD_DIR=${PHOENIX_PARSE_DIR:-"${TMPDIR:-/tmp}/webos-phoenix-parse"}
TARGET=${PHOENIX_PARSE_TARGET:-webos-phoenix-image torchd whisper-cpp phoenix-driver-feed}
[ $# -gt 0 ] || set -- qemux86-64 raspberrypi4-64

if [ "$(id -u)" = 0 ]; then
    echo "error: bitbake does not run as root. Run this as an ordinary user, or:" >&2
    echo "  unshare --user --map-user=1000 --map-group=1000 $0 $*" >&2
    exit 1
fi

# 1. build-webos at the commit setup-build.sh pins, without history.
BUILD_WEBOS_URL=$(sed -n 's/^BUILD_WEBOS_URL=//p' "$REPO_DIR/scripts/setup-build.sh")
BUILD_WEBOS_COMMIT=$(sed -n 's/^BUILD_WEBOS_COMMIT=//p' "$REPO_DIR/scripts/setup-build.sh")
if [ ! -d "$BUILD_DIR/.git" ]; then
    mkdir -p "$BUILD_DIR"
    git -C "$BUILD_DIR" init -q
    git -C "$BUILD_DIR" remote add origin "$BUILD_WEBOS_URL"
fi
if [ "$(git -C "$BUILD_DIR" rev-parse -q --verify HEAD 2>/dev/null)" != "$BUILD_WEBOS_COMMIT" ]; then
    git -C "$BUILD_DIR" fetch -q --depth 1 origin "$BUILD_WEBOS_COMMIT"
    # setup-build.sh edits weboslayers.py; start from the pinned file.
    git -C "$BUILD_DIR" checkout -q -f FETCH_HEAD
fi

# 2. The layers weboslayers.py lists, at their pinned commits. mcf would
# clone each with its full history; a treeless clone of the
# one branch fetches only the commits, then the files of the pinned one.
python3 -u - "$BUILD_DIR" <<'PY'
import os, subprocess, sys
build = sys.argv[1]
sys.path.insert(0, build)
from weboslayers import webos_layers

def git(*args, cwd=None):
    subprocess.run(["git", *args], cwd=cwd, check=True)

seen = set()
for name, prio, url, submission, location in webos_layers:
    if not url or not submission:
        continue  # not cloned by mcf, or shares a checkout listed earlier
    loc = location or os.path.splitext(url.rstrip("/").split("/")[-1])[0]
    if loc in seen:
        continue
    seen.add(loc)
    opts = dict(kv.split("=", 1) for kv in submission.split(","))
    branch, ref = opts.get("branch", "master"), opts.get("commit") or opts.get("tag")
    path = os.path.join(build, loc)
    if os.path.isdir(os.path.join(path, ".git")):
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=path,
                              capture_output=True, text=True).stdout.strip()
        if ref and head.startswith(ref) or ref and subprocess.run(
                ["git", "rev-parse", "-q", "--verify", ref + "^{commit}"], cwd=path,
                capture_output=True, text=True).stdout.strip() == head:
            print(f"{loc}: {ref} (already there)")
            continue
        git("fetch", "-q", "--filter=tree:0", "origin", branch, cwd=path)
    else:
        print(f"{loc}: cloning {url} {branch}")
        git("clone", "-q", "--filter=tree:0", "--no-checkout", "--single-branch",
            "--branch", branch, url, path)
    git("-c", "advice.detachedHead=false", "checkout", "-q", "-B", branch, ref or f"origin/{branch}", cwd=path)
    print(f"{loc}: {ref or branch}")
PY

# 3. Add meta-phoenix and write the configuration (no layer updates).
MCF_COMMAND=configure "$REPO_DIR/scripts/setup-build.sh" "$BUILD_DIR" "$@"

# The recipes that build this repository take its HEAD instead of AUTOREV
# (which asks GitHub for the branch head while parsing). No network: a
# recipe that wants to fetch while parsing is an error here.
cat > "$BUILD_DIR/webos-local.conf" <<CONF
# Written by scripts/parse-check.sh
PHOENIX_SRCREV = "$(git -C "$REPO_DIR" rev-parse HEAD)"
BB_NO_NETWORK = "1"
# uninative is a download (a host-independent glibc for native tools);
# nothing is built here, so leave it out instead of warning about it.
INHERIT:remove = "uninative"
# The disk space monitor's limits (stop below 1-2 GB free) are for builds; a
# dry run writes only bitbake's caches, and the monitor would stop it on a
# full-ish disk with "No new tasks can be executed". (forcevariable: the
# webos distro sets it after this file.)
BB_DISKMON_DIRS:forcevariable = ""
CONF

# 4. Parse and resolve for each machine.
cd "$BUILD_DIR"
bb() (
    # oe-init-build-env reads unset variables.
    m=$1; shift; set +u
    . ./oe-init-build-env >/dev/null
    MACHINE=$m bitbake "$@"
)
COMPRESS=${PHOENIX_PARSE_COMPRESS-xz zstd}
first=$1
set -- "$@" --
failed=
summary=
while [ "$1" != -- ]; do
    m=$1; shift
    echo
    echo "=== $m: bitbake -p"
    log="$BUILD_DIR/parse-check-$m.log"
    if bb "$m" -p >"$log" 2>&1; then
        parse=ok
        echo "=== $m: bitbake -n $TARGET"
        # shellcheck disable=SC2086
        if bb "$m" -n $TARGET >>"$log" 2>&1; then
            dry=ok
        else
            dry=FAILED; failed=1
        fi
    else
        parse=FAILED; dry=skipped; failed=1
    fi
    grep -E '^(ERROR|WARNING):' "$log" | sort -u || true
    [ "$parse$dry" = okok ] || tail -n 30 "$log"
    summary="$summary$(printf '%-18s parse %-7s dry run %s' "$m" "$parse" "$dry")
"
done

# The firmware compression switch (meta-phoenix linux-firmware bbappend):
# resolve the image with it on, as a case of its own.
for c in $COMPRESS; do
    echo
    echo "=== $first, PHOENIX_FIRMWARE_COMPRESS = \"$c\": bitbake -n webos-phoenix-image linux-firmware"
    printf 'PHOENIX_FIRMWARE_COMPRESS = "%s"\n' "$c" > "$BUILD_DIR/parse-compress-$c.conf"
    log="$BUILD_DIR/parse-check-$first-compress-$c.log"
    if bb "$first" -R "$BUILD_DIR/parse-compress-$c.conf" -n webos-phoenix-image linux-firmware >"$log" 2>&1; then
        dry=ok
    else
        dry=FAILED; failed=1
        tail -n 30 "$log"
    fi
    summary="$summary$(printf '%-18s compress %-4s dry run %s' "$first" "$c" "$dry")
"
done

echo
echo "Summary ($TARGET; logs in $BUILD_DIR/parse-check-MACHINE.log):"
printf '%s' "$summary"
[ -z "$failed" ]
