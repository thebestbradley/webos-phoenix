#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Set up Ubuntu 24.04 (a desktop, a VM, or a cloud agent's container) to
# build, run and test the webOS Phoenix simulator: the same as ./phoenix
# (the one command, at the top of the checkout), which checks what is
# installed and installs only what is missing. The same Qt and packages as
# CI (.github/actions/setup/action.yml). Kept for the options it has always had.
# See docs/GETTING-STARTED.md.
#
# Qt is 6.11.3, the simulator's (its Qt WebEngine has the newest Chromium,
# 140 with security fixes to 153; a device's webOS OSE image ships 6.8.1,
# the oldest the shell builds with),
# installed with aqtinstall into /opt/Qt (QT_PREFIX to change it): Ubuntu's
# own Qt packages stop at 6.4.
#
#   scripts/linux-setup.sh           install packages (PHP 8 for the
#                                    Marketplace's catalog among them), fetch
#                                    submodules, build (./phoenix build)
#   scripts/linux-setup.sh --tests   also the test tools (Playwright and its
#                                    Chromium, Radicale, WsgiDAV, PHP's MySQL
#                                    driver, xvfb)
#   scripts/linux-setup.sh --deps    only install packages and the test tools
#                                    (no build; ./phoenix setup --tests); for
#                                    a cloud environment's setup script
#   ... --no-assistant               without what the assistant and dictation
#                                    use (installed by default, about 980 MB
#                                    on disk; see below)
#
# The assistant (docs/AI-AND-MCP.md, "What's installed where"): espeak-ng
# (apt), whisper.cpp's whisper-cli and llama.cpp's llama-server (built from
# the commits ./phoenix pins into /usr/local/bin, a few minutes), whisper's
# base.en model (148 MB) into build/whisper, the wake word (Vosk, 26 +
# 71 MB) into build/wakeword, the voice (Kitten TTS and ONNX Runtime, 57 MB
# on disk) into build/kitten and the built-in language model (Qwen3 0.6B,
# 639 MB) into build/models, each checked by its SHA-256 or git commit.
# Skipped when already there. Settings > Assistant downloads the larger
# models.
#
# Run it as a user with sudo, or as root (cloud containers).

set -eu

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
command=build
set -- "$@" --end
while [ "$1" != --end ]; do
    case "$1" in
        --tests) set -- "$@" --tests ;;
        --no-assistant) set -- "$@" --no-assistant ;;
        --deps) command=setup; set -- "$@" --tests ;;
        -h|--help) sed -n '5,37p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
    esac
    shift
done
shift
exec "$REPO_DIR/phoenix" "$command" "$@"
