#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Start the ARM64 VM image (MACHINE phoenix-vm-arm64) as one of the first
# target devices: its CPU count, memory and panel, and the kernel's
# phoenix.device=<device>, which makes the image configure itself as that
# device (phoenix-device-config's phoenix-device-select). docs/HARDWARE.md,
# "Device VMs"; docs/BUILDING-MAC.md, "Run it in a VM".
#
#   scripts/vm.sh DEVICE [options] [-- QEMU options...]
#   scripts/vm.sh --list
#
# DEVICE: fairphone-fp6, ayn-odin2portal, pinephonepro, pinetab2,
# raspberrypi4-64 (meta-phoenix/recipes-phoenix/phoenix-device-config/
# files/device-profiles.json).
#
# Options:
#   --image PATH     the image: a folder with Image and
#                    webos-phoenix-image-phoenix-vm-arm64.rootfs.ext4 (the
#                    build's deploy/images/phoenix-vm-arm64, or out/phoenix-vm-arm64
#                    where scripts/mac-build.sh copies them: the default), or
#                    the .ext4 itself with Image beside it
#   --kernel FILE    the kernel, if not beside the image
#   --cpus N         virtual CPUs (default: the device's, at most the host's)
#   --memory MIB     memory in MiB (default: the device's)
#   --cap-cpu PCT    approximate the device's slower cores: on Linux each
#                    virtual CPU gets at most PCT% of a host core
#                    (systemd-run's CPUQuota); on a Mac the VM runs on the
#                    efficiency cores (taskpolicy -b) and PCT is not used
#   --gl on|off      3D through virgl (virtio-gpu-gl-pci). Default: on for
#                    Linux, off on a Mac (Homebrew's QEMU is built without
#                    OpenGL; UTM's QEMU has it, docs/BUILDING-MAC.md)
#   --audio virtio|hda|none   virtio-sound (QEMU 8.2+, the default) or
#                    Intel HDA
#   --display SPEC   QEMU's -display (default: cocoa on a Mac, gtk on Linux)
#   --accel hvf|kvm|tcg  default: hvf on Apple silicon, kvm on an arm64
#                    Linux host with /dev/kvm, tcg (emulation) otherwise
#   --ssh-port N     the host port forwarded to the VM's ssh (default 2222)
#   --fresh          start from the image as built: the device's own disk
#                    (a copy-on-write overlay, one per device) is made anew
#   --dry-run        print the QEMU command and exit (nothing is needed)
#   --utm            print UTM's settings for this device and exit
#
# Each device keeps its own disk (its data, its apps) in
# ${XDG_STATE_HOME:-~/.local/state}/webos-phoenix/vm/<device>.qcow2, an
# overlay over the image; a newer image starts it anew. Ctrl+A X quits
# QEMU from the console.

set -eu

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
PROFILES="$REPO_DIR/meta-phoenix/recipes-phoenix/phoenix-device-config/files/device-profiles.py"
QEMU=${PHOENIX_VM_QEMU:-qemu-system-aarch64}
# For the tests (tools/test-vm-script.sh): the host to plan for.
HOST_OS=${PHOENIX_VM_HOST_OS:-$(uname -s)}
HOST_ARCH=${PHOENIX_VM_HOST_ARCH:-$(uname -m)}

die() { echo "vm.sh: $*" >&2; exit 2; }
usage() { sed -n '11,48p' "$0" | sed 's/^# \{0,1\}//'; }

command -v python3 >/dev/null 2>&1 || die "python3 is needed (to read the device profiles)"
profile() { python3 "$PROFILES" get "$DEVICE" "$1"; }

[ $# -gt 0 ] || { usage; exit 2; }
case $1 in
    -h|--help) usage; exit 0 ;;
    --list) python3 "$PROFILES" list; exit 0 ;;
    -*) die "the device comes first: scripts/vm.sh DEVICE [options] (--list lists them)" ;;
esac
DEVICE=$1; shift
python3 "$PROFILES" get "$DEVICE" name >/dev/null 2>&1 || die "no device \"$DEVICE\"; there are: $(python3 "$PROFILES" list | tr '\n' ' ')"

IMAGE=$REPO_DIR/out/phoenix-vm-arm64
KERNEL='' CPUS='' MEMORY='' CAP='' GL='' AUDIO=virtio DISPLAY_SPEC='' ACCEL='' SSH_PORT=2222 FRESH='' DRY='' UTM=''
need() { [ $# -ge 2 ] && [ -n "$2" ] || die "$1 needs a value"; }
num() { case $2 in ''|*[!0-9]*) die "$1 takes a whole number, not \"$2\"" ;; esac; [ "$2" -gt 0 ] || die "$1 must be more than 0"; }
while [ $# -gt 0 ]; do
    case $1 in
        --image) need "$@"; IMAGE=$2; shift ;;
        --kernel) need "$@"; KERNEL=$2; shift ;;
        --cpus) need "$@"; num "$1" "$2"; CPUS=$2; shift ;;
        --memory) need "$@"; num "$1" "$2"; MEMORY=$2; shift ;;
        --cap-cpu) need "$@"; num "$1" "$2"; [ "$2" -le 100 ] || die "--cap-cpu is a percentage of a core, 1 to 100"; CAP=$2; shift ;;
        --gl) need "$@"; case $2 in on|off) GL=$2 ;; *) die "--gl on or off" ;; esac; shift ;;
        --audio) need "$@"; case $2 in virtio|hda|none) AUDIO=$2 ;; *) die "--audio virtio, hda or none" ;; esac; shift ;;
        --display) need "$@"; DISPLAY_SPEC=$2; shift ;;
        --accel) need "$@"; case $2 in hvf|kvm|tcg) ACCEL=$2 ;; *) die "--accel hvf, kvm or tcg" ;; esac; shift ;;
        --ssh-port) need "$@"; num "$1" "$2"; SSH_PORT=$2; shift ;;
        --fresh) FRESH=1 ;;
        --dry-run) DRY=1 ;;
        --utm) UTM=1 ;;
        --) shift; break ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option $1 (scripts/vm.sh --help)" ;;
    esac
    shift
done

# The device.
NAME=$(profile name)
WIDTH=$(profile width)
HEIGHT=$(profile height)
DEV_CPUS=$(profile cpus)
DEV_MEMORY=$(profile memoryMiB)
MEMORY=${MEMORY:-$DEV_MEMORY}
APPEND="root=/dev/vda rw rootwait console=ttyAMA0 phoenix.device=$DEVICE"

# The host: the accelerator, the CPU model, how many cores it can give.
case $HOST_OS in
    Darwin) host_cpus=$(sysctl -n hw.ncpu 2>/dev/null || echo 1) ;;
    *) host_cpus=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1) ;;
esac
host_cpus=${PHOENIX_VM_HOST_CPUS:-$host_cpus}
if [ -z "$CPUS" ]; then
    CPUS=$DEV_CPUS
    if [ "$CPUS" -gt "$host_cpus" ]; then
        echo "vm.sh: the $NAME has $DEV_CPUS cores; this computer has $host_cpus, so the VM gets $host_cpus" >&2
        CPUS=$host_cpus
    fi
fi
arm_host=
case $HOST_ARCH in arm64|aarch64) arm_host=1 ;; esac
if [ -z "$ACCEL" ]; then
    if [ "$HOST_OS" = Darwin ] && [ -n "$arm_host" ]; then
        ACCEL=hvf
    elif [ "$HOST_OS" = Linux ] && [ -n "$arm_host" ] && { [ -n "${PHOENIX_VM_KVM:-}" ] || [ -w /dev/kvm ]; }; then
        ACCEL=kvm
    else
        ACCEL=tcg
    fi
fi
# The interrupt controller: GICv3 (GICv2 stops at 8 CPUs); under KVM the
# host's own ("host": many arm64 hosts have no GICv2 to offer; OE's
# qemuarm64 runs KVM with gic-version=3, QB_CPU_KVM).
GIC=3
case $ACCEL in
    hvf) CPU_MODEL=host ;;
    kvm) CPU_MODEL=host GIC=host ;;
    tcg) CPU_MODEL=max
         echo "vm.sh: no hardware acceleration here ($HOST_OS $HOST_ARCH): QEMU emulates the ARM CPU (TCG), many times slower than the device" >&2 ;;
esac
if [ -z "$GL" ]; then
    if [ "$HOST_OS" = Darwin ]; then GL=off; else GL=on; fi
fi
if [ -z "$DISPLAY_SPEC" ]; then
    if [ "$HOST_OS" = Darwin ]; then
        DISPLAY_SPEC="cocoa,zoom-to-fit=on"
        [ "$GL" = on ] && DISPLAY_SPEC="cocoa,gl=es,zoom-to-fit=on"
    else
        DISPLAY_SPEC="gtk,zoom-to-fit=on"
        [ "$GL" = on ] && DISPLAY_SPEC="gtk,gl=on,zoom-to-fit=on"
    fi
fi
if [ "$GL" = on ]; then GPU=virtio-gpu-gl-pci; else GPU=virtio-gpu-pci; fi
case $HOST_OS in Darwin) AUDIODEV=coreaudio ;; *) AUDIODEV=pa ;; esac

if [ -n "$UTM" ]; then
    cat <<EOF
UTM settings for the $NAME (docs/BUILDING-MAC.md, "UTM"):
  Create a New Virtual Machine > Virtualize > Linux
    Use Apple Virtualization: off (QEMU)
    Boot from kernel image: on
      Kernel image:  Image (from the image folder)
      Root image:    webos-phoenix-image-phoenix-vm-arm64.rootfs.ext4
      Boot arguments: $APPEND
  Hardware: Memory $MEMORY MiB, CPU cores $CPUS
  Then edit the VM:
    Display: Emulated Display Card "virtio-gpu-gl-pci (GPU Supported)"; turn off
      "Resize display to window size automatically"
    QEMU > Arguments, add:
      -global virtio-gpu-gl-pci.xres=$WIDTH
      -global virtio-gpu-gl-pci.yres=$HEIGHT
      -device virtio-multitouch-pci
      -device virtio-tablet-pci
    Sound: virtio-sound-pci (or "Intel HD Audio")
    Network: Shared Network, virtio-net-pci
EOF
    exit 0
fi

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
STATE=${XDG_STATE_HOME:-$HOME/.local/state}/webos-phoenix/vm
DISK=$STATE/$DEVICE.qcow2

# The command. The network card goes without its boot ROM (romfile=): the
# kernel is loaded directly, and Debian's QEMU without ipxe-qemu would
# stop on the missing efi-virtio.rom.
set -- -name "webOS Phoenix: $NAME" \
    -machine "virt,gic-version=$GIC" -accel "$ACCEL" -cpu "$CPU_MODEL" -smp "$CPUS" -m "$MEMORY" \
    -kernel "$KERNEL" -append "$APPEND" \
    -drive "if=none,id=root,file=$DISK,format=qcow2" -device virtio-blk-pci,drive=root \
    -device "$GPU,xres=$WIDTH,yres=$HEIGHT" -display "$DISPLAY_SPEC" \
    -device virtio-multitouch-pci -device virtio-tablet-pci -device virtio-keyboard-pci \
    -netdev "user,id=net0,hostfwd=tcp:127.0.0.1:$SSH_PORT-:22" -device virtio-net-pci,netdev=net0,romfile= \
    -device virtio-rng-pci \
    -serial mon:stdio "$@"
case $AUDIO in
    virtio) set -- "$@" -audiodev "$AUDIODEV,id=snd0" -device virtio-sound-pci,audiodev=snd0 ;;
    hda) set -- "$@" -audiodev "$AUDIODEV,id=snd0" -device intel-hda -device hda-duplex,audiodev=snd0 ;;
esac
set -- "$QEMU" "$@"
if [ -n "$CAP" ]; then
    if [ "$HOST_OS" = Darwin ]; then
        echo "vm.sh: --cap-cpu: on a Mac the VM runs on the efficiency cores (taskpolicy -b); the percentage is not used" >&2
        set -- taskpolicy -b "$@"
    else
        set -- systemd-run --user --scope --quiet -p "CPUQuota=$((CAP * CPUS))%" -- "$@"
    fi
fi

if [ -n "$DRY" ]; then
    for a in "$@"; do
        case $a in
            *[!A-Za-z0-9_./:=,+%@-]*|'') printf "'%s' " "$(printf '%s' "$a" | sed "s/'/'\\\\''/g")" ;;
            *) printf '%s ' "$a" ;;
        esac
    done
    echo
    exit 0
fi

[ -f "$KERNEL" ] || die "no kernel at $KERNEL (build the image: scripts/mac-build.sh phoenix-vm-arm64; or --image, --kernel)"
[ -f "$ROOTFS" ] || die "no image at $ROOTFS (build it: scripts/mac-build.sh phoenix-vm-arm64; or --image)"
command -v "$QEMU" >/dev/null 2>&1 || die "$QEMU is not installed (macOS: brew install qemu; Debian/Ubuntu: apt install qemu-system-arm)"
command -v qemu-img >/dev/null 2>&1 || die "qemu-img is not installed (it comes with QEMU)"
if [ -n "$CAP" ] && [ "$HOST_OS" != Darwin ]; then
    command -v systemd-run >/dev/null 2>&1 || die "--cap-cpu needs systemd-run (a systemd user session)"
fi
"$QEMU" -device help 2>/dev/null | grep -q '"virtio-multitouch-pci"' \
    || die "this QEMU has no virtio-multitouch-pci (QEMU 8.0 or later has it): $("$QEMU" --version | head -n 1)"
if [ "$AUDIO" = virtio ] && ! "$QEMU" -device help 2>/dev/null | grep -q '"virtio-sound-pci"'; then
    die "this QEMU has no virtio-sound-pci (QEMU 8.2 or later); use --audio hda"
fi

# The device's own disk over the image, made anew when asked or when the
# image is newer (an overlay over a changed image would be garbage).
ROOTFS_ABS=$(cd "$(dirname "$ROOTFS")" && pwd)/$(basename "$ROOTFS")
mkdir -p "$STATE"
if [ -n "$FRESH" ] || [ ! -f "$DISK" ] || [ "$ROOTFS_ABS" -nt "$DISK" ]; then
    [ -f "$DISK" ] && echo "vm.sh: the $NAME's disk starts again from the image (its data is gone)" >&2
    rm -f "$DISK"
    qemu-img create -q -f qcow2 -F raw -b "$ROOTFS_ABS" "$DISK"
fi
echo "vm.sh: the $NAME: ${WIDTH}x$HEIGHT, $CPUS CPUs, $MEMORY MiB, $ACCEL; ssh -p $SSH_PORT root@127.0.0.1"
exec "$@"
