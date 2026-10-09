# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The CMU Pronouncing Dictionary (cmudict.dict, 135,000 English words, 3.6
# MB), in /usr/share/phoenix/kitten where phoenix-tts reads it: its
# permissive phonemizer (services/tts/src/phonemes.h), which turns words into
# the espeak-style phonemes Kitten TTS was trained on without espeak-ng
# (GPL-3.0) in the image. With kitten-tts-nano and onnxruntime.
#
# License: BSD-2-Clause (the repository's LICENSE, Carnegie Mellon
# University), shipped beside it. docs/LEGAL.md.

SUMMARY = "CMU Pronouncing Dictionary, for the Phoenix Assistant's voice"
HOMEPAGE = "https://github.com/cmusphinx/cmudict"
SECTION = "multimedia"
LICENSE = "BSD-2-Clause"
LIC_FILES_CHKSUM = "file://LICENSE;md5=9461bd113012f497ef5a0987ab6db68c"

SRC_URI = "git://github.com/cmusphinx/cmudict.git;protocol=https;branch=master"
# master on 2025-10-24, what tools/get-kitten.py fetches.
SRCREV = "74790861f652b15e4ac49015a90074ad62a27690"
PV = "0.7b+git"

S = "${WORKDIR}/git"

inherit allarch

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${datadir}/phoenix/kitten
    install -m 0644 ${S}/cmudict.dict ${D}${datadir}/phoenix/kitten/cmudict.dict
    install -m 0644 ${S}/LICENSE ${D}${datadir}/phoenix/kitten/cmudict.LICENSE
}

FILES:${PN} = "${datadir}/phoenix/kitten/cmudict.dict ${datadir}/phoenix/kitten/cmudict.LICENSE"
