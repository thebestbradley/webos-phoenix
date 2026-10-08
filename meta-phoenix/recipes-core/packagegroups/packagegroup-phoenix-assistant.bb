# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "What the Phoenix Assistant and dictation run on the device"
DESCRIPTION = "Speech recognition (whisper.cpp and its English model), \
the on-device model runner (llama.cpp's llama-server), the wake word \
(libvosk and its small English model; phoenix-wakeword comes with \
phoenix-shell) and a speech program for spoken answers. The language \
models themselves are downloaded in Settings > Assistant, not shipped \
(docs/AI-AND-MCP.md, \"What's installed where\")."
LICENSE = "Apache-2.0"

# What it pulls in depends on the target (Vosk's library), so it is not
# allarch, as packagegroups otherwise are.
PACKAGE_ARCH = "${TUNE_PKGARCH}"
inherit packagegroup

# The speech program (apps/assistant/service/lib/node-device.js finds
# espeak-ng first, then flite). Flite (meta-multimedia, BSD-3-Clause,
# English only) by default, so the image stays permissive. espeak-ng speaks
# more languages but is GPL-3.0 (as a program of its own, never linked;
# docs/LEGAL.md): set PHOENIX_TTS = "espeak" in local.conf for meta-oe's
# eSpeak 1.48, or add an espeak-ng recipe. "" leaves spoken answers out.
PHOENIX_TTS ?= "flite"

# Vosk's prebuilt library exists for these only (recipes-support/vosk).
PHOENIX_WAKEWORD ?= "${@'libvosk vosk-model-small-en-us' if d.getVar('TARGET_ARCH') in ('x86_64', 'aarch64', 'arm') else ''}"

RDEPENDS:${PN} = " \
    whisper-cpp \
    whisper-cpp-model-base-en \
    llama-cpp-server \
    ${PHOENIX_WAKEWORD} \
    ${PHOENIX_TTS} \
"
