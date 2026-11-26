#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Make a UTM virtual machine (a .utm bundle) of the ARM64 VM image
# (MACHINE phoenix-vm-arm64) as one of the first target devices, for UTM on
# an iPad (UTM SE from the App Store, or the sideloaded UTM with JIT) or on
# a Mac: the same machine as scripts/vm.sh, in UTM's own format.
# docs/BUILDING-MAC.md, "Run it on an iPad with UTM".
#
#   scripts/make-utm.sh [DEVICE] [options]
#
# DEVICE: a device profile (scripts/vm.sh --list). Default: pinetab2, the
# 10.1" landscape tablet, the nearest to an iPad's screen.
#
# Options:
#   --for ipad|ipad-se|mac  what runs it (default ipad):
#                    ipad     UTM on an iPad (TCG: there is no hypervisor
#                             on iOS), with or without JIT: at most 4 CPUs
#                             and 3072 MiB, a 384 MiB translation cache,
#                             systemd's start timeouts and SAM's app
#                             transition timeout at 10 minutes
#                    ipad-se  the same, for UTM SE (its interpreter is many
#                             times slower than JIT): timeouts at 30 minutes
#                    mac      UTM on an Apple silicon Mac (HVF): the
#                             device's CPUs and memory, as scripts/vm.sh
#   --image PATH     a folder with Image and
#                    webos-phoenix-image-phoenix-vm-arm64.rootfs.ext4
#                    (default out/phoenix-vm-arm64), or the .ext4 itself
#   --kernel FILE    the kernel, if not beside the image
#   --initrd FILE    an initramfs (the image's kernel needs none)
#   --out DIR        where the bundle goes (default out/): DIR/Phoenix-
#                    DEVICE.utm, -se.utm for ipad-se, -mac.utm for mac
#   --cpus N         virtual CPUs (default above)
#   --memory MIB     memory in MiB (default above)
#   --gl on|off      3D through virgl, virtio-gpu-gl-pci (default on: under
#                    emulation the guest's own renderer, llvmpipe, would be
#                    far slower)
#   --audio hda|virtio|none  Intel HDA (default: what UTM itself gives an
#                    ARM64 Linux), virtio-sound-pci, or none
#   --disk raw|qcow2 the root disk in the bundle. Default: raw, as a clone
#                    of the image (APFS; a Btrfs or XFS reflink) when the
#                    bundle goes on the image's volume and it can clone:
#                    instant, and it takes no space. Else qcow2 when qemu-img
#                    is there (it holds only what the image uses), else a
#                    raw copy. qcow2 is the smaller one to copy to an iPad
#   --ssh-port N     the port forwarded to the VM's ssh, on the host's
#                    127.0.0.1 (default 2222)
#   --force          replace a bundle that is already there
#   --dry-run        print the plan and config.plist; copy nothing
#
# PHOENIX_UTM_QEMU_IMG names qemu-img; PHOENIX_UTM_CLONE=no never clones.
#
# UTM reads config.plist (ConfigurationVersion 4: UTM 4.0 or later) and
# Data/, which holds the kernel and the root disk; it deletes any other file
# in Data/ when it saves the settings. tools/check-utm-bundle.py checks a
# bundle against UTM's decoders and prints the QEMU command UTM builds.

set -eu

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
PROFILES="$REPO_DIR/meta-phoenix/recipes-phoenix/phoenix-device-config/files/device-profiles.py"
QEMU_IMG=${PHOENIX_UTM_QEMU_IMG:-qemu-img}

die() { echo "make-utm.sh: $*" >&2; exit 2; }
usage() { sed -n '11,52p' "$0" | sed 's/^# \{0,1\}//'; }

command -v python3 >/dev/null 2>&1 || die "python3 is needed (to read the device profiles and write config.plist)"

DEVICE='' FOR=ipad IMAGE=$REPO_DIR/out/phoenix-vm-arm64 KERNEL='' INITRD='' OUT=$REPO_DIR/out
CPUS='' MEMORY='' GL=on AUDIO=hda DISK='' SSH_PORT=2222 FORCE='' DRY=''
need() { [ $# -ge 2 ] && [ -n "$2" ] || die "$1 needs a value"; }
num() { case $2 in ''|*[!0-9]*) die "$1 takes a whole number, not \"$2\"" ;; esac; [ "$2" -gt 0 ] || die "$1 must be more than 0"; }
while [ $# -gt 0 ]; do
    case $1 in
        --for) need "$@"; case $2 in ipad|ipad-se|mac) FOR=$2 ;; *) die "--for ipad, ipad-se or mac" ;; esac; shift ;;
        --image) need "$@"; IMAGE=$2; shift ;;
        --kernel) need "$@"; KERNEL=$2; shift ;;
        --initrd) need "$@"; INITRD=$2; shift ;;
        --out) need "$@"; OUT=$2; shift ;;
        --cpus) need "$@"; num "$1" "$2"; CPUS=$2; shift ;;
        --memory) need "$@"; num "$1" "$2"; MEMORY=$2; shift ;;
        --gl) need "$@"; case $2 in on|off) GL=$2 ;; *) die "--gl on or off" ;; esac; shift ;;
        --audio) need "$@"; case $2 in hda|virtio|none) AUDIO=$2 ;; *) die "--audio hda, virtio or none" ;; esac; shift ;;
        --disk) need "$@"; case $2 in qcow2|raw) DISK=$2 ;; *) die "--disk qcow2 or raw" ;; esac; shift ;;
        --ssh-port) need "$@"; num "$1" "$2"; [ "$2" -le 65535 ] || die "--ssh-port is a port, 1 to 65535"; SSH_PORT=$2; shift ;;
        --force) FORCE=1 ;;
        --dry-run) DRY=1 ;;
        -h|--help) usage; exit 0 ;;
        -*) die "unknown option $1 (scripts/make-utm.sh --help)" ;;
        *) [ -z "$DEVICE" ] || die "one device at a time (\"$DEVICE\", then \"$1\")"; DEVICE=$1 ;;
    esac
    shift
done
DEVICE=${DEVICE:-pinetab2}
python3 "$PROFILES" get "$DEVICE" name >/dev/null 2>&1 \
    || die "no device \"$DEVICE\"; there are: $(python3 "$PROFILES" list | tr '\n' ' ')"
profile() { python3 "$PROFILES" get "$DEVICE" "$1"; }

# The device, as scripts/vm.sh starts it: its panel is virtio-gpu's mode
# (the image's compositor.env for the device has the same geometry,
# device-profiles.py), its kernel command line names it.
NAME=$(profile name)
WIDTH=$(profile width)
HEIGHT=$(profile height)
DEV_CPUS=$(profile cpus)
DEV_MEMORY=$(profile memoryMiB)
APPEND="root=/dev/vda rw rootwait console=ttyAMA0 phoenix.device=$DEVICE"

# What runs it. An iPad has no hypervisor for apps (UTM's
# jb_has_hypervisor() needs a private entitlement, Services/UTMJailbreak.m),
# so QEMU translates every guest instruction (TCG): with JIT, or with UTM
# SE's threaded interpreter. QEMU runs inside UTM's own process there, and
# iOS stops a process that outgrows its memory limit: the guest's memory
# plus the translation cache (twice, mirrored, when JIT comes from a
# debugger) plus UTM itself must fit (UTM's own estimate,
# Platform/Shared/VMConfigSystemView.swift validateMemorySize). 3072 MiB
# and 384 MiB come to about 4 GB, inside what an 8 GB iPad gives one app.
# Booting is minutes, not seconds: systemd's 90-second limits would stop
# units that are only slow, and SAM's 10-second limit on an app's
# transition killed the shell's status bar and Just Type while WAM was
# still loading them (40 s under TCG on a Mac; 25 November 2026). SAM
# reads SAM_TRANSITION_TIMEOUT_MS (meta-phoenix's sam.bbappend), which
# systemd.setenv= gives every service.
case $FOR in
    mac)
        SUFFIX=-mac LABEL=" (Mac)"
        CPUS=${CPUS:-$DEV_CPUS}
        MEMORY=${MEMORY:-$DEV_MEMORY}
        JIT_CACHE=0 TIMEOUT='' ;;
    ipad|ipad-se)
        if [ "$FOR" = ipad ]; then SUFFIX='' LABEL='' TIMEOUT=600
        else SUFFIX=-se LABEL=" (UTM SE)" TIMEOUT=1800; fi
        [ -n "$CPUS" ] || { CPUS=$DEV_CPUS; [ "$CPUS" -le 4 ] || CPUS=4; }
        [ -n "$MEMORY" ] || { MEMORY=$DEV_MEMORY; [ "$MEMORY" -le 3072 ] || MEMORY=3072; }
        JIT_CACHE=384 ;;
esac
[ -z "$TIMEOUT" ] || APPEND="$APPEND systemd.default_timeout_start_sec=$TIMEOUT systemd.default_device_timeout_sec=$TIMEOUT systemd.setenv=SAM_TRANSITION_TIMEOUT_MS=${TIMEOUT}000"
if [ "$GL" = on ]; then GPU=virtio-gpu-gl-pci; else GPU=virtio-gpu-pci; fi
case $AUDIO in hda) SOUND=intel-hda ;; virtio) SOUND=virtio-sound-pci ;; none) SOUND='' ;; esac

# The image: a folder, unless it names a file (an .ext4 or one there).
image_is_dir=1
case $IMAGE in *.ext4) image_is_dir= ;; esac
[ -f "$IMAGE" ] && image_is_dir=
if [ -n "$image_is_dir" ]; then
    ROOTFS=$IMAGE/webos-phoenix-image-phoenix-vm-arm64.rootfs.ext4
    [ -e "$ROOTFS" ] || [ ! -e "$IMAGE/webos-phoenix-image-phoenix-vm-arm64.ext4" ] || ROOTFS=$IMAGE/webos-phoenix-image-phoenix-vm-arm64.ext4
    KERNEL=${KERNEL:-$IMAGE/Image}
else
    ROOTFS=$IMAGE
    KERNEL=${KERNEL:-$(dirname "$IMAGE")/Image}
fi
KERNEL_NAME=$(basename "$KERNEL")
INITRD_NAME=''
[ -z "$INITRD" ] || INITRD_NAME=$(basename "$INITRD")
BUNDLE=$OUT/Phoenix-$DEVICE$SUFFIX.utm

# The root disk. A clone of the image (an APFS clone, a Btrfs/XFS reflink)
# shares its blocks: instant, no space taken, and the VM's writes go to the
# bundle's copy only. It needs the bundle on the image's own volume and a
# file system that clones. Else qcow2 (qemu-img convert), which holds only
# the image's used blocks; else a raw copy. --disk raw still clones when it
# can; --disk qcow2 always converts.
has_qemu_img() { command -v "$QEMU_IMG" >/dev/null 2>&1; }
# A folder that is there: $1, or the nearest one above it.
existing() { d=$1; while [ ! -e "$d" ]; do d=$(dirname "$d"); done; printf '%s\n' "$d"; }
# The file system $1 is on: its volume and its type (apfs, btrfs, ...).
# On macOS by df's device: the system and data volumes share one st_dev.
fs_of() {
    case $(uname -s) in
        Darwin) dev=$(df -P "$1" | awk 'NR == 2 { print $1 }')
                printf '%s %s\n' "$dev" \
                    "$(mount | awk -v d="$dev" '$1 == d { t = $0; sub(/^[^(]*\(/, "", t); sub(/[,)].*$/, "", t); print t; exit }')" ;;
        *) printf '%s %s\n' "$(stat -c %d "$1")" "$(stat -f -c %T "$1")" ;;
    esac
}
# Whether the root disk can be a clone: the plan's guess (making it tries).
clone_expected() {
    [ "${PHOENIX_UTM_CLONE:-}" != no ] && [ -f "$ROOTFS" ] || return 1
    src=$(fs_of "$(dirname "$ROOTFS")") dst=$(fs_of "$(existing "$OUT")")
    [ "$src" = "$dst" ] || return 1
    case ${src#* } in apfs|btrfs|xfs) return 0 ;; esac
    return 1
}
# A clone of $1 at $2, or nothing: never a copy (macOS's cp -c copies when
# it cannot clone, clonefile(2) does not).
clone() {
    [ "${PHOENIX_UTM_CLONE:-}" != no ] || return 1
    case $(uname -s) in
        Darwin) python3 -c 'import ctypes, os, sys
libc = ctypes.CDLL(None, use_errno=True)
sys.exit(libc.clonefile(os.fsencode(sys.argv[1]), os.fsencode(sys.argv[2]), 0) != 0)' "$1" "$2" 2>/dev/null ;;
        *) cp --reflink=always "$1" "$2" 2>/dev/null || { rm -f "$2"; return 1; } ;;
    esac
}
# The root disk's name in the bundle, for $DISK.
root_name() {
    ROOT_NAME=$(basename "$ROOTFS" .ext4)
    case $DISK in qcow2) ROOT_NAME=$ROOT_NAME.qcow2 ;; raw) ROOT_NAME=$ROOT_NAME.ext4 ;; esac
    [ "$KERNEL_NAME" != "$ROOT_NAME" ] && [ "$INITRD_NAME" != "$KERNEL_NAME" ] && [ "$INITRD_NAME" != "$ROOT_NAME" ] \
        || die "the kernel, the initrd and the root disk need different file names in the bundle"
}
DISK_AUTO='' HOW=''
if [ -z "$DISK" ]; then
    DISK_AUTO=1
    if clone_expected; then DISK=raw
    elif has_qemu_img; then DISK=qcow2
    else DISK=raw; fi
fi
[ "$DISK" != raw ] || ! clone_expected || HOW=' (a clone of the image)'
root_name

# config.plist: UTM's QEMU configuration (Configuration/UTMQemuConfiguration*.swift).
write_config() {
    UTM_NAME="webOS Phoenix: $NAME$LABEL" UTM_DEVICE=$DEVICE UTM_FOR=$FOR UTM_CPUS=$CPUS UTM_MEMORY=$MEMORY \
    UTM_JIT_CACHE=$JIT_CACHE UTM_GPU=$GPU UTM_WIDTH=$WIDTH UTM_HEIGHT=$HEIGHT UTM_SOUND=$SOUND \
    UTM_APPEND=$APPEND UTM_KERNEL=$KERNEL_NAME UTM_INITRD=$INITRD_NAME UTM_ROOT=$ROOT_NAME \
    UTM_SSH_PORT=$SSH_PORT python3 - "$1" <<'EOF'
import os
import plistlib
import random
import sys
import uuid

e = os.environ


def ident():
    return str(uuid.uuid4()).upper()  # as Swift's UUID().uuidString


def drive(name, kind, interface="None"):
    return {"ImageName": name, "ImageType": kind, "Interface": interface, "InterfaceVersion": 1,
            "Identifier": ident(), "ReadOnly": False}


def mac_address():
    # Locally administered, as UTMQemuConfigurationNetwork.randomMacAddress()
    b = [random.randrange(256) for _ in range(6)]
    b[0] = (b[0] & 0xFC) | 0x02
    return ":".join("%02X" % x for x in b)


gpu, w, h = e["UTM_GPU"], e["UTM_WIDTH"], e["UTM_HEIGHT"]
drives = [drive(e["UTM_KERNEL"], "LinuxKernel")]
if e["UTM_INITRD"]:
    drives.append(drive(e["UTM_INITRD"], "LinuxInitrd"))
drives.append(drive(e["UTM_ROOT"], "Disk", "VirtIO"))
port = int(e["UTM_SSH_PORT"])
config = {
    "Backend": "QEMU",
    "ConfigurationVersion": 4,
    "Information": {
        "Name": e["UTM_NAME"],
        "Icon": "webos",
        "IconCustom": False,
        "UUID": ident(),
        "Notes": "Made by webOS Phoenix's scripts/make-utm.sh (--for %s): phoenix.device=%s, %sx%s. "
                 "The console: the Display menu's Serial 0. ssh -p %d root@127.0.0.1 on the host."
                 % (e["UTM_FOR"], e["UTM_DEVICE"], w, h, port),
    },
    "System": {
        "Architecture": "aarch64",
        "Target": "virt",
        # "default": -cpu host under HVF, cortex-a72 under TCG (UTM's choice:
        # ARMv8.0, so no pointer authentication or SVE for TCG to emulate)
        "CPU": "default",
        "CPUFlagsAdd": [],
        "CPUFlagsRemove": [],
        "CPUCount": int(e["UTM_CPUS"]),
        "ForceMulticore": False,
        "MemorySize": int(e["UTM_MEMORY"]),
        "JITCacheSize": int(e["UTM_JIT_CACHE"]),
    },
    "QEMU": {
        "DebugLog": False,
        "UEFIBoot": False,
        "RNGDevice": True,
        "BalloonDevice": False,
        "TPMDevice": False,
        # Used where the host has it (a Mac); UTM falls back to TCG on an iPad.
        "Hypervisor": True,
        "TSO": False,
        "RTCLocalTime": False,
        "PS2Controller": False,
        # scripts/vm.sh's machine: GICv3, and no EL2 (UTM turns it on under
        # TCG for Windows unless told, UTMQemuConfiguration+Arguments.swift
        # machineProperties).
        "MachinePropertyOverride": "virtualization=off,gic-version=3",
        # UTM splits each argument at spaces unless quoted (parsedUserArguments):
        # the command line goes in double quotes, as one argument.
        "AdditionalArguments": ["-global", "%s.xres=%s" % (gpu, w), "-global", "%s.yres=%s" % (gpu, h),
                                "-append", '"%s"' % e["UTM_APPEND"]],
    },
    # UTM's USB 3.0 bus brings usb-tablet, usb-mouse and usb-kbd: the
    # touches (as an absolute pointer) and the keyboard.
    "Input": {"UsbBusSupport": "3.0", "UsbSharing": False, "MaximumUsbShare": 3},
    "Sharing": {"DirectoryShareMode": "None", "DirectoryShareReadOnly": False, "ClipboardSharing": False},
    "Display": [{"Hardware": gpu, "DynamicResolution": False, "NativeResolution": False,
                 "UpscalingFilter": "Linear", "DownscalingFilter": "Linear"}],
    "Drive": drives,
    "Network": [{"Mode": "Emulated", "Hardware": "virtio-net-pci", "MacAddress": mac_address(),
                 "IsolateFromHost": False,
                 "PortForward": [{"Protocol": "TCP", "HostAddress": "127.0.0.1", "HostPort": port,
                                  "GuestPort": 22}]}],
    "Serial": [{"Mode": "Terminal", "Target": "Auto",
                "Terminal": {"ForegroundColor": "#ffffff", "BackgroundColor": "#000000", "Font": "Menlo",
                             "FontSize": 12, "CursorBlink": True}}],
    "Sound": [{"Hardware": e["UTM_SOUND"]}] if e["UTM_SOUND"] else [],
}
data = plistlib.dumps(config, fmt=plistlib.FMT_XML, sort_keys=True)
if sys.argv[1] == "-":
    sys.stdout.write(data.decode())
else:
    with open(sys.argv[1], "wb") as f:
        f.write(data)
EOF
}

plan() {
    echo "make-utm.sh: $BUNDLE: the $NAME for UTM ($FOR): ${WIDTH}x$HEIGHT, $CPUS CPUs, $MEMORY MiB, $GPU, sound ${SOUND:-none}, a $DISK root disk$HOW; ssh on 127.0.0.1:$SSH_PORT"
}

if [ -n "$DRY" ]; then
    plan
    echo "make-utm.sh: Data/$KERNEL_NAME from $KERNEL"
    [ -z "$INITRD" ] || echo "make-utm.sh: Data/$INITRD_NAME from $INITRD"
    echo "make-utm.sh: Data/$ROOT_NAME from $ROOTFS$HOW"
    write_config -
    exit 0
fi

[ -f "$KERNEL" ] || die "no kernel at $KERNEL (build the image: scripts/mac-build.sh phoenix-vm-arm64; or --image, --kernel)"
[ -f "$ROOTFS" ] || die "no image at $ROOTFS (build it: scripts/mac-build.sh phoenix-vm-arm64; or --image)"
[ -z "$INITRD" ] || [ -f "$INITRD" ] || die "no initrd at $INITRD"
if [ "$DISK" = qcow2 ]; then
    has_qemu_img || die "--disk qcow2 needs $QEMU_IMG (macOS: brew install qemu); or --disk raw"
fi
if [ -e "$BUNDLE" ] && [ -z "$FORCE" ]; then
    die "$BUNDLE is there already (--force replaces it; UTM keeps its own copy once imported)"
fi

mkdir -p "$OUT"
TMP=$OUT/.Phoenix-$DEVICE$SUFFIX.utm.$$
trap 'rm -rf "$TMP"' EXIT INT TERM
rm -rf "$TMP"
mkdir -p "$TMP/Data"

# The root disk first: a clone takes no room. By default, and with --disk
# raw, it tries one; by default, without one, it is qcow2 when there is a
# qemu-img, as the plan's guess was.
CLONED='' HOW=''
if [ "$DISK" = raw ] || [ -n "$DISK_AUTO" ]; then
    want=$DISK DISK=raw
    root_name
    if clone "$ROOTFS" "$TMP/Data/$ROOT_NAME"; then
        CLONED=1 HOW=' (a clone of the image: it takes no space)'
    elif [ -n "$DISK_AUTO" ] && has_qemu_img; then
        DISK=qcow2
        root_name
    else
        DISK=$want
        root_name
    fi
fi

# Room for the rest: the kernel and, unless it is a clone, the root disk's
# used blocks (a copy keeps its holes; qcow2 holds no more than them).
if [ -n "$CLONED" ]; then
    need_kb=$(du -k "$KERNEL" ${INITRD:+"$INITRD"} | awk '{ s += $1 } END { print s + 1024 }')
else
    need_kb=$(du -k "$ROOTFS" "$KERNEL" ${INITRD:+"$INITRD"} | awk '{ s += $1 } END { print s + 1024 }')
fi
free_kb=$(df -Pk "$OUT" | awk 'NR == 2 { print $4 }')
[ "$free_kb" -ge "$need_kb" ] || die "$OUT has $((free_kb / 1024)) MiB free; the bundle needs about $((need_kb / 1024)) MiB"

# A copy that shares the blocks where the file system can (APFS clones,
# Btrfs/XFS reflinks), else a plain copy that keeps the holes.
copy() {
    case $(uname -s) in
        Darwin) cp -c "$1" "$2" 2>/dev/null || cp "$1" "$2" ;;
        *) cp --reflink=auto --sparse=always "$1" "$2" 2>/dev/null || cp "$1" "$2" ;;
    esac
}
copy "$KERNEL" "$TMP/Data/$KERNEL_NAME"
[ -z "$INITRD" ] || copy "$INITRD" "$TMP/Data/$INITRD_NAME"
if [ -z "$CLONED" ]; then
    case $DISK in
        qcow2) "$QEMU_IMG" convert -q -f raw -O qcow2 "$ROOTFS" "$TMP/Data/$ROOT_NAME" ;;
        raw) copy "$ROOTFS" "$TMP/Data/$ROOT_NAME" ;;
    esac
fi
write_config "$TMP/config.plist"
rm -rf "$BUNDLE"
mv "$TMP" "$BUNDLE"
trap - EXIT INT TERM
plan
case $FOR in
    mac) next="open it in UTM (double-click it)" ;;
    *) next="copy it to the iPad: AirDrop, or Finder's Files tab for UTM (docs/BUILDING-MAC.md, \"Run it on an iPad with UTM\")"
       [ "$DISK" != raw ] || ! has_qemu_img || next="$next; --disk qcow2 makes a smaller one to copy" ;;
esac
echo "make-utm.sh: $(du -sk "$BUNDLE" | awk '{ printf "%d MiB", $1 / 1024 }'); $next"
