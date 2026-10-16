#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Runs INSIDE the build container (see scripts/mac-build.sh): sets up the
# layers in /work and builds webos-phoenix-image, taking the Phoenix shell
# and apps from the mounted checkout so local edits are built.
#
# The build never writes to the checkout: it is synced into the build
# volume first (externalsrc would otherwise write into the checkout's .git
# to track changes). Only the ARM64 VM's finished kernel and root image are
# copied out, to out/phoenix-vm-arm64/ (ignored by git), for scripts/vm.sh
# and scripts/make-utm.sh.
#
#   container-build.sh [MACHINE] [TARGET]      defaults: qemux86-64 webos-phoenix-image
#
# PHOENIX_STACK picks the layers (scripts/mac-build.sh --stack):
#   ose (default)  webOS OSE's build-webos (scripts/setup-build.sh), in
#                  /work/build-webos-phoenix, set up on the first run
#   luneos         LuneOS's layers (scripts/setup-build-luneos.sh), in
#                  /work/build-phoenix-luneos, brought to the pins in
#                  scripts/luneos-layers.txt on every run (a layer already
#                  at its pin is left alone, without the network)
# BITBAKE_ARGS adds bitbake options, e.g. BITBAKE_ARGS=-g to only resolve
# the dependency graph (a quick check that everything parses).
# PHOENIX_WORK is the build volume (default /work).

set -eu

SRC=$(cd "$(dirname "$0")/.." && pwd)
MACHINE=${1:-qemux86-64}
TARGET=${2:-webos-phoenix-image}
STACK=${PHOENIX_STACK:-ose}
WORK=${PHOENIX_WORK:-/work}

# Each stack: its build directory, the local configuration file its
# conf/local.conf includes, and its TMPDIR, where deploy/images is.
case $STACK in
    ose)
        BUILD_DIR=$WORK/build-webos-phoenix
        # build-webos build-templates/local-conf.in:130 (TMPDIR) and :480 (include)
        LOCAL_CONF=webos-local.conf
        TMP=BUILD
        ;;
    luneos)
        BUILD_DIR=$WORK/build-phoenix-luneos
        # setup-build-luneos.sh's conf/local.conf includes it; TMPDIR is
        # oe-core's default (wrynose bitbake.conf:405, without the
        # "-glibc" scarthgap appended: TCLIBCAPPEND is gone, :109), which
        # LuneOS's distro keeps.
        LOCAL_CONF=phoenix-local.conf
        TMP=tmp
        ;;
    *) echo "error: PHOENIX_STACK is ose or luneos, not \"$STACK\"" >&2; exit 2 ;;
esac
DEPLOY=$BUILD_DIR/$TMP/deploy/images/$MACHINE

# Yocto needs a case-sensitive filesystem; the build volume must be ext4.
probe=$WORK/.case-probe
rm -f "$probe" "$probe-X"
touch "$probe" "$probe-X" 2>/dev/null || true
if [ ! -e "$probe-X" ] || [ -e "$(echo "$probe" | tr 'a-z' 'A-Z')" ]; then
    echo "error: $WORK is not a case-sensitive filesystem. Mount the ext4 build volume there." >&2
    exit 1
fi
rm -f "$probe" "$probe-X"

if [ -z "$(ls -A "$SRC/third_party/enyo-1.0" 2>/dev/null)" ]; then
    echo "error: third_party/ is empty. Run 'git submodule update --init' in your checkout first." >&2
    exit 1
fi

if [ "$STACK" = luneos ]; then
    "$SRC/scripts/setup-build-luneos.sh" "$BUILD_DIR" "$MACHINE"
elif [ ! -f "$BUILD_DIR/oe-init-build-env" ]; then
    "$SRC/scripts/setup-build.sh" "$BUILD_DIR" "$MACHINE"
fi

# Build the shell and apps from a copy of this checkout rather than from
# GitHub. rsync only touches changed files, so unchanged sources don't
# rebuild. Not out/ (this script's own output: images and UTM bundles,
# gigabytes) or .claude/ (worktrees): phoenix-apps' source is the whole
# copy, and externalsrc checksums every file in it (externalsrc.bbclass,
# srctree_hash_files), so either would be read on each run and rebuild
# the apps whenever it changed.
LOCAL_SRC=$WORK/phoenix-src
mkdir -p "$LOCAL_SRC"
rsync -a --delete --delete-excluded --exclude .git --exclude build/ --exclude node_modules/ \
    --exclude /out/ --exclude /.claude/ "$SRC/" "$LOCAL_SRC/"

# The image takes the web apps as built in the checkout (phoenix-apps runs
# tools/install-rootfs.py, which stops at the first app that is not): say
# so now rather than an hour into the build.
if [ -z "${BITBAKE_ARGS:-}" ] && [ "$TARGET" = webos-phoenix-image ] &&
   ! python3 -B "$LOCAL_SRC/tools/install-rootfs.py" --list /dev/null >/dev/null; then
    echo "error: the image needs the web apps built in your checkout: ./phoenix, or cd apps && npm ci && npm run build" >&2
    exit 1
fi

cat > "$BUILD_DIR/$LOCAL_CONF" <<CONF
# Written by scripts/container-build.sh
INHERIT += "externalsrc"
EXTERNALSRC:pn-phoenix-shell = "$LOCAL_SRC/shell"
EXTERNALSRC:pn-phoenix-apps = "$LOCAL_SRC"
EXTERNALSRC_SYMLINKS = ""
CONF

cd "$BUILD_DIR"
# The environment scripts read positional parameters and unset variables.
set --
set +u
if [ "$STACK" = luneos ]; then
    # shellcheck disable=SC1091  # written by setup-build-luneos.sh
    . ./setup-env
else
    . ./oe-init-build-env
fi
set -u
# The machine asked for, whatever the build directory was first set up
# with (mcf and setup-build-luneos.sh write that one into its
# configuration; both environments let MACHINE through).
export MACHINE
# shellcheck disable=SC2086
bitbake ${BITBAKE_ARGS:-} "$TARGET"
echo
if [ -z "${BITBAKE_ARGS:-}" ]; then
    echo "Done ($STACK layers). Images: $DEPLOY/"
    # The ARM64 VM runs on the Mac (scripts/vm.sh, scripts/make-utm.sh): its
    # kernel and root image go to the checkout's out/phoenix-vm-arm64/,
    # where they look. The same names on both stacks: the kernel's
    # KERNEL_IMAGETYPE link and the image's IMAGE_LINK_NAME
    # (kernel-artifact-names.bbclass, image-artifact-names.bbclass).
    if [ "$MACHINE" = phoenix-vm-arm64 ] && [ "$TARGET" = webos-phoenix-image ]; then
        mkdir -p "$SRC/out/$MACHINE"
        cp -L "$DEPLOY/Image" "$DEPLOY/webos-phoenix-image-$MACHINE.rootfs.ext4" "$SRC/out/$MACHINE/"
        echo "Copied for scripts/vm.sh and scripts/make-utm.sh: out/$MACHINE/ (Image, webos-phoenix-image-$MACHINE.rootfs.ext4; $STACK layers)"
    fi
else
    echo "Done (bitbake ${BITBAKE_ARGS}; $STACK layers)."
fi
