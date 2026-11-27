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

# Tile memory. WebAppMgr's start script caps the memory Chromium keeps for
# each page's drawn tiles at 60 MB (MAX_GPU_MEM_LIMIT into
# --force-gpu-mem-available-mb, meta-webos-ports ec5e878
# recipes-webos-ose/wam/wam/webapp-mgr.sh.in:160, 214), a TV's budget: one
# 1080p screen and a small chip. A tile takes 4 bytes a pixel: 4 MB a
# screenful at the PineTab2's 1280x800, 16 MB at 2560x1600 (the Mac VM at
# Retina size), where a card's layers run past 60 MB and the tiles that do
# not fit are left undrawn: white blocks over parts of the page, at random,
# until something redraws (Settings, 27 November 2026; none with 512 MB in
# the same steps). It is a ceiling, not a reservation: a page takes what
# its layers need, and more room lets Chromium draw ahead of a scroll. What
# bounds it is memory (each card has its own, and the GPU shares the RAM):
# 512 MB with 3.5 GB of memory or more (MemTotal; a "4 GB" device reports
# about 3.8), 256 MB with 1.75 GB or more, else 128 MB; never less than
# twelve screenfuls of the largest connected screen (each connected DRM
# connector's preferred mode, the first line of its modes) nor the start
# script's own value. For the tests: PHOENIX_MEMINFO, PHOENIX_DRM_DIR.
phoenix_wam_mem_kb=$(sed -n 's/^MemTotal:[[:space:]]*\([0-9][0-9]*\) kB$/\1/p' "${PHOENIX_MEMINFO:-/proc/meminfo}" 2>/dev/null | head -n 1)
case $phoenix_wam_mem_kb in ''|*[!0-9]*|??????????*) phoenix_wam_mem_kb=0 ;; esac
if [ "$phoenix_wam_mem_kb" -ge 3670016 ]; then
    phoenix_wam_gpu_mb=512
elif [ "$phoenix_wam_mem_kb" -ge 1835008 ]; then
    phoenix_wam_gpu_mb=256
else
    phoenix_wam_gpu_mb=128
fi
for phoenix_wam_conn in "${PHOENIX_DRM_DIR:-/sys/class/drm}"/card*-*; do
    [ "$(cat "$phoenix_wam_conn/status" 2>/dev/null)" = connected ] || continue
    phoenix_wam_mode=$(head -n 1 "$phoenix_wam_conn/modes" 2>/dev/null)
    phoenix_wam_w=${phoenix_wam_mode%%x*}
    phoenix_wam_h=${phoenix_wam_mode#*x}
    phoenix_wam_h=${phoenix_wam_h%%[!0-9]*}
    case $phoenix_wam_w$phoenix_wam_h in ''|*[!0-9]*|0*) continue ;; esac
    case $phoenix_wam_w in ?????*) continue ;; esac
    case $phoenix_wam_h in ?????*) continue ;; esac
    phoenix_wam_mb=$(( (phoenix_wam_w * phoenix_wam_h * 4 * 12 + 1048575) / 1048576 ))
    [ "$phoenix_wam_mb" -le "$phoenix_wam_gpu_mb" ] || phoenix_wam_gpu_mb=$phoenix_wam_mb
done

# The web inspector, only in Developer Mode. WebAppMgr's start script turns
# Chromium's remote debugging on for every image, on port 9998
# (meta-webos-ports ec5e878 recipes-webos-ose/wam/wam/webapp-mgr.sh.in:222,
# WAM_COMMON_SWITCHES; OSE's the same), so anyone who could reach that port
# could inspect and drive every web app, the Lock Screen's PIN entry and
# Accounts' sign-ins included. This file is sourced after the switches are
# built (webapp-mgr.sh.in:278-279), so it takes the port away unless
# Developer Mode is on (Developer Mode's flag file: OSE's
# com.palm.service.devmode, devmode_service.js:20-27 at 94b6921, which
# Phoenix's provider, services/devmode, keeps too). In Developer
# Mode it listens on the device's loopback only: a computer reaches it
# through the developer's paired connection (nova forward, SSH), never
# straight over the network (docs/DEV-HELPER.md 9, 13).
# For the tests: PHOENIX_DEVMODE_FLAG.
phoenix_wam_switches=""
for phoenix_wam_switch in $WAM_SWITCHES; do
    case $phoenix_wam_switch in
        --remote-debugging-port=*|--remote-debugging-address=*) ;;
        --force-gpu-mem-available-mb=*)
            # The tile budget above, where it is larger than the start
            # script's (a value that is not a plain number stays as it is).
            case ${phoenix_wam_switch#*=} in
                ''|*[!0-9]*|?????*) ;;
                *) [ "$phoenix_wam_gpu_mb" -le "${phoenix_wam_switch#*=}" ] \
                       || phoenix_wam_switch=--force-gpu-mem-available-mb=$phoenix_wam_gpu_mb ;;
            esac
            phoenix_wam_switches="$phoenix_wam_switches $phoenix_wam_switch" ;;
        *) phoenix_wam_switches="$phoenix_wam_switches $phoenix_wam_switch" ;;
    esac
done
if [ -e "${PHOENIX_DEVMODE_FLAG:-/var/luna/preferences/devmode_enabled}" ]; then
    phoenix_wam_switches="$phoenix_wam_switches --remote-debugging-port=9998 --remote-debugging-address=127.0.0.1"
fi
WAM_SWITCHES=$phoenix_wam_switches
export WAM_SWITCHES

unset phoenix_ua_anchor phoenix_ua_period phoenix_ua_now phoenix_ua_major \
    phoenix_ua_device_json phoenix_ua_form phoenix_ua_mobile \
    phoenix_wam_switches phoenix_wam_switch phoenix_wam_gpu_mb phoenix_wam_mb \
    phoenix_wam_conn phoenix_wam_mode phoenix_wam_w phoenix_wam_h phoenix_wam_mem_kb
