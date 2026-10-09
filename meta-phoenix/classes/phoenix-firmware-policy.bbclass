# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The firmware policy (docs/LEGAL.md, "Firmware and drivers"; the owner's
# decision of October 2026): open source drivers are in the image;
# firmware that is not open source, even when its maker allows passing it
# on (most of linux-firmware), is not. It is built into the package feed
# (phoenix-driver-feed) and the Hardware app offers it, with its licence,
# when the device has the hardware it is for.
#
# This makes the rule hold: an image that would install a firmware package
# fails, naming the package and what pulled it in. Recommendations of
# firmware (a machine's MACHINE_EXTRA_RRECOMMENDS, such as the Raspberry
# Pi 4's Wi-Fi) are dropped instead (BAD_RECOMMENDATIONS, set by the image).
#
#   PHOENIX_FIRMWARE_PACKAGES   what counts as firmware (fnmatch patterns)
#   PHOENIX_FIRMWARE_IN_IMAGE   firmware packages allowed anyway: open
#                               source firmware, or an exception the owner
#                               decided (docs/HARDWARE.md, "Decisions")

PHOENIX_FIRMWARE_PACKAGES ??= "linux-firmware linux-firmware-* bluez-firmware bluez-firmware-* *-firmware firmware-*"
PHOENIX_FIRMWARE_IN_IMAGE ??= ""

python phoenix_firmware_policy () {
    import fnmatch
    from oe.rootfs import image_list_installed_packages
    patterns = (d.getVar("PHOENIX_FIRMWARE_PACKAGES") or "").split()
    allowed = (d.getVar("PHOENIX_FIRMWARE_IN_IMAGE") or "").split()
    installed = image_list_installed_packages(d)
    bad = sorted(p for p in installed
                 if any(fnmatch.fnmatchcase(p, pat) for pat in patterns)
                 and not any(fnmatch.fnmatchcase(p, a) for a in allowed))
    if bad:
        bb.fatal("Firmware packages in the image: %s. Phoenix offers firmware in the Hardware app "
                 "instead (docs/LEGAL.md, \"Firmware and drivers\"); add one to PHOENIX_FIRMWARE_IN_IMAGE "
                 "only when it is open source or the owner decided so." % " ".join(bad))
}

ROOTFS_POSTPROCESS_COMMAND += "phoenix_firmware_policy;"
