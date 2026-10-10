# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

require recipes-core/images/webos-image.bb

DESCRIPTION = "webOS OSE image with the Phoenix mobile shell"

IMAGE_INSTALL:append = " phoenix-shell phoenix-keyboard phoenix-apps phoenix-pty phoenix-devices packagegroup-phoenix-terminal \
    packagegroup-phoenix-assistant"

# Hardware (docs/HARDWARE.md, "Hardware support and the Hardware app"):
# every open source kernel module the kernel was built with (the
# phoenix-hardware*.cfg fragments), loaded by modalias when the hardware is
# there; opkg and its database (webOS images keep "package-management"),
# which org.webosphoenix.hardware installs firmware and extra drivers with.
IMAGE_INSTALL:append = " kernel-modules opkg"

# Firmware (docs/HARDWARE.md, "Firmware in the image"; docs/LEGAL.md,
# "Firmware and drivers"): the redistributable firmware for common hardware,
# with its licence files, so it works out of the box; machines add their
# own (the Raspberry Pi 4's Wi-Fi and Bluetooth, MACHINE_EXTRA_RRECOMMENDS;
# phones' adaptation packages). phoenix-firmware-policy fails the image for
# firmware whose licence does not allow redistribution and lists the rest
# with its licences in /usr/share/phoenix/firmware/licences.json.
# PHOENIX_FIRMWARE_EXCLUDE: firmware packages to leave out (a small image);
# the Hardware app offers them.
IMAGE_INSTALL:append = " packagegroup-phoenix-firmware"
PHOENIX_FIRMWARE_EXCLUDE ?= ""
BAD_RECOMMENDATIONS:append = " ${PHOENIX_FIRMWARE_EXCLUDE}"
inherit phoenix-firmware-policy
