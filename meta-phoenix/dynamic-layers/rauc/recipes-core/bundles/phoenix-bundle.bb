# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "webOS Phoenix system update (a RAUC bundle of webos-phoenix-image)"
DESCRIPTION = "The system update for a machine with A/B slots (PHOENIX_RAUC): \
webos-phoenix-image's root file system as one verity bundle, for the device \
type (RAUC's compatible, the update feed's: phoenix-<MACHINE>), with the build \
and version of the rootfs it carries. Published to an update channel with \
Phoenix-Web-Services' platform:publish-testing-update (test channels) or the \
release console (docs/PLATFORM.md 6.9, 7.3)."
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

inherit bundle

python __anonymous() {
    if d.getVar("PHOENIX_RAUC") != "1":
        raise bb.parse.SkipRecipe("%s has no A/B slots (PHOENIX_RAUC)" % d.getVar("MACHINE"))
}

# The device type: phoenix-<MACHINE>, or the machine's name when it starts
# with phoenix- already (phoenix-vm-arm64), as services/account/deviceinfo.js
# derives it and the machine's system.conf says.
RAUC_BUNDLE_COMPATIBLE = "${@d.getVar('MACHINE') if d.getVar('MACHINE').startswith('phoenix-') else 'phoenix-' + d.getVar('MACHINE')}"
# Each block checked as it is read (dm-verity); system.conf accepts no
# other format (bundle-formats=-plain).
RAUC_BUNDLE_FORMAT = "verity"
RAUC_BUNDLE_SLOTS = "rootfs"
RAUC_SLOT_rootfs = "webos-phoenix-image"
RAUC_SLOT_rootfs[fstype] = "ext4"

# The build and version are the rootfs's own (phoenix-devpush.bbclass writes
# <image>.phoenix.json from it): com.palm.update compares the bundle's build
# with the feed's and, after the restart, with the running system's
# BUILD_ID, so they must be the same number (docs/DEV-PUSH.md 4.6, G5). Read
# when the manifest is written (do_configure, after the image); the
# signature is the image's (do_unpack depends on its do_image_complete), not
# the file's contents, which a parse may not have yet.
def phoenix_bundle_info(d, key):
    import json, os
    path = os.path.join(d.getVar("DEPLOY_DIR_IMAGE"),
                        "%s%s%s.phoenix.json" % (d.getVar("RAUC_SLOT_rootfs"), d.getVar("IMAGE_MACHINE_SUFFIX"),
                                                 d.getVar("IMAGE_NAME_SUFFIX")))
    try:
        with open(path) as f:
            return str(json.load(f)[key])
    except (OSError, ValueError, KeyError):
        return "unknown"

RAUC_BUNDLE_BUILD = "${@phoenix_bundle_info(d, 'build')}"
RAUC_BUNDLE_BUILD[vardepvalue] = "the image's BUILD_ID"
RAUC_BUNDLE_VERSION = "${@phoenix_bundle_info(d, 'version')}"
RAUC_BUNDLE_VERSION[vardepvalue] = "the image's product version"
RAUC_BUNDLE_DESCRIPTION = "webOS Phoenix for ${RAUC_BUNDLE_COMPATIBLE}"

# Room on the build host: bundle.bbclass copies the slot image into the
# bundle directory with shutil.copy, which writes the ext4's holes as data
# (9.7 GiB for 4.3 GiB of blocks, November 2026). The deployed image is on
# the same file system (TMPDIR), so link it there instead, and only read it
# (mksquashfs). do_configure:append puts shutil back.
python do_configure:prepend() {
    import os, shutil
    phoenix_copy = shutil.copy
    def phoenix_link_or_copy(src, dst, *args, **kwargs):
        try:
            if os.path.lexists(dst):
                os.remove(dst)
            # The deployed name is a symlink, and os.link on Linux links the
            # symlink itself (link(2)), which in the bundle directory points
            # nowhere: link the file it names (Revision 39's do_configure).
            os.link(os.path.realpath(src), dst)
            return dst
        except OSError:
            return phoenix_copy(src, dst, *args, **kwargs)
    shutil.copy = phoenix_link_or_copy
    for key in ("build", "version"):
        if phoenix_bundle_info(d, key) == "unknown":
            bb.fatal("phoenix-bundle: no %s in the image's .phoenix.json (phoenix-devpush.bbclass)" % key)
    # The slots take the bundle's file system as it is, then grow it
    # (resize=true): it must fit (PHOENIX_ROOT_SLOT_SIZE, the wks file's).
    import os
    image = os.path.join(d.getVar("DEPLOY_DIR_IMAGE"), "%s%s%s.ext4" % (
        d.getVar("RAUC_SLOT_rootfs"), d.getVar("IMAGE_MACHINE_SUFFIX"), d.getVar("IMAGE_NAME_SUFFIX")))
    slot = d.getVar("PHOENIX_ROOT_SLOT_SIZE") or ""
    units = {"K": 1 << 10, "M": 1 << 20, "G": 1 << 30}
    if slot and slot[-1] in units and slot[:-1].isdigit() and os.path.exists(image):
        limit = int(slot[:-1]) * units[slot[-1]]
        size = os.path.getsize(image)
        if size > limit:
            bb.fatal("phoenix-bundle: the rootfs (%d MiB) does not fit a root slot (PHOENIX_ROOT_SLOT_SIZE = %s)" % (size >> 20, slot))
}

python do_configure:append() {
    shutil.copy = phoenix_copy
}
# Once the bundle is made the link is not needed; without this it would
# keep an old image's blocks after the image is rebuilt.
phoenix_bundle_tidy() {
    rm -f ${BUNDLE_DIR}/*.ext4
}
do_bundle[postfuncs] += "phoenix_bundle_tidy"

# The signing certificate and key: the TEST development certificate by
# default (meta-phoenix/files/rauc/test, public keys: bundles only test
# images install). A release bundle is re-signed with the owner's key
# (`rauc resign`, PLATFORM.md 7.2), never built with it. The keyring checks
# the bundle as RAUC on the device will.
PHOENIX_RAUC_CERT ??= "${LAYERDIR_meta-phoenix}/files/rauc/test/development-1.cert.pem"
PHOENIX_RAUC_KEY ??= "${LAYERDIR_meta-phoenix}/files/rauc/test/development-1.key.pem"
PHOENIX_RAUC_KEYRING ??= "${LAYERDIR_meta-phoenix}/files/rauc/test/ca.cert.pem"
RAUC_CERT_FILE = "${PHOENIX_RAUC_CERT}"
RAUC_KEY_FILE = "${PHOENIX_RAUC_KEY}"
RAUC_KEYRING_FILE = "${PHOENIX_RAUC_KEYRING}"

# Deployed as a hard link to the bundle do_bundle made (bundle.bbclass's
# do_deploy copies it: one more copy of several GB), under the bundle's
# names and the build's (<compatible>-<build>.raucb, as
# platform:publish-testing-update publishes it), after checking it as the
# device will (the keyring). No crypt or casync bundle here.
do_deploy() {
    install -d ${DEPLOYDIR}
    chmod 0644 ${B}/bundle.raucb
    build=$(${STAGING_BINDIR_NATIVE}/rauc info --keyring=${RAUC_KEYRING_FILE} --output-format=shell ${B}/bundle.raucb | sed -n 's/^RAUC_MF_BUILD=//p' | tr -d "'\"")
    [ -n "$build" ] || bbfatal "phoenix-bundle: rauc info shows no build"
    ln -f ${B}/bundle.raucb ${DEPLOYDIR}/${BUNDLE_NAME}${BUNDLE_EXTENSION} 2>/dev/null || \
        install -m 0644 ${B}/bundle.raucb ${DEPLOYDIR}/${BUNDLE_NAME}${BUNDLE_EXTENSION}
    ln -sf ${BUNDLE_NAME}${BUNDLE_EXTENSION} ${DEPLOYDIR}/${BUNDLE_LINK_NAME}${BUNDLE_EXTENSION}
    ln -sf ${BUNDLE_NAME}${BUNDLE_EXTENSION} ${DEPLOYDIR}/${RAUC_BUNDLE_COMPATIBLE}-$build${BUNDLE_EXTENSION}
}
