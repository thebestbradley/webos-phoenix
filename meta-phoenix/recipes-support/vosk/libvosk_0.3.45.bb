# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# libvosk, the speech recognizer behind the Assistant's wake word, "Hey
# Phoenix" (services/wakeword's phoenix-wakeword, installed by
# phoenix-shell, dlopens libvosk.so; docs/AI-AND-MCP.md, Voice). With
# vosk-model-small-en-us; packagegroup-phoenix-assistant installs both.
#
# PREBUILT: the libvosk.so of Alpha Cephei's own Python wheels on PyPI
# (vosk 0.3.45: aarch64, armv7 hard-float and x86_64 Linux, glibc 2.17 or
# 2.27 and later; checked by their SHA-256), the same files
# tools/get-wakeword.py fetches for the simulator. Building Vosk from
# source means Alpha Cephei's Kaldi fork, OpenFST and OpenBLAS/CLAPACK:
# a recipe of its own, to do (it would give security updates and the
# machine's own CPU flags).
#
# Licenses: Vosk is Apache-2.0 (github.com/alphacep/vosk-api COPYING);
# inside the library Kaldi and OpenFST are Apache-2.0, OpenBLAS and CLAPACK
# BSD-3-Clause. The wheels carry no license file, so OE's common texts are
# shipped. docs/LEGAL.md.

SUMMARY = "Vosk speech recognition library (libvosk), prebuilt"
HOMEPAGE = "https://alphacephei.com/vosk/"
SECTION = "libs"
LICENSE = "Apache-2.0 & BSD-3-Clause"
LIC_FILES_CHKSUM = " \
    file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10 \
    file://${COMMON_LICENSE_DIR}/BSD-3-Clause;md5=550794465ba0ec5312d6919e203a55f9 \
"

PYPI_URL = "https://files.pythonhosted.org/packages/py3/v/vosk"
# The wheel for the target (TARGET_ARCH), fetched as a .zip so do_unpack
# unzips it.
VOSK_WHEEL = "${@{'x86_64': 'manylinux_2_12_x86_64.manylinux2010_x86_64', 'aarch64': 'manylinux2014_aarch64', \
                  'arm': 'linux_armv7l'}.get(d.getVar('TARGET_ARCH'), 'none')}"
SRC_URI = "${PYPI_URL}/vosk-${PV}-py3-none-${VOSK_WHEEL}.whl;name=${TARGET_ARCH};downloadfilename=vosk-${PV}-${TARGET_ARCH}.zip;subdir=wheel"
SRC_URI[x86_64.sha256sum] = "25e025093c4399d7278f543568ed8cc5460ac3a4bf48c23673ace1e25d26619f"
SRC_URI[aarch64.sha256sum] = "54efb47dd890e544e9e20f0316413acec7f8680d04ec095c6140ab4e70262704"
SRC_URI[arm.sha256sum] = "4221f83287eefe5abbe54fc6f1da5774e9e3ffcbbdca1705a466b341093b072e"

COMPATIBLE_HOST = "(x86_64|aarch64|arm).*-linux.*"

S = "${UNPACKDIR}/wheel"

do_unpack[depends] += "unzip-native:do_populate_sysroot"
do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${libdir}
    install -m 0755 ${S}/vosk/libvosk.so ${D}${libdir}/libvosk.so
}

# A plugin-style library without a soname, loaded by its name: it is the
# runtime package's, not -dev's. Already stripped, built elsewhere.
FILES_SOLIBSDEV = ""
FILES:${PN} = "${libdir}/libvosk.so"
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_SYSROOT_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
INSANE_SKIP:${PN} = "already-stripped ldflags dev-so"
