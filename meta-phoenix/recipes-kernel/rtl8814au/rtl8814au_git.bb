# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "Realtek RTL8814AU USB Wi-Fi driver (out of tree)"
DESCRIPTION = "Nick Morrow's 8814au driver for USB Wi-Fi adapters with the \
RTL8814AU chip (four antennas, AC1900 dongles), maintained for current \
kernels. Mainline Linux gained RTL8814AU support in rtw88 only in 2025, \
after the 6.6 kernels OSE ships. Built for each Phoenix kernel into \
lib/modules/<kernel>/updates and offered by the Hardware app \
(phoenix-driver-feed), never in the image. See docs/HARDWARE.md, \
\"Out-of-tree drivers\"."
HOMEPAGE = "https://github.com/morrownr/8814au"
LICENSE = "GPL-2.0-only"
LIC_FILES_CHKSUM = "file://LICENSE;md5=ab842b299d0a92fb908d6eb122cd6de9"

SRC_URI = "git://github.com/morrownr/8814au.git;protocol=https;branch=main"
SRCREV = "1840d7b23bf2350a3e9e22448a93c251d2fec73c"
PV = "5.8.5.1+git"
S = "${WORKDIR}/git"

inherit module

EXTRA_OEMAKE += "KSRC=${STAGING_KERNEL_DIR} KVER=${KERNEL_VERSION} ARCH=${ARCH} CROSS_COMPILE=${TARGET_PREFIX}"
MODULES_MODULE_SYMVERS_LOCATION = "."

do_install () {
    install -D -m 0644 ${S}/8814au.ko ${D}${nonarch_base_libdir}/modules/${KERNEL_VERSION}/updates/8814au.ko
}

EXCLUDE_FROM_WORLD = "1"
