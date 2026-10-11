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
