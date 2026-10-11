# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Linux for the AYN Odin 2 Portal (Qualcomm QCS8550 / Snapdragon 8 Gen 2):
# AYN's own mainline tree, github.com/AYNTechnologies/linux, branch ayn/v7.0
# at d0bd1239126dbd52b2bad91de1db0020de26977c (its head on 11 October 2026;
# Linux 7.0). It carries the Odin 2 family's device trees
# (qcs8550-ayn-odin2portal.dts, by Teguh Sobirin for ROCKNIX) and the
# drivers they need that mainline does not have yet: the Chipone ICNA3512
# panel (DRM_PANEL_CHIPONE_ICNA35XX), the UART gamepad (JOYSTICK_RSINPUT),
# the HTR3212 stick LEDs, the AW88166 amplifiers. The device trees are on
# their way upstream (Aaron Kling's "Support AYN QCS8550 Devices", v9, 27
# July 2026; not in Linux 7.3-rc6), without those drivers' nodes.
#
# The configuration is ROCKNIX's for its SM8550 image (ROCKNIX/distribution
# tag 20261001, c445081a59518f37d9776e5412dd7b14910696f7,
# projects/ROCKNIX/devices/SM8550/linux/linux.aarch64.conf), written for
# its Linux 7.2 with patches; olddefconfig drops what 7.0 lacks.
#
# A git fetch (GitHub's archives cannot be checksummed ahead here); it is a
# full kernel clone, about 5 GB in DL_DIR.

require linux-phoenix-device.inc

SUMMARY = "Linux for the AYN Odin 2 Portal (AYN's mainline tree)"
HOMEPAGE = "https://github.com/AYNTechnologies/linux"
LICENSE = "GPL-2.0-only"
LIC_FILES_CHKSUM = "file://COPYING;md5=6bc538ed5bd9a7fc9398086aedcd7e46"

ROCKNIX_COMMIT = "c445081a59518f37d9776e5412dd7b14910696f7"
PHOENIX_KERNEL_CONFIG = "rocknix-c445081-SM8550-linux.aarch64.conf"

SRC_URI = " \
    git://github.com/AYNTechnologies/linux.git;protocol=https;nobranch=1 \
    https://raw.githubusercontent.com/ROCKNIX/distribution/${ROCKNIX_COMMIT}/projects/ROCKNIX/devices/SM8550/linux/linux.aarch64.conf;name=config;downloadfilename=${PHOENIX_KERNEL_CONFIG} \
"
SRCREV = "d0bd1239126dbd52b2bad91de1db0020de26977c"
SRC_URI[config.sha256sum] = "0191aa5a12f0829a830c988cda90c834bf2e9f6750e29a262cf60f721da0a983"

PV = "7.0+git"
LINUX_VERSION = "7.0"
S = "${WORKDIR}/git"

COMPATIBLE_MACHINE = "^ayn-odin2portal$"
