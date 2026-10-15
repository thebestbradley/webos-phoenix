# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# meta-phoenix's own phones and tablets (MACHINEOVERRIDES phoenix-mobile,
# conf/machine/include/phoenix-mobile.inc): OSE's g-media-pipeline is built
# only for OSE's machines (its COMPATIBLE_MACHINE, meta-webos d7ed46c), so
# the packagegroup's opengl case (packagegroup-webos-extended.bb:104) would
# make the image unbuildable there. Media plays through Chromium's own
# pipeline on these machines (phoenix-mobile.inc).
RDEPENDS:${PN}:remove:phoenix-mobile = "g-media-pipeline"

# LuneOS's packagegroup (meta-luneos recipes-core/packagegroups/
# packagegroup-webos-extended.bb:75-77, 156) brings the Mojo 1.0 framework,
# LICENSE = "CLOSED": extracted from a webOS 3.0.5 image
# (recipes-webos-owo/frameworks/mojo-framework.bb:16). Palm's closed code
# is not shipped (docs/LEGAL.md); Phoenix runs no Mojo apps. (OSE's
# packagegroup has no such set; this is empty there either way.)
WEBOS_PACKAGESET_MOJO_1 = ""
