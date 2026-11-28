# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "The A/B boot's first GRUB environment"
DESCRIPTION = "EFI/BOOT/grubenv on a new A/B disk (files/wic/phoenix-ab-efi.wks.in, \
IMAGE_EFI_BOOT_FILES): slot A bootable and first, slot B empty (it gets the \
first update), and the kernel arguments the machine adds (PHOENIX_GRUB_ARGS). \
RAUC rewrites it with grub-editenv (mark-active, mark-good) and GRUB counts \
each try in it (files/wic/phoenix-ab-grub.cfg)."
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

inherit deploy nopackages

PACKAGE_ARCH = "${MACHINE_ARCH}"
INHIBIT_DEFAULT_DEPS = "1"
do_fetch[noexec] = "1"
do_unpack[noexec] = "1"
do_patch[noexec] = "1"
do_configure[noexec] = "1"
do_compile[noexec] = "1"
do_install[noexec] = "1"

# The machine's console and device, for example "console=ttyAMA0
# phoenix.device=pinephonepro" (phoenix-vm-arm64.conf).
PHOENIX_GRUB_ARGS ??= ""

python do_deploy() {
    import os
    from phoenix import slots
    args = d.getVar("PHOENIX_GRUB_ARGS") or ""
    data = slots.grubenv({"ORDER": "A B", "A_OK": "1", "A_TRY": "0", "B_OK": "0", "B_TRY": "0",
                          "PHOENIX_ARGS": args})
    with open(os.path.join(d.getVar("DEPLOYDIR"), "phoenix-grubenv"), "wb") as f:
        f.write(data)
}
do_deploy[vardeps] += "PHOENIX_GRUB_ARGS"
addtask deploy before do_build
