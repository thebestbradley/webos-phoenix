#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Tests ./phoenix, the one command (install what is missing, build, run),
# in its dry run: what it finds, what it would install and run, on a
# pretend Linux and a pretend Mac. Nothing is installed: the computer is
# made of stand-ins (a PATH of mock programs, a fake Qt, a fake checkout).
#
#   sh tools/test-phoenix-script.sh

# The checks are strings evaluated later, on purpose.
# shellcheck disable=SC2016

set -u
REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
failures=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }

# ---- The pretend computer ------------------------------------------------------------
# Only these real programs are on the PATH; the rest are mocks or missing.
BIN=$T/bin
mkdir -p "$BIN"
for p in sh sed awk grep head cat date dirname basename id getconf tr mktemp env sort wc mkdir rm ls git find cp chmod; do
    real=$(command -v "$p") && ln -s "$real" "$BIN/$p"
done
mock() {  # mock NAME BODY: a program printing or doing BODY
    printf '#!/bin/sh\n%s\n' "$2" > "$BIN/$1"
    chmod +x "$BIN/$1"
}
unmock() { rm -f "$BIN/$1"; }
# dpkg-query: the packages in $T/dpkg are installed ("all": every one).
mock dpkg-query '
fmt=""; for a in "$@"; do case "$a" in -f=*) fmt=${a#-f=} ;; -*) ;; *)
  if grep -qx -e "$a" -e all "'"$T"'/dpkg" 2>/dev/null; then
    case "$fmt" in *Package*) echo "$a ii " ;; *) printf "ii " ;; esac
  else echo "dpkg-query: no packages found matching $a" >&2; fi ;; esac; done'
echo all > "$T/dpkg"

# A checkout: the script in an otherwise empty repository with the apps' lock.
CHECKOUT=$T/checkout
mkdir -p "$CHECKOUT/apps/node_modules"
cp "$REPO_DIR/phoenix" "$CHECKOUT/phoenix"
echo '{}' > "$CHECKOUT/apps/package-lock.json"
git -C "$CHECKOUT" init -q
sleep 1
echo '{}' > "$CHECKOUT/apps/node_modules/.package-lock.json"

# A Qt 6.8.1 with Qt WebEngine (what the script reads of one).
fake_qt() {
    mkdir -p "$1/lib/cmake/Qt6" "$1/lib/cmake/Qt6WebEngineQuick"
    echo "set(PACKAGE_VERSION \"$2\")" > "$1/lib/cmake/Qt6/Qt6ConfigVersionImpl.cmake"
}
fake_qt "$T/qt" 6.8.1
# The build directory with the assistant's models in it.
BUILD=$T/build
mkdir -p "$BUILD/whisper" "$BUILD/wakeword/vosk-model-small-en-us-0.15"
echo model > "$BUILD/whisper/ggml-base.en.bin"
echo lib > "$BUILD/wakeword/libvosk.so"
echo lib > "$BUILD/wakeword/libvosk.dylib"

# phoenix ARGS...: runs the script on the pretend computer; output in $T/out.
phoenix() {
    env -i PATH="$BIN${EXTRA_PATH:+:$EXTRA_PATH}" HOME="$T/home" QT_PREFIX="$T/qtprefix" PHOENIX_BUILD_DIR="$BUILD" \
        DISPLAY=:9 ${PHOENIX_OS:+PHOENIX_OS=$PHOENIX_OS} ${PHOENIX_QT_DIR:+PHOENIX_QT_DIR=$PHOENIX_QT_DIR} \
        sh "$CHECKOUT/phoenix" "$@" > "$T/out" 2>&1
    status=$?
    cp "$T/out" "$T/last"
    return $status
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
PHOENIX_OS=Linux
mock node 'echo v22.11.0'
mock whisper-cli 'true'
mock llama-server 'true'

PHOENIX_QT_DIR=$T/qt phoenix check
check "Linux, everything there: nothing to install" \
    '[ $status = 0 ]' 'has "dry run"' 'has "ok       Qt 6.8.1"' 'has "ok       Node.js v22.11.0"' \
    'has "ok       whisper-cli"' 'has "ok       whisper base.en model"' 'has "Nothing to install"' \
    'lacks "  install  "' 'has "would run: cmake -S .*-DCMAKE_PREFIX_PATH=$T/qt"' \
    'has "would run: cmake --build $BUILD --parallel"'

PHOENIX_QT_DIR=$T/qt phoenix build --dry-run
check "build --dry-run is check" '[ $status = 0 ]' 'has "Nothing to install"' 'lacks "  install  "'

# A computer with nothing of ours: every part would be installed.
printf 'git\nsed\n' > "$T/dpkg"
unmock node; unmock whisper-cli; unmock llama-server
rm -rf "$BUILD/whisper" "$BUILD/wakeword"
phoenix check
check "Linux, nothing there: what it would install, with sizes" \
    '[ $status = 0 ]' 'has "install  apt: build-essential cmake ninja-build"' 'has "espeak-ng"' \
    'has "apt-get install -y --no-install-recommends"' \
    'has "install  Qt 6.8.1 into $T/qtprefix (aqtinstall) (about"' 'has "aqt install-qt linux desktop 6.8.1"' \
    'has "install  Node.js 22 (NodeSource)"' 'has "install  whisper-cli"' 'has "install  llama-server"' \
    'has "install  whisper base.en model (148 MB"' 'has "get-whisper-model.py --dest $BUILD/whisper"' \
    'has "get-wakeword.py --dest $BUILD/wakeword"' 'has "Would install:"' \
    '[ ! -e "$BUILD/whisper" ]' '[ ! -e "$T/qtprefix" ]'

phoenix check --no-assistant
check "--no-assistant leaves out the assistant's parts" \
    '[ $status = 0 ]' 'lacks "espeak-ng"' 'lacks "whisper"' 'lacks "llama"' 'lacks "wake word"' 'has "install  Qt 6.8.1"'

phoenix build --offline
check "--offline with Qt missing: an actionable error" \
    '[ $status = 1 ]' 'has "--offline downloads nothing"'

echo all > "$T/dpkg"
mock node 'echo v23.1.0'
PHOENIX_QT_DIR=$T/qt phoenix check --no-assistant
check "an odd-numbered Node.js is replaced by 22" 'has "install  Node.js 22"'
mock node 'echo v22.11.0'

fake_qt "$T/qt-old" 6.4.2
PHOENIX_QT_DIR=$T/qt-old phoenix check --no-assistant
check "a Qt older than 6.8 asked for: an error" '[ $status = 1 ]' 'has "is not a Qt 6.8 or later"'

fake_qt "$T/qtprefix/6.8.1/gcc_64" 6.8.1
phoenix check --no-assistant
check "Qt found where the script installs it" 'has "ok       Qt 6.8.1 ($T/qtprefix/6.8.1/gcc_64)"' 'lacks "  install  "'

# The build directory already configured: its Qt is kept, no configure.
echo "CMAKE_PREFIX_PATH:UNINITIALIZED=$T/qt" > "$BUILD/CMakeCache.txt"
phoenix check --no-assistant
check "a configured build keeps its Qt" 'has "ok       configured with Qt 6.8.1 ($T/qt)"' 'lacks "would run: cmake -S"'
rm "$BUILD/CMakeCache.txt"

# Submodules not checked out yet.
git -C "$CHECKOUT" update-index --add --cacheinfo 160000,0123456789012345678901234567890123456789,third_party/x
printf '[submodule "x"]\n\tpath = third_party/x\n\turl = https://example.invalid/x.git\n' > "$CHECKOUT/.gitmodules"
phoenix check --no-assistant
check "missing git submodules are fetched" 'has "install  1 git submodules"' 'has "submodule update --init"'
git -C "$CHECKOUT" rm -q --cached third_party/x
rm "$CHECKOUT/.gitmodules"

touch "$CHECKOUT/apps/package-lock.json"
phoenix check --no-assistant
check "npm packages older than the lock: npm ci" 'has "install  npm packages for apps/"' 'has "npm ci"'
touch "$CHECKOUT/apps/node_modules/.package-lock.json"

# ---- run -----------------------------------------------------------------------------
phoenix --dry-run --no-assistant run
check "run: adaptive by default" '[ $status = 0 ]' 'has "would run: .*phoenix-sim --adaptive$"'
phoenix --dry-run --no-assistant run tablet --scene cards --launch org.webosphoenix.settings
check "run tablet ARGS: the arguments go to the simulator" \
    'has "would run: .*phoenix-sim --tablet --scene cards --launch org.webosphoenix.settings$"'
phoenix run --dry-run --no-assistant phone -- --help
check "run phone -- ARGS" 'has "phoenix-sim --phone --help$"'
phoenix phone
check "a mode without run: usage error" '[ $status = 2 ]' 'has "only ./phoenix run"'
phoenix --bogus
check "an unknown option: usage error" '[ $status = 2 ]' 'has "unknown command or option: --bogus"'
phoenix --help
check "--help" '[ $status = 0 ]' 'has "./phoenix run \[MODE\]"' 'has "--no-assistant"' 'has "--offline"'

# ---- macOS ---------------------------------------------------------------------------
PHOENIX_OS=Darwin
mkdir -p "$T/brew/bin" "$T/brew/opt"
mock xcode-select 'exit 0'
printf '#!/bin/sh\necho "brew $*"\n' > "$T/brew/bin/brew"
chmod +x "$T/brew/bin/brew"
# Homebrew's prefix is where its brew is (not where a link to it points).
EXTRA_PATH=$T/brew/bin
mkdir -p "$BUILD/whisper" "$BUILD/wakeword/vosk-model-small-en-us-0.15"
echo model > "$BUILD/whisper/ggml-base.en.bin"
echo lib > "$BUILD/wakeword/libvosk.dylib"
for f in cmake ninja git; do mkdir -p "$T/brew/opt/$f"; done
phoenix check
check "Mac: the missing Homebrew packages in one brew install, with sizes" \
    '[ $status = 0 ]' 'has "ok       Xcode command line tools"' 'has "ok       Homebrew"' 'has "ok       cmake"' \
    'has "install  qt (about 1.3 GB"' 'has "install  node@22"' 'has "install  whisper-cpp"' 'has "install  llama.cpp"' \
    'has "would run: $T/brew/bin/brew install qt node@22 python@3.12 whisper-cpp llama.cpp$"' \
    'has "-DCMAKE_PREFIX_PATH=$T/brew/opt/qt"'

for f in qt node@22 python@3.12 whisper-cpp llama.cpp; do mkdir -p "$T/brew/opt/$f"; done
fake_qt "$T/brew/opt/qt" 6.10.0
phoenix check
check "Mac, everything there: nothing to install" \
    '[ $status = 0 ]' 'lacks "  install  "' 'has "Nothing to install"' 'lacks "brew install"'

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
