# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "A Bluetooth L2CAP channel on standard input and output"
DESCRIPTION = "phoenix-l2cap ADDRESS PSM: opens a connection-oriented L2CAP \
channel to a paired Bluetooth device and relays its packets, each framed \
by a two-byte length, over standard input and output \
(services/l2cap/l2cap.c). The accessories service runs it for the AirPods' \
control channel (PSM 0x1001: batteries, ear detection, listening modes; \
docs/ACCESSORIES.md), as Node.js has no Bluetooth sockets. Phoenix's own, \
Apache-2.0; it needs only the kernel's Bluetooth sockets (BlueZ's headers \
are not used)."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/support"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://../../LICENSE;md5=89aea4e17d99a7cacdbeed46a0096b10"

PHOENIX_SRCREV ?= "${AUTOREV}"
PHOENIX_BRANCH ?= "main"
SRC_URI = "git://github.com/thebestbradley/webos-phoenix.git;protocol=https;branch=${PHOENIX_BRANCH}"
SRCREV = "${PHOENIX_SRCREV}"
PV = "0.1.0+git"

S = "${WORKDIR}/git/services/l2cap"

inherit cmake
