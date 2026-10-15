# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Client hints that agree with Phoenix's user agent (phoenix-webruntime.inc).
# Both recipes: webruntime-clang_151.bb requires webruntime_151.bb, which
# does not bring the other's bbappends; LuneOS builds the -clang one
# (WEBRUNTIME_TOOLCHAIN, luneos-preferred-providers.inc).

require phoenix-webruntime.inc
