# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Open source drivers for as much hardware as possible, as modules, in
# every Phoenix image (files/phoenix-hardware*.cfg; docs/HARDWARE.md,
# "Hardware support and the Hardware app"). OE packages each module on its
# own (kernel-module-<name>, KERNEL_SPLIT_MODULES), so a module built later
# can also be offered on its own by the Hardware app.

FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI:append = " file://phoenix-hardware.cfg"
SRC_URI:append:x86-64 = " file://phoenix-hardware-x86.cfg"
SRC_URI:append:aarch64 = " file://phoenix-hardware-arm.cfg"
SRC_URI:append:arm = " file://phoenix-hardware-arm.cfg"

# phoenix-vm-arm64: QEMU's virtual devices built in (files/phoenix-vm.cfg),
# and what OSE and Phoenix need of a kernel (files/phoenix-ose.cfg, as the
# phones' kernels have it).
SRC_URI:append:phoenix-vm-arm64 = " file://phoenix-vm.cfg file://phoenix-ose.cfg"
# The yocto-kernel-cache's BSP for it is qemuarm64's: KMACHINE defaults to
# MACHINE (kernel-yocto.bbclass:17), and the cache has no
# phoenix-vm-arm64-standard.scc, which do_kernel_metadata would stop on
# ("Could not locate BSP definition", kernel-yocto.bbclass:257).
KMACHINE:phoenix-vm-arm64 = "qemuarm64"
