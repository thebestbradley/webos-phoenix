# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "System helpers of Phoenix's messaging accounts"
DESCRIPTION = "The programs some connector packages start (the connector \
kit's system helpers, device.ts HELPERS): Delta Chat's core \
(deltachat-rpc-server, MPL-2.0) for the Delta Chat account; TDLib's JSON \
interface (phoenix-tdjson over libtdjson, BSL-1.0) for the Unofficial \
Telegram account, only in a build that has Telegram's api_id \
(PHOENIX_TELEGRAM_API_ID, phoenix-tdjson's recipe). Without them the \
accounts say they are not available in this build."
LICENSE = "Apache-2.0"

inherit packagegroup

PHOENIX_TELEGRAM_API_ID ??= ""

RDEPENDS:${PN} = " \
    deltachat-rpc-server \
    ${@'phoenix-tdjson' if d.getVar('PHOENIX_TELEGRAM_API_ID') else ''} \
"
