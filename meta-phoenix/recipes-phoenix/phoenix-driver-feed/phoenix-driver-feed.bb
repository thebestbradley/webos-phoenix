# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "Driver packages for the Hardware app's catalog"
DESCRIPTION = "Collects the firmware packages Phoenix offers in the Hardware app \
(and leaves out of the image: phoenix-firmware-policy) with a driver manifest \
for each (files/drivers/*.json: the hardware it is for, its licence, which \
packages): ${DEPLOY_DIR_IMAGE}/phoenix-drivers/<id>/driver.json and the .ipk \
files next to it, ready for server/drivers/bin/drivers.php add. \
See docs/DRIVERS.md."
HOMEPAGE = "https://github.com/thebestbradley/webos-phoenix"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

SRC_URI = "file://drivers"
S = "${WORKDIR}/drivers"

inherit deploy nopackages

do_configure[noexec] = "1"
do_compile[noexec] = "1"

# The recipes whose packages the manifests name (linux-firmware's are split
# per chip: linux-firmware-rtl8821, ...; out-of-tree kernel modules would be
# added here with their recipes).
PHOENIX_DRIVER_RECIPES ?= "linux-firmware"
do_deploy[depends] += "${@' '.join('%s:do_package_write_ipk' % r for r in d.getVar('PHOENIX_DRIVER_RECIPES').split())}"

python do_deploy () {
    import glob, json, os, shutil
    out = os.path.join(d.getVar("DEPLOYDIR"), "phoenix-drivers")
    ipks = d.getVar("DEPLOY_DIR_IPK")
    for manifest in sorted(glob.glob(os.path.join(d.getVar("S"), "*.json"))):
        with open(manifest) as f:
            m = json.load(f)
        dest = os.path.join(out, m["id"])
        os.makedirs(dest, exist_ok=True)
        files = []
        for name in m["packages"]:
            found = sorted(glob.glob(os.path.join(ipks, "*", name + "_*.ipk")))
            if not found:
                bb.fatal("phoenix-driver-feed: %s names %s, which was not built" % (os.path.basename(manifest), name))
            shutil.copy(found[-1], dest)
            files.append(os.path.basename(found[-1]))
        m["packages"] = files
        with open(os.path.join(dest, "driver.json"), "w") as f:
            json.dump(m, f, indent=4)
}
addtask deploy after do_compile before do_build
