#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Set up a webOS OSE build with meta-phoenix added.
#
#   scripts/setup-build.sh [BUILD_DIR] [MACHINE [MACHINE...]]
#
# Defaults: ../build-webos-phoenix, qemux86-64. Then:
#   cd BUILD_DIR && . ./oe-init-build-env && bitbake webos-phoenix-image
#
# webOS OSE builds need Ubuntu (see webosose.org system requirements),
# ~200 GB of disk and several hours on first build. macOS cannot run the
# build natively; use a Linux VM or a Linux build server.
#
# More than one MACHINE configures them all (the first is the default;
# MACHINE=... bitbake picks another). MCF_COMMAND=configure only writes the
# configuration, leaving the layer checkouts as they are (scripts/
# parse-check.sh fetches them itself, without history).

set -eu

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
BUILD_DIR=${1:-"$REPO_DIR/../build-webos-phoenix"}
MACHINE=${2:-qemux86-64}
[ $# -gt 2 ] && shift 2 || set --

# Pinned build-webos commit (webOS OSE master, 2025-03-27).
BUILD_WEBOS_URL=https://github.com/webosose/build-webos.git
BUILD_WEBOS_COMMIT=ae3601d8c003654290d33dc9bc9928bfe662e816

if [ ! -d "$BUILD_DIR/.git" ]; then
    git clone "$BUILD_WEBOS_URL" "$BUILD_DIR"
fi
cd "$BUILD_DIR"
git checkout -q "$BUILD_WEBOS_COMMIT"

# mcf only resolves layer paths relative to the build directory, so link
# this repository in and register meta-phoenix from there (empty URL means
# "don't clone"). Priority 60 puts it above meta-webos and the BSP layers.
ln -sfn "$REPO_DIR" webos-phoenix
if ! grep -q "'meta-phoenix'" weboslayers.py; then
    python3 - <<'PY'
path = "weboslayers.py"
src = open(path).read()
entry = "('meta-phoenix',              60, '', '', 'webos-phoenix'),\n"
start = src.index("webos_layers = [")
end = src.index("\n]", start)
open(path, "w").write(src[:end + 1] + entry + src[end + 1:])
PY
fi

# meta-phoenix's own machines (meta-phoenix/conf/machine: the Fairphone 6,
# the Odin 2 Portal, the PINE64 devices; docs/HARDWARE.md, "First targets"):
# mcf refuses a MACHINE that weboslayers.py's Machines does not list.
python3 - "$REPO_DIR/meta-phoenix/conf/machine" <<'PY'
import os, re, sys
path = "weboslayers.py"
src = open(path).read()
m = re.search(r"^Machines = \[(.*?)\]", src, re.M)
have = re.findall(r"'([^']+)'", m.group(1))
add = sorted(f[:-5] for f in os.listdir(sys.argv[1]) if f.endswith(".conf") and f[:-5] not in have)
if add:
    line = "Machines = [%s]" % ", ".join("'%s'" % x for x in have + add)
    open(path, "w").write(src[:m.start()] + line + src[m.end():])
PY

./mcf -p 0 -b 0 --command "${MCF_COMMAND:-update+configure}" "$MACHINE" "$@"
echo
echo "Ready. Next:"
echo "  cd $BUILD_DIR && . ./oe-init-build-env && bitbake webos-phoenix-image"
