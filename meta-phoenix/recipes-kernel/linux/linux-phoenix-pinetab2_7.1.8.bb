# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Linux for the PINE64 PineTab2 (Rockchip RK3566): DanctNIX's tree
# (codeberg.org/DanctNIX/linux-pinetab2), the stable kernel plus the
# PineTab2's patches, among them the out-of-tree BES2600 Wi-Fi driver,
# at tag v7.1.8-danctnix1 (commit 344dbbd1d2e2b540197575e1c00a2b15abb1ab8b).
# postmarketOS/Nura builds the same thing (pmaports 2116628, 10 October
# 2026, device/testing/linux-pine64-pinetab2: kernel.org's linux-7.1.8 with
# DanctNIX's v7.1.8-danctnix1.patch, and config-pine64-pinetab2.aarch64,
# whose configuration this takes).
#
# A git fetch at the tag's commit: a full kernel clone, about 5 GB in DL_DIR.

require linux-phoenix-device.inc

SUMMARY = "Linux for the PineTab2 (DanctNIX's tree)"
HOMEPAGE = "https://codeberg.org/DanctNIX/linux-pinetab2"
LICENSE = "GPL-2.0-only"
LIC_FILES_CHKSUM = "file://COPYING;md5=6bc538ed5bd9a7fc9398086aedcd7e46"

PMAPORTS_COMMIT = "2116628388ff9e022908899445497221496e17a1"
PHOENIX_KERNEL_CONFIG = "pmaports-2116628-config-pine64-pinetab2.aarch64"

SRC_URI = " \
    git://codeberg.org/DanctNIX/linux-pinetab2.git;protocol=https;nobranch=1 \
    https://gitlab.postmarketos.org/postmarketOS/pmaports/-/raw/${PMAPORTS_COMMIT}/device/testing/linux-pine64-pinetab2/config-pine64-pinetab2.aarch64;name=config;downloadfilename=${PHOENIX_KERNEL_CONFIG} \
"
SRCREV = "344dbbd1d2e2b540197575e1c00a2b15abb1ab8b"
SRC_URI[config.sha256sum] = "a69ddbd011445609c6ef842a09865f168ba6aa85bfeee8385dbc24229de2a910"

PV = "7.1.8+git"
LINUX_VERSION = "7.1.8"
S = "${WORKDIR}/git"

COMPATIBLE_MACHINE = "^pinetab2$"
