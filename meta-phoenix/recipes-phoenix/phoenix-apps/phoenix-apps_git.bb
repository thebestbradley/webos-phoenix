# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "Original Open webOS apps and frameworks, and the Phoenix web app runtime"
DESCRIPTION = "Installs the Open webOS core apps (Accounts, Calculator, \
Calendar, Clock, Contacts, Email, Memos), Enyo 1.0, MojoLoader and the \
foundation/loadable frameworks at their original device paths \
(/usr/palm/applications, /usr/palm/frameworks), plus Phoenix web apps, their \
Node.js Luna services (/usr/palm/services, e.g. org.webosphoenix.filemanager \
for Files, org.webosphoenix.transcriber for Voice Memos, \
org.webosphoenix.service.dav for CardDAV & CalDAV accounts, the shell's \
line to the pages, the legacy application manager, DropShare and the \
accessories, and Open webOS's app services, with luna-service2 role and \
permission files), db8 kinds and activities (/etc/palm), account templates \
(/usr/palm/public/accounts), phoenix-runtime.js and the system sounds \
(/usr/palm/sounds from Open webOS, /usr/share/phoenix/sounds), using \
tools/install-rootfs.py."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/apps"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://LICENSE;md5=89aea4e17d99a7cacdbeed46a0096b10"

PHOENIX_SRCREV ?= "${AUTOREV}"
PHOENIX_BRANCH ?= "main"
# gitsm: the original apps and frameworks are git submodules (third_party/).
SRC_URI = "gitsm://github.com/thebestbradley/webos-phoenix.git;protocol=https;branch=${PHOENIX_BRANCH}"
SRCREV = "${PHOENIX_SRCREV}"
PV = "0.1.0+git"

S = "${WORKDIR}/git"

inherit allarch python3native

# The system sounds' raw PCM twins (below): mpg123 decodes the MP3s.
DEPENDS = "mpg123-native"

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    ${PYTHON} ${S}/tools/install-rootfs.py ${D}
    # OSE's audiod plays raw PCM only (no MP3, no WAV header): every system
    # sound, ringtone and app sound gets "<file>.pcm", 16-bit 44.1 kHz
    # stereo, which the shell plays (tools/sounds-to-pcm.py,
    # LsmWindowSource.playSound).
    MPG123=${STAGING_BINDIR_NATIVE}/mpg123 ${PYTHON} ${S}/tools/sounds-to-pcm.py \
        ${D}${prefix}/palm/sounds ${D}${datadir}/phoenix/sounds \
        ${D}${prefix}/palm/applications ${D}/media/internal/ringtones
    ${PYTHON} ${S}/tools/sounds-to-pcm.py --check ${D}${prefix}/palm/sounds ${D}${datadir}/phoenix/sounds
}

FILES:${PN} = " \
    /media/internal/ringtones \
    /media/internal/samples \
    ${prefix}/palm/applications \
    ${prefix}/palm/frameworks \
    ${prefix}/palm/services \
    ${prefix}/palm/public \
    ${prefix}/palm/sounds \
    ${datadir}/phoenix/runtime \
    ${datadir}/phoenix/sounds \
    ${datadir}/luna-service2 \
    ${sysconfdir}/palm \
"

# Web apps run in WebAppMgr; their data lives in db8. The apps' own Luna
# services (Files, Voice Memos, CardDAV & CalDAV) are JavaScript services:
# run-js-service and webos-service. Voice Memos' transcriber also wants
# whisper.cpp (the whisper-cpp recipe stub) and answers "not installed"
# without it.
# Open webOS's app services (accounts, contacts, the linker, calendar
# reminders: compat/app-services) are Mojo-era services, which OSE's
# mojoservicelauncher runs.
RDEPENDS:${PN} = "${VIRTUAL-RUNTIME_webappmanager} db8 nodejs nodejs-module-webos-service mojoservicelauncher"
