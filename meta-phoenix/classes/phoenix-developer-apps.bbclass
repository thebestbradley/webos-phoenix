# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The developer apps Phoenix does not own, out of sight until Developer Mode
# is on (docs/APP-RUNTIME.md, "Developer apps"; the owner, 27 November 2026:
# demo and test apps hidden unless Developer Mode). Phoenix's own say so in
# their appinfo.json ("phoenix": {"developer": true}); the test, demo and
# example apps the platform's layers install are listed in
# conf/developer-apps.json, and as the rootfs is finished
# (ROOTFS_POSTPROCESS_COMMAND) the same flag is written into each one's
# appinfo.json (lib/phoenix/developerapps.py). A listed app that is not in
# the image is skipped; one whose appinfo.json cannot be rewritten fails the
# image, so a test app never ships in sight by mistake.

PHOENIX_DEVELOPER_APPS ??= "${LAYERDIR_meta-phoenix}/conf/developer-apps.json"

python phoenix_developer_apps_rootfs () {
    from phoenix import developerapps
    listed = d.getVar("PHOENIX_DEVELOPER_APPS")
    try:
        apps = developerapps.load(listed)
    except (OSError, ValueError) as e:
        bb.fatal("phoenix-developer-apps: %s" % e)
    marked, missing, failed = developerapps.mark(d.getVar("IMAGE_ROOTFS"), sorted(apps))
    if failed:
        bb.fatal("phoenix-developer-apps: %s" % "; ".join("%s: %s" % f for f in failed))
    if marked:
        bb.note("phoenix-developer-apps: developer apps (shown only with Developer Mode on): %s" % ", ".join(marked))
    if missing:
        bb.note("phoenix-developer-apps: not in this image: %s" % ", ".join(missing))
}
do_rootfs[file-checksums] += "${PHOENIX_DEVELOPER_APPS}:True"

ROOTFS_POSTPROCESS_COMMAND += "phoenix_developer_apps_rootfs;"
