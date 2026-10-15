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
#   QT         a Qt 6.12.0 (later than the simulator's 6.11.3, as Homebrew's)
#              QT_ASK   PHOENIX_QT_DIR for the run ("" none)
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
    fake_qt "$QT" 6.12.0

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
    mkdir -p "$BUILD/whisper" "$BUILD/wakeword/vosk-model-small-en-us-0.15" "$BUILD/kitten" "$BUILD/models"
    echo model > "$BUILD/whisper/ggml-base.en.bin"
    echo lib > "$BUILD/wakeword/libvosk.so"
    echo lib > "$BUILD/wakeword/libvosk.dylib"
    echo model > "$BUILD/kitten/kitten_tts_nano_v0_2.onnx"
    echo words > "$BUILD/kitten/cmudict.dict"
    echo lib > "$BUILD/kitten/libonnxruntime.so.1"
    echo model > "$BUILD/models/qwen3-0.6b-q8_0.gguf"

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
        mock llama-server 'echo "version: 0.6.0-dev (build 11552, commit 23b0202)"'
    else
        mock xcode-select 'exit 0'
        # Homebrew's prefix is where its brew is (not where a link to it
        # points): brew stays out of BIN.
        BREW=$T/brew
        mkdir -p "$BREW/bin"
        printf '#!/bin/sh\necho "brew $*"\n' > "$BREW/bin/brew"
        chmod +x "$BREW/bin/brew"
        for f in qt cmake ninja node@22 git python@3.12 php whisper-cpp llama.cpp onnxruntime; do mkdir -p "$BREW/opt/$f"; done
        fake_qt "$BREW/opt/qt" 6.12.0
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
    '[ $status = 0 ]' 'has "dry run"' 'has "ok       Qt 6.12.0 ($QT, PHOENIX_QT_DIR)"' 'has "ok       Node.js v22.11.0"' \
    'has "ok       whisper-cli"' 'has "ok       whisper base.en model"' 'has "Nothing to install"' \
    'has "ok       voice: Kitten TTS"' 'has "ok       built-in language model: Qwen3 0.6B"' \
    'has "ok       PHP 8.3.6 with sodium and pdo_sqlite"' \
    'lacks "  install  "' 'has "would run: cmake -S .*-DCMAKE_PREFIX_PATH=$QT"' \
    'has "would run: cmake --build $BUILD --parallel"'

computer Linux
QT_ASK=$QT
phoenix build --dry-run
check "build --dry-run is check" '[ $status = 0 ]' 'has "Nothing to install"' 'lacks "  install  "'

# A llama-server older than EmbeddingGemma 2 needs (Search your phone): built again.
computer Linux
QT_ASK=$QT
mock llama-server 'echo "version: 0.5.0-dev (build 11239, commit 66e665c)"'
phoenix check
check "Linux, an old llama-server: built again at the pinned commit" \
    '[ $status = 0 ]' 'has "llama-server build 11239 is older than 11451"' 'has "install  llama-server"' \
    'has "would run: git fetch --depth 1 https://github.com/ggml-org/llama.cpp.git 23b0202a189c44a54625aadcb37a946dd1d6278d"'

# A computer with nothing of ours: every part would be installed.
computer Linux
printf 'git\nsed\n' > "$T/dpkg"
unmock node; unmock whisper-cli; unmock llama-server; unmock php
rm -rf "$BUILD/whisper" "$BUILD/wakeword" "$BUILD/kitten" "$BUILD/models"
phoenix check
check "Linux, nothing there: what it would install, with sizes" \
    'has "install  voice: Kitten TTS (model and dictionary, ONNX Runtime) (about 39 MB, 57 MB on disk, checked by their SHA-256)"' \
    'has "get-kitten.py --dest $BUILD/kitten"' \
    'has "install  built-in language model: Qwen3 0.6B (639 MB, checked by its SHA-256)"' \
    'has "get-base-model.py --dest $BUILD/models"' '[ ! -e "$BUILD/kitten" ]' \
    '[ $status = 0 ]' 'has "install  apt: build-essential cmake ninja-build"' 'has "espeak-ng"' \
    'has "install  apt:.* php-cli php-sqlite3 "' 'has "skipped  PHP: not there yet"' 'lacks "php-mysql"' \
    'has "apt-get install -y --no-install-recommends"' \
    'has "install  Qt 6.11.3 into $T/qtprefix (aqtinstall) (about"' 'has "aqt install-qt linux desktop 6.11.3"' \
    'has "install  Node.js 22 (NodeSource)"' 'has "install  whisper-cli"' 'has "install  llama-server"' \
    'has "install  whisper base.en model (148 MB"' 'has "get-whisper-model.py --dest $BUILD/whisper"' \
    'has "get-wakeword.py --dest $BUILD/wakeword"' 'has "Would install:"' \
    '[ ! -e "$BUILD/whisper" ]' '[ ! -e "$T/qtprefix" ]'

computer Linux
printf 'git\nsed\n' > "$T/dpkg"
unmock node; unmock whisper-cli; unmock llama-server
rm -rf "$BUILD/whisper" "$BUILD/wakeword" "$BUILD/kitten" "$BUILD/models"
phoenix check --no-assistant
check "--no-assistant leaves out the assistant's parts" \
    '[ $status = 0 ]' 'lacks "espeak-ng"' 'lacks "whisper"' 'lacks "llama"' 'lacks "wake word"' 'lacks "Kitten"' 'lacks "Qwen3"' \
    'has "install  Qt 6.11.3"'

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
fake_qt "$T/qtprefix/6.11.3/gcc_64" 6.11.3
phoenix check --no-assistant
check "Qt found where the script installs it" 'has "ok       Qt 6.11.3 ($T/qtprefix/6.11.3/gcc_64)"' 'lacks "  install  "'

# The build directory already configured: its Qt is kept, no configure,
# a later one than the simulator's too (6.12.0: a newer Qt, an older engine).
computer Linux
echo "CMAKE_PREFIX_PATH:UNINITIALIZED=$QT" > "$BUILD/CMakeCache.txt"
phoenix check --no-assistant
check "a configured build on a later Qt (6.12.0) keeps it" 'has "ok       configured with Qt 6.12.0 ($QT)"' 'lacks "would run: cmake -S"' \
    'lacks "install  Qt"'

# A build on an older Qt (6.8.1, the simulator's before 15 October 2026):
# the simulator's Qt installed, the build configured again with it, keeping
# its generator, build type and switches.
computer Linux
fake_qt "$T/qtprefix/6.8.1/gcc_64" 6.8.1
printf 'CMAKE_PREFIX_PATH:UNINITIALIZED=%s\nCMAKE_GENERATOR:INTERNAL=Ninja\nCMAKE_BUILD_TYPE:STRING=Release\nPHOENIX_BUILD_APPS:BOOL=OFF\n' "$T/qtprefix/6.8.1/gcc_64" > "$BUILD/CMakeCache.txt"
phoenix check --no-assistant
check "a build on an older Qt moves to the simulator's" '[ $status = 0 ]' \
    'has "note     Qt 6.8.1 ($T/qtprefix/6.8.1/gcc_64) is older than the simulator.s 6.11.3"' \
    'has "install  Qt 6.11.3 into $T/qtprefix (aqtinstall)"' 'has "would run: rm -f $BUILD/CMakeCache.txt"' \
    'has "would run: cmake -S .* -G Ninja -DCMAKE_BUILD_TYPE=Release -DPHOENIX_BUILD_APPS=OFF  *-DCMAKE_PREFIX_PATH=$T/qtprefix/6.11.3/gcc_64"'
phoenix check --no-assistant --offline
check "... offline: built with the older one, and says so" '[ $status = 0 ]' \
    'has "skipped  Qt 6.11.3 (--offline: built with Qt 6.8.1, $T/qtprefix/6.8.1/gcc_64)"' 'lacks "aqt install-qt"' \
    'has "ok       configured with Qt 6.8.1"'

# The device's Qt asked for (PHOENIX_QT_DIR): used, older or not.
computer Linux
fake_qt "$T/qt681" 6.8.1
QT_ASK=$T/qt681
phoenix check --no-assistant
check "the device's Qt 6.8.1 asked for: used" '[ $status = 0 ]' 'has "ok       Qt 6.8.1 ($T/qt681, PHOENIX_QT_DIR)"' \
    'lacks "install  Qt"' 'has "-DCMAKE_PREFIX_PATH=$T/qt681"'

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
# An app with its launch params (phoenix-sim --launch 'appId:{json}'): one
# argument, as given, quoted in what it prints.
phoenix --dry-run --no-assistant run phone --launch 'com.palm.app.clock:{"action": "edit"}'
check "run phone --launch 'appId:{json}': the params go to the simulator whole" '[ $status = 0 ]' \
    "has \"would run: .*phoenix-sim --phone --launch 'com.palm.app.clock:{\\\"action\\\": \\\"edit\\\"}'\$\""
phoenix --dry-run --no-assistant run --marketplace
check "run --marketplace: the catalog's option goes to the simulator" '[ $status = 0 ]' 'has "would run: .*phoenix-sim --adaptive --marketplace$"'
phoenix --dry-run --no-assistant run tablet --marketplace --scene cards
check "run tablet --marketplace ARGS" 'has "would run: .*phoenix-sim --tablet --marketplace --scene cards$"'
# The catalog starts with the simulator where PHP is (phoenix-sim does it); --no-marketplace: not this time.
mock php 'exit 0'
phoenix --dry-run --no-assistant run
check "run: with PHP, the catalog starts with the simulator" '[ $status = 0 ]' "has \"Starting the simulator (adaptive), with the Marketplace's catalog\""
phoenix --dry-run --no-assistant run --no-marketplace
check "run --no-marketplace: goes to the simulator, which starts no catalog" \
    'has "would run: .*phoenix-sim --adaptive --no-marketplace$"' "lacks \"with the Marketplace's catalog\""
unmock php
phoenix run --dry-run --no-assistant phone -- --help
check "run phone -- ARGS" 'has "phoenix-sim --phone --help$"'
# A device profile sets its own screen and layout: no mode is added.
phoenix --dry-run --no-assistant run --device fairphone-fp6 --scene cards
check "run --device ID: the device, no mode" '[ $status = 0 ]' 'has "would run: .*phoenix-sim --device fairphone-fp6 --scene cards$"' \
    'has "Starting the simulator (device)"'
phoenix --dry-run --no-assistant run tablet --device pinetab2
check "run MODE --device: usage error" '[ $status = 2 ]' 'has "leave out tablet"'
phoenix phone
check "a mode without run: usage error" '[ $status = 2 ]' 'has "only ./phoenix run"'
phoenix --bogus
check "an unknown option: usage error" '[ $status = 2 ]' 'has "unknown command or option: --bogus"'
phoenix --help
check "--help" '[ $status = 0 ]' 'has "./phoenix run \[MODE\]"' 'has "--no-assistant"' 'has "--offline"' \
    'has "./phoenix run --marketplace"' 'has "./phoenix run --no-marketplace"' 'has "Start Catalog with the"' \
    'has "./phoenix test --quick"' 'has "./phoenix test --web \[--shard I/N\]"' \
    'has "^Environment: PHOENIX_BUILD_DIR"' 'lacks "set -eu"'

# ---- test ----------------------------------------------------------------------------
# CI's runners, run as they are: nothing is checked, installed or built first.
computer Linux
printf 'git\nsed\n' > "$T/dpkg"
phoenix test --quick --dry-run
check "test --quick: tools/ci-checks.sh (CI's checks job)" '[ $status = 0 ]' \
    'has "would run: sh $CHECKOUT/tools/ci-checks.sh$"' 'lacks "==> "' 'lacks "install  "'
phoenix --dry-run test --quick --fail-fast typecheck
check "test --quick ARGS: the arguments go to it" '[ $status = 0 ]' \
    'has "would run: sh $CHECKOUT/tools/ci-checks.sh --fail-fast typecheck$"'
phoenix test --web --shard 2/4 --dry-run
check "test --web --shard I/N: tools/run-web-tests.cjs (CI's web jobs)" '[ $status = 0 ]' \
    'has "would run: node $CHECKOUT/tools/run-web-tests.cjs --shard 2/4$"' 'lacks "==> "'
mkdir -p "$CHECKOUT/tools"
printf 'echo "ci-checks $*"\n' > "$CHECKOUT/tools/ci-checks.sh"
phoenix test --quick --list
check "test --quick runs it, with nothing installed or built first" '[ $status = 0 ]' \
    'has "^ci-checks --list$"' 'lacks "==> "' 'lacks "apt-get"' 'lacks "cmake"'
mock node 'echo "node $*"'
phoenix test --web settings media
check "test --web NAME...: the tests named" '[ $status = 0 ]' 'has "^node $CHECKOUT/tools/run-web-tests.cjs settings media$"'
phoenix test
check "test without --quick or --web: usage error" '[ $status = 2 ]' 'has "test needs --quick (the quick checks) or --web"'
phoenix test --quick --web
check "test --quick --web: usage error" '[ $status = 2 ]' 'has "--quick or --web, not both"'

# ---- macOS ---------------------------------------------------------------------------
computer Darwin
rm -rf "$BREW/opt/qt" "$BREW/opt/node@22" "$BREW/opt/python@3.12" "$BREW/opt/php" "$BREW/opt/whisper-cpp" "$BREW/opt/llama.cpp" "$BREW/opt/onnxruntime"
unmock php
phoenix check
check "Mac: the missing Homebrew packages in one brew install, with sizes" \
    '[ $status = 0 ]' 'has "ok       Xcode command line tools"' 'has "ok       Homebrew"' 'has "ok       cmake"' \
    'has "install  qt (about 1.3 GB"' 'has "install  node@22"' 'has "install  whisper-cpp"' 'has "install  llama.cpp"' \
    'has "install  php (about 120 MB"' 'has "skipped  PHP: not there yet"' \
    'has "install  onnxruntime (about 40 MB"' \
    'has "would run: $BREW/bin/brew install qt node@22 python@3.12 php whisper-cpp llama.cpp onnxruntime$"' \
    'has "-DCMAKE_PREFIX_PATH=$BREW/opt/qt"'

computer Darwin
phoenix check
check "Mac, everything there: nothing to install" \
    '[ $status = 0 ]' 'lacks "  install  "' 'has "Nothing to install"' 'lacks "brew install"' \
    'has "-DCMAKE_PREFIX_PATH=$BREW/opt/qt"'

# Homebrew's Qt older than the simulator's: upgraded (offline: used as it is).
computer Darwin
fake_qt "$BREW/opt/qt" 6.10.0
phoenix check --no-assistant
check "Mac: Homebrew's Qt older than 6.11.3: brew upgrade qt" '[ $status = 0 ]' \
    'has "install  qt 6.11.3 or newer (Homebrew.s is 6.10.0)"' 'has "brew upgrade qt"' 'has "-DCMAKE_PREFIX_PATH=$BREW/opt/qt"'
phoenix check --no-assistant --offline
check "... offline: built with it" '[ $status = 0 ]' 'has "skipped  qt 6.11.3 (Homebrew.s is 6.10.0; --offline: built with it)"' 'lacks "brew upgrade"'

# The voice on a Mac: Homebrew's ONNX Runtime, so no library of its own.
computer Darwin
rm -f "$BUILD/kitten/libonnxruntime.so.1"
phoenix check
check "Mac: Kitten TTS without a library of its own (Homebrew's onnxruntime)" '[ $status = 0 ]' 'has "ok       voice: Kitten TTS"'
rm -rf "$BUILD/kitten"
phoenix check
check "Mac: the voice fetched without ONNX Runtime" \
    'has "install  voice: Kitten TTS (model and dictionary) (about 28 MB, checked by their SHA-256)"' 'has "get-kitten.py --dest $BUILD/kitten"'

# --offline: the voice and the built-in model are skipped, with what then.
computer Linux
QT_ASK=$QT
rm -rf "$BUILD/kitten" "$BUILD/models"
phoenix check --offline
check "--offline without the voice or the built-in model: says what that means" '[ $status = 0 ]' \
    'has "skipped  voice (--offline): answers are spoken with espeak-ng, say or Flite"' \
    'has "skipped  built-in language model (--offline)"' 'lacks "get-kitten.py"' 'lacks "get-base-model.py"'

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
