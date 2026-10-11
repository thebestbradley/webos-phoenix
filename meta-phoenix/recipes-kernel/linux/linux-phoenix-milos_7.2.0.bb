# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Linux for the Fairphone (Gen. 6) and (Gen. 6+): the "milos" tree
# (Qualcomm SM7635 / Snapdragon 7s Gen 3, and SM7635-AC / 7s Gen 4 in the
# 6+), maintained by Fairphone's Luca Weiss, as postmarketOS/Nura builds it.
#
# Pinned from pmaports 2116628 (10 October 2026),
# device/testing/linux-postmarketos-qcom-milos/APKBUILD: pkgver 7.2.0, the
# archive of tag v7.2.0-milos of github.com/milos-mainline/linux (commit
# 1b485d51924504267c91c724322249c7d26ace7d) with the APKBUILD's sha512, and
# its config-postmarketos-qcom-milos.aarch64. The Gen. 6+ boots the same
# image (Nura wiki, "Fairphone (Gen. 6)": "software-compatible"); the tree
# has one device tree for both, milos-fairphone-fp6.dts.

require linux-phoenix-device.inc

SUMMARY = "Linux for the Fairphone (Gen. 6) and (Gen. 6+) (milos-mainline)"
HOMEPAGE = "https://github.com/milos-mainline/linux"
LICENSE = "GPL-2.0-only"
LIC_FILES_CHKSUM = "file://COPYING;md5=6bc538ed5bd9a7fc9398086aedcd7e46"

PMAPORTS_COMMIT = "2116628388ff9e022908899445497221496e17a1"
PHOENIX_KERNEL_CONFIG = "pmaports-2116628-config-postmarketos-qcom-milos.aarch64"

SRC_URI = " \
    https://github.com/milos-mainline/linux/archive/refs/tags/v${PV}-milos/linux-v${PV}-milos.tar.gz;name=kernel \
    https://gitlab.postmarketos.org/postmarketOS/pmaports/-/raw/${PMAPORTS_COMMIT}/device/testing/linux-postmarketos-qcom-milos/config-postmarketos-qcom-milos.aarch64;name=config;downloadfilename=${PHOENIX_KERNEL_CONFIG} \
"
SRC_URI[kernel.sha512sum] = "71851b0a7b5ff23569732c8ac64541b087a691815c3db3fa18af2439cc95c750e4058d27dc313819482978b0e99a5b93920121e8931c7b4f1cd58707f1b9b0b7"
SRC_URI[config.sha256sum] = "69896c02153e7c22d11496ef52b8d37f27652ad3203f2337afeb3bdc4b080e3c"

S = "${UNPACKDIR}/linux-${PV}-milos"
LINUX_VERSION = "${PV}"

COMPATIBLE_MACHINE = "^fairphone-fp6$"
