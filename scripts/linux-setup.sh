#!/bin/bash
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Set up Ubuntu 24.04 (a desktop, a VM, or a cloud agent's container) to
# build, run and test the webOS Phoenix simulator. The same Qt and packages
# as CI (.github/workflows/ci.yml). See docs/GETTING-STARTED.md.
#
# Qt is 6.8.1, the release a device's webOS OSE image ships (meta-qt6,
# scarthgap), installed with aqtinstall into /opt/Qt (QT_PREFIX to change
# it): Ubuntu's own Qt packages stop at 6.4.
#
#   scripts/linux-setup.sh           install packages, fetch submodules, build
#   scripts/linux-setup.sh --tests   also the test tools (Playwright and its
#                                    Chromium, Radicale, WsgiDAV, PHP, xvfb)
#   scripts/linux-setup.sh --deps    only install packages (no build); for a
#                                    cloud environment's setup script
#   ... --no-assistant               without what the assistant and dictation
#                                    use (installed by default, about 280 MB
#                                    on disk; see below)
#
# The assistant (docs/AI-AND-MCP.md, "What's installed where"): espeak-ng
# (apt), whisper.cpp's whisper-cli and llama.cpp's llama-server (built from
# pinned commits into /usr/local/bin, a few minutes), whisper's base.en
# model (148 MB) into build/whisper and the wake word (Vosk, 26 + 71 MB)
# into build/wakeword, each checked by its SHA-256 or git commit. Skipped
# when already there. The on-device language models are not fetched here:
# Settings > Assistant downloads them.
#
# Run it as a user with sudo, or as root (cloud containers).

set -euo pipefail

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
WANT_TESTS=0
BUILD=1
WANT_ASSISTANT=1
for arg in "$@"; do
    case "$arg" in
        --tests) WANT_TESTS=1 ;;
        --no-assistant) WANT_ASSISTANT=0 ;;
        --deps) BUILD=0; WANT_TESTS=1 ;;
        -h|--help) sed -n '5,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $arg (see --help)" >&2; exit 2 ;;
    esac
done

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO=sudo
say() { printf '\n==> %s\n' "$*"; }

QT_VERSION=6.8.1
QT_PREFIX=${QT_PREFIX:-/opt/Qt}
QT_DIR="$QT_PREFIX/$QT_VERSION/gcc_64"

say "CMake, the build tools, and what Qt $QT_VERSION needs from the system"
$SUDO apt-get update
# The libraries Qt's own (display, fonts, input, sound, Qt WebEngine's
# Chromium) load from the system, and the OpenGL headers its CMake files ask
# for.
$SUDO apt-get install -y --no-install-recommends \
    build-essential cmake ninja-build git curl ca-certificates pkg-config \
    libgl-dev libegl-dev libxkbcommon-dev libglib2.0-dev fonts-dejavu-core \
    libgl1 libegl1 libgbm1 libfontconfig1 libfreetype6 libdbus-1-3 \
    libxkbcommon0 libxkbcommon-x11-0 libx11-xcb1 libxcb-cursor0 libxcb-icccm4 \
    libxcb-image0 libxcb-keysyms1 libxcb-randr0 libxcb-render-util0 libxcb-shape0 \
    libxcb-xinerama0 libxcb-xkb1 libnss3 libnspr4 libxcomposite1 libxdamage1 \
    libxrandr2 libxtst6 libxkbfile1 libxshmfence1 libasound2t64 libpulse0 libcups2t64 \
    python3 python3-pip python3-venv

if [ ! -x "$QT_DIR/bin/qmltestrunner" ]; then
    say "Qt $QT_VERSION (aqtinstall) into $QT_PREFIX"
    # --break-system-packages: Ubuntu 24.04 marks its Python as externally
    # managed; aqtinstall is a build tool, not system software.
    python3 -m pip install --quiet --break-system-packages aqtinstall
    $SUDO mkdir -p "$QT_PREFIX"
    $SUDO python3 -m aqt install-qt linux desktop "$QT_VERSION" linux_gcc_64 -O "$QT_PREFIX" \
        -m qtwebengine qtwebchannel qtpositioning qt5compat qtmultimedia qtshadertools
    $SUDO rm -f aqtinstall.log
fi

# Node.js 22 LTS. Ubuntu's own nodejs package is too old.
if ! command -v node >/dev/null 2>&1 || ! node --version | grep -Eq '^v(2[2-9]|[3-9][0-9])\.'; then
    say "Node.js 22 (NodeSource)"
    curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash -
    $SUDO apt-get install -y nodejs
fi

if [ $WANT_TESTS = 1 ]; then
    say "Test tools"
    $SUDO apt-get install -y --no-install-recommends \
        xvfb xauth xdotool libgl1-mesa-dri php-cli php-sqlite3 php-mysql
    # Radicale and WsgiDAV (DAV sync and backup tests), Pillow and NumPy (HiDPI
    # art checks). --break-system-packages: Ubuntu 24.04 marks its Python as
    # externally managed; these are test tools, not system software.
    python3 -m pip install --quiet --break-system-packages radicale wsgidav cheroot pillow numpy
    # Playwright and its Chromium, for the web app tests (tools/test-*.cjs,
    # which need NODE_PATH="$(npm root -g)").
    $SUDO npm install -g playwright@1
    $SUDO npx --yes playwright@1 install --with-deps chromium
fi

# ---- The assistant's programs and models -------------------------------------------
# whisper.cpp and llama.cpp at the commits meta-phoenix's recipes pin
# (meta-phoenix/recipes-support), as static programs (their ggml inside).
# Ubuntu 24.04 packages neither.
WHISPER_COMMIT=d09f61a708f3487afa956ff578e60eae5e7a233c   # whisper.cpp master, 2026-09-24 (1.9.4)
LLAMA_COMMIT=66e665c4276ee46f3ec9872dd7e5a496842bc44f     # llama.cpp b11239, 2026-09-28
build_ggml_program() {  # NAME REPO COMMIT TARGET CMAKE_FLAGS...
    local name=$1 repo=$2 commit=$3 target=$4; shift 4
    if command -v "$target" >/dev/null 2>&1; then
        echo "  $target: $(command -v "$target") (already there)"
        return
    fi
    say "$target ($name ${commit:0:7}, built from source into /usr/local/bin)"
    local src
    src=$(mktemp -d)
    git -C "$src" init -q
    git -C "$src" fetch -q --depth 1 "$repo" "$commit"
    git -C "$src" checkout -q FETCH_HEAD
    cmake -S "$src" -B "$src/build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=ON "$@" >/dev/null
    cmake --build "$src/build" --target "$target"
    $SUDO install -m 0755 "$src/build/bin/$target" "/usr/local/bin/$target"
    rm -rf "$src"
    echo "  /usr/local/bin/$target ($(du -h "/usr/local/bin/$target" | cut -f1))"
}
if [ $WANT_ASSISTANT = 1 ]; then
    say "The assistant: speech (espeak-ng), recognition (whisper.cpp), on-device model runner (llama.cpp)"
    $SUDO apt-get install -y --no-install-recommends espeak-ng
    build_ggml_program whisper.cpp https://github.com/ggml-org/whisper.cpp.git "$WHISPER_COMMIT" whisper-cli \
        -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF
    build_ggml_program llama.cpp https://github.com/ggml-org/llama.cpp.git "$LLAMA_COMMIT" llama-server \
        -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_APP=OFF -DLLAMA_BUILD_UI=OFF \
        -DLLAMA_USE_PREBUILT_UI=OFF -DLLAMA_OPENSSL=OFF -DLLAMA_BUILD_NUMBER=11239
    say "Models: whisper base.en (148 MB) and the wake word (Vosk, 26 + 71 MB), into build/"
    python3 "$REPO_DIR/tools/get-whisper-model.py"
    python3 "$REPO_DIR/tools/get-wakeword.py"
fi

[ $BUILD = 1 ] || { say "Packages and Qt $QT_VERSION installed (configure with -DCMAKE_PREFIX_PATH=$QT_DIR)"; exit 0; }

say "git submodules"
git -C "$REPO_DIR" submodule update --init

say "Building the simulator and the apps"
# Ninja for a new build directory; an existing one keeps its generator.
gen=()
[ -f "$REPO_DIR/build/CMakeCache.txt" ] || gen=(-G Ninja)
cmake -S "$REPO_DIR/shell" -B "$REPO_DIR/build" ${gen[@]+"${gen[@]}"} -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    -DCMAKE_PREFIX_PATH="$QT_DIR"
cmake --build "$REPO_DIR/build"

say "Done"
cat <<EOF
Run the simulator:   ./build/phoenix-sim   (or --tablet)
Behaviour tests:     QT_QPA_PLATFORM=offscreen $QT_DIR/bin/qmltestrunner -import shell/qml -import build/qml -input shell/tests
Web app tests:       NODE_PATH="\$(npm root -g)" node tools/test-apps.cjs
More in docs/GETTING-STARTED.md.
EOF
