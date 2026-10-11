# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "The device's configuration for the Phoenix shell and services"
DESCRIPTION = "/etc/phoenix/device.json (what the shell and phoenix-devices \
cannot detect: form factor, density, a hardware Home button, the ringer \
switch; docs/HARDWARE.md, \"Device configuration\") and \
/etc/phoenix/compositor.env (luna-surfacemanager's output geometry, which \
phoenix-shell's product.env reads), for this MACHINE: files/<MACHINE>/, \
else files/ (the defaults: everything detected)."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/base"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

# BitBake looks in files/${MACHINE}/ before files/ (FILESOVERRIDES).
SRC_URI = "file://device.json file://compositor.env"
S = "${UNPACKDIR}"
PACKAGE_ARCH = "${MACHINE_ARCH}"

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${sysconfdir}/phoenix
    install -m 0644 ${UNPACKDIR}/device.json ${D}${sysconfdir}/phoenix/device.json
    install -m 0644 ${UNPACKDIR}/compositor.env ${D}${sysconfdir}/phoenix/compositor.env
}

FILES:${PN} = "${sysconfdir}/phoenix/device.json ${sysconfdir}/phoenix/compositor.env"
