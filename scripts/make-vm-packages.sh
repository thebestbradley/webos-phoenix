#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Wrap the VM image's EFI disk (webos-phoenix-image-<machine>.rootfs.wic,
# meta-phoenix files/wic/phoenix-vm-efi.wks.in) for each hypervisor that
# boots from firmware, one folder or archive per target, from one build.
# docs/VIRTUALIZATION.md (2.0), X5. UTM's QEMU backend and the iPad keep
# scripts/make-utm.sh (kernel boot).
#
#   scripts/make-vm-packages.sh --disk FILE [options] [TARGET...]
#
# TARGET (default: all of them):
#   vmware      Phoenix-NAME-vmware.vmwarevm/: phoenix.vmx + a monolithic
#               sparse VMDK (NVMe, e1000e, HD Audio, xHCI, EFI). VMware
#               Fusion opens the folder; Workstation opens the .vmx.
#   virtualbox  Phoenix-NAME-virtualbox/: phoenix.vdi + install-virtualbox.sh
#               (VBoxManage createvm for the disk's architecture: EFI, VMSVGA,
#               USB tablet, virtio-net, virtio-scsi)
#   libvirt     Phoenix-NAME-libvirt/: phoenix.qcow2 + phoenix.xml (UEFI,
#               virtio, SPICE with the agent channel) + install.sh
#               (virsh define / virt-install --import). GNOME Boxes imports
#               the qcow2.
#   hyperv      Phoenix-NAME-hyperv/: phoenix.vhdx (dynamic) + Install-Phoenix.ps1
#               (Generation 2, Secure Boot off)
#   raw         Phoenix-NAME-raw/disk.img: the disk as it is, for Apple
#               Virtualization (tools/phoenix-vz, Tart, UTM's Apple backend,
#               VirtualBuddy) and cloud images
#
# Options:
#   --disk FILE     the EFI disk (.wic; .wic.zst is decompressed first)
#   --arch arm64|x86-64  the disk's architecture (default: from the name,
#                   phoenix-vm-arm64 or phoenix-vm-x86-64; else arm64)
#   --name NAME     the label in file and VM names (default: rev, from the
#                   folder, else "phoenix")
#   --out DIR       where the packages go (default: the disk's folder/vm)
#   --cpus N        virtual CPUs (default 4)
#   --memory MIB    memory (default 4096)
#   --force         replace packages that are already there
#   --dry-run       print what would be made; write nothing
#
# Needs qemu-img (Homebrew's qemu on a Mac; the build's qemu-img-native on
# the builder: PHOENIX_QEMU_IMG). Writes SHA256SUMS over what it made.

set -eu

QEMU_IMG=${PHOENIX_QEMU_IMG:-qemu-img}
DISK= ARCH= NAME= OUT= CPUS=4 MEM=4096 FORCE=0 DRY=0 TARGETS=
ALL="vmware virtualbox libvirt hyperv raw"

die() { echo "make-vm-packages: $*" >&2; exit 1; }
usage() { sed -n '4,46p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
    case $1 in
        --disk) DISK=$2; shift 2 ;;
        --arch) ARCH=$2; shift 2 ;;
        --name) NAME=$2; shift 2 ;;
        --out) OUT=$2; shift 2 ;;
        --cpus) CPUS=$2; shift 2 ;;
        --memory) MEM=$2; shift 2 ;;
        --force) FORCE=1; shift ;;
        --dry-run) DRY=1; shift ;;
        -h|--help) usage 0 ;;
        -*) die "unknown option $1 (--help)" ;;
        *) case " $ALL " in *" $1 "*) TARGETS="$TARGETS $1" ;; *) die "unknown target $1 ($ALL)" ;; esac; shift ;;
    esac
done
[ -n "$DISK" ] || usage 1
[ -f "$DISK" ] || die "no disk at $DISK"
TARGETS=${TARGETS:-$ALL}
case $CPUS in ''|*[!0-9]*) die "--cpus wants a number" ;; esac
case $MEM in ''|*[!0-9]*) die "--memory wants a number" ;; esac

if [ -z "$ARCH" ]; then
    case $(basename "$DISK") in *x86-64*|*x86_64*) ARCH=x86-64 ;; *) ARCH=arm64 ;; esac
fi
case $ARCH in arm64|x86-64) ;; *) die "--arch arm64 or x86-64" ;; esac
DIR=$(cd "$(dirname "$DISK")" && pwd)
if [ -z "$NAME" ]; then
    NAME=$(basename "$(dirname "$DIR")" | sed -n 's/.*\(rev[0-9][0-9]*\).*/\1/p')
    NAME=${NAME:-phoenix}
fi
OUT=${OUT:-$DIR/vm}
LABEL="webOS Phoenix ($NAME, $ARCH)"

if [ "$DRY" = 0 ]; then
    command -v "$QEMU_IMG" >/dev/null 2>&1 || die "needs qemu-img (brew install qemu, or PHOENIX_QEMU_IMG)"
fi

# A .wic.zst from the builder: decompress once, sparse, beside it.
case $DISK in
    *.zst)
        RAW=${DISK%.zst}
        if [ ! -f "$RAW" ]; then
            [ "$DRY" = 1 ] && echo "would decompress $DISK" || zstd -q -d --sparse -o "$RAW" "$DISK"
        fi
        DISK=$RAW ;;
esac

# Room: every converted disk holds about the disk's used blocks.
if [ "$DRY" = 0 ] && [ -f "$DISK" ]; then
    used_k=$(du -k "$DISK" | cut -f1)
    n=$(echo $TARGETS | wc -w)
    mkdir -p "$OUT"
    free_k=$(df -Pk "$OUT" | awk 'NR==2 {print $4}')
    need_k=$((used_k * n + 1048576))
    [ "$free_k" -gt "$need_k" ] || die "needs about $((need_k / 1024)) MiB free in $OUT, has $((free_k / 1024))"
fi

made=
pkg() { # pkg DIR: start a package folder
    p=$OUT/$1
    if [ -e "$p" ]; then
        [ "$FORCE" = 1 ] || die "$p is there (--force replaces it)"
        [ "$DRY" = 1 ] || rm -rf "$p"
    fi
    [ "$DRY" = 1 ] || mkdir -p "$p"
    made="$made $1"
    echo "make-vm-packages: $p"
}
convert() { # convert FORMAT OPTIONS DEST
    if [ "$DRY" = 1 ]; then echo "  $QEMU_IMG convert -O $1 ${2:+-o $2} $DISK $3"; return; fi
    if [ -n "$2" ]; then "$QEMU_IMG" convert -p -O "$1" -o "$2" "$DISK" "$3"
    else "$QEMU_IMG" convert -p -O "$1" "$DISK" "$3"; fi
}
write() { # write FILE: stdin to FILE (or to the screen for --dry-run)
    if [ "$DRY" = 1 ]; then echo "  --- $1"; sed 's/^/  | /'; else cat > "$1"; fi
}

for t in $TARGETS; do
    case $t in
    vmware)
        pkg "Phoenix-$NAME-vmware.vmwarevm"
        convert vmdk subformat=monolithicSparse "$p/phoenix.vmdk"
        if [ "$ARCH" = arm64 ]; then guest=arm-other6xlinux-64; else guest=other6xlinux-64; fi
        write "$p/phoenix.vmx" <<EOF
.encoding = "UTF-8"
config.version = "8"
virtualHW.version = "21"
displayName = "$LABEL"
guestOS = "$guest"
firmware = "efi"
uefi.secureBoot.enabled = "FALSE"
numvcpus = "$CPUS"
memsize = "$MEM"
nvme0.present = "TRUE"
nvme0:0.present = "TRUE"
nvme0:0.fileName = "phoenix.vmdk"
ethernet0.present = "TRUE"
ethernet0.virtualDev = "e1000e"
ethernet0.connectionType = "nat"
ethernet0.addressType = "generated"
usb.present = "TRUE"
usb_xhci.present = "TRUE"
ehci.present = "TRUE"
sound.present = "TRUE"
sound.virtualDev = "hdaudio"
sound.autoDetect = "TRUE"
svga.present = "TRUE"
mks.enable3d = "FALSE"
serial0.present = "TRUE"
serial0.fileType = "file"
serial0.fileName = "serial.log"
tools.syncTime = "TRUE"
EOF
        ;;
    virtualbox)
        pkg "Phoenix-$NAME-virtualbox"
        convert vdi "" "$p/phoenix.vdi"
        if [ "$ARCH" = arm64 ]; then plat=arm; ostype=Linux_arm64; else plat=x86; ostype=Linux_64; fi
        write "$p/install-virtualbox.sh" <<EOF
#!/bin/sh
# Register "$LABEL" in VirtualBox 7.1 or later and start it.
# Run from this folder: sh install-virtualbox.sh [VM name]
set -eu
VM=\${1:-"$LABEL"}
HERE=\$(cd "\$(dirname "\$0")" && pwd)
VBoxManage createvm --name "\$VM" --platform-architecture $plat --ostype $ostype --register
VBoxManage modifyvm "\$VM" --firmware efi --cpus $CPUS --memory $MEM \\
    --graphicscontroller vmsvga --vram 64 --mouse usbtablet --keyboard usb --usbxhci on \\
    --nic1 nat --nictype1 virtio --audio-enabled on --audio-controller hda \\
    --uart1 0x3F8 4 --uartmode1 file "\$HERE/serial.log"
VBoxManage storagectl "\$VM" --name VirtIO --add virtio --bootable on
VBoxManage storageattach "\$VM" --storagectl VirtIO --port 0 --device 0 --type hdd --medium "\$HERE/phoenix.vdi"
VBoxManage startvm "\$VM"
EOF
        [ "$DRY" = 1 ] || chmod +x "$p/install-virtualbox.sh"
        ;;
    libvirt)
        pkg "Phoenix-$NAME-libvirt"
        convert qcow2 compression_type=zlib "$p/phoenix.qcow2"
        if [ "$ARCH" = arm64 ]; then a=aarch64 m=virt; else a=x86_64 m=q35; fi
        write "$p/phoenix.xml" <<EOF
<domain type='kvm'>
  <name>phoenix-$NAME</name>
  <title>$LABEL</title>
  <memory unit='MiB'>$MEM</memory>
  <vcpu>$CPUS</vcpu>
  <os firmware='efi'>
    <type arch='$a' machine='$m'>hvm</type>
    <firmware><feature enabled='no' name='secure-boot'/></firmware>
  </os>
  <features><acpi/></features>
  <cpu mode='host-passthrough'/>
  <devices>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2' discard='unmap'/>
      <source file='@DISK@'/>
      <target dev='vda' bus='virtio'/>
    </disk>
    <interface type='network'><source network='default'/><model type='virtio'/></interface>
    <graphics type='spice' autoport='yes'><listen type='address'/></graphics>
    <video><model type='virtio' heads='1'/></video>
    <channel type='spicevmc'><target type='virtio' name='com.redhat.spice.0'/></channel>
    <channel type='unix'><target type='virtio' name='org.qemu.guest_agent.0'/></channel>
    <input type='tablet' bus='usb'/>
    <input type='keyboard' bus='usb'/>
    <controller type='usb' model='qemu-xhci'/>
    <sound model='ich9'/>
    <rng model='virtio'><backend model='random'>/dev/urandom</backend></rng>
    <serial type='pty'/>
  </devices>
</domain>
EOF
        write "$p/install.sh" <<EOF
#!/bin/sh
# Define "$LABEL" in libvirt (system connection) and open it.
# Run from this folder: sh install.sh   (virt-manager or Boxes also work)
set -eu
HERE=\$(cd "\$(dirname "\$0")" && pwd)
IMG=/var/lib/libvirt/images/phoenix-$NAME.qcow2
sudo install -m 0644 "\$HERE/phoenix.qcow2" "\$IMG"
sed "s|@DISK@|\$IMG|" "\$HERE/phoenix.xml" > "\$HERE/phoenix.defined.xml"
virsh -c qemu:///system define "\$HERE/phoenix.defined.xml"
virsh -c qemu:///system start phoenix-$NAME
command -v virt-viewer >/dev/null && virt-viewer -c qemu:///system phoenix-$NAME &
EOF
        [ "$DRY" = 1 ] || chmod +x "$p/install.sh"
        ;;
    hyperv)
        pkg "Phoenix-$NAME-hyperv"
        convert vhdx subformat=dynamic "$p/phoenix.vhdx"
        write "$p/Install-Phoenix.ps1" <<EOF
# Create "$LABEL" in Hyper-V (Generation 2, Secure Boot off) and connect.
# Run in an elevated PowerShell from this folder: .\\Install-Phoenix.ps1
param([string]\$Name = "$LABEL", [string]\$Switch = "Default Switch")
\$ErrorActionPreference = "Stop"
\$vhdx = Join-Path \$PSScriptRoot "phoenix.vhdx"
\$vm = New-VM -Name \$Name -Generation 2 -MemoryStartupBytes ${MEM}MB -VHDPath \$vhdx -SwitchName \$Switch
Set-VM -VM \$vm -ProcessorCount $CPUS -StaticMemory -CheckpointType Disabled
Set-VMFirmware -VM \$vm -EnableSecureBoot Off
Set-VMVideo -VM \$vm -HorizontalResolution 1280 -VerticalResolution 800 -ResolutionType Single
Start-VM -VM \$vm
vmconnect.exe localhost \$Name
EOF
        ;;
    raw)
        pkg "Phoenix-$NAME-raw"
        if [ "$DRY" = 1 ]; then echo "  clone or sparse copy $DISK -> $p/disk.img"
        else cp -c "$DISK" "$p/disk.img" 2>/dev/null || cp --sparse=always "$DISK" "$p/disk.img" 2>/dev/null || cp "$DISK" "$p/disk.img"; fi
        ;;
    esac
done

[ "$DRY" = 1 ] && exit 0
cd "$OUT"
for d in $made; do find "$d" -type f ! -name serial.log; done | sort | while read -r f; do shasum -a 256 "$f"; done > SHA256SUMS
echo "made:$made in $OUT (SHA256SUMS)"
