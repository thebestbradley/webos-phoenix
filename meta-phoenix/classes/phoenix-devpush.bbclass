# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Dev push at image time (docs/DEV-PUSH.md 8.1, 12 P3), as the rootfs is
# finished (ROOTFS_POSTPROCESS_COMMAND), with meta-phoenix's library
# (lib/phoenix/devpush.py, which tools/install-rootfs.py --stamp uses too):
#
#   - BUILD_ID in /etc/os-release: this rootfs's own id (the time it was put
#     together), which OSE's and LuneOS's os-release do not carry. A rebuilt
#     rootfs gets a new one, so an overlay made for the old image is not
#     mounted on it (4.6) and the updates service knows which build runs.
#     PHOENIX_BUILD_ID sets it instead.
#   - Developer Mode off as built: OSE's com.palm.service.devmode recipe
#     writes its flag into OSE images, which would start with Developer Mode
#     (and novad's listener, and WebAppMgr's inspector) on.
#     PHOENIX_DEVMODE_ON = "1" keeps it on: a test image only.
#   - /usr/share/phoenix/manifest.json (phoenix-apps wrote it "unstamped"):
#     every listed file's size, hash and mode read from the image's own
#     copy, with that BUILD_ID, which nova builds bundles against.
#   - <image>.phoenix.json beside the image in DEPLOY_DIR_IMAGE: that
#     BUILD_ID and the product's version, read from this rootfs. A system
#     update's RAUC bundle (phoenix-bundle) takes its build and version from
#     it, so the bundle always says the build of the rootfs it carries,
#     even when the rootfs was not rebuilt (DATETIME and PHOENIX_BUILD_ID
#     are left out of this task's signature): com.palm.update compares
#     them, and a bundle whose build is not the running system's after the
#     restart reads as an update that did not start (docs/DEV-PUSH.md 4.6).

PHOENIX_BUILD_ID ??= "${DATETIME}"
PHOENIX_BUILD_ID[vardepsexclude] = "DATETIME"
PHOENIX_DEVMODE_ON ??= "0"

python phoenix_devpush_rootfs () {
    import os
    from phoenix import devpush
    rootfs = d.getVar("IMAGE_ROOTFS")
    build = d.getVar("PHOENIX_BUILD_ID")
    written = devpush.set_build_id(rootfs, build)
    if not written:
        bb.fatal("phoenix-devpush: no os-release in the image to write BUILD_ID into")
    bb.note("phoenix-devpush: BUILD_ID=%s in %s" % (build, written))
    if d.getVar("PHOENIX_DEVMODE_ON") != "1":
        gone = devpush.devmode_off(rootfs)
        if gone:
            bb.note("phoenix-devpush: Developer Mode off as built (removed %s)" % ", ".join(gone))
    if os.path.isfile(os.path.join(rootfs, devpush.MANIFEST.lstrip("/"))):
        try:
            m = devpush.stamp(rootfs, build)
        except ValueError as e:
            bb.fatal("phoenix-devpush: %s" % e)
        bb.note("phoenix-devpush: stamped %s: build %s, %d files" % (devpush.MANIFEST, m["build"], len(m["files"])))
    else:
        bb.warn("phoenix-devpush: no %s (phoenix-apps not in the image?): nova cannot push to it" % devpush.MANIFEST)
    info = devpush.build_info(rootfs)
    deploy = d.getVar("IMGDEPLOYDIR")
    bb.utils.mkdirhier(deploy)
    name = d.getVar("IMAGE_NAME") + ".phoenix.json"
    with open(os.path.join(deploy, name), "wb") as f:
        f.write(devpush.dump_manifest(info))
    link = os.path.join(deploy, d.getVar("IMAGE_LINK_NAME") + ".phoenix.json")
    if name != os.path.basename(link):
        if os.path.lexists(link):
            os.remove(link)
        os.symlink(name, link)
    bb.note("phoenix-devpush: %s: build %s, version %s" % (name, info["build"], info["version"]))
}
phoenix_devpush_rootfs[vardepsexclude] = "DATETIME PHOENIX_BUILD_ID"

ROOTFS_POSTPROCESS_COMMAND += "phoenix_devpush_rootfs;"
