# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# whisper.cpp's whisper-cli and its English model, the speech recognition
# of dictation, Voice Memos, Voice Dial and the Assistant
# (org.webosphoenix.transcriber, apps/voicememos/service), which looks for:
#
#   whisper-cli                          on the PATH (${bindir})
#   /usr/share/whisper/ggml-base.en.bin  the default model
#   ffmpeg                               optional: converts audio that is not
#                                        16 kHz WAV (the app records WAV)
#
# packagegroup-phoenix-assistant installs whisper-cpp and
# whisper-cpp-model-base-en (148 MB). The model is in the image rather
# than fetched on first use: dictation and the wake word's request must
# work offline from the first boot, and every supported device (4 GB and
# more, docs/HARDWARE.md) has the room. ffmpeg is in openembedded-core but
# has LICENSE_FLAGS "commercial"; add LICENSE_FLAGS_ACCEPTED += "commercial"
# if it is wanted. Without whisper-cli or the model the service answers
# "not installed" (errorCode 2 or 3), and Settings > Assistant says what the
# image lacks.
#
# Licenses: whisper.cpp and ggml are MIT (LICENSE). The model weights are
# OpenAI's Whisper models (MIT, github.com/openai/whisper), converted to
# ggml by the whisper.cpp authors and published at
# huggingface.co/ggerganov/whisper.cpp. See docs/LEGAL.md.
#
# Built statically (ggml inside the program), like llama-cpp, so the two
# recipes never install the same libggml files. Not built on real hardware
# yet (CI parses and dry-runs it): to check on a device are the ggml CPU
# backend flags for the target (GGML_NATIVE must stay off when
# cross-compiling), the speed of base.en (tiny.en, 78 MB, is ~2x faster
# and less exact) and memory.

SUMMARY = "whisper.cpp: OpenAI Whisper speech recognition in C/C++ (whisper-cli)"
HOMEPAGE = "https://github.com/ggml-org/whisper.cpp"
SECTION = "multimedia"
LICENSE = "MIT"
# The model's own notice (OpenAI's MIT licence) ships beside it.
LIC_FILES_CHKSUM = "file://LICENSE;md5=223b26b3c1143120c87e2b13111d3e99 \
                    file://${UNPACKDIR}/openai-whisper-LICENSE;md5=b1b8ea5cbbe899304ac6566613a3b74e"

SRC_URI = "git://github.com/ggml-org/whisper.cpp.git;protocol=https;branch=master \
           https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin;name=base-en \
           https://raw.githubusercontent.com/openai/whisper/${OPENAI_WHISPER_REV}/LICENSE;name=openai;downloadfilename=openai-whisper-LICENSE \
"
# openai/whisper v20250625, for its LICENSE.
OPENAI_WHISPER_REV = "31243bad24cc746f07d4c8bfdd2d974872cb1803"
# master on 2026-09-24 (version 1.9.4 in its CMakeLists.txt), the build
# scripts/linux-setup.sh makes.
SRCREV = "d09f61a708f3487afa956ff578e60eae5e7a233c"
SRC_URI[base-en.sha256sum] = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"
SRC_URI[openai.sha256sum] = "b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d"

S = "${WORKDIR}/git"

inherit cmake

# whisper-cli only: no server, SDL2 (microphone) examples, curl or tests.
EXTRA_OECMAKE = " \
    -DBUILD_SHARED_LIBS=OFF \
    -DWHISPER_BUILD_EXAMPLES=ON \
    -DWHISPER_BUILD_SERVER=OFF \
    -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_SDL2=OFF \
    -DWHISPER_CURL=OFF \
    -DGGML_NATIVE=OFF \
"
OECMAKE_TARGET_COMPILE = "whisper-cli"

do_install() {
    install -d ${D}${bindir} ${D}${datadir}/whisper
    install -m 0755 ${B}/bin/whisper-cli ${D}${bindir}/whisper-cli
    install -m 0644 ${UNPACKDIR}/ggml-base.en.bin ${D}${datadir}/whisper/ggml-base.en.bin
    install -m 0644 ${UNPACKDIR}/openai-whisper-LICENSE ${D}${datadir}/whisper/LICENSE.openai-whisper
}

PACKAGES =+ "${PN}-model-base-en"
FILES:${PN}-model-base-en = "${datadir}/whisper/ggml-base.en.bin ${datadir}/whisper/LICENSE.openai-whisper"
LICENSE:${PN}-model-base-en = "MIT"
# The ggml model is data (about 148 MB), the same for every machine.
INSANE_SKIP:${PN}-model-base-en = "arch"

RRECOMMENDS:${PN} = "${PN}-model-base-en"
