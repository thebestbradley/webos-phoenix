#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Set up a device image build on LuneOS's layer stack, with meta-phoenix
# added: Yocto 6.0 wrynose, meta-qt6 6.12 and meta-webos-ports, whose web
# runtime is Chromium 151 (docs/HARDWARE.md, "The web runtime: Chromium 151
# on LuneOS's layers"; docs/DECISIONS.md, 15 October 2026).
#
#   scripts/setup-build-luneos.sh [BUILD_DIR] [MACHINE [MACHINE...]]
#
# Defaults: ../build-phoenix-luneos, qemux86-64. Then:
#   cd BUILD_DIR && . ./setup-env && bitbake webos-phoenix-image
#
# This is the path device images move to; scripts/setup-build.sh (webOS
# OSE's build-webos, scarthgap, Chromium 120) stays until every machine
# builds here. Same host as OSE's: x86-64 Linux, ~200 GB of disk, many hours
# for the first build (Chromium alone is most of it).
#
# The layers and their commits are in scripts/luneos-layers.txt. Each is
# cloned without file history (commits only; the files of the pinned commit
# are fetched, and only the sub-directories that are layers), like
# scripts/parse-check.sh does for OSE's. A layer already at its pinned
# commit is left as it is. PHOENIX_LUNEOS_COMMAND=configure only writes the
# configuration, leaving the layer checkouts as they are.
#
# The distro is LuneOS's ("luneos"); the image is meta-phoenix's
# webos-phoenix-image, which takes LuneOS's base image without its shell
# and apps (recipes-core/images/webos-phoenix-image.bb). More than one
# MACHINE: the first is the default, MACHINE=... bitbake picks another.

set -eu

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
BUILD_DIR=${1:-"$REPO_DIR/../build-phoenix-luneos"}
[ $# -gt 0 ] && shift
[ $# -gt 0 ] || set -- qemux86-64
LAYERS=${PHOENIX_LUNEOS_LAYERS:-"$REPO_DIR/scripts/luneos-layers.txt"}
COMMAND=${PHOENIX_LUNEOS_COMMAND:-update+configure}

case $COMMAND in
    update+configure|configure) ;;
    *) echo "setup-build-luneos: PHOENIX_LUNEOS_COMMAND is update+configure or configure, not \"$COMMAND\"" >&2; exit 2 ;;
esac

# Each machine must have a configuration in one of the layers (checked
# after the checkouts, below).
mkdir -p "$BUILD_DIR/conf"
BUILD_DIR=$(cd "$BUILD_DIR" && pwd)

layer_lines() {
    # name branch commit url layers..., without comments and blank lines.
    sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "$LAYERS"
}

# 1. The layers, at their pinned commits.
if [ "$COMMAND" = update+configure ]; then
    layer_lines | while read -r name branch commit url rest; do
        dir="$BUILD_DIR/$name"
        if [ -d "$dir/.git" ] && [ "$(git -C "$dir" rev-parse -q --verify HEAD 2>/dev/null)" = "$commit" ]; then
            echo "$name: $commit (already there)"
            continue
        fi
        if [ ! -d "$dir/.git" ]; then
            echo "$name: cloning $url $branch"
            git clone -q --filter=tree:0 --no-checkout --single-branch --branch "$branch" "$url" "$dir"
        else
            git -C "$dir" fetch -q --filter=tree:0 origin "$branch"
        fi
        # Only the layers' directories (and +extras) when they are
        # sub-directories: meta-openembedded and meta-smartphone hold many
        # layers Phoenix does not use. Git's cone patterns, written before
        # the first checkout (`git sparse-checkout set` would check out the
        # branch's head first).
        dirs=""
        for l in $rest; do
            case $l in
                -|.) ;;
                +*) dirs="$dirs ${l#+}" ;;
                *) dirs="$dirs $l" ;;
            esac
        done
        if [ -n "$dirs" ]; then
            git -C "$dir" config core.sparseCheckout true
            git -C "$dir" config core.sparseCheckoutCone true
            mkdir -p "$dir/.git/info"
            { echo '/*'; echo '!/*/'; for x in $dirs; do echo "/$x/"; done; } > "$dir/.git/info/sparse-checkout"
        else
            git -C "$dir" config core.sparseCheckout false
        fi
        git -C "$dir" -c advice.detachedHead=false checkout -q "$commit"
        echo "$name: $commit"
    done
fi

# 2. conf/bblayers.conf: meta-phoenix first (its machines and classes win
# the BBPATH lookups), then the pinned layers in the file's order. The
# layer itself, not this repository: a worktree under .claude/worktrees
# would otherwise be a second copy (scripts/setup-build.sh says why).
ln -sfn "$REPO_DIR/meta-phoenix" "$BUILD_DIR/meta-phoenix"
# BitBake's ${...} are written as they are.
# shellcheck disable=SC2016,SC1003
{
    echo "# Written by scripts/setup-build-luneos.sh from scripts/luneos-layers.txt."
    echo 'LCONF_VERSION = "7"'
    echo 'BBPATH = "${TOPDIR}"'
    echo 'BBFILES ?= ""'
    echo 'BBLAYERS = " \'
    echo '  ${TOPDIR}/meta-phoenix \'
    layer_lines | while read -r name branch commit url rest; do
        for l in $rest; do
            case $l in
                -|+*) ;;
                .) echo "  \${TOPDIR}/$name \\" ;;
                *) echo "  \${TOPDIR}/$name/$l \\" ;;
            esac
        done
    done
    echo '"'
} > "$BUILD_DIR/conf/bblayers.conf"

# 3. conf/local.conf: LuneOS's distro and the first machine. Settings of
# your own go in phoenix-local.conf beside it (scripts/parse-check.sh
# writes one); this file is rewritten each time.
# shellcheck disable=SC2016
{
    echo "# Written by scripts/setup-build-luneos.sh; put your settings in phoenix-local.conf."
    echo 'CONF_VERSION = "2"'
    echo 'DISTRO ?= "luneos"'
    echo "MACHINE ??= \"$1\""
    echo 'include phoenix-local.conf'
} > "$BUILD_DIR/conf/local.conf"

# 4. setup-env: bitbake from the pinned checkout, run from the build
# directory (bitbake reads conf/ there), MACHINE and DISTRO passed through.
cat > "$BUILD_DIR/setup-env" <<ENV
# Written by scripts/setup-build-luneos.sh. Source it: . ./setup-env
cd "$BUILD_DIR" || return 1
PATH="$BUILD_DIR/bitbake/bin:$BUILD_DIR/openembedded-core/scripts:\$PATH"
BB_ENV_PASSTHROUGH_ADDITIONS="MACHINE DISTRO http_proxy https_proxy ftp_proxy no_proxy all_proxy ALL_PROXY SSH_AGENT_PID SSH_AUTH_SOCK BB_SRCREV_POLICY BB_NUMBER_THREADS GIT_PROXY_COMMAND"
LC_ALL=en_US.UTF-8
export PATH BB_ENV_PASSTHROUGH_ADDITIONS LC_ALL
unset BBPATH
ENV

# 5. Every machine has a configuration somewhere in the stack.
missing=""
for m in "$@"; do
    found=""
    for conf in "$BUILD_DIR"/meta-phoenix/conf/machine/"$m".conf "$BUILD_DIR"/*/conf/machine/"$m".conf \
                "$BUILD_DIR"/*/*/conf/machine/"$m".conf; do
        [ -f "$conf" ] && found=1 && break
    done
    [ -n "$found" ] || missing="$missing $m"
done
if [ -n "$missing" ]; then
    if [ "$COMMAND" = configure ] && [ ! -d "$BUILD_DIR/openembedded-core" ]; then
        echo "setup-build-luneos: no layers checked out yet; run without PHOENIX_LUNEOS_COMMAND=configure" >&2
    else
        echo "setup-build-luneos: no machine configuration for:$missing" >&2
    fi
    exit 1
fi

echo
echo "Ready (LuneOS's layers, MACHINE $1). Next:"
echo "  cd $BUILD_DIR && . ./setup-env && bitbake webos-phoenix-image"
