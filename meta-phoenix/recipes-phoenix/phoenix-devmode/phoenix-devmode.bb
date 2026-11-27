# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "webOS Phoenix's Developer Mode on a device: dev push's units"
DESCRIPTION = "What dev push needs beyond phoenix-apps (docs/DEV-PUSH.md 12, \
P3): novad.service (org.webosphoenix.nova, long-running as root), \
phoenix-overlay.service (the developer overlay at boot, before the hub, \
WebAppMgr and the shell) and /etc/phoenix/nova.json (the USB link's \
address, the shell's and WebAppMgr's units, the account nova term uses) \
and phoenix-usb-debug (USB debugging's CDC NCM gadget, which novad runs). \
The services themselves (novad and com.webos.service.devmode, Developer \
Mode's provider) are Node services phoenix-apps installs under \
/usr/palm/services."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/base"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

SRC_URI = "file://novad.service file://phoenix-overlay.service file://nova.json file://phoenix-usb-debug \
    file://sshd-phoenix-devmode.conf file://ssh-devmode-only.conf"
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
    install -d ${D}${sbindir}
    install -m 0755 ${UNPACKDIR}/phoenix-usb-debug ${D}${sbindir}/phoenix-usb-debug
    # phoenix-devmode-ssh: OpenSSH's server only in Developer Mode.
    install -d ${D}${sysconfdir}/ssh/sshd_config.d
    install -m 0644 ${UNPACKDIR}/sshd-phoenix-devmode.conf ${D}${sysconfdir}/ssh/sshd_config.d/10-phoenix-devmode.conf
    for unit in sshd.socket sshd.service; do
        install -d ${D}${systemd_system_unitdir}/$unit.d
        install -m 0644 ${UNPACKDIR}/ssh-devmode-only.conf ${D}${systemd_system_unitdir}/$unit.d/phoenix-devmode.conf
    done
}

FILES:${PN} = " \
    ${systemd_system_unitdir}/novad.service \
    ${systemd_system_unitdir}/phoenix-overlay.service \
    ${sysconfdir}/phoenix/nova.json \
    ${sbindir}/phoenix-usb-debug \
"
# The services' files and Node (phoenix-apps RDEPENDS on nodejs); mount
# and mknod for the overlay (util-linux, coreutils: the base utilities).
RDEPENDS:${PN} = "phoenix-apps nodejs ${VIRTUAL-RUNTIME_base-utils}"
# USB debugging's link (phoenix-usb-debug, which novad runs): ip, and
# BusyBox's DHCP server for the computer's one address (without it the
# computer is set to 172.16.42.2 by hand, and the script says so).
RRECOMMENDS:${PN} = "iproute2-ip busybox-udhcpd"

# A production image's SSH server (webos-phoenix-image.bb, PHOENIX_PRODUCTION
# = "1", which takes the debug image's SSH server out): OpenSSH's, started
# only while Developer Mode is on, for `user` by key alone (TERMINAL.md T4;
# docs/DEV-PUSH.md 9.2). Not in a development image, whose own SSH server
# (the distribution's debug-tweaks) stays as it is.
PACKAGES =+ "${PN}-ssh"
FILES:${PN}-ssh = " \
    ${sysconfdir}/ssh/sshd_config.d/10-phoenix-devmode.conf \
    ${systemd_system_unitdir}/sshd.socket.d/phoenix-devmode.conf \
    ${systemd_system_unitdir}/sshd.service.d/phoenix-devmode.conf \
"
RDEPENDS:${PN}-ssh = "openssh-sshd"
