# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# A phone or tablet's own kernel (docs/HARDWARE.md, "First targets"): the
# tree and the configuration of the distribution that maintains the device
# (postmarketOS/Nura's pmaports for the Fairphone and the PINE64 devices,
# ROCKNIX for the Odin 2 Portal), pinned to a commit, plus Phoenix's:
#
#   phoenix-hardware.cfg, phoenix-hardware-arm.cfg
#       the generic drivers every Phoenix kernel builds as modules (the
#       linux-yocto and linux-raspberrypi bbappends'), except where the
#       device's configuration builds the same driver in: a module must
#       never replace a built-in the device needs before the root is mounted
#   phoenix-ose.cfg
#       what OSE and Phoenix need (systemd, Chromium's sandbox, OSE's own
#       kernel fragments), merged last; it only turns options on
#
# then `make olddefconfig` (kernel.bbclass's do_configure) settles what the
# tree has. The recipe sets SRC_URI (the tree and the configuration file),
# PHOENIX_KERNEL_CONFIG (that file's name in UNPACKDIR) and
# COMPATIBLE_MACHINE.
#
# The device distributions build these trees with clang (LLVM=1); OE builds
# them with GCC: the clang-only options (CFI, LTO) fall away in olddefconfig.

SECTION = "kernel"
# LICENSE and LIC_FILES_CHKSUM are in each recipe (its tree's COPYING).

inherit kernel

FILESEXTRAPATHS:prepend := "${THISDIR}/files:"
SRC_URI:append = " file://phoenix-hardware.cfg file://phoenix-hardware-arm.cfg file://phoenix-ose.cfg"

PHOENIX_KERNEL_CONFIG ?= ""

# kernel.bbclass copies ${UNPACKDIR}/defconfig only when ${B}/.config does
# not exist yet, "so recipes can manage the .config themselves in
# do_configure:prepend()" (oe-core scarthgap, kernel.bbclass).
do_configure:prepend() {
    base="${UNPACKDIR}/${PHOENIX_KERNEL_CONFIG}"
    if [ -z "${PHOENIX_KERNEL_CONFIG}" ] || [ ! -f "$base" ]; then
        bbfatal "PHOENIX_KERNEL_CONFIG (${PHOENIX_KERNEL_CONFIG}) is not a file the recipe fetched"
    fi
    cp "$base" ${B}/.config
    # The generic drivers, without demoting the device's built-ins.
    awk 'NR == FNR { if ($0 ~ /^CONFIG_[A-Za-z0-9_]+=y$/) { split($0, kv, "="); builtin[kv[1]] = 1 } next }
         /^CONFIG_[A-Za-z0-9_]+=m$/ { split($0, kv, "="); if (kv[1] in builtin) next }
         /^(CONFIG_|# CONFIG_)/ { print }' \
        ${B}/.config ${UNPACKDIR}/phoenix-hardware.cfg ${UNPACKDIR}/phoenix-hardware-arm.cfg \
        > ${B}/phoenix-hardware-device.cfg
    KCONFIG_CONFIG=${B}/.config ${S}/scripts/kconfig/merge_config.sh -m -O ${B} \
        ${B}/.config ${B}/phoenix-hardware-device.cfg ${UNPACKDIR}/phoenix-ose.cfg
}

# Every module packaged on its own (kernel-module-<name>), as for the
# generic kernels: the Hardware app can offer one later.
KERNEL_SPLIT_MODULES = "1"
