# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "webOS Phoenix Terminal PTY service (org.webosphoenix.pty)"
DESCRIPTION = "The Luna service that owns the Terminal app's shells: a PTY \
per session (forkpty), output as replies on the page's subscription with \
flow control, and only org.webosphoenix.terminal may open one. Runs as the \
unprivileged device user under systemd, never as root (docs/TERMINAL.md)."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/services"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://../../LICENSE;md5=89aea4e17d99a7cacdbeed46a0096b10"

PHOENIX_SRCREV ?= "${AUTOREV}"
PHOENIX_BRANCH ?= "main"
SRC_URI = "git://github.com/thebestbradley/webos-phoenix.git;protocol=https;branch=${PHOENIX_BRANCH}"
SRCREV = "${PHOENIX_SRCREV}"
PV = "0.1.0+git"

S = "${WORKDIR}/git/services/pty"

inherit cmake pkgconfig systemd useradd

EXTRA_OECMAKE = "-DPHOENIX_PTY_SYSTEMD_UNITDIR=${systemd_system_unitdir} -DPHOENIX_PTY_TESTS=OFF"

DEPENDS = "luna-service2 glib-2.0"

# The device's user account, which every Terminal shell runs as (uid 1000,
# home /home/user, bash). Developer Mode (sudo, SSH; phoenix-devmode, not
# written yet) will build on it.
USERADD_PACKAGES = "${PN}"
USERADD_PARAM:${PN} = "--uid 1000 --home-dir /home/user --create-home --shell /bin/bash --user-group user"

SYSTEMD_SERVICE:${PN} = "phoenix-pty.service"
SYSTEMD_AUTO_ENABLE = "enable"

FILES:${PN} += " \
    ${datadir}/luna-service2 \
    ${systemd_system_unitdir}/phoenix-pty.service \
"

# The shells and tools come from packagegroup-phoenix-terminal.
RDEPENDS:${PN} = "bash"
