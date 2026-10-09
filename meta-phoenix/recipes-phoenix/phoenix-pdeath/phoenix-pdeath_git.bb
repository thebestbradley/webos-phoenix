# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "Runs a program that ends when its parent dies"
DESCRIPTION = "phoenix-pdeath SIGNAL -- PROGRAM [ARGS...]: \
prctl(PR_SET_PDEATHSIG), then exec. The Assistant service starts \
llama-server through it, so a service that dies (even killed outright) \
does not leave the model running (services/pdeath/pdeath.c; \
apps/assistant/service/lib/node-device.js). Phoenix's own, Apache-2.0, \
in place of util-linux's GPL-2.0 setpriv --pdeathsig."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/support"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://../../LICENSE;md5=89aea4e17d99a7cacdbeed46a0096b10"

PHOENIX_SRCREV ?= "${AUTOREV}"
PHOENIX_BRANCH ?= "main"
SRC_URI = "git://github.com/thebestbradley/webos-phoenix.git;protocol=https;branch=${PHOENIX_BRANCH}"
SRCREV = "${PHOENIX_SRCREV}"
PV = "0.1.0+git"

S = "${WORKDIR}/git/services/pdeath"

inherit cmake
