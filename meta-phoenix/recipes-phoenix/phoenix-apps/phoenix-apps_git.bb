# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "Original Open webOS apps and frameworks, and the Phoenix web app runtime"
DESCRIPTION = "Installs the Open webOS core apps (Accounts, Calculator, \
Calendar, Clock, Contacts, Email, Memos), Enyo 1.0, MojoLoader and the \
foundation/loadable frameworks at their original device paths \
(/usr/palm/applications, /usr/palm/frameworks), plus Phoenix web apps and \
phoenix-runtime.js, using tools/install-rootfs.py."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/apps"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://LICENSE;md5=89aea4e17d99a7cacdbeed46a0096b10"

PHOENIX_SRCREV ?= "${AUTOREV}"
PHOENIX_BRANCH ?= "main"
# gitsm: the original apps and frameworks are git submodules (third_party/).
SRC_URI = "gitsm://github.com/thebestbradley/webos-phoenix.git;protocol=https;branch=${PHOENIX_BRANCH}"
SRCREV = "${PHOENIX_SRCREV}"
PV = "0.1.0+git${SRCPV}"

S = "${WORKDIR}/git"

inherit allarch python3native

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    ${PYTHON} ${S}/tools/install-rootfs.py ${D}
}

FILES:${PN} = " \
    ${prefix}/palm/applications \
    ${prefix}/palm/frameworks \
    ${datadir}/phoenix/runtime \
    ${sysconfdir}/palm/db \
"

# Web apps run in WebAppMgr; their data lives in db8.
RDEPENDS:${PN} = "${VIRTUAL-RUNTIME_webappmanager} db8"
