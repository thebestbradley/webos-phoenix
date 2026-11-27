#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Build "Phoenix VM Location.app" (VMLocation.swift) into OUT (default
# out/), signed for this Mac only (ad hoc). Core Location asks the user once,
# the first time it runs, whether it may have this Mac's position.
#
#   tools/vm-location/build.sh [OUT]
#   open "out/Phoenix VM Location.app"     # or run Contents/MacOS/vm-location --verbose
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${1:-$HERE/../../out}
APP="$OUT/Phoenix VM Location.app"
[ "$(uname -s)" = Darwin ] || { echo "build.sh: macOS only" >&2; exit 1; }
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"
xcrun swiftc -O -o "$APP/Contents/MacOS/vm-location" "$HERE/VMLocation.swift" \
    -framework AppKit -framework CoreLocation -framework Network
codesign --force --sign - "$APP"
echo "build.sh: $APP"
