# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The Assistant's built-in on-device model: Qwen3 0.6B, the Qwen team's own
# GGUF (Q8_0, 639 MB),
# in /usr/share/phoenix/models where the assistant service's llama-server
# runs it from (apps/assistant/service/lib/node-device.js builtInDirs;
# lib/models.js BUILT_IN). It answers what the commands do not, offline,
# from the first boot; larger models stay downloads in Settings >
# Assistant. llama-cpp's llama-server runs it (packagegroup-phoenix-
# assistant installs both).
#
# From the Qwen team's repository at a pinned revision, checked by its
# SHA-256 (the same file and hash as lib/models.js and
# tools/get-base-model.py; node-device.test.ts checks they agree).
#
# License: Apache-2.0, Qwen's (the repository's LICENSE, shipped beside it).
# docs/LEGAL.md.

SUMMARY = "Qwen3 0.6B (GGUF, Q8_0), the Phoenix Assistant's built-in model"
HOMEPAGE = "https://huggingface.co/Qwen/Qwen3-0.6B"
SECTION = "misc"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${UNPACKDIR}/Qwen3-LICENSE;md5=e5ba20110b2e2fa01ab5bcffaa6deb47"

QWEN = "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/23749fefcc72300e3a2ad315e1317431b06b590a"
SRC_URI = " \
    ${QWEN}/Qwen3-0.6B-Q8_0.gguf;name=model;downloadfilename=qwen3-0.6b-q8_0.gguf \
    ${QWEN}/LICENSE;name=license;downloadfilename=Qwen3-LICENSE \
"
SRC_URI[model.sha256sum] = "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031"
SRC_URI[license.sha256sum] = "5de36594c10839788a8c589443a8ef9d8b8d17c65a1b5807206ae037fc36c6bd"

S = "${UNPACKDIR}"

inherit allarch

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${datadir}/phoenix/models
    install -m 0644 ${UNPACKDIR}/qwen3-0.6b-q8_0.gguf ${D}${datadir}/phoenix/models/qwen3-0.6b-q8_0.gguf
    install -m 0644 ${UNPACKDIR}/Qwen3-LICENSE ${D}${datadir}/phoenix/models/qwen3-0.6b-q8_0.LICENSE
}

FILES:${PN} = "${datadir}/phoenix/models"
