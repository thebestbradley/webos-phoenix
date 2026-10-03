#!/bin/bash
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Set up a Mac to build, run and test the webOS Phoenix simulator.
# See docs/GETTING-STARTED.md.
#
#   scripts/mac-setup.sh            install what the simulator needs, build it
#   scripts/mac-setup.sh --tests    also what the test suites need (Playwright,
#                                   Python and PHP packages)
#   scripts/mac-setup.sh --voice    also whisper.cpp and its English model, for
#                                   dictation, Voice Memos and Voice Dial
#   scripts/mac-setup.sh --all      all of the above
#   scripts/mac-setup.sh --check    only report what is installed and missing
#
# Safe to run again: it skips what is already there. It needs Homebrew
# (https://brew.sh) and Xcode's command line tools, and says how to get them
# if they are missing. Apple silicon and Intel Macs both work.

set -euo pipefail

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
WANT_TESTS=0
WANT_VOICE=0
CHECK_ONLY=0
for arg in "$@"; do
    case "$arg" in
        --tests) WANT_TESTS=1 ;;
        --voice) WANT_VOICE=1 ;;
        --all) WANT_TESTS=1; WANT_VOICE=1 ;;
        --check) CHECK_ONLY=1 ;;
        -h|--help) sed -n '5,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $arg (see --help)" >&2; exit 2 ;;
    esac
done

if [ "$(uname -s)" != Darwin ]; then
    echo "This script is for macOS. On Ubuntu, see docs/GETTING-STARTED.md (scripts/linux-setup.sh)." >&2
    exit 1
fi

say() { printf '\n==> %s\n' "$*"; }
missing=0
have() { command -v "$1" >/dev/null 2>&1; }
report() {  # report NAME OK? [HINT]
    if [ "$2" = 1 ]; then printf '  ok       %s\n' "$1"; else printf '  missing  %s%s\n' "$1" "${3:+  ($3)}"; missing=1; fi
}

# ---- Prerequisites ---------------------------------------------------------------
say "Prerequisites"
if xcode-select -p >/dev/null 2>&1; then clt=1; else clt=0; fi
report "Xcode command line tools" $clt "xcode-select --install"
if have brew; then brewok=1; else brewok=0; fi
report "Homebrew" $brewok "https://brew.sh"
if [ $clt = 0 ] || [ $brewok = 0 ]; then
    echo
    echo "Install the missing prerequisites above, open a new terminal, and run this script again."
    exit 1
fi

BREW_PREFIX=$(brew --prefix)
# node@22 is keg-only: Homebrew doesn't put it on the PATH by itself.
NODE22_BIN="$BREW_PREFIX/opt/node@22/bin"

# Homebrew formulae: (formula, what it is for)
CORE_FORMULAE="qt cmake ninja node@22 git python@3.12"
TEST_FORMULAE="php"
VOICE_FORMULAE="whisper-cpp"

formulae=$CORE_FORMULAE
[ $WANT_TESTS = 1 ] && formulae="$formulae $TEST_FORMULAE"
[ $WANT_VOICE = 1 ] && formulae="$formulae $VOICE_FORMULAE"

say "Homebrew packages"
to_install=""
for f in $formulae; do
    if brew list --formula "$f" >/dev/null 2>&1; then report "$f" 1; else report "$f" 0 "brew install $f"; to_install="$to_install $f"; fi
done

say "Source"
if [ -e "$REPO_DIR/third_party/enyo-1.0/framework" ]; then subs=1; else subs=0; fi
report "git submodules (original Open webOS apps and frameworks)" $subs "git submodule update --init"

if [ $CHECK_ONLY = 1 ]; then
    say "Node.js on the PATH"
    if have node; then node --version; else echo "  none"; fi
    [ -x "$NODE22_BIN/node" ] && echo "  node@22: $("$NODE22_BIN/node" --version) (add $NODE22_BIN to your PATH)"
    echo
    if [ $missing = 0 ]; then
        echo "Everything is installed."
    else
        echo "Run scripts/mac-setup.sh (without --check) to install what is missing."
    fi
    exit 0
fi

# ---- Install -------------------------------------------------------------------------
if [ -n "$to_install" ]; then
    say "Installing:$to_install"
    # shellcheck disable=SC2086
    brew install $to_install
fi

# Use Node 22 LTS for this script and the build. Odd-numbered Node releases
# (Homebrew's plain `node` may be one) are refused by Enact's CLI.
export PATH="$NODE22_BIN:$PATH"
case ":$(grep -s 'node@22' "$HOME/.zprofile" "$HOME/.zshrc" || true):" in
    *node@22*) ;;
    *)
        echo
        echo "Note: put Node 22 on your PATH for new terminals:"
        echo "  echo 'export PATH=\"$NODE22_BIN:\$PATH\"' >> ~/.zprofile"
        ;;
esac

say "git submodules"
git -C "$REPO_DIR" submodule update --init

if [ $WANT_VOICE = 1 ]; then
    say "whisper.cpp model (ggml-base.en.bin, about 150 MB)"
    MODEL_DIR="$HOME/Library/Application Support/webos-phoenix/whisper"
    MODEL="$MODEL_DIR/ggml-base.en.bin"
    mkdir -p "$MODEL_DIR"
    if [ ! -s "$MODEL" ]; then
        curl -fL --progress-bar -o "$MODEL.part" \
            https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
        mv "$MODEL.part" "$MODEL"
    fi
    echo "  $MODEL"
    echo "  The simulator finds whisper-cli on the PATH; tell it where the model is:"
    echo "    echo 'export PHOENIX_WHISPER_MODEL=\"$MODEL\"' >> ~/.zprofile"
fi

say "Building the simulator and the apps (the first build takes a few minutes)"
# Ninja for a new build directory; an existing one keeps its generator.
gen=()
[ -f "$REPO_DIR/build/CMakeCache.txt" ] || gen=(-G Ninja)
cmake -S "$REPO_DIR/shell" -B "$REPO_DIR/build" ${gen[@]+"${gen[@]}"} \
    -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    -DCMAKE_PREFIX_PATH="$BREW_PREFIX/opt/qt"
cmake --build "$REPO_DIR/build"

if [ $WANT_TESTS = 1 ]; then
    say "Test tools"
    # Playwright drives headless Chromium for the web app tests (tools/test-*.cjs).
    npm install -g playwright@1
    npx --yes playwright@1 install chromium
    # Radicale and WsgiDAV: the CardDAV/CalDAV and WebDAV servers the sync and
    # backup tests talk to. Pillow and NumPy: the HiDPI art checks.
    PY="$BREW_PREFIX/opt/python@3.12/bin/python3.12"
    "$PY" -m venv "$REPO_DIR/.venv"
    "$REPO_DIR/.venv/bin/pip" install --quiet radicale wsgidav cheroot pillow numpy
    echo "  Python packages are in .venv/ (activate it with: source .venv/bin/activate)"
fi

say "Done"
cat <<EOF
Run the simulator:
  ./build/phoenix-sim              # a phone (Pre, 320x480)
  ./build/phoenix-sim --tablet     # a tablet (TouchPad, 1024x768)

Behaviour tests:
  QT_QPA_PLATFORM=offscreen "$BREW_PREFIX/opt/qt/bin/qmltestrunner" -import shell/qml -import build/qml -input shell/tests

More in docs/GETTING-STARTED.md.
EOF
