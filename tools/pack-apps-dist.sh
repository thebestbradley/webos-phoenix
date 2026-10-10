#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Pack the built web apps for a device image:
#
#   tools/pack-apps-dist.sh OUT.tar.gz
#
# The image's phoenix-apps recipe installs the apps with
# tools/install-rootfs.py, which takes each React, Enact and Flutter app
# from its dist/ and the Node services' shared packages from their built
# lib/. BitBake may not use the network in do_compile, so the recipe does
# not run npm: build the apps here (cd apps && npm ci && npm run build; the
# Enact and Flutter demos as their READMEs say), pack them, and point the
# recipe at the archive in local.conf:
#
#   PHOENIX_APPS_DIST = "/path/to/OUT.tar.gz"
#
# It is unpacked over the checkout (paths are relative to the repository).
# CI packs one from every commit it builds (.github/workflows/ci.yml, the
# "apps-dist" artifact). Without it the recipe's do_install stops with
# "the app is not built" rather than leave the apps out of the image.

set -eu
REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:?usage: tools/pack-apps-dist.sh OUT.tar.gz}
case "$OUT" in /*) ;; *) OUT=$PWD/$OUT ;; esac
cd "$REPO_DIR"
set --
for d in apps/*/dist apps/shared/*/lib; do
    [ -d "$d" ] && set -- "$@" "$d"
done
[ $# -gt 0 ] || { echo "pack-apps-dist: nothing built (cd apps && npm run build)" >&2; exit 1; }
# Reproducible: sorted, no owners, the commit's time.
MTIME=$(git log -1 --format=%cI 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="$MTIME" -czf "$OUT" "$@"
echo "Packed $# directories into $OUT" >&2
