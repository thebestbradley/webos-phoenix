# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The wake word's model: Alpha Cephei's small US English Vosk model
# (40 MB download, 71 MB installed), in /usr/share/phoenix/wakeword where
# PhoenixViewsRoot.qml points phoenix-wakeword. Shipped in the image (not
# fetched on first use): it is small, the wake word must work offline, and
# it is the same for every machine. packagegroup-phoenix-assistant
# installs it with libvosk.
#
# License: Apache-2.0, per alphacephei.com/vosk/models (checked 8 October
# 2026); the archive has only a README, so OE's common text is shipped.

SUMMARY = "Vosk small US English model, for the Phoenix wake word"
HOMEPAGE = "https://alphacephei.com/vosk/models"
SECTION = "multimedia"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

SRC_URI = "https://alphacephei.com/vosk/models/vosk-model-small-en-us-${PV}.zip"
SRC_URI[sha256sum] = "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498"

S = "${UNPACKDIR}/vosk-model-small-en-us-${PV}"

inherit allarch

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${datadir}/phoenix/wakeword
    cp -R --no-preserve=ownership ${S} ${D}${datadir}/phoenix/wakeword/
}

FILES:${PN} = "${datadir}/phoenix/wakeword"
