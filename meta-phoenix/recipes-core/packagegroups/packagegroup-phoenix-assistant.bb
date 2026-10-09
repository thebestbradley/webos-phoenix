# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "What the Phoenix Assistant and dictation run on the device"
DESCRIPTION = "Speech recognition (whisper.cpp and its English model), \
the on-device model runner (llama.cpp's llama-server, which phoenix-pdeath \
ends with the Assistant service) and the built-in \
model (Qwen3 0.6B), the wake word (libvosk and its small English model; \
phoenix-wakeword comes with phoenix-shell) and the voice for spoken \
answers: Kitten TTS (its model, the CMU dictionary and ONNX Runtime; \
phoenix-tts comes with phoenix-shell), with Flite when it cannot speak. \
Larger language models are downloaded in Settings > Assistant \
(docs/AI-AND-MCP.md, \"What's installed where\")."
LICENSE = "Apache-2.0"

# What it pulls in depends on the target (Vosk's library), so it is not
# allarch, as packagegroups otherwise are.
PACKAGE_ARCH = "${TUNE_PKGARCH}"
inherit packagegroup

# The voice: Kitten TTS (phoenix-tts with kitten-tts-nano, cmudict and
# onnxruntime, all permissive: Apache-2.0, BSD-2-Clause, MIT), where ONNX
# Runtime's prebuilt library exists (recipes-support/onnxruntime: x86-64,
# aarch64); "" leaves it out. apps/assistant/service/lib/node-device.js
# speaks with it first, for English.
PHOENIX_KITTEN ?= "${@'onnxruntime kitten-tts-nano cmudict' if d.getVar('TARGET_ARCH') in ('x86_64', 'aarch64') else ''}"

# The speech program when Kitten cannot speak (and for other languages;
# node-device.js finds espeak-ng first, then flite). Flite (meta-multimedia,
# BSD-3-Clause, English only) by default, so the image stays permissive.
# espeak-ng speaks more languages but is GPL-3.0 (as a program of its own,
# never linked; docs/LEGAL.md): set PHOENIX_TTS = "espeak" in local.conf
# for meta-oe's eSpeak 1.48, or add an espeak-ng recipe. "" leaves the
# fallback out.
PHOENIX_TTS ?= "flite"

# The built-in on-device model (639 MB): "" leaves it out (the Assistant
# then has its commands and the models Settings downloads).
PHOENIX_BASE_MODEL ?= "qwen3-0.6b-gguf"

# Vosk's prebuilt library exists for these only (recipes-support/vosk).
PHOENIX_WAKEWORD ?= "${@'libvosk vosk-model-small-en-us' if d.getVar('TARGET_ARCH') in ('x86_64', 'aarch64', 'arm') else ''}"

RDEPENDS:${PN} = " \
    whisper-cpp \
    whisper-cpp-model-base-en \
    llama-cpp-server \
    phoenix-pdeath \
    ${PHOENIX_BASE_MODEL} \
    ${PHOENIX_WAKEWORD} \
    ${PHOENIX_KITTEN} \
    ${PHOENIX_TTS} \
"
