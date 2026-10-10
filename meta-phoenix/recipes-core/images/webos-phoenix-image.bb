# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

require recipes-core/images/webos-image.bb

DESCRIPTION = "webOS OSE image with the Phoenix mobile shell"

# A production image (docs/PRE-IMAGE-CHECKLIST.md X1, OPEN-QUESTIONS Q66):
# OSE builds every image as a pre-release unless WEBOS_DISTRO_PRERELEASE is
# empty ("devel" by default, webos_prerelease_dep.bbclass), which brings
# debug-tweaks (root without a password) and a Dropbear SSH server that
# starts at boot (webos_image.bbclass). PHOENIX_PRODUCTION = "1" in
# local.conf takes both out of this image whatever the distro says;
# Developer Mode is then the way in.
PHOENIX_PRODUCTION ?= "0"
IMAGE_FEATURES:remove = "${@'debug-tweaks ssh-server-dropbear ssh-server-openssh' if d.getVar('PHOENIX_PRODUCTION') == '1' else ''}"

IMAGE_INSTALL:append = " phoenix-shell phoenix-apps phoenix-pty phoenix-devices phoenix-diag packagegroup-phoenix-terminal \
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
