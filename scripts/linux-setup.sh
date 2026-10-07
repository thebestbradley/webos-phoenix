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
#
# Run it as a user with sudo, or as root (cloud containers).

set -euo pipefail

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
WANT_TESTS=0
BUILD=1
for arg in "$@"; do
    case "$arg" in
        --tests) WANT_TESTS=1 ;;
        --deps) BUILD=0; WANT_TESTS=1 ;;
        -h|--help) sed -n '5,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
