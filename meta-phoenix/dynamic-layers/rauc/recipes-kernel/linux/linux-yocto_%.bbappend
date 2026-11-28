# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# RAUC's kernel options (files/phoenix-rauc.cfg) on the machines with A/B
# slots (PHOENIX_RAUC = "1", which a machine has where meta-rauc is in the
# build, as this dynamic layer is): phoenix-vm-arm64 first. The phones' and
# tablets' own kernels (linux-phoenix-*) get them with their slots.

FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI:append:phoenix-vm-arm64 = " file://phoenix-rauc.cfg"
