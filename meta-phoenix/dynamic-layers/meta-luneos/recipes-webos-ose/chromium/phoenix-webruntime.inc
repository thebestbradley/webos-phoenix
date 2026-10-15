# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# LuneOS's Chromium 151 web runtime (meta-luneos
# recipes-webos-ose/chromium/webruntime_151.bb, webos-ports/chromium151 at
# cacb244) with client hints that agree with the user agent Phoenix sets
# (docs/DECISIONS.md, 15 October 2026; phoenix-wam-conf).
#
# neva's client hints, when on, always say Chromium <151>, platform webOS,
# not mobile (src/neva/user_agent/common/user_agent.cc:54-75,
# GetDefaultUserAgentMetadata); the patch adds switches for the brand
# version, platform and mobile bit, each off by default. The marker file
# tells /etc/wam/plugins/conf.sh that this runtime takes them: on a runtime
# without the patch it leaves the client hints off.

FILESEXTRAPATHS:prepend := "${THISDIR}/files:"
SRC_URI += "file://0001-neva-user-agent-client-hints-that-agree-with-a-user-agent.patch"

do_install:append() {
    install -d ${D}${datadir}/phoenix
    echo "neva-user-agent-client-hints-brand-version neva-user-agent-client-hints-platform neva-user-agent-client-hints-mobile" \
        > ${D}${datadir}/phoenix/webruntime-client-hints
}
FILES:${PN} += "${datadir}/phoenix/webruntime-client-hints"
