#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Builds the installable app into dist/: Flutter's web build (dart2js and
# the CanvasKit renderer), with CanvasKit bundled rather than fetched from
# Google's CDN, so it runs offline on a device.
#
#   tool/build.sh            (needs flutter on PATH, or FLUTTER=/path/to/flutter)
#
# Flutter copies every renderer it has into canvaskit/, but a dart2js
# CanvasKit build loads only canvaskit.{js,wasm} or, in Chromium,
# chromium/canvaskit.{js,wasm} (flutter_bootstrap.js; the "builds" list in
# _flutter.buildConfig names canvaskit alone). Skwasm, skwasm_heavy and wimp
# are for --wasm builds, webparagraph is opt-in, and *.symbols are debug
# symbols: about 25 MB the app never reads, so they are left out.
set -eu
cd "$(dirname "$0")/.."
FLUTTER="${FLUTTER:-flutter}"
"$FLUTTER" build web --release --no-web-resources-cdn --no-source-maps --no-wasm-dry-run --output "$PWD/dist"
rm -rf dist/canvaskit/skwasm.* dist/canvaskit/skwasm_heavy.* dist/canvaskit/wimp.* dist/canvaskit/webparagraph
find dist/canvaskit -name '*.symbols' -delete
