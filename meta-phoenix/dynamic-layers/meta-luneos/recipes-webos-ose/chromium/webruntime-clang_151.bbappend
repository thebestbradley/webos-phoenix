# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Client hints that agree with Phoenix's user agent (phoenix-webruntime.inc).
# Both recipes: webruntime-clang_151.bb requires webruntime_151.bb, which
# does not bring the other's bbappends; LuneOS builds the -clang one
# (WEBRUNTIME_TOOLCHAIN, luneos-preferred-providers.inc).

require phoenix-webruntime.inc

# GN's clang_x64 helper binaries do not consistently inherit BUILD_LDFLAGS'
# native sysroot RUNPATH. root_store_tool then links successfully but fails
# when its generated action loads libglib-2.0.so.0. Keep runtime lookup in
# this recipe's native sysroot; do not add target libraries or host packages.
# This only affects build-time tools, not the runtime's trust store or TLS.
do_compile:prepend() {
    export LD_LIBRARY_PATH="${STAGING_LIBDIR_NATIVE}:${STAGING_BASELIBDIR_NATIVE}"
}
