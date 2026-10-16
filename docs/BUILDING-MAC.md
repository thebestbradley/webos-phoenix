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
- **16 GB of RAM or more** (Chromium, the web runtime, is a very large build)
- **About 300 GB of free disk**. The build volume grows as it fills, up to that size.
  Each layer stack ([below](#which-layers---stack)) has a build tree of its
  own there: to keep both, make the volume larger before its first run
  (`PHOENIX_VOLUME_SIZE=600g`), or delete the one you no longer use (in
  `scripts/mac-build.sh --shell`: `rm -rf /work/build-webos-phoenix`).
- Rosetta. macOS offers to install it the first time an x86-64 container runs.

## Why x86-64 (Rosetta)?

webOS OSE only supports **x86-64 build machines**. Its build scripts check for
Ubuntu 20.04/22.04 amd64 and need 32-bit compiler packages that don't exist for
ARM Linux. So the build container runs x86-64 Linux, translated by Rosetta.
That's slower than native, but it works. LuneOS's layers build in the same
container.

This only affects the *build machine*. The OS you build can still target
ARM64 devices: the build cross-compiles, and `raspberrypi4-64` (and later phones
such as the PinePhone Pro, and the ARM64 VM) are ARM64 targets. Making the build itself run natively
on ARM64 is on the roadmap (LuneOS's layers do not need OSE's 32-bit
compilers, but nobody has tried them on an ARM64 build host).

## Build

From your checkout:

| Command | What it does |
| --- | --- |
| `scripts/mac-build.sh --check` | A quick check first: fetch the layers and resolve the whole image without compiling (`--check phoenix-vm-arm64` for another machine) |
| `scripts/mac-build.sh` | The `qemux86-64` emulator image |
| `scripts/mac-build.sh raspberrypi4-64` | 64-bit Raspberry Pi 4 image |
| `scripts/mac-build.sh phoenix-vm-arm64` | The ARM64 VM image that runs on this Mac as any first target device ([Run it in a VM](#run-it-in-a-vm)) |
| `scripts/mac-build.sh fairphone-fp6` (`ayn-odin2portal`, `pinephonepro`, `pinetab2`) | A first target's own image (docs/HARDWARE.md, "First targets") |
| `scripts/mac-build.sh --stack luneos phoenix-vm-arm64` | Any of these on LuneOS's layers, with Chromium 151 ([Which layers](#which-layers---stack)) |
| `scripts/mac-build.sh --shell` | Just open a shell in the build container |

Before the first build, build the web apps in your checkout (`./phoenix`,
or `cd apps && npm ci && npm run build`): the image takes them from there,
and the build stops at its start, saying so, when they are not built.

The first run:

1. starts the `container` services
2. builds the `webos-phoenix-build` image (Ubuntu 22.04 with the build
   tools of both layer stacks; again whenever
   `tools/build-container/Containerfile` changes)
3. creates `webos-phoenix-work`, an ext4 volume for the build. Yocto needs a
   case-sensitive filesystem, and the Mac's default one isn't.
4. clones webOS OSE `build-webos` at the pinned commit (with `--stack
   luneos`, LuneOS's layers at the commits in `scripts/luneos-layers.txt`),
   adds `meta-phoenix`, and runs `bitbake webos-phoenix-image`

Your checkout is mounted into the container at `/src/webos-phoenix`, and the
Phoenix shell and apps are built from it (`externalsrc`). Edit on the Mac, re-run the
script, and the image picks up your changes. Everything the build writes stays
in the volume, and re-runs only rebuild what changed.

By default the container gets all but two CPU cores and three quarters of your
RAM. Override with `PHOENIX_CPUS=8 PHOENIX_MEMORY=24g scripts/mac-build.sh`.

### Which layers: `--stack`

| | `--stack ose` (the default) | `--stack luneos` |
| --- | --- | --- |
| Layers | webOS OSE's `build-webos` (`scripts/setup-build.sh`) | LuneOS's (`scripts/setup-build-luneos.sh`, pins in `scripts/luneos-layers.txt`) |
| Yocto, Qt, web runtime | 5.0 scarthgap, 6.8.1, Chromium 120 | 6.0 wrynose, 6.12, Chromium 151 |
| Build directory in the volume | `/work/build-webos-phoenix` | `/work/build-phoenix-luneos` |
| Images | `BUILD/deploy/images/<machine>/` | `tmp/deploy/images/<machine>/` |

`PHOENIX_STACK=luneos` does the same as `--stack luneos`. Device images
are moving to LuneOS's layers (DECISIONS.md, 15 October 2026; the plan:
[HARDWARE.md, "The web runtime: Chromium 151 on LuneOS's layers"](HARDWARE.md#the-web-runtime-chromium-151-on-luneoss-layers)).
OSE's stay the default until a machine has built and booted on LuneOS's.
Each run brings LuneOS's layers to the pins in `scripts/luneos-layers.txt`;
a layer already there is left alone.

**Not built on LuneOS's layers yet.** The setup and `--stack luneos
--check` work; the build itself will stop until meta-phoenix's remaining
wrynose work is done (HARDWARE.md, "Still to do", steps 2-4). First,
wrynose stops at `do_unpack` any recipe whose `S` is under `${WORKDIR}`
(oe-core `insane.bbclass:1440-1449`), as `phoenix-keyboard`,
`phoenix-pty`, `phoenix-devices`, `whisper-cpp` and others in the image
still are (the shell and the apps are not: `externalsrc` sets theirs).

## Where the output goes

Images are in `/work/build-webos-phoenix/BUILD/deploy/images/<machine>/`
inside the volume (on LuneOS's layers,
`/work/build-phoenix-luneos/tmp/deploy/images/<machine>/`). To copy them to the Mac:

```sh
scripts/mac-build.sh --shell
```

then, inside the container:

```sh
cp /work/build-webos-phoenix/BUILD/deploy/images/raspberrypi4-64/*.wic* /src/webos-phoenix/out/
```

`--check` is worth running first. It sets everything up and has BitBake parse
all of webOS OSE (about 3,400 recipes; with `--stack luneos`, all of
LuneOS's layers) and resolve `webos-phoenix-image`,
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
   scripts/mac-build.sh phoenix-vm-arm64                  # OSE's layers, Chromium 120
   scripts/mac-build.sh --stack luneos phoenix-vm-arm64   # or LuneOS's, Chromium 151
   ```

   When it finishes, the build copies the kernel and the root image to
   `out/phoenix-vm-arm64/` in your checkout (`Image` and
   `webos-phoenix-image-phoenix-vm-arm64.rootfs.ext4`; `out/` is ignored
   by git). The names are the same on both stacks: what is there is the
   last build's, and its last line says which layers it was. LuneOS's
   layers have not built an image yet ([Which layers](#which-layers---stack)).

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
(llvmpipe): correct, but slower than the device (the shell sees llvmpipe and
leaves out the blur behind translucent surfaces, as RenderInfo prints at
start-up). For GL, use UTM.

### UTM

[UTM](https://mac.getutm.app/) is QEMU with GL (virglrenderer over
ANGLE/Metal) and a window around it. `scripts/make-utm.sh` makes the VM for
it, as a UTM bundle with the same machine as `vm.sh`:

```sh
scripts/make-utm.sh fairphone-fp6 --for mac     # out/Phoenix-fairphone-fp6-mac.utm
```

Double-click the bundle to open it in UTM. It has the device's CPU count,
memory and resolution, virtio-gpu-gl-pci, UTM's USB tablet and keyboard,
Intel HD Audio, ssh on port 2222 and the console in UTM's serial window;
`--help` lists the options, and the next section says what is in it and
why. To change the image, make the bundle again (`--force` replaces it):
UTM runs the copy inside it.

By hand, `scripts/vm.sh <device> --utm` prints the settings with the
device's numbers; for the Fairphone:

1. **Create a New Virtual Machine** > **Virtualize** > **Linux**. Leave
   **Use Apple Virtualization** off (that is QEMU). Turn on **Boot from
   kernel image**:
   - Kernel image: `out/phoenix-vm-arm64/Image`
   - Root image: `out/phoenix-vm-arm64/webos-phoenix-image-phoenix-vm-arm64.rootfs.ext4`
   - Boot arguments, **in double quotes**:
     `"root=/dev/vda rw rootwait console=ttyAMA0 phoenix.device=fairphone-fp6"`.
     UTM passes them to QEMU's `-append` split at the spaces unless quoted
     (`parsedUserArguments` in UTM's `UTMQemuConfiguration+Arguments.swift`),
     and QEMU then stops on `Could not open 'rw'`.
2. **Hardware**: Memory 8192 MiB, CPU cores 8 (the device's; the Pi 4,
   PineTab2 4, the PinePhone Pro 6).
3. Finish, then **Edit** the VM:
   - **Display**: Emulated Display Card **virtio-gpu-gl-pci (GPU
     Supported)**; turn off **Resize display to window size
     automatically** (the device's resolution is fixed).
   - **QEMU** > **Arguments**, add, one per line:
     `-global virtio-gpu-gl-pci.xres=1116`,
     `-global virtio-gpu-gl-pci.yres=2484`. (Not `vm.sh`'s virtio
     multitouch and tablet: UTM's window sends the pointer through SPICE,
     which has no touches, to its own USB tablet.)
   - **Sound**: Intel HD Audio (UTM's own choice for ARM64 Linux), or
     `virtio-sound-pci`.
   - **Network**: Emulated VLAN, `virtio-net-pci`; **Port Forward** TCP
     127.0.0.1 port 2222 to guest port 22 for ssh.
4. Another device: clone the VM and change the boot argument
   (`phoenix.device=pinephonepro`), the memory, the cores and the two
   resolution lines (`scripts/vm.sh pinephonepro --utm`).

UTM keeps its own copy of the root image inside the VM, so after a new
build, replace the drive (or make the VM again).

## Run it on an iPad with UTM

UTM runs on an iPad too, so the same image can run there as a tablet or a
phone, with the iPad's own touch screen. iPadOS gives apps no hypervisor,
so UTM translates every ARM instruction (QEMU's TCG): this is emulation,
many times slower than on the Mac. Whether it is fast enough to be a
development device is what a first try finds out.

**Not tried yet.** Nobody has built the image or run it in UTM. The bundle
was checked against UTM's source (`tools/check-utm-bundle.py`: the keys
UTM 4.0 to 5.0.6 read, and the QEMU command UTM builds from it), and that
command was started with QEMU 8.2 and a stand-in kernel, which found the
panel's resolution, 4 CPUs, 3 GB, the USB tablet and keyboard and the root
disk where Phoenix expects them (`tools/test-make-utm.py --boot`). GL
could not be tried there (no GPU).

### What to install on the iPad

| | UTM SE | UTM |
| --- | --- | --- |
| Where | the App Store | sideloaded: the `.ipa` from [UTM's releases](https://github.com/utmapp/UTM/releases), signed with your Apple developer account (AltStore, SideStore or Xcode) |
| How it runs the guest | QEMU's threaded interpreter: no JIT needed | QEMU's JIT |
| Speed | the slowest | faster: how much is one of the things to measure |
| What else it needs | nothing | JIT, which iPadOS only allows an app being debugged: at every launch, UTM asks AltStore's AltServer (AltJIT) or a JitStreamer server (UTM's Settings) for it, or you start it from the Mac ([UTM's tethered launch](https://github.com/utmapp/UTM/blob/main/Documentation/TetheredLaunch.md)). UTM 4.7.4 and later know iOS 26's way. Without JIT, UTM cannot emulate |
| Bundle | `scripts/make-utm.sh --for ipad-se` | `scripts/make-utm.sh` |

Any UTM from 4.0 reads the bundle; 5.0.6 also keeps iPadOS's edge swipes
from taking the first swipe at the screen's edges.

### Make the bundle on the Mac

```sh
scripts/mac-build.sh --stack luneos phoenix-vm-arm64   # the image, once (hours): Chromium 151
brew install qemu                       # qemu-img: a qcow2 disk, smaller to copy
scripts/make-utm.sh                     # out/Phoenix-pinetab2.utm (UTM with JIT)
scripts/make-utm.sh --for ipad-se       # out/Phoenix-pinetab2-se.utm (UTM SE)
scripts/make-utm.sh fairphone-fp6       # the phone: turn the iPad upright
```

`--stack luneos` builds the image on LuneOS's layers, whose web runtime is
Chromium 151, the engine devices are moving to; without it the image is
OSE's, Chromium 120 ([Which layers](#which-layers---stack): LuneOS's
layers have not built an image yet). `make-utm.sh` takes whichever image
the last build copied to `out/phoenix-vm-arm64/`. `scripts/mac-build.sh
--stack luneos --check phoenix-vm-arm64` first checks the setup in
minutes.

The PineTab2 is the default: the 10.1" tablet, used in landscape, is the
nearest profile to an iPad. Its 1280x800 (16:10) shows with bands above
and below on the iPad's wider-than-4:3 screen; an iPad-shaped profile would
need adding to the image (OPEN-QUESTIONS Q170): an entry in
`meta-phoenix/recipes-phoenix/phoenix-device-config/files/device-profiles.json`
(the panel upright, for an 11" iPad half its pixels, 1180x820, to keep the
emulated drawing down; `"orientation": "landscape"`), its
`files/<config>/device.json` (`"formFactor": "tablet"`, `"density": 1.0`),
the id in `tools/test-device-profiles.py`'s list, then a new image build
(the image carries the profiles) and `scripts/make-utm.sh <id>`. The
simulator picks it up too (`phoenix-sim --device <id>`). What is in the
bundle:

- **CPU and memory**: at most 4 CPUs and 3072 MiB, a 384 MiB translation
  cache. QEMU runs inside UTM's own process on iPadOS, and iPadOS ends an
  app that outgrows its limit: the guest's memory, the cache (counted
  twice when JIT comes from a debugger) and UTM have to fit in about 5 GB
  on an 8 GB iPad. On a 16 GB iPad, raise the memory to 4096 in UTM's
  settings for the VM (System).
- **Display**: virtio-gpu-gl-pci, so the image's Mesa draws through virgl
  on the iPad's GPU (ANGLE over Metal) instead of the software renderer,
  which under emulation would be far slower; the device's resolution,
  fixed. If the screen stays black while the console shows the shell
  running, make it again with `--gl off`.
- **Touch and keys**: UTM's USB tablet and keyboard. UTM sends what you
  do on its screen through SPICE, which carries a pointer but no touches:
  a finger is one pointer (a tap clicks where it lands, a drag drags). No
  pinch or two-finger gestures reach Phoenix, so the bundle leaves out
  `vm.sh`'s virtio multitouch, which would get nothing.
- **Boot**: the kernel itself (no boot loader), `vm.sh`'s command line,
  and systemd's start and device timeouts at 10 minutes (30 for UTM SE)
  instead of 90 seconds: under emulation a unit can be that slow without
  being stuck.
- **The rest**: Intel HD Audio, network (QEMU's user networking: the
  iPad's connection), ssh on the iPad's own 127.0.0.1:2222, the console
  in UTM's serial window, a virtio random number generator.

### Copy it to the iPad

Either of:

- **AirDrop**: in Finder, Share > AirDrop the `.utm` to the iPad and open
  it with UTM (UTM moves it out of its Inbox into its own folder).
- **A cable**: connect the iPad, select it in Finder's sidebar, open
  **Files**, and drag the `.utm` onto **UTM SE** (or **UTM**). It shows
  in UTM's list when UTM next starts.

If neither offers UTM, compress the bundle in Finder, copy the `.zip` to
the iPad's Files (iCloud Drive, a USB drive), tap it there to expand it,
and in UTM tap **+** > **Open…** and choose the `.utm`: UTM runs it where
it is. UTM warns that the VM uses custom QEMU arguments: it does (the
panel's resolution and the kernel's command line).

### Start it

1. In UTM's settings (in UTM, or iPadOS's Settings > UTM) > Cursor, set
   **Touch Input** to **Touch mode (try hiding cursor)**: a finger then
   acts where it touches. The default, Drag cursor, moves the pointer like
   a trackpad.
   Keep UTM on the screen while it runs: iPadOS suspends an app that
   leaves it, and UTM cannot save the VM's state with GPU acceleration
   on ("Suspend is not supported when GPU acceleration is enabled"), so
   if iPadOS then ends UTM the VM stops as if unplugged. **Continue
   running VM in the background** keeps it going for a while (the
   sideloaded UTM longer: it asks for your location to stay awake).
2. Start the VM. UTM's **Display** menu (the toolbar) switches between
   the screen and **Serial 0**, the console: kernel messages, then a
   login prompt.
3. On iPadOS QEMU runs inside UTM, once per launch: when the VM stops,
   UTM goes to the Home Screen and quits. Open it again to start the VM
   again.

### What to expect

- Slow. A boot to the lock screen may take many minutes with JIT and
  longer with UTM SE; nobody has measured either yet.
- One pointer for touch (above); a hardware keyboard works, and UTM's
  keyboard button brings up the on-screen one.
- iPadOS's own swipes from the bottom and the sides compete with
  Phoenix's gestures there.
- Sound may stutter when the emulated CPUs are busy.
- If UTM closes by itself during the boot, iPadOS stopped it for memory:
  lower the VM's memory (2048) in UTM's settings.

### What to check first

1. It boots: Serial 0 shows the kernel, then a login; `journalctl -u
   phoenix-device-select` says `phoenix-device-select: pinetab2`. The
   image is the one you meant: from `--stack luneos`, `/etc/os-release`
   names LuneOS and `opkg list-installed | grep webruntime` shows 151
   (OSE's: webOS OSE, 120).
2. How long: `systemd-analyze`, and the time from tapping start to the
   lock screen. Note which UTM, which iPad.
3. The lock screen fills the picture at 1280x800 the right way up.
4. A tap unlocks; dragging moves the cards; the cursor follows the finger.
5. Typing on a keyboard reaches Just Type; sound plays; the network is up.
6. Send what fails or is slow, with `phoenix-diag`'s logs, as for the Mac.

## Troubleshooting

- **The build is killed or Chromium fails to link**: give the container more
  memory (`PHOENIX_MEMORY=28g`), or fewer CPUs (each parallel job needs memory).
  On LuneOS's layers Chromium and V8 run a job per CPU too, like every
  other recipe: LuneOS's own recipes ask for 64 and 48 jobs, sized for its
  64-thread build host, and `scripts/setup-build-luneos.sh` overrides that.
- **"not a case-sensitive filesystem"**: the build directory must be on the
  `webos-phoenix-work` volume, not your Mac folder.
- **"the image needs the web apps built in your checkout"**: build them on the
  Mac (`./phoenix`), then run the build again.
- **Start over**: `container volume delete webos-phoenix-work` removes the whole
  build. It's large, so only do this if you mean it. To start one stack over,
  delete its build directory instead (`/work/build-webos-phoenix` or
  `/work/build-phoenix-luneos`, from `scripts/mac-build.sh --shell`).
- **Old build images**: each change to `tools/build-container/Containerfile`
  builds a new `webos-phoenix-build` image, tagged with the file's checksum;
  `container image list` shows the older ones, which can be deleted.
