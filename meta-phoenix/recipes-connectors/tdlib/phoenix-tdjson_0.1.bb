# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# phoenix-tdjson (files/phoenix-tdjson.c): TDLib's JSON interface on
# standard input and output, the system helper the Unofficial Telegram
# account starts (apps/telegram; the connector kit's device.ts HELPERS).
#
# And the account's build-time settings: Telegram's api_id and api_hash
# for Phoenix (registered by the Phoenix project account,
# docs/OPEN-QUESTIONS.md Q16), never in the source tree. Set them in the
# build's local.conf:
#
#   PHOENIX_TELEGRAM_API_ID = "1234567"
#   PHOENIX_TELEGRAM_API_HASH = "0123456789abcdef0123456789abcdef"
#
# and they are written to /etc/phoenix/connectors/
# org.webosphoenix.service.telegram.json, which the connector reads
# (ctx.setting). Without them the account says "not available in this
# build". They can be read from an image, as every open-source Telegram
# client's can (docs/PLATFORM.md 6.5).

SUMMARY = "TDLib's JSON interface on stdin/stdout, for Phoenix's Telegram account"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

SRC_URI = "file://phoenix-tdjson.c"
S = "${WORKDIR}"

DEPENDS = "tdlib"

PHOENIX_TELEGRAM_API_ID ??= ""
PHOENIX_TELEGRAM_API_HASH ??= ""
# Rebuilt when the settings change.
do_install[vardeps] += "PHOENIX_TELEGRAM_API_ID PHOENIX_TELEGRAM_API_HASH"

do_compile() {
    ${CC} ${CFLAGS} ${LDFLAGS} -std=c11 -D_GNU_SOURCE -o phoenix-tdjson phoenix-tdjson.c -ltdjson -lpthread
}

do_install() {
    install -d ${D}${bindir}
    install -m 0755 phoenix-tdjson ${D}${bindir}/phoenix-tdjson
    if [ -n "${PHOENIX_TELEGRAM_API_ID}" ] && [ -n "${PHOENIX_TELEGRAM_API_HASH}" ]; then
        install -d ${D}${sysconfdir}/phoenix/connectors
        printf '{"apiId": %s, "apiHash": "%s"}\n' "${PHOENIX_TELEGRAM_API_ID}" "${PHOENIX_TELEGRAM_API_HASH}" \
            > ${D}${sysconfdir}/phoenix/connectors/org.webosphoenix.service.telegram.json
        chmod 0600 ${D}${sysconfdir}/phoenix/connectors/org.webosphoenix.service.telegram.json
    fi
}

FILES:${PN} = "${bindir}/phoenix-tdjson ${sysconfdir}/phoenix/connectors"
RDEPENDS:${PN} = "tdlib"
