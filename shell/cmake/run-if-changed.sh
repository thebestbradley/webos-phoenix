#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Runs a build command only when a file under DIR changed since it last
# succeeded (shell/CMakeLists.txt: the web apps' `npm run build`, which
# otherwise rebuilds every app on every build, about two minutes).
#
#   run-if-changed.sh STAMP DIR COMMAND...
#
# Changed: a file under DIR newer than STAMP, leaving out what the build
# writes and the packages (node_modules, dist, notes-core's lib); or
# node_modules/.package-lock.json newer (npm ci ran); or an app's dist/
# gone. STAMP takes the time the command started, so an edit made while it
# ran counts next time.

set -eu
stamp=$1
dir=$2
shift 2

if [ -f "$stamp" ]; then
    changed=$(find "$dir" \( -name node_modules -o -name dist -o -path "$dir/shared/notes-core/lib" \) -prune \
                   -o -type f -newer "$stamp" -print | head -n 1)
    [ "$dir/node_modules/.package-lock.json" -nt "$stamp" ] && changed=npm
    # DIR or its apps, each with a build script writing dist/ (not the
    # workspaces' root).
    for d in "$dir" "$dir"/*/; do
        d=${d%/}
        [ -f "$d/package.json" ] && ! grep -q '"workspaces"' "$d/package.json" && grep -q '"build":' "$d/package.json" \
            && [ ! -d "$d/dist" ] && changed=dist
    done
    if [ -z "$changed" ]; then
        echo "$(basename "$dir"): up to date"
        exit 0
    fi
fi
mkdir -p "$(dirname "$stamp")"
touch "$stamp.new"
"$@"
mv "$stamp.new" "$stamp"
