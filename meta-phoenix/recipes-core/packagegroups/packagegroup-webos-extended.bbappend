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

# Phoenix first (docs/DECISIONS.md, 27 November 2026; docs/LUNEOS.md
# "Phoenix first"): LuneOS's packagegroup also installs its own copies of
# what Phoenix ships itself, at the same paths. phoenix-apps installs the
# originals from Phoenix's submodules with Phoenix's compat overlays
# (its install plan, runtime/rootfs.json: luna-systemui and luna-applauncher under
# /usr/lib/luna/system, the core apps, Isis, Enyo 1.0, the foundations,
# the loadable frameworks, underscore, the app services), so LuneOS's
# would clash with them or put the unpatched copy in their place. Kept:
# what Phoenix has none of: mojoservice-frameworks, luna-init-fonts, the
# Just Type daemon (luna-universalsearchmgr) and the mail transports
# (mojomail-*). LuneOS's copies add only com.palm.service.photos and the
# phonenumberlib framework, which nothing in Phoenix calls.
# (meta-luneos packagegroup-webos-extended.bb, WEBOS_PACKAGESET_ENYO_1,
# _SYSTEMAPPS and the browser at 01a50c1.)
WEBOS_PACKAGESET_ENYO_1:luneos = " \
    mojoservice-frameworks \
    luna-init-fonts \
"
WEBOS_PACKAGESET_SYSTEMAPPS:luneos = " \
    luna-universalsearchmgr \
    mojomail-imap \
    mojomail-pop \
    mojomail-smtp \
"
# LuneOS's browser, Atlas: Phoenix's is Isis (third_party/isis, on the
# Phoenix runtime).
VIRTUAL-RUNTIME_com.webos.app.browser:luneos = ""
