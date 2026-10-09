#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Set up Ubuntu 24.04 (a desktop, a VM, or a cloud agent's container) to
# build, run and test the webOS Phoenix simulator: the same as ./phoenix
# (the one command, at the top of the checkout), which checks what is
# installed and installs only what is missing. The same Qt and packages as
# CI (.github/workflows/ci.yml). Kept for the options it has always had.
# See docs/GETTING-STARTED.md.
#
# Qt is 6.8.1, the release a device's webOS OSE image ships (meta-qt6,
# scarthgap), installed with aqtinstall into /opt/Qt (QT_PREFIX to change
# it): Ubuntu's own Qt packages stop at 6.4.
#
#   scripts/linux-setup.sh           install packages, fetch submodules, build
#                                    (./phoenix build)
#   scripts/linux-setup.sh --tests   also the test tools (Playwright and its
#                                    Chromium, Radicale, WsgiDAV, PHP, xvfb)
#   scripts/linux-setup.sh --deps    only install packages and the test tools
#                                    (no build; ./phoenix setup --tests); for
#                                    a cloud environment's setup script
#   ... --no-assistant               without what the assistant and dictation
#                                    use (installed by default, about 280 MB
#                                    on disk; see below)
#
# The assistant (docs/AI-AND-MCP.md, "What's installed where"): espeak-ng
# (apt), whisper.cpp's whisper-cli and llama.cpp's llama-server (built from
# the commits ./phoenix pins into /usr/local/bin, a few minutes), whisper's
# base.en model (148 MB) into build/whisper and the wake word (Vosk, 26 +
# 71 MB) into build/wakeword, each checked by its SHA-256 or git commit.
# Skipped when already there. The on-device language models are not
# fetched here: Settings > Assistant downloads them.
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
        -h|--help) sed -n '5,35p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
    esac
    shift
done
shift
exec "$REPO_DIR/phoenix" "$command" "$@"
