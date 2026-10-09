#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Tests ./phoenix, the one command (install what is missing, build, run),
# in its dry run: what it finds, what it would install and run, on a
# pretend Linux and a pretend Mac. Nothing is installed: the computer is
# made of stand-ins (a PATH of mock programs, a fake Qt, a fake checkout).
#
# Each case starts from a computer of its own (computer LINUX|DARWIN, then
# changes to it), in a new folder: nothing one case does reaches the next,
# and nothing of the computer running the tests (its Qt, Homebrew, Node.js,
# environment) reaches any. The settings of a case are plain variables set
# before the call, never `VAR=value function` (which macOS's /bin/sh keeps
# set after the function returns).
#
#   sh tools/test-phoenix-script.sh

# The checks are strings evaluated later, on purpose.
# shellcheck disable=SC2016

set -u
REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
failures=0
cases=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }

# The real programs a pretend computer has; the rest are mocks or missing.
REAL_BIN=$ROOT/real-bin
mkdir -p "$REAL_BIN"
for p in sh sed awk grep head cat date dirname basename id getconf tr mktemp env sort wc mkdir rm ls git find cp chmod sleep touch; do
    real=$(command -v "$p") && ln -s "$real" "$REAL_BIN/$p"
done

# A Qt with Qt WebEngine (what the script reads of one): fake_qt DIR VERSION.
fake_qt() {
    mkdir -p "$1/lib/cmake/Qt6" "$1/lib/cmake/Qt6WebEngineQuick"
    echo "set(PACKAGE_VERSION \"$2\")" > "$1/lib/cmake/Qt6/Qt6ConfigVersionImpl.cmake"
}
mock() {  # mock NAME BODY: a program on the pretend computer's PATH
    printf '#!/bin/sh\n%s\n' "$2" > "$BIN/$1"
    chmod +x "$BIN/$1"
}
unmock() { rm -f "$BIN/$1"; }

# computer Linux|Darwin: a new pretend computer with everything there:
#   T          its folder          BIN      its PATH (mocks and REAL_BIN)
#   CHECKOUT   the script's repo   BUILD    the build directory, with models
#   QT         a Qt 6.8.1          QT_ASK   PHOENIX_QT_DIR for the run ("" none)
#   OS         PHOENIX_OS          BREW     Homebrew's prefix (Darwin)
# Linux: every apt package ($T/dpkg lists them, "all"), node 22,
# whisper-cli, llama-server. Darwin: the command line tools, Homebrew and
# every formula, its Qt in opt/qt. Both: PHP 8.3 with sodium and pdo_sqlite.
computer() {
    cases=$((cases + 1))
    T=$ROOT/case-$cases
    BIN=$T/bin
    mkdir -p "$BIN" "$T/home"
    for p in "$REAL_BIN"/*; do ln -s "$(readlink "$p" 2>/dev/null || echo "$p")" "$BIN/$(basename "$p")"; done
    OS=$1
    QT_ASK=""
    QT=$T/qt
    fake_qt "$QT" 6.8.1

    # A checkout: the script in an otherwise empty repository, its apps'
    # packages installed after the lock was written.
    CHECKOUT=$T/checkout
    mkdir -p "$CHECKOUT/apps/node_modules"
    cp "$REPO_DIR/phoenix" "$CHECKOUT/phoenix"
    echo '{}' > "$CHECKOUT/apps/package-lock.json"
    git -C "$CHECKOUT" init -q
    touch -t 202001010000 "$CHECKOUT/apps/package-lock.json"
    echo '{}' > "$CHECKOUT/apps/node_modules/.package-lock.json"

    # The build directory (not configured) with the assistant's models.
    BUILD=$T/build
    mkdir -p "$BUILD/whisper" "$BUILD/wakeword/vosk-model-small-en-us-0.15"
    echo model > "$BUILD/whisper/ggml-base.en.bin"
    echo lib > "$BUILD/wakeword/libvosk.so"
    echo lib > "$BUILD/wakeword/libvosk.dylib"

    BREW=""
    # php -r CHECK answers yes (exit 0); php -r 'echo PHP_VERSION;' 8.3.6.
    mock php 'case "$*" in *PHP_VERSION\;*) printf 8.3.6 ;; esac; exit 0'
    if [ "$OS" = Linux ]; then
        echo all > "$T/dpkg"
        # dpkg-query: the packages in $T/dpkg are installed ("all": every one).
        mock dpkg-query '
fmt=""; for a in "$@"; do case "$a" in -f=*) fmt=${a#-f=} ;; -*) ;; *)
  if grep -qx -e "$a" -e all "'"$T"'/dpkg" 2>/dev/null; then
    case "$fmt" in *Package*) echo "$a ii " ;; *) printf "ii " ;; esac
  else echo "dpkg-query: no packages found matching $a" >&2; fi ;; esac; done'
        mock node 'echo v22.11.0'
        mock whisper-cli 'true'
        mock llama-server 'true'
    else
        mock xcode-select 'exit 0'
        # Homebrew's prefix is where its brew is (not where a link to it
        # points): brew stays out of BIN.
        BREW=$T/brew
        mkdir -p "$BREW/bin"
        printf '#!/bin/sh\necho "brew $*"\n' > "$BREW/bin/brew"
        chmod +x "$BREW/bin/brew"
        for f in qt cmake ninja node@22 git python@3.12 php whisper-cpp llama.cpp; do mkdir -p "$BREW/opt/$f"; done
        fake_qt "$BREW/opt/qt" 6.10.0
    fi
}

# phoenix ARGS...: runs the script on the case's computer, with nothing of
# this one; its output in $T/out, its exit status in $status.
phoenix() {
    if [ -n "$QT_ASK" ]; then
        set -- PHOENIX_QT_DIR="$QT_ASK" sh "$CHECKOUT/phoenix" "$@"
    else
        set -- sh "$CHECKOUT/phoenix" "$@"
    fi
    env -i PATH="$BIN${BREW:+:$BREW/bin}" HOME="$T/home" QT_PREFIX="$T/qtprefix" PHOENIX_BUILD_DIR="$BUILD" \
        PHOENIX_OS="$OS" DISPLAY=:9 "$@" > "$T/out" 2>&1
    # shellcheck disable=SC2034  # read by the checks (eval)
    status=$?
}
has() { grep -q -- "$1" "$T/out"; }
lacks() { ! grep -q -- "$1" "$T/out"; }
check() {  # check NAME CONDITION...: passes when every condition does
    name=$1; shift
    for c in "$@"; do
        if ! eval "$c"; then
            fail "$name: $c"
            sed 's/^/      | /' "$T/out"
            return
        fi
    done
    pass "$name"
}

# ---- Linux ---------------------------------------------------------------------------
computer Linux
QT_ASK=$QT
phoenix check
check "Linux, everything there: nothing to install" \
    '[ $status = 0 ]' 'has "dry run"' 'has "ok       Qt 6.8.1"' 'has "ok       Node.js v22.11.0"' \
    'has "ok       whisper-cli"' 'has "ok       whisper base.en model"' 'has "Nothing to install"' \
    'has "ok       PHP 8.3.6 with sodium and pdo_sqlite"' \
    'lacks "  install  "' 'has "would run: cmake -S .*-DCMAKE_PREFIX_PATH=$QT"' \
    'has "would run: cmake --build $BUILD --parallel"'

computer Linux
QT_ASK=$QT
phoenix build --dry-run
check "build --dry-run is check" '[ $status = 0 ]' 'has "Nothing to install"' 'lacks "  install  "'

# A computer with nothing of ours: every part would be installed.
computer Linux
printf 'git\nsed\n' > "$T/dpkg"
unmock node; unmock whisper-cli; unmock llama-server; unmock php
rm -rf "$BUILD/whisper" "$BUILD/wakeword"
phoenix check
check "Linux, nothing there: what it would install, with sizes" \
    '[ $status = 0 ]' 'has "install  apt: build-essential cmake ninja-build"' 'has "espeak-ng"' \
    'has "install  apt:.* php-cli php-sqlite3 "' 'has "skipped  PHP: not there yet"' 'lacks "php-mysql"' \
    'has "apt-get install -y --no-install-recommends"' \
    'has "install  Qt 6.8.1 into $T/qtprefix (aqtinstall) (about"' 'has "aqt install-qt linux desktop 6.8.1"' \
    'has "install  Node.js 22 (NodeSource)"' 'has "install  whisper-cli"' 'has "install  llama-server"' \
    'has "install  whisper base.en model (148 MB"' 'has "get-whisper-model.py --dest $BUILD/whisper"' \
    'has "get-wakeword.py --dest $BUILD/wakeword"' 'has "Would install:"' \
    '[ ! -e "$BUILD/whisper" ]' '[ ! -e "$T/qtprefix" ]'

computer Linux
printf 'git\nsed\n' > "$T/dpkg"
unmock node; unmock whisper-cli; unmock llama-server
rm -rf "$BUILD/whisper" "$BUILD/wakeword"
phoenix check --no-assistant
check "--no-assistant leaves out the assistant's parts" \
    '[ $status = 0 ]' 'lacks "espeak-ng"' 'lacks "whisper"' 'lacks "llama"' 'lacks "wake word"' 'has "install  Qt 6.8.1"'

computer Linux
phoenix build --offline
check "--offline with Qt missing: an actionable error" \
    '[ $status = 1 ]' 'has "--offline downloads nothing"'

computer Linux
QT_ASK=$QT
mock node 'echo v23.1.0'
phoenix check --no-assistant
check "an odd-numbered Node.js is replaced by 22" 'has "install  Node.js 22"'

computer Linux
fake_qt "$T/qt-old" 6.4.2
QT_ASK=$T/qt-old
phoenix check --no-assistant
check "a Qt older than 6.8 asked for: an error" '[ $status = 1 ]' 'has "is not a Qt 6.8 or later"'

computer Linux
fake_qt "$T/qtprefix/6.8.1/gcc_64" 6.8.1
phoenix check --no-assistant
check "Qt found where the script installs it" 'has "ok       Qt 6.8.1 ($T/qtprefix/6.8.1/gcc_64)"' 'lacks "  install  "'

# The build directory already configured: its Qt is kept, no configure.
computer Linux
echo "CMAKE_PREFIX_PATH:UNINITIALIZED=$QT" > "$BUILD/CMakeCache.txt"
phoenix check --no-assistant
check "a configured build keeps its Qt" 'has "ok       configured with Qt 6.8.1 ($QT)"' 'lacks "would run: cmake -S"'

# Submodules not checked out yet.
computer Linux
QT_ASK=$QT
git -C "$CHECKOUT" update-index --add --cacheinfo 160000,0123456789012345678901234567890123456789,third_party/x
printf '[submodule "x"]\n\tpath = third_party/x\n\turl = https://example.invalid/x.git\n' > "$CHECKOUT/.gitmodules"
phoenix check --no-assistant
check "missing git submodules are fetched" 'has "install  1 git submodules"' 'has "submodule update --init"'

computer Linux
QT_ASK=$QT
touch "$CHECKOUT/apps/package-lock.json"
touch -t 202001010000 "$CHECKOUT/apps/node_modules/.package-lock.json"
phoenix check --no-assistant
check "npm packages older than the lock: npm ci" 'has "install  npm packages for apps/"' 'has "npm ci"'

# PHP for the Marketplace's catalog: a normal part, its test driver only with --tests.
computer Linux
QT_ASK=$QT
printf 'git\nsed\n' > "$T/dpkg"
unmock php
phoenix check --no-assistant --tests
check "--tests adds PHP's MySQL driver (PHP itself is always installed)" \
    'has "install  apt:.* php-cli php-sqlite3 .*php-mysql"' 'has "xvfb"'

computer Linux
QT_ASK=$QT
mock php 'exit 1'
phoenix check --no-assistant
check "a PHP without sodium or pdo_sqlite: says how to get it, and goes on" \
    '[ $status = 0 ]' 'has "skipped  PHP 8 with sodium and pdo_sqlite is missing ($BIN/php): sudo apt install php-cli php-sqlite3"' \
    'has "would run: cmake --build"'

computer Darwin
mock php 'exit 1'
phoenix check --no-assistant
check "Mac: a PHP without sodium: brew reinstall php" '[ $status = 0 ]' 'has "brew reinstall php"'

# ---- run -----------------------------------------------------------------------------
computer Linux
QT_ASK=$QT
phoenix --dry-run --no-assistant run
check "run: adaptive by default" '[ $status = 0 ]' 'has "would run: .*phoenix-sim --adaptive$"'
phoenix --dry-run --no-assistant run tablet --scene cards --launch org.webosphoenix.settings
check "run tablet ARGS: the arguments go to the simulator" \
    'has "would run: .*phoenix-sim --tablet --scene cards --launch org.webosphoenix.settings$"'
phoenix --dry-run --no-assistant run --marketplace
check "run --marketplace: the catalog's option goes to the simulator" '[ $status = 0 ]' 'has "would run: .*phoenix-sim --adaptive --marketplace$"'
phoenix --dry-run --no-assistant run tablet --marketplace --scene cards
check "run tablet --marketplace ARGS" 'has "would run: .*phoenix-sim --tablet --marketplace --scene cards$"'
phoenix run --dry-run --no-assistant phone -- --help
check "run phone -- ARGS" 'has "phoenix-sim --phone --help$"'
phoenix phone
check "a mode without run: usage error" '[ $status = 2 ]' 'has "only ./phoenix run"'
phoenix --bogus
check "an unknown option: usage error" '[ $status = 2 ]' 'has "unknown command or option: --bogus"'
phoenix --help
check "--help" '[ $status = 0 ]' 'has "./phoenix run \[MODE\]"' 'has "--no-assistant"' 'has "--offline"' \
    'has "./phoenix run --marketplace"' 'has "Services > Marketplace Catalog"' 'has "^Environment: PHOENIX_BUILD_DIR"' 'lacks "set -eu"'

# ---- macOS ---------------------------------------------------------------------------
computer Darwin
rm -rf "$BREW/opt/qt" "$BREW/opt/node@22" "$BREW/opt/python@3.12" "$BREW/opt/php" "$BREW/opt/whisper-cpp" "$BREW/opt/llama.cpp"
unmock php
phoenix check
check "Mac: the missing Homebrew packages in one brew install, with sizes" \
    '[ $status = 0 ]' 'has "ok       Xcode command line tools"' 'has "ok       Homebrew"' 'has "ok       cmake"' \
    'has "install  qt (about 1.3 GB"' 'has "install  node@22"' 'has "install  whisper-cpp"' 'has "install  llama.cpp"' \
    'has "install  php (about 120 MB"' 'has "skipped  PHP: not there yet"' \
    'has "would run: $BREW/bin/brew install qt node@22 python@3.12 php whisper-cpp llama.cpp$"' \
    'has "-DCMAKE_PREFIX_PATH=$BREW/opt/qt"'

computer Darwin
phoenix check
check "Mac, everything there: nothing to install" \
    '[ $status = 0 ]' 'lacks "  install  "' 'has "Nothing to install"' 'lacks "brew install"' \
    'has "-DCMAKE_PREFIX_PATH=$BREW/opt/qt"'

computer Darwin
mock xcode-select 'exit 2'
phoenix check --no-assistant
check "Mac without the command line tools: their installer" 'has "install  Xcode command line tools"' 'has "xcode-select --install"'

echo
if [ $failures = 0 ]; then
    echo "All passed."
else
    echo "$failures failed."
    exit 1
fi
