#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Tests shell/cmake/run-if-changed.sh, which runs the web apps' build only
# when a file in apps/ changed since it last ran: what the build itself
# writes must not count, or every build rebuilds every app (a minute or
# two) and a no-op ./phoenix is never the two seconds it should be.
#
#   sh tools/test-run-if-changed.sh

set -u
REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
RUN="$REPO_DIR/shell/cmake/run-if-changed.sh"
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
failures=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }

# A pretend apps/: workspaces' root, an app writing dist/, and shared
# packages whose tsc builds write elsewhere (tsconfig.build.json's outDir).
A=$ROOT/apps
mkdir -p "$A/node_modules" "$A/app/src" "$A/app/dist" "$A/shared/kit/src" "$A/shared/core/src" "$A/shared/dart/lib"
echo '{"workspaces": ["app", "shared/*"]}' > "$A/package.json"
echo '{}' > "$A/node_modules/.package-lock.json"
echo '{"scripts": {"build": "vite build"}}' > "$A/app/package.json"
echo '{"scripts": {"build": "tsc -p tsconfig.build.json"}}' > "$A/shared/kit/package.json"
printf '{\n  "compilerOptions": {\n    "outDir": "lib",\n    "rootDir": "src"\n  }\n}\n' > "$A/shared/kit/tsconfig.build.json"
echo '{"scripts": {"build": "tsc -p tsconfig.build.json"}}' > "$A/shared/core/package.json"
echo '{"compilerOptions": {"outDir": "./out/js"}}' > "$A/shared/core/tsconfig.build.json"
echo 'x' > "$A/app/src/a.ts"; echo 'x' > "$A/shared/dart/lib/main.dart"
touch -t 202001010000 "$A/node_modules/.package-lock.json"
STAMP=$ROOT/build/apps.stamp

# The build as it runs: a moment later (the stamp takes its start time),
# writes each package's outDir and the app's dist/.
BUILD="sleep 1; mkdir -p '$A/shared/kit/lib' '$A/shared/core/out/js'; echo b > '$A/shared/kit/lib/index.js'; echo b > '$A/shared/core/out/js/index.js'; echo b > '$A/app/dist/index.js'; echo built"
sh "$RUN" "$STAMP" "$A" sh -c "$BUILD" > "$ROOT/out" 2>&1
grep -q built "$ROOT/out" && pass "first run builds" || fail "first run builds: $(cat "$ROOT/out")"
sleep 1
sh "$RUN" "$STAMP" "$A" sh -c "$BUILD" > "$ROOT/out" 2>&1
grep -q "up to date" "$ROOT/out" && pass "what the build wrote (outDir lib, ./out/js, dist) does not count" \
    || fail "what the build wrote does not count: $(cat "$ROOT/out")"
sleep 1
echo y > "$A/shared/dart/lib/main.dart"
sh "$RUN" "$STAMP" "$A" sh -c "$BUILD" > "$ROOT/out" 2>&1
grep -q built "$ROOT/out" && pass "a source in a lib/ that is no outDir counts" || fail "a source in lib/ counts: $(cat "$ROOT/out")"
sleep 1
echo y > "$A/shared/kit/src/a.ts"
sh "$RUN" "$STAMP" "$A" sh -c "$BUILD" > "$ROOT/out" 2>&1
grep -q built "$ROOT/out" && pass "a shared package's source counts" || fail "a shared package's source counts: $(cat "$ROOT/out")"

[ $failures = 0 ] && echo "All passed." || { echo "$failures failed."; exit 1; }
