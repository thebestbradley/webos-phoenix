# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "Original Open webOS apps and frameworks, and the Phoenix web app runtime"
DESCRIPTION = "Installs the Open webOS core apps (Accounts, Calculator, \
Calendar, Clock, Contacts, Email, Memos), Enyo 1.0, MojoLoader and the \
foundation/loadable frameworks at their original device paths \
(/usr/palm/applications, /usr/palm/frameworks), plus Phoenix web apps, their \
Node.js Luna services (/usr/palm/services, e.g. org.webosphoenix.filemanager \
for Files, org.webosphoenix.transcriber for Voice Memos and \
org.webosphoenix.service.dav for CardDAV & CalDAV accounts, with \
luna-service2 role and permission files), account templates \
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

# The built web apps. React, Enact and Flutter apps install from their dist/
# and the Node services' shared packages from their lib/, which npm builds;
# BitBake allows no network in do_compile, so they are built outside it
# (tools/pack-apps-dist.sh, or CI's "apps-dist" artifact for the commit) and
# the archive is named in local.conf:
#   PHOENIX_APPS_DIST = "/path/to/apps-dist.tar.gz"
# It is unpacked over the checkout. Without it do_install stops with "the
# app is not built" (tools/install-rootfs.py) instead of an image without
# them (docs/PRE-IMAGE-CHECKLIST.md B3).
PHOENIX_APPS_DIST ??= ""
SRC_URI += "${@'file://%s;subdir=git' % d.getVar('PHOENIX_APPS_DIST') if d.getVar('PHOENIX_APPS_DIST') else ''}"
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

# Everything install-rootfs.py installs (tools/check-image.py checks this
# list against it: a path left out stops do_package, installed-vs-shipped):
# the apps, frameworks, services, account templates and sounds under
# /usr/palm; Just Type and the system alerts' pages under /usr/lib/luna;
# the services' and apps' luna-service2 files (with each app's generated
# role and permissions); their /etc/palm configuration (db8 kinds, backup
# registrations, the update, Marketplace and Hardware sources).
FILES:${PN} = " \
    /media/internal/ringtones \
    /media/internal/samples \
    ${prefix}/palm \
    ${prefix}/lib/luna \
    ${datadir}/phoenix/runtime \
    ${datadir}/phoenix/sounds \
    ${datadir}/luna-service2 \
    ${sysconfdir}/palm \
"

# Web apps run in WebAppMgr; their data lives in db8. The apps' own Luna
# services (Files, Voice Memos, CardDAV & CalDAV) are JavaScript services:
# run-js-service (mojoservicelauncher, which their .service files' Exec
# names; webos-image only brings it through a VIRTUAL-RUNTIME that some
# machines empty) and webos-service. Voice Memos' transcriber also wants
# whisper.cpp (the whisper-cpp recipe stub) and answers "not installed"
# without it.
RDEPENDS:${PN} = "${VIRTUAL-RUNTIME_webappmanager} db8 nodejs nodejs-module-webos-service mojoservicelauncher"
