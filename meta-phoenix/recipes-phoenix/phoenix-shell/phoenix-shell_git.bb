# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "webOS Phoenix: the classic webOS mobile system UI for webOS OSE"
DESCRIPTION = "Card view, launcher, status bar, notifications and lock \
screen of Palm/HP webOS, rebuilt in QML as a luna-surfacemanager views \
override."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/base"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://../LICENSE;md5=89aea4e17d99a7cacdbeed46a0096b10"

# Build from this repository. PHOENIX_SRCREV lets local.conf pin a commit;
# during development set it to "${AUTOREV}".
PHOENIX_SRCREV ?= "${AUTOREV}"
PHOENIX_BRANCH ?= "main"
SRC_URI = " \
    git://github.com/thebestbradley/webos-phoenix.git;protocol=https;branch=${PHOENIX_BRANCH} \
    file://product.env \
"
SRCREV = "${PHOENIX_SRCREV}"
PV = "0.1.0+git${SRCPV}"

S = "${WORKDIR}/git/shell"

inherit cmake

# The shell is pure QML; only the desktop simulator needs a compiler.
EXTRA_OECMAKE = "-DPHOENIX_BUILD_SIM=OFF -DPHOENIX_DATA_DIR=${datadir}/phoenix"

do_install:append() {
    install -d ${D}${sysconfdir}/surface-manager.d
    install -m 0644 ${UNPACKDIR}/product.env ${D}${sysconfdir}/surface-manager.d/product.env
}

FILES:${PN} += " \
    ${datadir}/phoenix \
    ${sysconfdir}/surface-manager.d/product.env \
"

RDEPENDS:${PN} += " \
    luna-surfacemanager-base \
    qtdeclarative-qmlplugins \
    qt5compat-qmlplugins \
"
