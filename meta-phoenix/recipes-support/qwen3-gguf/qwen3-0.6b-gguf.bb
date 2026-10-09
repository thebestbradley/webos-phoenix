# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The Assistant's built-in on-device model: Qwen3 0.6B in Q4_K_M (397 MB),
# in /usr/share/phoenix/models where the assistant service's llama-server
# runs it from (apps/assistant/service/lib/node-device.js builtInDirs;
# lib/models.js BUILT_IN). It answers what the commands do not, offline,
# from the first boot; larger models stay downloads in Settings >
# Assistant. llama-cpp's llama-server runs it (packagegroup-phoenix-
# assistant installs both).
#
# The Qwen team publishes only a Q8_0 GGUF of Qwen3 0.6B (639 MB); this is
# Unsloth's Q4_K_M quantization of their weights, at a pinned revision,
# checked by its SHA-256 (the same file and hash as lib/models.js and
# tools/get-base-model.py; node-device.test.ts checks they agree).
#
# License: Apache-2.0, Qwen's (the model's LICENSE, shipped beside it).
# docs/LEGAL.md.

SUMMARY = "Qwen3 0.6B (GGUF, Q4_K_M), the Phoenix Assistant's built-in model"
HOMEPAGE = "https://huggingface.co/Qwen/Qwen3-0.6B"
SECTION = "misc"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${UNPACKDIR}/Qwen3-LICENSE;md5=0b19e609b901d29b7a3b908e80e81314"

SRC_URI = " \
    https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/50968a4468ef4233ed78cd7c3de230dd1d61a56b/Qwen3-0.6B-Q4_K_M.gguf;name=model;downloadfilename=qwen3-0.6b-q4_k_m.gguf \
    https://huggingface.co/Qwen/Qwen3-0.6B/resolve/c1899de289a04d12100db370d81485cdf75e47ca/LICENSE;name=license;downloadfilename=Qwen3-LICENSE \
"
SRC_URI[model.sha256sum] = "ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a"
SRC_URI[license.sha256sum] = "832dd9e00a68dd83b3c3fb9f5588dad7dcf337a0db50f7d9483f310cd292e92e"

S = "${UNPACKDIR}"

inherit allarch

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${datadir}/phoenix/models
    install -m 0644 ${UNPACKDIR}/qwen3-0.6b-q4_k_m.gguf ${D}${datadir}/phoenix/models/qwen3-0.6b-q4_k_m.gguf
    install -m 0644 ${UNPACKDIR}/Qwen3-LICENSE ${D}${datadir}/phoenix/models/qwen3-0.6b-q4_k_m.LICENSE
}

FILES:${PN} = "${datadir}/phoenix/models"
