# Building the OS image on a Mac

There are two things you can build:

| What | How | Time |
| --- | --- | --- |
| The Phoenix UI simulator | Natively on macOS, see [GETTING-STARTED.md](GETTING-STARTED.md) | Minutes |
| A full webOS Phoenix OS image | In a Linux container, this page | Hours the first time |

This page is for the second one. It uses Apple's
[`container`](https://github.com/apple/container) tool, which runs Linux
containers as lightweight virtual machines.

## Requirements

- A Mac with Apple silicon, running **macOS 26** (required by `container`)
- `container` installed from its [releases page](https://github.com/apple/container/releases)
- **16 GB of RAM or more** (Chromium, part of webOS OSE, is a very large build)
- **About 300 GB of free disk**. The build volume grows as it fills, up to that size.
- Rosetta. macOS offers to install it the first time an x86-64 container runs.

## Why x86-64 (Rosetta)?

webOS OSE only supports **x86-64 build machines**. Its build scripts check for
Ubuntu 20.04/22.04 amd64 and need 32-bit compiler packages that don't exist for
ARM Linux. So the build container runs x86-64 Linux, translated by Rosetta.
That's slower than native, but it works.

This only affects the *build machine*. The OS you build can still target
ARM64 devices: OSE cross-compiles, and `raspberrypi4-64` (and later phones
such as the PinePhone Pro, and the ARM64 VM) are ARM64 targets. Making the build itself run natively
on ARM64 is on the roadmap.

## Build

From your checkout:

| Command | What it does |
| --- | --- |
| `scripts/mac-build.sh --check` | A quick check first: fetch the layers and resolve the whole image without compiling |
| `scripts/mac-build.sh` | The `qemux86-64` emulator image |
| `scripts/mac-build.sh raspberrypi4-64` | 64-bit Raspberry Pi 4 image |
| `scripts/mac-build.sh phoenix-vm-arm64` | The ARM64 VM image that runs on this Mac as any first target device ([Run it in a VM](#run-it-in-a-vm)) |
| `scripts/mac-build.sh fairphone-fp6` (`ayn-odin2portal`, `pinephonepro`, `pinetab2`) | A first target's own image (docs/HARDWARE.md, "First targets") |
| `scripts/mac-build.sh --shell` | Just open a shell in the build container |

The first run:

1. starts the `container` services
2. builds the `webos-phoenix-build` image (Ubuntu 22.04 with OSE's build tools)
3. creates `webos-phoenix-work`, an ext4 volume for the build. Yocto needs a
   case-sensitive filesystem, and the Mac's default one isn't.
4. clones webOS OSE `build-webos` at the pinned commit, adds `meta-phoenix`,
   and runs `bitbake webos-phoenix-image`

Your checkout is mounted into the container at `/src/webos-phoenix`, and the
Phoenix shell is built from it (`externalsrc`). Edit on the Mac, re-run the
script, and the image picks up your changes. Everything the build writes stays
in the volume, and re-runs only rebuild what changed.

By default the container gets all but two CPU cores and three quarters of your
RAM. Override with `PHOENIX_CPUS=8 PHOENIX_MEMORY=24g scripts/mac-build.sh`.

## Where the output goes

Images are in `/work/build-webos-phoenix/BUILD/deploy/images/<machine>/`
inside the volume. To copy them to the Mac:

```sh
scripts/mac-build.sh --shell
```

then, inside the container:

```sh
cp /work/build-webos-phoenix/BUILD/deploy/images/raspberrypi4-64/*.wic* /src/webos-phoenix/out/
```

`--check` is worth running first. It sets everything up and has BitBake parse
all of webOS OSE (about 3,400 recipes) and resolve `webos-phoenix-image`,
which catches setup problems in minutes instead of hours into a build.

## Run it in a VM

Before a device arrives, the real OS image can run on the Mac as that
device: `phoenix-vm-arm64` is an ARM64 virtual machine image with every
first target's configuration in it, and the kernel's command line picks one
at boot (docs/HARDWARE.md, "Device VMs"). On Apple silicon it runs at
near-native speed (Hypervisor.framework).

**Not tried yet.** This image has not been built or booted by anyone: the
first boot is yours. Steps:

1. Build the image (hours the first time, like any OSE image):

   ```sh
   scripts/mac-build.sh phoenix-vm-arm64
   ```

   When it finishes, the build copies the kernel and the root image to
   `out/phoenix-vm-arm64/` in your checkout (`Image` and
   `webos-phoenix-image-phoenix-vm-arm64.rootfs.ext4`; `out/` is ignored
   by git).

2. Install QEMU 8.2 or later (it has the multitouch and sound devices):

   ```sh
   brew install qemu
   ```

3. Start it as a device:

   ```sh
   scripts/vm.sh fairphone-fp6
   ```

   `scripts/vm.sh --list` lists the devices: `fairphone-fp6`,
   `ayn-odin2portal`, `pinephonepro`, `pinetab2`, `raspberrypi4-64`. Each
   gets its CPU count (at most the Mac's), memory and screen resolution,
   and keeps its own disk (an overlay over the image, in
   `~/.local/state/webos-phoenix/vm/`; `--fresh` starts it again). The
   console is the terminal (Ctrl+A X quits QEMU); ssh is on port 2222.
   `scripts/vm.sh fairphone-fp6 --dry-run` prints the QEMU command without
   running it; `--help` lists the options (`--memory`, `--cpus`,
   `--cap-cpu` to run on the efficiency cores, `--audio hda`, `--image`).

4. What to check first: it boots to the lock screen at the device's
   resolution (the Fairphone: 1116x2484, the status bar holding the camera
   hole); `journalctl -u phoenix-device-select` says
   `phoenix-device-select: fairphone-fp6`; touches on the screen move the
   cards; sound plays. Send what fails, with `phoenix-diag`'s logs.

5. Input, since nothing has run on a device yet:
   - **Pointer**: the mouse's cursor shows over the shell and a click opens
     a card. (The devices hide it, `WEBOS_CURSOR_HIDE=1` in `phoenix-shell`'s
     `product.env`; the VM's `compositor.env` unsets it, so a missing
     cursor here is a fault.)
   - **Trackpad**: a two-finger swipe moves card view sideways and the
     launcher's pages (`TrackpadSwipe.qml`). OSE builds Qt without libinput
     (OPEN-QUESTIONS Q100), so the guest gets the Mac's scrolling as wheel
     notches, which take the shell's mouse-wheel path (one card or page a
     notch), not a finger-like swipe; check both directions, and that the
     notches stop when the fingers lift. No tap-to-click or natural
     scrolling setting exists without libinput: the Mac's own scrolling
     direction is what QEMU passes on.
   - **Keyboard shortcuts** (`KeyboardShortcuts.js`, Settings > Text Assist
     > Hardware keyboard): in card view, then again with an app's card
     maximized, try next card, Just Type, close the card and card view.
     The guest is Linux, so the iPad scheme's "Command" shortcuts are the
     Control key here; the Mac's Command key arrives as Super, and macOS
     keeps Command+Tab and Command+Space for itself. On a device
     luna-surfacemanager gives a key to the focused app's surface first: if
     the shortcuts work in card view but never with an app maximized, the
     shell is not seeing them (the app's page has them); note which keys,
     and whether the app reacted instead.

Homebrew's QEMU is built without OpenGL on macOS, so `vm.sh` gives it the
plain virtio GPU and the image draws with Mesa's software renderer
(llvmpipe): correct, but slower than the device. For GL, use UTM.

### UTM

[UTM](https://mac.getutm.app/) is QEMU with GL (virglrenderer over
ANGLE/Metal) and a window around it. `scripts/vm.sh <device> --utm`
prints these settings with the device's numbers; for the Fairphone:

1. **Create a New Virtual Machine** > **Virtualize** > **Linux**. Leave
   **Use Apple Virtualization** off (that is QEMU). Turn on **Boot from
   kernel image**:
   - Kernel image: `out/phoenix-vm-arm64/Image`
   - Root image: `out/phoenix-vm-arm64/webos-phoenix-image-phoenix-vm-arm64.rootfs.ext4`
   - Boot arguments: `root=/dev/vda rw rootwait console=ttyAMA0 phoenix.device=fairphone-fp6`
2. **Hardware**: Memory 8192 MiB, CPU cores 8 (the device's; the Pi 4,
   PineTab2 4, the PinePhone Pro 6).
3. Finish, then **Edit** the VM:
   - **Display**: Emulated Display Card **virtio-gpu-gl-pci (GPU
     Supported)**; turn off **Resize display to window size
     automatically** (the device's resolution is fixed).
   - **QEMU** > **Arguments**, add, one per line:
     `-global virtio-gpu-gl-pci.xres=1116`,
     `-global virtio-gpu-gl-pci.yres=2484`,
     `-device virtio-multitouch-pci`, `-device virtio-tablet-pci`.
   - **Sound**: `virtio-sound-pci` if listed, else Intel HD Audio.
   - **Network**: Shared Network, `virtio-net-pci`.
4. Another device: clone the VM and change the boot argument
   (`phoenix.device=pinephonepro`), the memory, the cores and the two
   resolution lines (`scripts/vm.sh pinephonepro --utm`).

UTM keeps its own copy of the root image inside the VM, so after a new
build, replace the drive (or make the VM again).

## Troubleshooting

- **The build is killed or Chromium fails to link**: give the container more
  memory (`PHOENIX_MEMORY=28g`), or fewer CPUs (each parallel job needs memory).
- **"not a case-sensitive filesystem"**: the build directory must be on the
  `webos-phoenix-work` volume, not your Mac folder.
- **Start over**: `container volume delete webos-phoenix-work` removes the whole
  build. It's large, so only do this if you mean it.
