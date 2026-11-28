# Phoenix in VM software

The VM image is one machine, **`phoenix-vm-arm64`** (`meta-phoenix/conf/machine/`;
[HARDWARE.md, "Device VMs"](HARDWARE.md#device-vms)). One build gives two disks:

- the **ext4 root** and the kernel (`Image`), which QEMU and UTM's QEMU backend
  boot directly (`scripts/vm.sh`, `scripts/make-utm.sh`);
- the **A/B disk** (`webos-phoenix-image-phoenix-vm-arm64.rootfs.wic`, built on
  LuneOS's layers with meta-rauc: `files/wic/phoenix-ab-efi.wks.in`). It is a GPT
  disk with an EFI system partition and GRUB, root slots A and B, and the data
  partition. Any hypervisor with UEFI firmware boots it. GRUB names the root
  by partition label (`root=PARTLABEL=phoenix-root-a`), so it does not matter
  which disk controller the hypervisor puts it on.

`scripts/make-vm-packages.sh` wraps the A/B disk for every other kind of VM software
in one run. The kernel has their disks, displays and buses built in
(`recipes-kernel/linux/files/phoenix-vm-hypervisors.cfg`), because the image has no initramfs.

```sh
scripts/make-vm-packages.sh --disk webos-phoenix-image-phoenix-vm-arm64.rootfs.wic           # every target
scripts/make-vm-packages.sh --disk ....wic vmware parallels virtualbox                       # some
scripts/make-vm-packages.sh --disk ....wic --dry-run                                          # the plan
```

| Target | What it writes | Opens in |
| --- | --- | --- |
| `vmware` | `Phoenix-NAME-vmware.vmwarevm/`: `phoenix.vmx` (EFI, NVMe, e1000e, HD Audio, xHCI, SVGA) + monolithic sparse VMDK | VMware Fusion (the folder), Workstation (the `.vmx`) |
| `ova` | `Phoenix-NAME.ova`: an OVF 1.0 descriptor (EFI through `vmw:Config`; AHCI on x86-64, NVMe on arm64; e1000e) + a stream-optimized VMDK + a SHA256 manifest | VMware Workstation and ESXi, `ovftool`, Proxmox `qm importovf` |
| `virtualbox` | `Phoenix-NAME-virtualbox/`: `phoenix.vdi` + `install-virtualbox.sh` (VBoxManage: the disk's platform, EFI, VMSVGA, USB tablet, virtio-net, virtio-scsi) | VirtualBox 7.1 or later |
| `parallels` | `Phoenix-NAME-parallels/`: `phoenix.hdd` (Parallels' disk bundle: `DiskDescriptor.xml` + an expanding `.hds`) + `install-parallels.sh` (prlctl: EFI, NVMe) | Parallels Desktop 19 or later (Pro or Business, for `prlctl`) |
| `libvirt` | `Phoenix-NAME-libvirt/`: `phoenix.qcow2` + `phoenix.xml` (UEFI, virtio, SPICE) + `install.sh` | virt-manager, `virsh`, GNOME Boxes (the qcow2) |
| `proxmox` | `Phoenix-NAME-proxmox/`: `phoenix.qcow2` + `install-proxmox.sh` (`qm create` with OVMF, the disk by `import-from`) | Proxmox VE 8 |
| `hyperv` | `Phoenix-NAME-hyperv/`: `phoenix.vhdx` (dynamic) + `Install-Phoenix.ps1` (Generation 2, Secure Boot off) | Hyper-V |
| `raw` | `Phoenix-NAME-raw/disk.img` | Apple Virtualization (`tools/phoenix-vz`, UTM's Apple backend, Tart, VirtualBuddy), cloud images |

The script also writes `SHA256SUMS` over everything it made.

## Which VM software, which CPU

A VM runs a guest of the host's own CPU architecture at full speed. A guest
of another architecture is emulated (QEMU's TCG), many times slower.
**Phoenix builds only an arm64 VM image today**, so the arm64 rows below are the
only ones a Phoenix image can fill. Each package is only as usable as the disk
it wraps: an x86-64 package needs an x86-64 disk, and none exists yet (see
[below](#an-x86-64-vm-image-what-is-missing)).

| VM software | Host | Guest Phoenix can give it | Package | State (28 Nov 2026) |
| --- | --- | --- | --- | --- |
| QEMU (`scripts/vm.sh`, kernel boot) | Apple silicon (HVF), arm64 Linux (KVM) | arm64 | the ext4 + `Image` | local has run it; no evidence on the board yet |
| QEMU | x86-64 Linux, Intel Mac | arm64, **emulated** | the same | usable for tests only (slow) |
| UTM, QEMU backend | Apple silicon Mac; iPad (emulated) | arm64 | `make-utm.sh` | boots on the M1 (local, 28 Nov); the glass is lost and it is slow: llvmpipe (QA.md) |
| UTM Apple backend, Tart, VirtualBuddy, `tools/phoenix-vz` | Apple silicon | arm64 | `raw` | not booted |
| VMware Fusion 13.5+ | Apple silicon | arm64 | `vmware` | made and checked; not opened in Fusion |
| VMware Fusion, Workstation, ESXi | Intel Mac, x86-64 PC | x86-64 only | `vmware`, `ova` | **no x86-64 disk** |
| VirtualBox 7.1+ | Apple silicon Mac (arm64 guests) | arm64 | `virtualbox` | made and checked; not opened in VirtualBox |
| VirtualBox | x86-64 PC or Intel Mac | x86-64 only | `virtualbox` | **no x86-64 disk** |
| Parallels Desktop 19+ | Apple silicon | arm64 | `parallels` | made and checked; not opened in Parallels |
| Hyper-V | Windows 11 on Arm | arm64 | `hyperv` | made and checked; not opened in Hyper-V |
| Hyper-V | x86-64 Windows | x86-64 only | `hyperv` | **no x86-64 disk** |
| libvirt / virt-manager / GNOME Boxes | arm64 Linux (KVM) | arm64 | `libvirt` | made, the domain validated against libvirt's schema; not defined in a libvirt |
| Proxmox VE | x86-64 only (Proxmox has no arm64 release) | arm64 **emulated** (`qm` `arch: aarch64`); x86-64 once there is a disk | `proxmox` | made and checked; not imported on a node |

"Made and checked" is what `tools/test-make-vm-packages.py` shows, and what CI runs
(`tools/ci-checks.sh`, `make-vm-packages`):

- every converted disk passes `qemu-img check` and has the same blocks as the source (`qemu-img compare`);
- each config names its disk, EFI, a controller the kernel has built in, and the disk's architecture;
- the OVA has the OVF first in the tar, then its manifest (whose SHA256s match), then the disk;
- the OVF's references, capacity and controller items agree with each other;
- the libvirt domain passes libvirt's RelaxNG schema (`virt-xml-validate`);
- the scripts pass `sh -n`, and the `SHA256SUMS` are right.

`--boot DISK --arch arm64|x86-64` makes each package from a real UEFI disk, then boots its converted disk under
QEMU with UEFI firmware (AAVMF or OVMF), on the controller that package's
config gives it: NVMe for VMware and Parallels, AHCI for the OVA, virtio-scsi
for VirtualBox and Proxmox, virtio-blk for libvirt and raw. The arm64 OVA uses NVMe because the arm64
UEFI of QEMU, UTM and Proxmox (edk2's ArmVirtQemu, AAVMF) has no AHCI driver: a disk on AHCI is not
even offered as a boot option there (seen on 28 November 2026: `map: No mapping found`). QEMU has no model of
Hyper-V's storvsc, so the VHDX boots on virtio-blk. Each boot must reach a login
prompt. This proves that the disk survives each conversion and boots on that
controller under UEFI. It does not prove that the hypervisor itself accepts the
package; only local's checklist below proves that.

### The boots, 28 November 2026

There is still no Phoenix VM image to download: the website's image library says that bootable images
"have not yet been published", and no GitHub release has one. So the stand-ins were Debian 12's
nocloud images, arm64 and amd64, checked against Debian's SHA512SUMS and converted to raw. They are
UEFI GPT disks with GRUB, as the A/B disk is. The run was
`tools/test-make-vm-packages.py --boot`, under QEMU 8.2.2 with TCG, Ubuntu's AAVMF and OVMF
(2024.02), 2 vCPUs and 2 GiB. Every package's disk reached a login prompt on its controller:

| Package | Disk on | arm64 | x86-64 |
| --- | --- | --- | --- |
| vmware | NVMe | 86 s | 42 s |
| ova | NVMe on arm64, AHCI on x86-64 | 100 s (on AHCI: no boot, see above) | 44 s |
| virtualbox | virtio-scsi | 94 s | 42 s |
| parallels | NVMe | 88 s | 40 s |
| libvirt | virtio-blk | 84 s | 40 s |
| proxmox | virtio-scsi | 90 s | 40 s |
| hyperv | virtio-blk (QEMU has no storvsc) | 94 s | 38 s |
| raw | virtio-blk | 100 s | 38 s |

The arm64 times include about 40 s of the firmware's network boot attempts, which came before the disk
in that run. The test now gives the disk `bootindex=0`.

## An x86-64 VM image: what is missing

VirtualBox, Hyper-V, Proxmox and VMware on PCs (most of the VM software people
use) need an x86-64 guest. meta-phoenix has no x86-64 Phoenix machine.
OSE's `qemux86-64` is OSE's emulator image: its `WEBOS_TARGET_MACHINE_IMPL` is
"emulator", with OSE's nyx modules and VirtualBox settings, not Phoenix's
package set. To add `phoenix-vm-x86-64`:

1. **The machine.** Add `conf/machine/phoenix-vm-x86-64.conf`, built on OE's `qemux86-64` as
   `phoenix-vm-arm64` is built on `qemuarm64`: `require conf/machine/qemux86-64.conf` and
   `phoenix-mobile.inc`, with `KERNEL_IMAGETYPE = "bzImage"`, `SERIAL_CONSOLES = "115200;ttyS0"`, the same
   `IMAGE_FSTYPES`/`WKS_FILE`/slot sizes, and `PHOENIX_GRUB_ARGS` with `console=tty0 console=ttyS0`
   (no `hvc0` or `ttyAMA0`).
2. **One override for both VMs.** Every `:phoenix-vm-arm64` override says "a Phoenix VM", not "arm64".
   Give both machines a shared override (`MACHINEOVERRIDES =. "phoenix-vm:"`) and move these to it:
   - `recipes-kernel/linux/linux-yocto_%.bbappend`;
   - `dynamic-layers/rauc/recipes-kernel/linux/linux-yocto_%.bbappend`;
   - `phoenix-device-config.bb` (the device profiles and `phoenix-device-select`);
   - `nyx-modules.bbappend` and `nyx-conf.bbappend` (the GPS);
   - `luna-surfacemanager-conf.bbappend` and its `phoenix-vm-arm64/` folder (`99-virtualbox-mouse.rules`);
   - `phoenix-grubenv.bb`.

   `KMACHINE` stays per machine: `qemux86-64`.
3. **The kernel's configuration fragments.** Check `phoenix-vm.cfg` and `phoenix-vm-hypervisors.cfg` on x86-64:
   - add `CONFIG_HYPERVISOR_GUEST`, `CONFIG_PARAVIRT`, `CONFIG_KVM_GUEST`;
   - add VirtualBox's guest driver, `CONFIG_VBOXGUEST`, and `CONFIG_SND_HDA_INTEL` (VirtualBox's and
     VMware's sound);
   - add `CONFIG_FB_EFI`/`CONFIG_DRM_SIMPLEDRM` before the real display driver loads;
   - check that `CONFIG_DRM_VMWGFX` and `CONFIG_DRM_HYPERV` resolve on x86 (they do upstream).
4. **GRUB.** `files/wic/phoenix-ab-grub.cfg` loads `/boot/Image`, which is arm64's name. It must
   take the kernel's file name from the machine (`KERNEL_IMAGETYPE`, as `bzImage`), for example
   through the grubenv `phoenix-grubenv` writes. Use `grub-efi`'s x86-64 EFI loader (`BOOTX64.EFI`).
5. **RAUC.** Add `dynamic-layers/rauc/recipes-core/rauc/files/phoenix-vm-x86-64/system.conf`
   (`compatible=phoenix-vm-x86-64`), and check that `phoenix-bundle`'s compatible string and
   `tools/test-rauc-slots.py` know the machine.
6. **The build and CI.**
   - Add the machine to `scripts/mac-build.sh` and `scripts/setup-build.sh` (an Apple silicon Mac
     cross-builds it, as it does arm64), and to CI's parse matrices (`.github/workflows/parse.yml`,
     both stacks).
   - `make-vm-packages.sh` already takes `--arch x86-64`, and reads it from a disk named
     `*x86-64*`. `tools/test-make-vm-packages.py --boot DISK --arch x86-64` boots it under OVMF here.
7. **Graphics.** VirtualBox's VMSVGA, Hyper-V's synthetic video and VMware's SVGA without 3D give
   the guest no GL. The image then draws with llvmpipe, and the shell leaves out the blur
   (RenderInfo; HARDWARE.md). VMware with `mks.enable3d` (vmwgfx's GL) is the one PC hypervisor
   that could keep the glass.

## What local checks on the Mac

The packages from one `phoenix-vm-arm64` `.wic`, on Apple silicon. For each one, post on the board
the boot time, `systemctl --failed`, `journalctl -b -p err`, the `phoenix: renderer` line and a
screenshot of the lock screen. That fills QA.md's "Other VM software" row.

1. **Build and package.** `scripts/mac-build.sh --stack luneos phoenix-vm-arm64`, then
   `scripts/make-vm-packages.sh --disk <deploy>/webos-phoenix-image-phoenix-vm-arm64.rootfs.wic`.
   Run `python3 tools/test-make-vm-packages.py --boot <that .wic> --arch arm64` (with Homebrew's QEMU's
   `edk2-aarch64-code.fd`). Upload the `.wic.zst` and `SHA256SUMS` where the website's image library
   can link them.
2. **UTM, Apple backend.** Make a new VM: Virtualize > Linux > Use Apple Virtualization, with
   `Phoenix-*-raw/disk.img` as the boot disk. Or run `tools/phoenix-vz`. The console is on `hvc0`.
3. **VMware Fusion 13.5+.** Open `Phoenix-*-vmware.vmwarevm`.
   - Check that Fusion accepts `guestOS = "arm-other6xlinux-64"`, `virtualHW.version = "21"`, NVMe
     and e1000e on arm. If it does not, note which key it refuses.
   - Try `mks.enable3d = "TRUE"` for vmwgfx's GL.
   - Also File > Import the `.ova`.
4. **Parallels Desktop.** Run `sh Phoenix-*-parallels/install-parallels.sh`.
   - Check that Parallels accepts the `phoenix.hdd` bundle QEMU wrote. If it does not, run
     `prl_disk_tool check --hdd phoenix.hdd` and send its output.
   - The fallback is File > Open on the `.vmwarevm`, which Parallels converts.
5. **VirtualBox 7.1+ (arm64).** Run `sh Phoenix-*-virtualbox/install-virtualbox.sh`. On VirtualBox's ARM
   platform, check `--graphicscontroller vmsvga`, `--nictype1 virtio` and the virtio-scsi controller.
   Note any it refuses.
6. **UTM, QEMU backend, with the A/B disk.** The same `.wic` (or the libvirt qcow2) as a UEFI VM, not
   kernel boot. This checks GRUB's slot choice on a hypervisor that keeps NVRAM.
