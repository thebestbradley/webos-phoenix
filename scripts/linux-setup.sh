#!/bin/bash
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Set up Ubuntu 24.04 (a desktop, a VM, or a cloud agent's container) to
# build, run and test the webOS Phoenix simulator. The same packages as CI
# (.github/workflows/ci.yml). See docs/GETTING-STARTED.md.
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
        -h|--help) sed -n '5,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $arg (see --help)" >&2; exit 2 ;;
    esac
done

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO=sudo
say() { printf '\n==> %s\n' "$*"; }

say "Qt 6, CMake and the build tools"
$SUDO apt-get update
$SUDO apt-get install -y --no-install-recommends \
    build-essential cmake ninja-build git curl ca-certificates pkg-config \
    qt6-base-dev qt6-declarative-dev qt6-declarative-dev-tools \
    qml6-module-qtquick qml6-module-qtquick-window qml6-module-qtqml-workerscript \
    qml6-module-qttest qml6-module-qt5compat-graphicaleffects \
    qt6-webengine-dev qml6-module-qtwebengine qml6-module-qtwebchannel \
    qt6-multimedia-dev libqt6svg6 libglib2.0-dev fonts-dejavu-core \
    python3 python3-pip python3-venv

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

[ $BUILD = 1 ] || { say "Packages installed"; exit 0; }

say "git submodules"
git -C "$REPO_DIR" submodule update --init

say "Building the simulator and the apps"
# Ninja for a new build directory; an existing one keeps its generator.
gen=()
[ -f "$REPO_DIR/build/CMakeCache.txt" ] || gen=(-G Ninja)
cmake -S "$REPO_DIR/shell" -B "$REPO_DIR/build" ${gen[@]+"${gen[@]}"} -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build "$REPO_DIR/build"

say "Done"
cat <<'EOF'
Run the simulator:   ./build/phoenix-sim   (or --tablet)
Behaviour tests:     QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner -import shell/qml -import build/qml -input shell/tests
Web app tests:       NODE_PATH="$(npm root -g)" node tools/test-apps.cjs
More in docs/GETTING-STARTED.md.
EOF
