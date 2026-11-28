# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "webOS Phoenix's A/B layout at boot: the data partition and its overlays"
DESCRIPTION = "A systemd generator (phoenix-slots-generator) that, when the boot \
loader started one of two root slots (phoenix.data= and phoenix.esp= on the \
kernel's command line, files/wic/phoenix-ab-grub.cfg), mounts the data \
partition at /data and the EFI system partition at /boot/efi, keeps /var, \
/home and /media as overlays whose upper layers are on the data partition \
(what the user changed outlives a system update; what they did not is the \
running slot's), and /var/lib/phoenix on the data partition (com.palm.update's \
downloads and state, dev push's overlays). Without them nothing changes."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/base"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

SRC_URI = "file://phoenix-slots-generator"
S = "${UNPACKDIR}"

inherit allarch

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${systemd_unitdir}/system-generators
    install -m 0755 ${UNPACKDIR}/phoenix-slots-generator ${D}${systemd_unitdir}/system-generators/phoenix-slots-generator
    # The mount points, for a root that is read-only one day
    # (docs/PRE-IMAGE-CHECKLIST.md S3).
    install -d ${D}/data ${D}/boot/efi
}

FILES:${PN} = "${systemd_unitdir}/system-generators/phoenix-slots-generator /data /boot/efi"
# mkdir for the overlays' directories; e2fsck for the data partition's
# check (systemd-fsck@); vfat and overlayfs are the kernel's
# (phoenix-rauc.cfg).
RDEPENDS:${PN} = "${VIRTUAL-RUNTIME_base-utils} e2fsprogs-e2fsck"
