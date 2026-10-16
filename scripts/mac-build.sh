#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Build a webOS Phoenix OS image on a Mac with Apple's `container` tool
# (https://github.com/apple/container, macOS 26, Apple silicon).
#
#   scripts/mac-build.sh [--stack S] [MACHINE] [TARGET]
#                                   build (default qemux86-64 webos-phoenix-image)
#   scripts/mac-build.sh [--stack S] --check [MACHINE]
#                                   set up and resolve the whole image without
#                                   compiling (~15-30 minutes; default qemux86-64)
#   scripts/mac-build.sh --shell    open a shell in the build container
#
# --stack S: the layers the image builds on (PHOENIX_STACK sets the same):
#   ose     webOS OSE's build-webos: Yocto 5.0 scarthgap, Qt 6.8.1,
#           Chromium 120 (scripts/setup-build.sh). The default until a
#           machine has built and booted on LuneOS's.
#   luneos  LuneOS's layer stack: Yocto 6.0 wrynose, Qt 6.12, Chromium 151
#           (scripts/setup-build-luneos.sh), where device images are moving
#           (docs/DECISIONS.md, 15 October 2026; docs/HARDWARE.md, "The web
#           runtime: Chromium 151 on LuneOS's layers").
# Each stack has its own build directory on the volume, so both can be kept.
#
# The build tools run as x86-64 Linux under Rosetta, because webOS OSE only
# supports amd64 build hosts. The image itself can target ARM64 devices,
# e.g. MACHINE=raspberrypi4-64. See docs/BUILDING-MAC.md.
#
# Machines: qemux86-64 (OSE's emulator), raspberrypi4-64, meta-phoenix's
# fairphone-fp6, ayn-odin2portal, pinephonepro, pinetab2, and
# phoenix-vm-arm64, the ARM64 VM that runs as any of those devices on this
# Mac: scripts/mac-build.sh phoenix-vm-arm64 copies its kernel and root
# image to out/phoenix-vm-arm64/, then scripts/vm.sh fairphone-fp6 starts
# it, or scripts/make-utm.sh makes a UTM bundle of it for an iPad
# (docs/BUILDING-MAC.md, "Run it in a VM", "Run it on an iPad with UTM").
#
# Tunables (environment): PHOENIX_STACK, PHOENIX_CPUS, PHOENIX_MEMORY
# (e.g. 24g), PHOENIX_VOLUME_SIZE (default 300g).

set -eu

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
VOLUME=webos-phoenix-work

usage() { sed -n '8,23p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "mac-build: $*" >&2; exit 2; }

STACK=${PHOENIX_STACK:-ose}
MODE=build
while [ $# -gt 0 ]; do
    case $1 in
        --stack) [ $# -gt 1 ] || die "--stack needs ose or luneos"; STACK=$2; shift 2 ;;
        --stack=*) STACK=${1#--stack=}; shift ;;
        --check) MODE=check; shift ;;
        --shell) MODE=shell; shift ;;
        -h|--help) usage; exit 0 ;;
        -*) die "unknown option $1 (scripts/mac-build.sh --help)" ;;
        *) break ;;
    esac
done
case $STACK in
    ose|luneos) ;;
    *) die "the stack is ose or luneos, not \"$STACK\"" ;;
esac
case $MODE in
    build) [ $# -le 2 ] || die "too many arguments: [MACHINE] [TARGET] (scripts/mac-build.sh --help)" ;;
    check) [ $# -le 1 ] || die "--check takes one MACHINE at most" ;;
    shell) [ $# -eq 0 ] || die "--shell takes no arguments" ;;
esac

command -v container >/dev/null 2>&1 || {
    echo "error: Apple's 'container' tool is not installed." >&2
    echo "Install it from https://github.com/apple/container/releases (needs macOS 26 on Apple silicon)." >&2
    exit 1
}

# The build image, tagged with its Containerfile's checksum: when the
# package list changes, the next run builds the new image instead of
# finding the old one by its name.
CONTAINERFILE=$REPO_DIR/tools/build-container/Containerfile
IMAGE=webos-phoenix-build:$(cksum < "$CONTAINERFILE" | cut -d ' ' -f 1)

# Give the build most of the machine, leaving some for macOS.
host_cpus=$(sysctl -n hw.ncpu)
host_mem_gb=$(( $(sysctl -n hw.memsize) / 1073741824 ))
CPUS=${PHOENIX_CPUS:-$(( host_cpus > 2 ? host_cpus - 2 : host_cpus ))}
MEMORY=${PHOENIX_MEMORY:-$(( host_mem_gb * 3 / 4 ))g}
VOLUME_SIZE=${PHOENIX_VOLUME_SIZE:-300g}
if [ "$host_mem_gb" -lt 16 ]; then
    echo "warning: ${host_mem_gb} GB RAM. The web runtime (Chromium) needs 16 GB or more to build reliably." >&2
fi

container system start

# Build the image for amd64 (runs under Rosetta).
if ! container image inspect "$IMAGE" >/dev/null 2>&1; then
    container build --arch amd64 --tag "$IMAGE" \
        --file "$CONTAINERFILE" "$REPO_DIR/tools/build-container"
fi

# ext4 volume for the build tree: Yocto needs a case-sensitive filesystem,
# which the Mac's default APFS volume is not. The image is sparse.
if ! container volume inspect "$VOLUME" >/dev/null 2>&1; then
    container volume create --opt size="$VOLUME_SIZE" "$VOLUME"
    # The build runs as the unprivileged 'builder' user (BitBake refuses root).
    container run --rm --arch amd64 --user root --volume "$VOLUME:/work" "$IMAGE" \
        chown builder:builder /work
fi

# The checkout is mounted read-write at /src/webos-phoenix so the build uses
# your local edits; everything the build writes goes to /work, but for the
# ARM64 VM's kernel and root image, which container-build.sh copies to out/.
EXTRA_ENV="--env PHOENIX_STACK=$STACK"
case $MODE in
    shell) CMD="/bin/bash" ;;
    check)
        CMD="/src/webos-phoenix/scripts/container-build.sh ${1:-qemux86-64} webos-phoenix-image"
        EXTRA_ENV="$EXTRA_ENV --env BITBAKE_ARGS=-g"
        ;;
    build) CMD="/src/webos-phoenix/scripts/container-build.sh ${1:-qemux86-64} ${2:-webos-phoenix-image}" ;;
esac

echo "Starting build container: ${STACK} layers, ${CPUS} CPUs, ${MEMORY} memory, volume ${VOLUME} (${VOLUME_SIZE})"
# shellcheck disable=SC2086
exec container run -it --rm --arch amd64 \
    --cpus "$CPUS" --memory "$MEMORY" $EXTRA_ENV \
    --volume "$VOLUME:/work" \
    --volume "$REPO_DIR:/src/webos-phoenix" \
    --name webos-phoenix-build \
    "$IMAGE" $CMD
