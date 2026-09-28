#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Runs INSIDE the build container (see scripts/mac-build.sh):
# sets up webOS OSE in /work and builds webos-phoenix-image, taking the
# Phoenix shell from the mounted checkout so local edits are built.
#
#   container-build.sh [MACHINE] [TARGET]      defaults: qemux86-64 webos-phoenix-image

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

# Build the shell from this checkout rather than fetching it from GitHub.
cat > "$BUILD_DIR/webos-local.conf" <<CONF
# Written by scripts/container-build.sh
INHERIT += "externalsrc"
EXTERNALSRC:pn-phoenix-shell = "$SRC/shell"
# Don't drop oe-workdir/oe-logs symlinks into the checkout.
EXTERNALSRC_SYMLINKS = ""
CONF

cd "$BUILD_DIR"
# oe-init-build-env reads positional parameters; clear them first.
set --
. ./oe-init-build-env
bitbake "$TARGET"
echo
echo "Done. Images: $BUILD_DIR/BUILD/deploy/images/$MACHINE/"
