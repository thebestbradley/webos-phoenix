# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# TDLib, Telegram's own client library, for the Unofficial Telegram account
# (apps/telegram): only its JSON interface (libtdjson), which phoenix-tdjson
# puts on standard input and output for the connector.
#
# License: Boost Software License 1.0 (LICENSE_1_0.txt); it links OpenSSL
# (Apache-2.0) and zlib.
#
# A large C++ build (an hour or more and several GB of memory per compile
# job on a build machine; td_api's generated sources are huge): parallel
# make is limited below. Cross-compiling needs TDLib's code generators run
# on the build machine first (its README, "cross-compiling":
# prepare_cross_compiling), which do_configure:prepend does with the
# native toolchain. libtdjson is about 30-40 MB stripped on arm64.
# Not built in Phoenix's CI; the connector and its tests use a fake
# tdjson (apps/telegram/service/test/fake-tdjson.cjs).

SUMMARY = "TDLib: Telegram Database library (JSON interface)"
HOMEPAGE = "https://core.telegram.org/tdlib"
SECTION = "libs"
LICENSE = "BSL-1.0"
LIC_FILES_CHKSUM = "file://LICENSE_1_0.txt;md5=e4224ccaecb14d942c71d31bef20d78c"

# Master at 1.8.68 (TDLib versions are commits, not tags, since 1.8.0).
SRC_URI = "git://github.com/tdlib/td.git;protocol=https;branch=master"
SRCREV = "c15d3f5a5de6e3ba5839822c451152e5e18bb700"
S = "${WORKDIR}/git"

DEPENDS = "openssl zlib gperf-native cmake-native"

inherit cmake

EXTRA_OECMAKE = " \
    -DCMAKE_BUILD_TYPE=MinSizeRel \
    -DTD_ENABLE_JNI=OFF \
    -DTD_ENABLE_DOTNET=OFF \
    -DBUILD_TESTING=OFF \
"

# TDLib's generated sources (td_api, mtproto_api, the MIME tables) made on
# the build machine, into the source tree, before the cross build.
do_configure:prepend() {
    if [ ! -f ${S}/td/generate/auto/td/telegram/td_api.h ]; then
        rm -rf ${WORKDIR}/build-generate
        mkdir -p ${WORKDIR}/build-generate
        cd ${WORKDIR}/build-generate
        env -u CC -u CXX -u CFLAGS -u CXXFLAGS -u LDFLAGS -u CPPFLAGS \
            CC="${BUILD_CC}" CXX="${BUILD_CXX}" \
            cmake ${S} -DCMAKE_BUILD_TYPE=Release -DTD_ENABLE_JNI=OFF
        env -u CC -u CXX -u CFLAGS -u CXXFLAGS -u LDFLAGS -u CPPFLAGS \
            cmake --build . --target prepare_cross_compiling
        cd ${B}
    fi
}

# The generated sources need several GB per job.
PARALLEL_MAKE = "-j 2"

do_compile() {
    cmake_runcmake_build --target tdjson
}

# Only libtdjson and its header; the static libraries and the other
# interfaces are not shipped.
do_install() {
    install -d ${D}${libdir} ${D}${includedir}/td/telegram
    cp -P ${B}/libtdjson.so* ${D}${libdir}/
    install -m 0644 ${S}/td/telegram/td_json_client.h ${D}${includedir}/td/telegram/
    install -m 0644 ${B}/td/telegram/tdjson_export.h ${D}${includedir}/td/telegram/
}

FILES:${PN} = "${libdir}/libtdjson.so.*"
FILES:${PN}-dev = "${libdir}/libtdjson.so ${includedir}"
