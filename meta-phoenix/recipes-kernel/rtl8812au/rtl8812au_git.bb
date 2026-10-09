# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "Realtek RTL8812AU/RTL8821AU USB Wi-Fi driver (out of tree)"
DESCRIPTION = "The aircrack-ng project's 88XXau driver for USB Wi-Fi adapters \
with the RTL8812AU or RTL8821AU chip, among the most sold AC1200/AC600 \
dongles. Linux drives them itself only from 6.14 (rtw88_8812au, \
rtw88_8821au); OSE's kernels are 6.6. Built for each Phoenix kernel into \
lib/modules/<kernel>/updates and offered by the Hardware app \
(phoenix-driver-feed), never in the image: it is installed only for a \
device no built-in driver drives. See docs/HARDWARE.md, \"Out-of-tree drivers\"."
HOMEPAGE = "https://github.com/aircrack-ng/rtl8812au"
LICENSE = "GPL-2.0-only"
LIC_FILES_CHKSUM = "file://LICENSE;md5=b234ee4d69f5fce4486a80fdaf4a4263"

SRC_URI = "git://github.com/aircrack-ng/rtl8812au.git;protocol=https;branch=v5.6.4.2"
SRCREV = "734485506a30d6237c2deaad666a19f8ca5379f2"
PV = "5.6.4.2+git"
S = "${WORKDIR}/git"

inherit module

# Its Makefile builds against KSRC for KVER (given here: they override the
# Makefile's own, taken from the build host's uname).
EXTRA_OEMAKE += "KSRC=${STAGING_KERNEL_DIR} KVER=${KERNEL_VERSION} ARCH=${ARCH} CROSS_COMPILE=${TARGET_PREFIX}"
MODULES_MODULE_SYMVERS_LOCATION = "."

do_install () {
    install -D -m 0644 ${S}/88XXau.ko ${D}${nonarch_base_libdir}/modules/${KERNEL_VERSION}/updates/88XXau.ko
}

# The Hardware app's feed, not the image.
EXCLUDE_FROM_WORLD = "1"
