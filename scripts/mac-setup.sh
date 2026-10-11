#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Set up a Mac to build, run and test the webOS Phoenix simulator: the same
# as ./phoenix (the one command, at the top of the checkout), which checks
# what is installed and installs only what is missing. Kept for the
# options it has always had. See docs/GETTING-STARTED.md.
#
#   scripts/mac-setup.sh            install what the simulator needs, build it
#                                   (./phoenix build)
#   scripts/mac-setup.sh --tests    also what the test suites need (Playwright,
#                                   Python packages)
#   scripts/mac-setup.sh --all      the same as --tests
#   scripts/mac-setup.sh --no-assistant
#                                   without what the assistant and dictation
#                                   use (installed by default)
#   scripts/mac-setup.sh --check    only report what is installed and missing
#                                   (./phoenix check)
#
# The assistant (docs/AI-AND-MCP.md, "What's installed where"): whisper.cpp
# (whisper-cpp), llama.cpp (llama.cpp) and ONNX Runtime from Homebrew,
# whisper's base.en model (148 MB) into build/whisper, the wake word (Vosk,
# 13 + 71 MB) into build/wakeword, the voice (Kitten TTS, about 28 MB) into
# build/kitten and the built-in language model (Qwen3 0.6B, 639 MB) into
# build/models, each checked by its SHA-256. Settings > Assistant downloads
# the larger models.

set -eu

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
command=build
set -- "$@" --end
while [ "$1" != --end ]; do
    case "$1" in
        --tests|--all) set -- "$@" --tests ;;
        --voice) ;;     # the assistant's voice is installed by default now
        --no-assistant) set -- "$@" --no-assistant ;;
        --check) command=check ;;
        -h|--help) sed -n '5,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
    esac
    shift
done
shift

if [ "$(uname -s)" != Darwin ]; then
    echo "This script is for macOS. Elsewhere run ./phoenix (docs/GETTING-STARTED.md)." >&2
    exit 1
fi
exec "$REPO_DIR/phoenix" "$command" "$@"
