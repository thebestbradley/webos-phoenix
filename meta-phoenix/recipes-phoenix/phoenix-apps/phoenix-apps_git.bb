# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "Original Open webOS apps and frameworks, and the Phoenix web app runtime"
DESCRIPTION = "Installs the Open webOS core apps (Accounts, Calculator, \
Calendar, Clock, Contacts, Email, Memos), Enyo 1.0, MojoLoader and the \
foundation/loadable frameworks at their original device paths \
(/usr/palm/applications, /usr/palm/frameworks), plus Phoenix web apps, their \
Node.js Luna services (/usr/palm/services, e.g. org.webosphoenix.filemanager \
for Files and org.webosphoenix.service.dav for CardDAV & CalDAV accounts, with \
luna-service2 role and permission files), account templates \
(/usr/palm/public/accounts) and phoenix-runtime.js, using tools/install-rootfs.py."
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
    ${prefix}/palm/services \
    ${prefix}/palm/public \
    ${datadir}/phoenix/runtime \
    ${datadir}/luna-service2 \
    ${sysconfdir}/palm/db \
"

# Web apps run in WebAppMgr; their data lives in db8. The apps' own Luna
# services (Files, CardDAV & CalDAV) are JavaScript services: run-js-service
# and webos-service.
RDEPENDS:${PN} = "${VIRTUAL-RUNTIME_webappmanager} db8 nodejs nodejs-module-webos-service"
