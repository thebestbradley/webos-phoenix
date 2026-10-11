# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "System helpers of Phoenix's messaging accounts"
DESCRIPTION = "The programs some connector packages start (the connector \
kit's system helpers, device.ts HELPERS), in a build that is set up for \
them: TDLib's JSON interface (phoenix-tdjson over libtdjson, BSL-1.0) for \
the Unofficial Telegram account, with Telegram's api_id \
(PHOENIX_TELEGRAM_API_ID, phoenix-tdjson's recipe); Delta Chat's core \
(deltachat-rpc-server, MPL-2.0) for the Delta Chat account, when the owner \
allows its licence (PHOENIX_DELTACHAT = \"1\"; docs/OPEN-QUESTIONS.md Q89). \
Without them the accounts say they are not available in this build."
LICENSE = "Apache-2.0"

inherit packagegroup

PHOENIX_TELEGRAM_API_ID ??= ""
PHOENIX_DELTACHAT ??= "0"

RDEPENDS:${PN} = " \
    ${@'phoenix-tdjson' if d.getVar('PHOENIX_TELEGRAM_API_ID') else ''} \
    ${@'deltachat-rpc-server' if d.getVar('PHOENIX_DELTACHAT') == '1' else ''} \
"
