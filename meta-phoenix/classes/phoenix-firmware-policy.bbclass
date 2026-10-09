# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The firmware policy (docs/LEGAL.md, "Firmware and drivers"; the owner's
# decision of October 2026): as much hardware as possible works out of the
# box, so the image carries the firmware whose licence allows
# redistribution, unmodified, with its licence files
# (packagegroup-phoenix-firmware), as Ubuntu and Debian do. The Hardware
# app fills the gaps.
#
# This keeps the rule: an image that would install a firmware package whose
# licence is not on the allow-list fails, naming the package and its
# licence. It also writes /usr/share/phoenix/firmware/licences.json: each
# firmware package, its version, licence, licence files and size, which
# Settings > Device Info shows (org.webosphoenix.hardware firmwareLicenses),
# and logs the firmware's total size.
#
#   PHOENIX_FIRMWARE_PACKAGES   what counts as firmware (fnmatch patterns)
#   PHOENIX_FIRMWARE_LICENSES   licences that allow redistribution (fnmatch).
#                               Firmware-*: linux-firmware's own (each file in
#                               linux-firmware is there because its licence,
#                               in WHENCE, allows passing it on)
#   PHOENIX_FIRMWARE_EXCLUDE    (in the image recipe) firmware to leave out of
#                               a small image; the Hardware app offers it

PHOENIX_FIRMWARE_PACKAGES ??= "linux-firmware linux-firmware-* bluez-firmware bluez-firmware-* *-firmware firmware-*"
PHOENIX_FIRMWARE_LICENSES ??= "Firmware-* WHENCE binary-redist-* Synaptics-rpidistro GPL-2.0* GPL-3.0* LGPL-* MIT BSD-* ISC Apache-2.0"

python phoenix_firmware_policy () {
    import fnmatch, json, os, re
    import oe.packagedata
    from oe.rootfs import image_list_installed_packages
    patterns = (d.getVar("PHOENIX_FIRMWARE_PACKAGES") or "").split()
    allowed = (d.getVar("PHOENIX_FIRMWARE_LICENSES") or "").split()
    rootfs = d.getVar("IMAGE_ROOTFS")
    installed = image_list_installed_packages(d)
    out, bad, total = [], [], 0

    def pkgdata(p):
        try:
            return oe.packagedata.read_subpkgdata_dict(p, d)
        except Exception:
            return {}

    for p in sorted(installed):
        if p.startswith("packagegroup-") or not any(fnmatch.fnmatchcase(p, pat) for pat in patterns):
            continue
        data = pkgdata(p)
        lic = data.get("LICENSE", "")
        tokens = [t for t in re.split(r"[\s&|()]+", lic) if t]
        if not tokens or not all(any(fnmatch.fnmatchcase(t, a) for a in allowed) for t in tokens):
            bad.append("%s (%s)" % (p, lic or "no licence"))
            continue
        # Its licence files: in it, or in the licence packages it depends on.
        files = []
        deps = [x for x in re.split(r"[\s,]+", re.sub(r"\([^)]*\)", "", data.get("RDEPENDS", ""))) if x]
        for q in [p] + [x for x in deps if x.endswith("-license") or x.endswith("-licence")]:
            info = pkgdata(q).get("FILES_INFO")
            for f in (json.loads(info) if info else {}):
                if re.search(r"/(LICEN[CS]E[^/]*|WHENCE)$", f) and os.path.exists(rootfs + f):
                    files.append(f)
        size = int(data.get("PKGSIZE", "0") or 0)
        total += size
        out.append({"name": p, "version": "%s-%s" % (data.get("PKGV", ""), data.get("PKGR", "")), "license": lic,
                    "licenseFiles": sorted(set(files)), "size": size})
    if bad:
        bb.fatal("Firmware packages in the image whose licence does not allow redistribution (or is unknown): %s. "
                 "Only redistributable firmware goes in a Phoenix image (docs/LEGAL.md, \"Firmware and drivers\"); "
                 "if the licence does allow it, add it to PHOENIX_FIRMWARE_LICENSES with a note in docs/LEGAL.md."
                 % ", ".join(bad))
    dest = os.path.join(rootfs, "usr/share/phoenix/firmware")
    os.makedirs(dest, exist_ok=True)
    with open(os.path.join(dest, "licences.json"), "w") as f:
        json.dump({"packages": out, "totalSize": total}, f, indent=1)
    bb.note("Phoenix firmware: %d packages, %.1f MB" % (len(out), total / 1e6))
}

ROOTFS_POSTPROCESS_COMMAND += "phoenix_firmware_policy;"
