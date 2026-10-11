#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Runs INSIDE the build container (see scripts/mac-build.sh):
# sets up webOS OSE in /work and builds webos-phoenix-image, taking the
# Phoenix shell from the mounted checkout so local edits are built.
#
# The build never writes to the checkout: it is synced into the build
# volume first (externalsrc would otherwise write into the checkout's .git
# to track changes). Only the ARM64 VM's finished kernel and root image are
# copied out, to out/phoenix-vm-arm64/ (ignored by git), for scripts/vm.sh.
#
#   container-build.sh [MACHINE] [TARGET]      defaults: qemux86-64 webos-phoenix-image
#
# BITBAKE_ARGS adds bitbake options, e.g. BITBAKE_ARGS=-g to only resolve
# the dependency graph (a quick check that everything parses).

set -eu

SRC=$(cd "$(dirname "$0")/.." && pwd)
MACHINE=${1:-qemux86-64}
TARGET=${2:-webos-phoenix-image}
BUILD_DIR=/work/build-webos-phoenix

# Yocto needs a case-sensitive filesystem; /work must be the ext4 volume.
probe=/work/.case-probe
rm -f "$probe" "$probe-X"
touch "$probe" "$probe-X" 2>/dev/null || true
if [ ! -e "$probe-X" ] || [ -e "$(echo "$probe" | tr 'a-z' 'A-Z')" ]; then
    echo "error: /work is not a case-sensitive filesystem. Mount the ext4 build volume there." >&2
    exit 1
fi
rm -f "$probe" "$probe-X"

if [ ! -f "$BUILD_DIR/oe-init-build-env" ]; then
    "$SRC/scripts/setup-build.sh" "$BUILD_DIR" "$MACHINE"
fi

# Build the shell from a copy of this checkout rather than from GitHub.
# rsync only touches changed files, so unchanged sources don't rebuild.
LOCAL_SRC=/work/phoenix-src
if [ -z "$(ls -A "$SRC/third_party/enyo-1.0" 2>/dev/null)" ]; then
    echo "error: third_party/ is empty. Run 'git submodule update --init' in your checkout first." >&2
    exit 1
fi
mkdir -p "$LOCAL_SRC"
rsync -a --delete --exclude .git --exclude build/ --exclude node_modules/ "$SRC/" "$LOCAL_SRC/"

cat > "$BUILD_DIR/webos-local.conf" <<CONF
# Written by scripts/container-build.sh
INHERIT += "externalsrc"
EXTERNALSRC:pn-phoenix-shell = "$LOCAL_SRC/shell"
EXTERNALSRC:pn-phoenix-apps = "$LOCAL_SRC"
EXTERNALSRC_SYMLINKS = ""
CONF

cd "$BUILD_DIR"
# oe-init-build-env reads positional parameters and unset variables.
set --
set +u
. ./oe-init-build-env
set -u
# The machine asked for, whatever the build directory was first set up
# with (mcf writes that one into its configuration; oe-init-build-env lets
# MACHINE through from the environment).
export MACHINE
# shellcheck disable=SC2086
bitbake ${BITBAKE_ARGS:-} "$TARGET"
echo
if [ -z "${BITBAKE_ARGS:-}" ]; then
    echo "Done. Images: $BUILD_DIR/BUILD/deploy/images/$MACHINE/"
    # The ARM64 VM runs on the Mac (scripts/vm.sh): its kernel and root
    # image go to the checkout's out/phoenix-vm-arm64/, where vm.sh looks.
    if [ "$MACHINE" = phoenix-vm-arm64 ] && [ "$TARGET" = webos-phoenix-image ]; then
        deploy=$BUILD_DIR/BUILD/deploy/images/$MACHINE
        mkdir -p "$SRC/out/$MACHINE"
        cp -L "$deploy/Image" "$deploy/webos-phoenix-image-$MACHINE.rootfs.ext4" "$SRC/out/$MACHINE/"
        echo "Copied for scripts/vm.sh: out/$MACHINE/ (Image, webos-phoenix-image-$MACHINE.rootfs.ext4)"
    fi
else
    echo "Done (bitbake ${BITBAKE_ARGS})."
fi
