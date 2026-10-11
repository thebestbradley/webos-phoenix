# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Linux for the PINE64 PinePhone (Allwinner A64) and PinePhone Pro
# (Rockchip RK3399S): Ondřej Jirman's (megi's) tree, the one every
# PinePhone distribution's kernel comes from, at its tag
# orange-pi-7.2-20260903-2131 (commit
# facc87117511221bb61410e3f92ad8579697f736, codeberg.org/megi/linux).
#
# postmarketOS/Nura (pmaports 2116628, 10 October 2026) builds the
# PinePhone from a lightly patched megi 6.18 (Arnavion's
# orange-pi-6.18-20260105-0049, device/testing/linux-postmarketos-allwinner)
# and the PinePhone Pro from Linux 7.2 plus a selection of megi's 7.2
# patches (device/community/linux-pine64-pinephonepro); the configurations
# are theirs, one per machine. LuneOS's meta-pine64-luneos builds megi's
# tree too (linux-pinephone_git.bb, linux-pinephonepro_git.bb).
#
# A git fetch at the tag's commit (megi rebases his branches; tags stay):
# a full kernel clone, about 5 GB in DL_DIR.

require linux-phoenix-device.inc

SUMMARY = "Linux for the PinePhone and PinePhone Pro (megi's tree)"
HOMEPAGE = "https://xff.cz/kernels/"
LICENSE = "GPL-2.0-only"
LIC_FILES_CHKSUM = "file://COPYING;md5=6bc538ed5bd9a7fc9398086aedcd7e46"

PMAPORTS_COMMIT = "2116628388ff9e022908899445497221496e17a1"
PMAPORTS_RAW = "https://gitlab.postmarketos.org/postmarketOS/pmaports/-/raw/${PMAPORTS_COMMIT}/device"

SRC_URI = " \
    git://codeberg.org/megi/linux.git;protocol=https;nobranch=1 \
    ${PMAPORTS_RAW}/testing/linux-postmarketos-allwinner/config-postmarketos-allwinner.aarch64;name=pinephone;downloadfilename=pmaports-2116628-config-postmarketos-allwinner.aarch64 \
    ${PMAPORTS_RAW}/community/linux-pine64-pinephonepro/config-pine64-pinephonepro.aarch64;name=pinephonepro;downloadfilename=pmaports-2116628-config-pine64-pinephonepro.aarch64 \
"
SRCREV = "facc87117511221bb61410e3f92ad8579697f736"
SRC_URI[pinephone.sha256sum] = "71a4632846128c791bdadf05850f9fde6105ad7289741f090d1a4ef7e92b5711"
SRC_URI[pinephonepro.sha256sum] = "45b8866e865cfe4a073d313c8d388fe47a804e29e55deb8dfcf66ba2cfac7934"

PHOENIX_KERNEL_CONFIG:pinephone = "pmaports-2116628-config-postmarketos-allwinner.aarch64"
PHOENIX_KERNEL_CONFIG:pinephonepro = "pmaports-2116628-config-pine64-pinephonepro.aarch64"

PV = "7.2+git"
LINUX_VERSION = "7.2"
S = "${WORKDIR}/git"

COMPATIBLE_MACHINE = "^(pinephone|pinephonepro)$"
