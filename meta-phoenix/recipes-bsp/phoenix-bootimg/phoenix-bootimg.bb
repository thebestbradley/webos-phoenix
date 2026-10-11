# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The Android boot image a fastboot device boots Phoenix from
# (docs/HARDWARE.md, "First targets"): the kernel, the device tree and a
# command line that mounts the root itself, made by AOSP's mkbootimg with the
# header and offsets the machine gives (PHOENIX_BOOTIMG_ARGS, taken from the
# device's postmarketOS deviceinfo). Deployed as boot-${MACHINE}.img beside
# the image, for `fastboot flash boot` (or `fastboot boot` to try it).
#
# The ramdisk is an empty cpio (one directory, no /init): some Qualcomm
# bootloaders refuse an image without one, and with no /init the kernel goes
# on to mount root= as if there were no initramfs (Documentation/
# filesystems/ramfs-rootfs-initramfs.rst, "if rootfs does not contain an init
# program the kernel will fall through to the older code").

SUMMARY = "Android boot image for fastboot devices"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

inherit deploy nopackages

DEPENDS = "mkbootimg-native"
do_compile[depends] += "virtual/kernel:do_deploy"

# Set by the machine (conf/machine/fairphone-fp6.conf).
PHOENIX_BOOTIMG_ARGS ??= ""
PHOENIX_BOOTIMG_CMDLINE ??= ""
PHOENIX_BOOTIMG_DTB ??= ""
COMPATIBLE_MACHINE = "^(fairphone-fp6)$"
PACKAGE_ARCH = "${MACHINE_ARCH}"

S = "${WORKDIR}/bootimg"
B = "${WORKDIR}/build"

do_configure[noexec] = "1"

do_compile() {
    rm -rf ${B}/ramdisk && mkdir -p ${B}/ramdisk/dev
    (cd ${B}/ramdisk && find . | cpio -o -H newc --quiet) | gzip -9n > ${B}/ramdisk.cpio.gz
    mkbootimg \
        --kernel ${DEPLOY_DIR_IMAGE}/${KERNEL_IMAGETYPE} \
        --dtb ${DEPLOY_DIR_IMAGE}/$(basename ${PHOENIX_BOOTIMG_DTB}) \
        --ramdisk ${B}/ramdisk.cpio.gz \
        --cmdline "${PHOENIX_BOOTIMG_CMDLINE}" \
        ${PHOENIX_BOOTIMG_ARGS} \
        --output ${B}/boot.img
}

do_deploy() {
    install -m 0644 ${B}/boot.img ${DEPLOYDIR}/boot-${MACHINE}.img
}
addtask deploy after do_compile before do_build
