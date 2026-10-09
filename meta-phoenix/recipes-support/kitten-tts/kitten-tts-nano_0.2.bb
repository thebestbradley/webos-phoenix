# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The Assistant's voice: KittenML's Kitten TTS nano 0.2 (15 million
# parameters; the 24 MB ONNX model, its eight voices and config.json), in
# /usr/share/phoenix/kitten where phoenix-tts (phoenix-shell) looks for it.
# With onnxruntime and cmudict; packagegroup-phoenix-assistant installs
# them. Shipped in the image (not fetched on first use): it is small, the
# Assistant must speak offline from the first boot, and it is the same for
# every machine.
#
# License: Apache-2.0, the code (github.com/KittenML/KittenTTS LICENSE) and
# the model, its weights and voices (the Hugging Face model card's license:
# apache-2.0, checked 9 October 2026); the repository has no LICENSE file,
# so OE's common text is shipped. docs/LEGAL.md.

SUMMARY = "Kitten TTS nano 0.2 text-to-speech model, for the Phoenix Assistant"
HOMEPAGE = "https://huggingface.co/KittenML/kitten-tts-nano-0.2"
SECTION = "multimedia"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

HF = "https://huggingface.co/KittenML/kitten-tts-nano-0.2/resolve/9c81564aa56c6fb79f83780e87099357b88d6617"
SRC_URI = " \
    ${HF}/config.json;name=config;subdir=kitten \
    ${HF}/kitten_tts_nano_v0_2.onnx;name=model;subdir=kitten \
    ${HF}/voices.npz;name=voices;subdir=kitten;unpack=0 \
"
SRC_URI[config.sha256sum] = "010e4433f375686c65b6bff1469ab51e9ee0f77a3f4af1aa89079200126b21ba"
SRC_URI[model.sha256sum] = "42fa8809db319cd7c4c83b3c501e2313bf90edf610235291cad605e4adcb242d"
SRC_URI[voices.sha256sum] = "77258f1fa40dc0801ce69acda1e9d7461c4bcec5af28e73c1880f0fb4e91882e"

S = "${UNPACKDIR}/kitten"

inherit allarch

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${datadir}/phoenix/kitten
    install -m 0644 ${S}/config.json ${S}/kitten_tts_nano_v0_2.onnx ${S}/voices.npz ${D}${datadir}/phoenix/kitten/
}

FILES:${PN} = "${datadir}/phoenix/kitten/config.json ${datadir}/phoenix/kitten/kitten_tts_nano_v0_2.onnx \
               ${datadir}/phoenix/kitten/voices.npz"
