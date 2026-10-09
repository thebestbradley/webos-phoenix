# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

require recipes-core/images/webos-image.bb

DESCRIPTION = "webOS OSE image with the Phoenix mobile shell"

IMAGE_INSTALL:append = " phoenix-shell phoenix-apps phoenix-pty phoenix-devices packagegroup-phoenix-terminal \
    packagegroup-phoenix-assistant"

# Hardware (docs/HARDWARE.md, "Hardware support and the Hardware app"):
# every open source kernel module the kernel was built with (the
# phoenix-hardware*.cfg fragments), loaded by modalias when the hardware is
# there; opkg and its database (webOS images keep "package-management"),
# which org.webosphoenix.hardware installs firmware and extra drivers with.
IMAGE_INSTALL:append = " kernel-modules opkg"

# No firmware that is not open source in the image (phoenix-firmware-policy):
# the Hardware app offers it. The Raspberry Pi 4 recommends its Wi-Fi and
# Bluetooth firmware (meta-raspberrypi raspberrypi4-64.conf); a Pi has
# Ethernet to download it with.
inherit phoenix-firmware-policy
BAD_RECOMMENDATIONS:append:raspberrypi4 = " linux-firmware-rpidistro-bcm43455 linux-firmware-rpidistro-bcm43456 \
    bluez-firmware-rpidistro-bcm4345c0-hcd bluez-firmware-rpidistro-bcm4345c5-hcd"
