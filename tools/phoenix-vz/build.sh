#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Build phoenix-vz (Apple silicon, macOS 13 or later) into OUT (default
# this folder): swiftc, then an ad hoc signature with the virtualization
# entitlement, which Virtualization.framework requires of any program.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${1:-$HERE}
swiftc -O -o "$OUT/phoenix-vz" "$HERE/main.swift" -framework Virtualization -framework AppKit
codesign -s - -f --entitlements "$HERE/phoenix-vz.entitlements" "$OUT/phoenix-vz"
echo "$OUT/phoenix-vz"
