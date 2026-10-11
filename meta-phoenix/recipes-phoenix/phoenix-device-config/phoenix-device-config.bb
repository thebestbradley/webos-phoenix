# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "The device's configuration for the Phoenix shell and services"
DESCRIPTION = "/etc/phoenix/device.json (what the shell and phoenix-devices \
cannot detect: form factor, density, a hardware Home button, the ringer \
switch, the screen's corners and camera cutout; docs/HARDWARE.md, \"Device \
configuration\") and /etc/phoenix/compositor.env (luna-surfacemanager's \
output geometry, which phoenix-shell's product.env reads), for this MACHINE: \
files/<MACHINE>/, else files/ (the defaults: everything detected). The ARM64 \
VM (phoenix-vm-arm64) has every device's, and the kernel's command line \
picks one at boot (phoenix.device=ID; phoenix-device-select)."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/base"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

# BitBake looks in files/${MACHINE}/ before files/ (FILESOVERRIDES).
SRC_URI = "file://device.json file://compositor.env"
# The VM: the profiles' table, their device.json files, the script that
# installs them and the one that picks one at boot.
PHOENIX_VM_PROFILE_CONFIGS = "fairphone-fp6 ayn-odin2portal pinephonepro pinetab2 rpi-touch-display-2"
SRC_URI:append:phoenix-vm-arm64 = " file://device-profiles.json file://device-profiles.py \
    file://phoenix-device-select file://phoenix-device-select.service \
    ${@' '.join('file://%s/device.json' % c for c in d.getVar('PHOENIX_VM_PROFILE_CONFIGS').split())}"
S = "${UNPACKDIR}"
PACKAGE_ARCH = "${MACHINE_ARCH}"

inherit systemd
SYSTEMD_SERVICE:${PN} = ""
SYSTEMD_SERVICE:${PN}:phoenix-vm-arm64 = "phoenix-device-select.service"

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${sysconfdir}/phoenix
    install -m 0644 ${UNPACKDIR}/device.json ${D}${sysconfdir}/phoenix/device.json
    install -m 0644 ${UNPACKDIR}/compositor.env ${D}${sysconfdir}/phoenix/compositor.env
}

# The VM: /usr/share/phoenix/devices/<id>/ for each profile (and default/),
# and /etc/phoenix's two files as links to what phoenix-device-select
# writes in /run/phoenix at boot. python3 is the build host's (HOSTTOOLS).
do_install:append:phoenix-vm-arm64() {
    python3 ${UNPACKDIR}/device-profiles.py install ${UNPACKDIR} ${D}${datadir}/phoenix/devices \
        ${UNPACKDIR}/device-profiles.json
    install -m 0644 ${UNPACKDIR}/device-profiles.json ${D}${datadir}/phoenix/devices/device-profiles.json
    ln -sf /run/phoenix/device.json ${D}${sysconfdir}/phoenix/device.json
    ln -sf /run/phoenix/compositor.env ${D}${sysconfdir}/phoenix/compositor.env
    install -d ${D}${sbindir} ${D}${systemd_system_unitdir}
    install -m 0755 ${UNPACKDIR}/phoenix-device-select ${D}${sbindir}/phoenix-device-select
    install -m 0644 ${UNPACKDIR}/phoenix-device-select.service ${D}${systemd_system_unitdir}/
}

FILES:${PN} = "${sysconfdir}/phoenix/device.json ${sysconfdir}/phoenix/compositor.env"
# phoenix-device-select is a shell script.
RDEPENDS:${PN}:append:phoenix-vm-arm64 = " ${VIRTUAL-RUNTIME_base-utils}"
FILES:${PN}:append:phoenix-vm-arm64 = " ${datadir}/phoenix/devices ${sbindir}/phoenix-device-select \
    ${systemd_system_unitdir}/phoenix-device-select.service"
