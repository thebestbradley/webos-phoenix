# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "webOS Phoenix keyboard: the Phoenix virtual keyboard as a Maliit input method"
DESCRIPTION = "The shell's own keyboard (the Pre and TouchPad keyboards, \
Text Assist, dictation, swipe, emoji, the clip strip, cursor control) as an \
input method plugin for maliit-server, installed beside webOS OSE's own \
keyboard and made the default (maliit-framework-webos bbappend). It shows \
the shell's QML (phoenix-shell) in maliit-server's input panel. See \
docs/HARDWARE.md, \"The keyboard as the input method\"."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/base"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://../../LICENSE;md5=89aea4e17d99a7cacdbeed46a0096b10"

PHOENIX_SRCREV ?= "${AUTOREV}"
PHOENIX_BRANCH ?= "main"
SRC_URI = "git://github.com/thebestbradley/webos-phoenix.git;protocol=https;branch=${PHOENIX_BRANCH}"
SRCREV = "${PHOENIX_SRCREV}"
PV = "0.1.0+git"

S = "${WORKDIR}/git/services/keyboard"

inherit qt6-cmake pkgconfig

# maliit-framework-webos: the plugin API's headers and libmaliit-plugins
# (its recipe installs them, maliit-framework-webos.bb do_install).
DEPENDS = "qtbase qtdeclarative qtdeclarative-native maliit-framework-webos"

# maliit-framework-webos.bb: MALIIT_PLUGINS_DIR=${libdir}/maliit/plugins.
# The shell's QML where phoenix-shell installs it (PHOENIX_DATA_DIR).
EXTRA_OECMAKE = "-DPHOENIX_KEYBOARD_TESTS=OFF \
                 -DPHOENIX_MALIIT_PLUGINS_DIR=${libdir}/maliit/plugins \
                 -DPHOENIX_KEYBOARD_QML_DIR=${datadir}/phoenix/qml \
                 -DPHOENIX_KEYBOARD_STATE_DIR=${localstatedir}/lib/phoenix/keyboard"

# A Qt plugin, loaded by name (as imemanager's: FILES += ${libdir}/maliit).
FILES:${PN} += " \
    ${libdir}/maliit/plugins/libphoenix-keyboard.so \
    ${datadir}/luna-service2/client-permissions.d \
"

# The keyboard's QML and Phoenix.Native (phoenix-shell), maliit-server and
# OSE's own keyboard beside it (imemanager: the role maliit-server runs
# with), the QML modules it uses, and Qt Multimedia's backends for
# dictation's microphone.
RDEPENDS:${PN} = " \
    phoenix-shell \
    maliit-framework-webos \
    imemanager \
    qml-webos-bridge \
    qtdeclarative-qmlplugins \
    qtmultimedia-plugins \
"
