# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "webOS Phoenix's additions to OSE's settingsservice: the keys it keeps and who may set them"
DESCRIPTION = "OSE's settingsservice (com.webos.settingsservice) keeps only \
the keys its descriptions name, and serves a caller any key only when the hub \
lets that caller call its *Priv methods; otherwise only the keys \
/etc/palm/settingsservice.allow lists (LuneOS's: three). No api file named \
the *Priv methods, so every app and the shell got \"Access denied\", and \
picture.backlight (the brightness the shell draws and Settings sets) had no \
description, so even a privileged set failed with errorKey. On the 2.0 \
Revision 34 image the Brightness slider moved, but nothing was kept or \
drawn. This installs a description for picture.backlight in \
settingsservice's drop-in folder (/etc/palm/settings/defaults/*.description.json, \
PrefsKeyDescMap::loadDescFilesForEachApp) and an api file, with its \
manifest, that puts the *Priv methods in settings.management, the group \
the shell and Settings hold for setSystemSettings."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
SECTION = "webos/base"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

SRC_URI = "file://phoenix.description.json \
    file://phoenix-settingsservice-priv.api.json \
    file://phoenix-settingsservice-priv.manifest.json \
    file://phoenix-settings-desc \
    file://phoenix-settings-desc.service"
S = "${UNPACKDIR}"

inherit allarch systemd

# The drop-in is read at settingsservice's start, but a set is also checked
# against the descriptions in its db8 store, which only setSystemSettingDesc
# fills: on the 2.0 Revision 37 image the drop-in alone still answered
# errorKey for picture.backlight. phoenix-settings-desc.service sets each
# description of the drop-in at every boot, after settingsservice and
# before the shell (checked on the Revision 37 VM: described at 2.9 s, the
# shell keeps its level, Settings' set is kept, the screen dims).
SYSTEMD_SERVICE:${PN} = "phoenix-settings-desc.service"
SYSTEMD_AUTO_ENABLE = "enable"

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${sysconfdir}/palm/settings/defaults
    install -m 0644 ${UNPACKDIR}/phoenix.description.json ${D}${sysconfdir}/palm/settings/defaults/
    install -d ${D}${datadir}/luna-service2/api-permissions.d ${D}${datadir}/luna-service2/manifests.d
    install -m 0644 ${UNPACKDIR}/phoenix-settingsservice-priv.api.json ${D}${datadir}/luna-service2/api-permissions.d/
    install -m 0644 ${UNPACKDIR}/phoenix-settingsservice-priv.manifest.json ${D}${datadir}/luna-service2/manifests.d/
    install -d ${D}${sbindir} ${D}${systemd_system_unitdir}
    install -m 0755 ${UNPACKDIR}/phoenix-settings-desc ${D}${sbindir}/
    install -m 0644 ${UNPACKDIR}/phoenix-settings-desc.service ${D}${systemd_system_unitdir}/
}

FILES:${PN} = " \
    ${sysconfdir}/palm/settings/defaults/phoenix.description.json \
    ${datadir}/luna-service2/api-permissions.d/phoenix-settingsservice-priv.api.json \
    ${datadir}/luna-service2/manifests.d/phoenix-settingsservice-priv.manifest.json \
    ${sbindir}/phoenix-settings-desc \
    ${systemd_system_unitdir}/phoenix-settings-desc.service \
"
# The script: luna-send and python3, both in webos-phoenix-image.
# The hub reads an api file only through a manifest that names it
# (manifests.d); settingsservice reads the drop-in folder at start. No
# RDEPENDS on settingsservice: an allarch package naming arch ones would
# differ per machine (webos-image has settingsservice).
