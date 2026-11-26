# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "webOS Phoenix's Developer Mode on a device: dev push's units"
DESCRIPTION = "What dev push needs beyond phoenix-apps (docs/DEV-PUSH.md 12, \
P3): novad.service (org.webosphoenix.nova, long-running as root), \
phoenix-overlay.service (the developer overlay at boot, before the hub, \
WebAppMgr and the shell) and /etc/phoenix/nova.json (the USB link's \
address, the shell's and WebAppMgr's units, the account nova term uses). \
The services themselves (novad and com.webos.service.devmode, Developer \
Mode's provider) are Node services phoenix-apps installs under \
/usr/palm/services."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/base"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

SRC_URI = "file://novad.service file://phoenix-overlay.service file://nova.json"
S = "${UNPACKDIR}"

inherit allarch systemd

SYSTEMD_SERVICE:${PN} = "novad.service phoenix-overlay.service"
SYSTEMD_AUTO_ENABLE = "enable"

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${systemd_system_unitdir} ${D}${sysconfdir}/phoenix
    install -m 0644 ${UNPACKDIR}/novad.service ${UNPACKDIR}/phoenix-overlay.service ${D}${systemd_system_unitdir}/
    install -m 0644 ${UNPACKDIR}/nova.json ${D}${sysconfdir}/phoenix/nova.json
}

FILES:${PN} = " \
    ${systemd_system_unitdir}/novad.service \
    ${systemd_system_unitdir}/phoenix-overlay.service \
    ${sysconfdir}/phoenix/nova.json \
"
# The services' files and Node (phoenix-apps RDEPENDS on nodejs); mount
# and mknod for the overlay (util-linux, coreutils: the base utilities).
RDEPENDS:${PN} = "phoenix-apps nodejs ${VIRTUAL-RUNTIME_base-utils}"
