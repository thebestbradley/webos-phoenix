# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# STUB: never built yet, and not part of webos-phoenix-image. It records how
# the torch gets onto the image for the Flashlight app (apps/flashlight) and
# QR Scanner's light button, which call org.webosports.service.torch:
#
#   torchd (this recipe)   LuneOS's service, used unchanged: getStatus
#                          {subscribe} -> {available, on, brightness},
#                          set {on} | {brightness: 0-100}, toggle. The
#                          simulator implements the same API
#                          (runtime/phoenix-runtime.js, block "Torch").
#   nyx "Torch" module     NYX_DEVICE_LED "Torch" from LuneOS's fork of
#                          nyx-modules (src/led_torch, Apache-2.0). OSE's
#                          own nyx-modules has no torch module, so the image
#                          needs LuneOS's nyx-modules (meta-webos-ports) or
#                          that module added to OSE's with a bbappend.
#
# What backs it on a device (led_torch.c): the kernel LED class. The node
# comes from /etc/nyx.conf or is found under /sys/class/leds (the first
# name with "torch", else with "flash"); writing <node>/brightness lights it, scaled from the
# 0-100 request to <node>/max_brightness. On LEDS_CLASS_FLASH devices that
# brightness is the torch current (flash_brightness/flash_strobe, the
# camera flash, are left alone). Qualcomm's qpnp-flash-v2 (sargo, tissot)
# also needs its switch node set to 1 after the current is armed.
# MediaTek phones (CONFIG_MTK_FLASHLIGHT) have /dev/flashlight ioctls
# instead. On Halium the hybris module asks Android's camera service (on/off
# only; brightness saturates to 0 or 100).
#
# Access: torchd's sysbus files put its methods in the torch.operation
# group, which Flashlight and QR Scanner list in requiredPermissions.

SUMMARY = "torchd: the camera flash LED as a torch on the Luna bus (org.webosports.service.torch)"
HOMEPAGE = "https://github.com/webOS-ports/org.webosports.service.torch"
SECTION = "webos/services"
LICENSE = "Apache-2.0"
# No LICENSE file in the repository; the SPDX header of the one source file.
LIC_FILES_CHKSUM = "file://src/main.c;beginline=1;endline=15;md5=b328e4049199e707f885ea82cc557e65"

DEPENDS = "glib-2.0 luna-service2 nyx-lib libpbnjson"
RDEPENDS:${PN} = "nyx-modules"

SRC_URI = "git://github.com/webOS-ports/org.webosports.service.torch.git;protocol=https;branch=master"
# master on 2026-09-01.
SRCREV = "d447e6f92b1a46b8597e93571c33ace45b7760a5"
PV = "1.0.0+git"

S = "${WORKDIR}/git"

inherit webos_cmake webos_system_bus webos_daemon pkgconfig
