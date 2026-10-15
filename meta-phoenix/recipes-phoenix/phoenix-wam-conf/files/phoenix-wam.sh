# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# /etc/wam/plugins/conf.sh: webOS Phoenix's settings for WebAppMgr, the web
# runtime every web app runs in. WebAppMgr's start script sources this file
# just before it starts WebAppMgr, each time it starts (webapp-mgr.sh.in:
# meta-webosose d7ed46c recipes-webos/wam/wam/webapp-mgr.sh.in:243-247,
# meta-webos-ports ec5e878 recipes-webos-ose/wam/wam/webapp-mgr.sh.in:278-282),
# so what it computes is fresh at every boot. A sourced file: no exit, and
# its names start with phoenix_ / PHOENIX_.
#
# The user agent (docs/DECISIONS.md, 15 October 2026; docs/APP-RUNTIME.md,
# "The user agent"): what Chrome on Android sends, with the current Chrome
# stable major version, so that sites serve the device as the current
# browser it nearly is (the engine is Chromium 151 on LuneOS's layers, 120
# on OSE's), and the same as the simulator's:
#
#   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko)
#       Chrome/<major>.0.0.0 [Mobile ]Safari/537.36
#
#   - Chrome's reduced user agent: the platform frozen at "Linux; Android
#     10; K", the version at <major>.0.0.0; "Mobile" on a phone, not on a
#     tablet (as Chrome on an Android tablet).
#   - <major>: Chrome's stable major on today's date, from Chrome's 4-week
#     release cadence anchored at Chrome 155's stable release on 6 October
#     2026: 155 + whole 28-day periods since. Never lower than 155, so a
#     clock not yet set (1970, before NTP) still names a current Chrome.
#     PHOENIX_UA_CHROME_MAJOR (a whole number, 1 to 9999) names one instead,
#     the variable the simulator reads too; WebAppMgr's unit reads
#     /var/systemd/system/env/webapp-mgr.env (webapp-mgr.service,
#     EnvironmentFile), where a developer can set it.
#   - No webOS, Web0S, WebAppManager or QtWebEngine token: sites read those
#     as LG's TVs or Palm's 2011 browser and turn the page away.
#
# The runtime takes the user agent from its --user-agent switch (neva, in
# webos-ports/chromium151 and OSE's chromium120 alike:
# src/neva/user_agent/common/user_agent.cc:36-46, GetDefaultUserAgent), for
# pages (src/neva/app_runtime/webview_base.cc:68-70, 112-123 in 151) and the
# network's default (app_runtime_content_browser_client.cc:977-979, 1026).
# WebAppMgr appends " $WAM_NAME" to it for each page
# (src/platform/webengine/web_page_blink.cc:179-181 in WebOS-ports' wam,
# 92-94 in OSE's); meta-phoenix's wam patch appends nothing for an empty
# WAM_NAME. The switch has spaces in it, which WAM_EXTRA_FLAGS cannot carry
# (the start line splits it on spaces), so meta-phoenix's wam bbappend
# gives the start line one more argument, "--user-agent=$PHOENIX_USER_AGENT".
#
# The client hints (Sec-CH-UA*, navigator.userAgentData) must agree with
# it: brands Chromium <major> and Chromium's GREASE brand, platform
# Android, mobile on phones. A runtime that takes meta-phoenix's
# client-hint switches (the webruntime 151 patch, LuneOS's layers) says so
# with /usr/share/phoenix/webruntime-client-hints; on any other, the
# client hints stay off, which for a user agent set this way means none are
# sent (a UA override without metadata, Chromium's user_agent_metadata.h:
# 97-100), rather than ones saying webOS.
#
# For the tests (tools/test-wam-user-agent.py): PHOENIX_UA_NOW (seconds
# since 1970, UTC), PHOENIX_DEVICE_JSON, PHOENIX_UA_CLIENT_HINTS_FILE.

phoenix_ua_anchor=1791244800    # 2026-10-06T00:00:00Z, Chrome 155's stable release
phoenix_ua_period=2419200       # 28 days
phoenix_ua_now=${PHOENIX_UA_NOW:-$(date -u +%s 2>/dev/null)}
case $phoenix_ua_now in ''|*[!0-9]*) phoenix_ua_now=0 ;; esac
phoenix_ua_major=155
if [ "$phoenix_ua_now" -gt "$phoenix_ua_anchor" ]; then
    phoenix_ua_major=$((155 + (phoenix_ua_now - phoenix_ua_anchor) / phoenix_ua_period))
fi
# No leading zero (shell arithmetic would read it as octal), at most four digits.
case ${PHOENIX_UA_CHROME_MAJOR:-} in
    ''|*[!0-9]*|0*|?????*) ;;
    *) phoenix_ua_major=$PHOENIX_UA_CHROME_MAJOR ;;
esac

# The form factor: /etc/phoenix/device.json (phoenix-device-config, per
# machine; on the VM, phoenix-device-select links the chosen device's). A
# "phone" is mobile; a "tablet", and "auto" (QEMU, the Raspberry Pi: the
# shell picks its layout from the screen, after this has run), are not.
phoenix_ua_device_json=${PHOENIX_DEVICE_JSON:-/etc/phoenix/device.json}
phoenix_ua_form=$(sed -n 's/.*"formFactor"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p' "$phoenix_ua_device_json" 2>/dev/null | head -n 1)
phoenix_ua_mobile=""
if [ "$phoenix_ua_form" = phone ]; then
    phoenix_ua_mobile="Mobile "
fi

PHOENIX_USER_AGENT="Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$phoenix_ua_major.0.0.0 ${phoenix_ua_mobile}Safari/537.36"
export PHOENIX_USER_AGENT
WAM_NAME=""
export WAM_NAME

if [ -e "${PHOENIX_UA_CLIENT_HINTS_FILE:-/usr/share/phoenix/webruntime-client-hints}" ]; then
    WAM_EXTRA_FLAGS="$WAM_EXTRA_FLAGS --enable-neva-user-agent-client-hints"
    WAM_EXTRA_FLAGS="$WAM_EXTRA_FLAGS --neva-user-agent-client-hints-brand-version=$phoenix_ua_major"
    WAM_EXTRA_FLAGS="$WAM_EXTRA_FLAGS --neva-user-agent-client-hints-platform=Android"
    if [ -n "$phoenix_ua_mobile" ]; then
        WAM_EXTRA_FLAGS="$WAM_EXTRA_FLAGS --neva-user-agent-client-hints-mobile"
    fi
    export WAM_EXTRA_FLAGS
fi

unset phoenix_ua_anchor phoenix_ua_period phoenix_ua_now phoenix_ua_major \
    phoenix_ua_device_json phoenix_ua_form phoenix_ua_mobile
