# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# rauc.service only on a boot from an update slot (files/rauc-phoenix-slot.conf):
# an image with RAUC still starts straight from its ext4 (make-utm, the
# regression suite), where RAUC has no booted slot.

FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI += "file://rauc-phoenix-slot.conf"

do_install:append() {
    install -d ${D}${systemd_system_unitdir}/rauc.service.d
    install -m 0644 ${UNPACKDIR}/rauc-phoenix-slot.conf ${D}${systemd_system_unitdir}/rauc.service.d/phoenix-slot.conf
}

FILES:${PN}-service += "${systemd_system_unitdir}/rauc.service.d"
