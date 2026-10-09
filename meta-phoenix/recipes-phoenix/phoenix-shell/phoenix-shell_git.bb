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
PV = "0.1.0+git"

S = "${WORKDIR}/git/shell"

inherit qt6-cmake

# The shell is QML, plus one small compiled module (Phoenix.Native, e.g.
# delivering the Back key to apps), installed with Qt's QML modules.
DEPENDS = "qtbase qtdeclarative qtdeclarative-native"
EXTRA_OECMAKE = "-DPHOENIX_BUILD_SIM=OFF -DPHOENIX_DATA_DIR=${datadir}/phoenix \
                 -DPHOENIX_NATIVE_QML_DIR=${QT6_INSTALL_QMLDIR}"

do_install:append() {
    install -d ${D}${sysconfdir}/surface-manager.d
    install -m 0644 ${UNPACKDIR}/product.env ${D}${sysconfdir}/surface-manager.d/product.env
}

FILES:${PN} += " \
    ${datadir}/phoenix \
    ${datadir}/fonts/open-sans \
    ${datadir}/fonts/noto-color-emoji \
    ${sysconfdir}/fonts/conf.d/50-phoenix-emoji.conf \
    ${QT6_INSTALL_QMLDIR}/Phoenix \
    ${sysconfdir}/surface-manager.d/product.env \
"

# qtsvg-plugins: the launcher shows SVG app icons (the Marketplace's
# generated icons for web apps whose own icons are broken; launch points'
# .svg icons).
RDEPENDS:${PN} += " \
    luna-surfacemanager-base \
    qtdeclarative-qmlplugins \
    qt5compat-qmlplugins \
    qtsvg-plugins \
"
