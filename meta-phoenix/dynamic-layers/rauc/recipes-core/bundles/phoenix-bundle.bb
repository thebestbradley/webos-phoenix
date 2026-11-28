# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "webOS Phoenix system update (a RAUC bundle of webos-phoenix-image)"
DESCRIPTION = "The system update for a machine with A/B slots (PHOENIX_RAUC): \
webos-phoenix-image's root file system as one verity bundle, for the device \
type phoenix-<MACHINE> (RAUC's compatible, the update feed's), with the build \
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

RAUC_BUNDLE_COMPATIBLE = "phoenix-${MACHINE}"
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
RAUC_BUNDLE_DESCRIPTION = "webOS Phoenix for phoenix-${MACHINE}"

python do_configure:prepend() {
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

# The bundle under the build's name too, as the feed publishes it
# (phoenix-<build>.raucb is what com.palm.update saves it as).
do_deploy:append() {
    build=$(${STAGING_BINDIR_NATIVE}/rauc info --keyring=${RAUC_KEYRING_FILE} --output-format=shell ${B}/bundle.raucb | sed -n 's/^RAUC_MF_BUILD=//p' | tr -d "'\"")
    [ -n "$build" ] || bbfatal "phoenix-bundle: rauc info shows no build"
    ln -sf ${BUNDLE_NAME}${BUNDLE_EXTENSION} ${DEPLOYDIR}/phoenix-${MACHINE}-$build${BUNDLE_EXTENSION}
}
