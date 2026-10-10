# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "phoenix-diag: a device's logs and state in one archive"
DESCRIPTION = "Collects what is needed to understand a problem on a Phoenix \
device (the journal of the last boots with luna-hub, the shell's QML \
console, WebAppMgr and the services; the kernel log, failed units, boot \
timing, memory, storage, the display, input and sound devices, the \
network's state without its secrets, RAUC's slots, a few Luna services' \
answers) into /media/internal/phoenix-diag/*.tar.gz. User data is not \
read. See docs/PRE-IMAGE-CHECKLIST.md, G2."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/support"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

SRC_URI = "file://phoenix-diag"
S = "${UNPACKDIR}"

inherit allarch

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${bindir}
    install -m 0755 ${UNPACKDIR}/phoenix-diag ${D}${bindir}/phoenix-diag
}

# What it calls is in every OSE image (systemd's journalctl, procps, tar,
# luna-send); the rest (rauc, connmanctl, lsusb) is used when present.
RDEPENDS:${PN} = "tar gzip"
