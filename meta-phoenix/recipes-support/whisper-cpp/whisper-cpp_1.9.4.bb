# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# STUB: never built yet, and not part of webos-phoenix-image. It records how
# whisper.cpp would get onto the image for Voice Memos' transcription
# service (org.webosphoenix.transcriber, apps/voicememos/service), which
# looks for:
#
#   whisper-cli                          on the PATH (${bindir})
#   /usr/share/whisper/ggml-base.en.bin  the default model
#   ffmpeg                               optional: converts audio that is not
#                                        16 kHz WAV (the app records WAV)
#
# To try it: IMAGE_INSTALL:append = " whisper-cpp whisper-cpp-model-base-en"
# in local.conf. ffmpeg is in openembedded-core but has LICENSE_FLAGS
# "commercial"; add LICENSE_FLAGS_ACCEPTED += "commercial" if it is wanted.
# Without whisper-cli or the model the service answers "not installed"
# (errorCode 2 or 3) and the app says so.
#
# Licenses: whisper.cpp and ggml are MIT (LICENSE). The model weights are
# OpenAI's Whisper models (MIT, github.com/openai/whisper), converted to
# ggml by the whisper.cpp authors and published at
# huggingface.co/ggerganov/whisper.cpp. See docs/LEGAL.md.
#
# Still to check on a device: the ggml CPU backend flags for the target
# (GGML_NATIVE must stay off when cross-compiling; pick NEON / AVX2 per
# MACHINE), the speed of base.en there (tiny.en is ~2x faster, less exact),
# and the shared libraries' packaging.

SUMMARY = "whisper.cpp: OpenAI Whisper speech recognition in C/C++ (whisper-cli)"
HOMEPAGE = "https://github.com/ggml-org/whisper.cpp"
SECTION = "multimedia"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://LICENSE;md5=223b26b3c1143120c87e2b13111d3e99"

SRC_URI = "git://github.com/ggml-org/whisper.cpp.git;protocol=https;branch=master \
           https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin;name=base-en;unpack=0 \
"
# master on 2026-09-24 (version 1.9.4 in its CMakeLists.txt).
SRCREV = "d09f61a708f3487afa956ff578e60eae5e7a233c"
SRC_URI[base-en.sha256sum] = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"

S = "${WORKDIR}/git"

inherit cmake

# whisper-cli only: no server, SDL2 (microphone) examples, curl or tests.
EXTRA_OECMAKE = " \
    -DWHISPER_BUILD_EXAMPLES=ON \
    -DWHISPER_BUILD_SERVER=OFF \
    -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_SDL2=OFF \
    -DWHISPER_CURL=OFF \
    -DGGML_NATIVE=OFF \
"

do_install:append() {
    install -d ${D}${datadir}/whisper
    install -m 0644 ${WORKDIR}/ggml-base.en.bin ${D}${datadir}/whisper/ggml-base.en.bin
}

PACKAGES =+ "${PN}-model-base-en"
FILES:${PN}-model-base-en = "${datadir}/whisper/ggml-base.en.bin"
# The ggml model is data (about 148 MB), the same for every machine.
INSANE_SKIP:${PN}-model-base-en = "arch"

RRECOMMENDS:${PN} = "${PN}-model-base-en"
