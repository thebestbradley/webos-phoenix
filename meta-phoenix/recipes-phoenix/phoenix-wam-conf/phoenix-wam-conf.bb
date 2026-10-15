# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "webOS Phoenix's settings for WebAppMgr: the web apps' user agent"
DESCRIPTION = "/etc/wam/plugins/conf.sh, which WebAppMgr's start script \
sources before it starts WebAppMgr: the user agent of every web app, what \
Chrome on Android sends with the current Chrome stable major version \
(computed at each start from the date), Mobile on phones, and the client \
hints that agree with it where the web runtime takes them \
(docs/DECISIONS.md, 15 October 2026)."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/base"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

SRC_URI = "file://phoenix-wam.sh"
S = "${UNPACKDIR}"

inherit allarch

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${sysconfdir}/wam/plugins
    install -m 0644 ${UNPACKDIR}/phoenix-wam.sh ${D}${sysconfdir}/wam/plugins/conf.sh
}

FILES:${PN} = "${sysconfdir}/wam/plugins/conf.sh"
# What it works with, all in webos-phoenix-image: WebAppMgr's start line
# and its patch for an empty WAM_NAME (meta-phoenix's wam bbappend,
# recipes-webos/wam), the device's form factor (phoenix-device-config's
# device.json) and, on LuneOS's layers, the runtime's client-hint switches
# (dynamic-layers/meta-luneos webruntime bbappend). No RDEPENDS: an
# allarch package naming machine-specific ones would differ per machine.
