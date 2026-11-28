# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Two modules more in GRUB's EFI image for the A/B boot script
# (files/wic/phoenix-ab-grub.cfg): regexp (the slots' disk from the EFI
# partition's) and echo (which slot starts, and why, on the console).
# OE's list (grub-efi_2.14.bb GRUB_BUILDIN) has loadenv, test, search,
# part_gpt, ext2 and fat already.

GRUB_BUILDIN:append = " regexp echo"
