#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Runs INSIDE the build container (see scripts/mac-build.sh):
# sets up webOS OSE in /work and builds webos-phoenix-image, taking the
# Phoenix shell from the mounted checkout so local edits are built.
#
# The checkout is never written to: the shell sources are synced into the
# build volume first (externalsrc would otherwise write into the checkout's
# .git to track changes).
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
mkdir -p "$LOCAL_SRC"
rsync -a --delete --exclude build/ "$SRC/shell/" "$LOCAL_SRC/shell/"
rsync -a "$SRC/LICENSE" "$LOCAL_SRC/LICENSE"

cat > "$BUILD_DIR/webos-local.conf" <<CONF
# Written by scripts/container-build.sh
INHERIT += "externalsrc"
EXTERNALSRC:pn-phoenix-shell = "$LOCAL_SRC/shell"
EXTERNALSRC_SYMLINKS = ""
CONF

cd "$BUILD_DIR"
# oe-init-build-env reads positional parameters and unset variables.
set --
set +u
. ./oe-init-build-env
set -u
# shellcheck disable=SC2086
bitbake ${BITBAKE_ARGS:-} "$TARGET"
echo
if [ -z "${BITBAKE_ARGS:-}" ]; then
    echo "Done. Images: $BUILD_DIR/BUILD/deploy/images/$MACHINE/"
else
    echo "Done (bitbake ${BITBAKE_ARGS})."
fi
