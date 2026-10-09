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
# (whisper-cpp) and llama.cpp (llama.cpp) from Homebrew, whisper's base.en
# model (148 MB) into build/whisper and the wake word (Vosk, 13 + 71 MB)
# into build/wakeword, checked by their SHA-256; the Mac's own `say`
# speaks. The on-device language models are not fetched here: Settings >
# Assistant downloads them.

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
        -h|--help) sed -n '5,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
