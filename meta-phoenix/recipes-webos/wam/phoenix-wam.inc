# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# WebAppMgr (OSE's wam, or WebOS-ports' fork on LuneOS's layers; both build
# as wam-clang, WEBRUNTIME_TOOLCHAIN = "-clang") with the user agent
# Phoenix sets: /etc/wam/plugins/conf.sh (phoenix-wam-conf) computes it at
# each start; docs/DECISIONS.md, 15 October 2026.
#
# 1. The patch: WebAppMgr adds " $WAM_NAME" to the runtime's user agent
#    for every page (src/platform/webengine/web_page_blink.cc, OSE's
#    a486711 lines 92-94, WebOS-ports' 2e6fcb6 lines 179-181); with an
#    empty WAM_NAME it now adds nothing, not a trailing space.
# 2. The start line: webapp-mgr.sh starts WebAppMgr with its switches in
#    unquoted variables (meta-webosose d7ed46c
#    recipes-webos/wam/wam/webapp-mgr.sh.in:247, meta-webos-ports ec5e878
#    recipes-webos-ose/wam/wam/webapp-mgr.sh.in:282), which split a
#    user agent at its spaces. The line gets one quoted argument more,
#    --user-agent=$PHOENIX_USER_AGENT, when conf.sh (sourced just before,
#    lines 243-244 and 278-279) has set it. Edited the way meta-webosose's
#    and meta-luneos's wam.inc edit the same script (install_units:append).

FILESEXTRAPATHS:prepend := "${THISDIR}/files:"
SRC_URI += "file://0001-WebPageBlink-do-not-append-an-empty-WAM_NAME-to-the-.patch"

install_units:append() {
    script=${D}${systemd_system_unitdir}/scripts/webapp-mgr.sh
    if [ ! -f "$script" ]; then
        bbfatal "phoenix-wam: webapp-mgr.sh is not installed where expected ($script)"
    fi
    sed -i '/^exec \$WAM_EXE_PATH /s/$/ ${PHOENIX_USER_AGENT:+"--user-agent=$PHOENIX_USER_AGENT"}/' "$script"
    grep -q '^exec \$WAM_EXE_PATH .*PHOENIX_USER_AGENT:+"--user-agent=\$PHOENIX_USER_AGENT"}$' "$script" || \
        bbfatal "phoenix-wam: webapp-mgr.sh's start line was not changed"
}
