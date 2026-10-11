# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# AOSP's mkbootimg (platform/system/tools/mkbootimg, Apache-2.0), for
# phoenix-bootimg: Android boot images with header version 2 and a device
# tree, which meta-oe's android-tools (5.1.1, header version 0 only) cannot
# make. Pinned to tag android-16.0.0_r1. A Python script; it runs on the
# build host's python3 (in OE's HOSTTOOLS).

SUMMARY = "mkbootimg: makes Android boot images (AOSP)"
HOMEPAGE = "https://android.googlesource.com/platform/system/tools/mkbootimg/"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://mkbootimg.py;beginline=3;endline=15;md5=4b298fb007f09b49f4fd3c8bf859805e"

SRC_URI = "git://android.googlesource.com/platform/system/tools/mkbootimg;protocol=https;nobranch=1"
SRCREV = "808ecd09666ffe0ff5800f02af693abce56eb395"
S = "${WORKDIR}/git"

inherit native

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${libexecdir}/mkbootimg/gki ${D}${bindir}
    install -m 0755 ${S}/mkbootimg.py ${D}${libexecdir}/mkbootimg/mkbootimg.py
    install -m 0644 ${S}/gki/*.py ${D}${libexecdir}/mkbootimg/gki/
    ln -sf ../libexec/mkbootimg/mkbootimg.py ${D}${bindir}/mkbootimg
}
