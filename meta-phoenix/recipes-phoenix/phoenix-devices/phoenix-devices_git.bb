# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "webOS Phoenix device services (com.palm.display, keys, vibrate, ambientLightSensor)"
DESCRIPTION = "LunaSysMgr's device services, which webOS OSE does not have, \
for the apps of webOS 1-3 and Phoenix's: the display's state (from the \
Phoenix shell) and the backlight (sysfs), the volume, power, media and \
headset keys and the switches (evdev), the vibrator (force feedback, the \
LED class's transient trigger or timed_output) and the light sensor (IIO), \
found by looking and followed as they come and go (inotify, kernel uevents; \
no libudev). phoenix-devices --probe prints what it finds. \
See docs/HARDWARE.md."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/services"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://../../LICENSE;md5=89aea4e17d99a7cacdbeed46a0096b10"

PHOENIX_SRCREV ?= "${AUTOREV}"
PHOENIX_BRANCH ?= "main"
SRC_URI = "git://github.com/thebestbradley/webos-phoenix.git;protocol=https;branch=${PHOENIX_BRANCH}"
SRCREV = "${PHOENIX_SRCREV}"
PV = "0.1.0+git"

S = "${WORKDIR}/git/services/devices"

inherit cmake pkgconfig systemd

EXTRA_OECMAKE = "-DPHOENIX_DEVICES_SYSTEMD_UNITDIR=${systemd_system_unitdir} -DPHOENIX_DEVICES_TESTS=OFF"

DEPENDS = "luna-service2 glib-2.0"

SYSTEMD_SERVICE:${PN} = "phoenix-devices.service"
SYSTEMD_AUTO_ENABLE = "enable"

FILES:${PN} += " \
    ${datadir}/luna-service2 \
    ${systemd_system_unitdir}/phoenix-devices.service \
"
