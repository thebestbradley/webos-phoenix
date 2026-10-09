# Hardware and drivers

How webOS Phoenix gets onto as many real devices as possible: which devices
to target, how the legacy webOS services are backed by standard Linux
components, and how images are built, installed and updated.

This is a plan, not a status report. Nothing here has run on a device yet
(see [ROADMAP.md](ROADMAP.md), Milestone 1). Facts are as of September 2026;
where something is uncertain it says so.

## Summary

- **Start where OSE already works.** webOS OSE supports two machines out of
  the box: the Raspberry Pi 4 and an x86-64 emulator image. M1 targets both.
- **One mainline phone and one Halium phone first.** The best first phone is
  the **Google Pixel 3a**: cheap used, in postmarketOS's community category
  (mainline) *and* supported by LuneOS, Ubuntu Touch and Droidian (Halium).
  Pair it with the **OnePlus 6** (the best-supported mainline phone) and the
  **PinePhone Pro** (open hardware, LuneOS already has a layer).
- **Borrow, don't invent.** Kernels and firmware come from postmarketOS (now
  called Nura) and LuneOS layers. Device services follow LuneOS, which has
  run the legacy webOS APIs on phones since 2014.
- **oFono, not ModemManager, for telephony.** OSE's network stack is ConnMan,
  whose cellular support is an oFono plugin, and LuneOS's `webos-telephonyd`
  (whose API the Phoenix Phone and Messaging apps use) is built on oFono.
  ModemManager stays as a fallback for mainline modems oFono handles badly.
- **RAUC for A/B updates**, and a device installer built on the UBports
  Installer's config format plus a WebUSB flasher.
- **A demo that needs no hardware**: a VirtualBox/QEMU image and a browser demo.
- **Install it like a Linux distro**: generic images, live boot, one
  installer, a hardware report feeding the device table, and a light
  profile for old hardware (next section).
- **Drivers like a distro**: open source drivers in the image, firmware
  offered by the Hardware app with its licence, from a signed driver
  catalog ([Hardware support and the Hardware app](#hardware-support-and-the-hardware-app)).

## Install it like a Linux distro

Owner's direction (29 September 2026): support as much hardware as
possible, and make getting Phoenix as easy as installing a Linux
distribution on an old computer. Easy installs get people using and talking
about Phoenix; a community that is visibly using it is what gets
manufacturers to build dedicated webOS hardware again.

What a distro install means, and how close we can get:

| A distro gives you | Phoenix equivalent | How |
| --- | --- | --- |
| **One image for many machines** | A few **generic images** instead of one per device | x86-64 UEFI (any PC, tablet or 2-in-1); arm64 UEFI for boards and phones with a UEFI-capable bootloader (U-Boot, Tow-Boot, lk2nd on Qualcomm); one generic Halium image for Android devices with Project Treble (Android 9 and later), where the device's own vendor partition supplies the drivers and only a small per-device adaptation is added (LuneOS's `halium-arm64` and Ubuntu Touch's GSI approach) |
| **Try it before installing** (live USB) | **Live boot** | x86: a live USB image. Fastboot phones: `fastboot boot` a Phoenix boot image that runs from a file without touching Android, where the device allows it. The browser installer offers "Try" before "Install" |
| **A graphical installer** | **One installer for Mac, Windows and Linux, and a web page** | Detects the device over USB, says what works on it (from the device table), walks through bootloader unlocking, backs up, flashes, and offers to put Android back ([Installer](#installer)) |
| **"Does my hardware work?"** | **A hardware report** | A built-in tool (Settings > Device Info > Report hardware) that tests each feature (calls, Wi-Fi, camera, sensors, suspend) and, with the user's consent, sends the result to the public device table, as linux-hardware.org does for Linux PCs. Every install then improves the table |
| **Drivers in the kernel** | **Mainline first, Halium for reach** | Tiers (b) to (d) below. Upstream every fix to postmarketOS/Nura and the kernel so other projects share the work and it outlives us |
| **Runs on old machines** | **A light profile** | The classic UI is light; OSE's Chromium web runtime is the heavy part. Measure the minimum RAM on the Pi and x86 images, then trim: fewer preloaded apps, zram, one web runtime process for the Enyo apps. Publish the minimum clearly |
| **Updates** | **OTA A/B updates** | RAUC ([OTA](#ota-with-ab-updates)) |

**For manufacturers: "Phoenix Ready".** Once the community is there, a short
public hardware specification tells a maker what to build so Phoenix runs
fully: an unlockable bootloader, mainline or Treble support, the parts in
the reference device list, a `device.json` ([Device configuration](#device-configuration))
declaring its buttons and features, and for 2.0, DisplayPort Alt Mode, HDCP
and a TEE for Widevine ([CONVERGENCE.md](CONVERGENCE.md#3-hardware-it-depends-on)).
The device table's install counts are the evidence that there is demand.

## Drivers: found and installed, not baked in

Owner's question (3 October 2026): can Phoenix find and install its own
drivers, as Linux distributions do, instead of a build per device?

**On PCs, yes, as a distro does.** x86-64 and arm64 UEFI machines describe
their hardware (PCI, USB, ACPI), the generic kernel binds its drivers by
the devices' IDs (modaliases), and `linux-firmware` supplies their
firmware. One image covers them. What a distro adds, and Phoenix will
too, is a **driver manager** for the optional pieces the kernel does not
ship: it reads the machine's modaliases, matches them against a table
(as `ubuntu-drivers` and Manjaro's `mhwd` do), and offers proprietary GPU
or Wi-Fi drivers and missing firmware from the Phoenix package feed.

**On ARM phones and tablets, not completely, but not a build per device
either.** A phone cannot tell the kernel what is in it: its parts sit on
buses that do not enumerate, so the kernel needs a description of each
device (its device tree) and that device's kernel options. A generic image
cannot discover this. What Phoenix does instead is the Halium / Ubuntu
Touch split:

| Piece | Per device? | Where it comes from |
| --- | --- | --- |
| Phoenix itself: shell, services, apps, the web runtime (the root file system) | **No**: one per CPU architecture | The normal build; updated by RAUC |
| An **adaptation package**: kernel, device tree, firmware, `device.json`, the device's audio (UCM) and sensor configuration | **Yes**, small | Built per device in CI from postmarketOS / LuneOS device packages; installed and updated on its own, like a driver package |
| On Halium devices, the drivers themselves | No | **Already on the phone**: the device's own Android vendor partition, used through libhybris. This is the nearest thing to drivers that install themselves |

The **installer** identifies the device over USB (`fastboot getvar product`,
the Android build fingerprint) and fetches the generic image plus that
device's adaptation package. Supporting a new phone means adding one
package, not a new build of Phoenix.

**Then Phoenix finds what the drivers expose, by itself.** Installing the
drivers is half of it; the other half is using whatever they expose
without a line of Phoenix code per device. The kernel's drivers present
the hardware through standard interfaces, and `phoenix-devices`
([below](#finding-the-hardware-and-following-it)) reads only those: input
devices by their capabilities (`/sys/class/input/eventN/device/
capabilities`: a headset jack is whatever reports `SW_HEADPHONE_INSERT`,
a media key whatever reports `KEY_PLAYPAUSE`), the backlight class, the
vibrator by its kernel interface (force feedback, the LED class,
`timed_output`) and the IIO light sensor. It looks at start-up and again
whenever something comes or goes (inotify on `/dev/input` and the
kernel's uevents), so a USB or Bluetooth headset, a USB keyboard or a
dock is used as soon as it is plugged in, and a sensor whose driver loads
late is picked up. `device.json` is left for what no interface says (a
ringer switch's code, the hardware Home button); `phoenix-devices
--probe` prints what a new device has and what Phoenix will use, which is
the first step of bringing one up. So the chain is: the installer or
driver manager puts the right kernel, firmware and drivers in place, the
kernel binds them, and `phoenix-devices` (with oFono, ConnMan, BlueZ,
PulseAudio for the rest) finds what they expose. Most devices need no
Phoenix-specific code at all.

**On the device: a hardware check that heals.** A `org.webosphoenix.hardware`
service runs at first boot and after each update:

1. Probe each part through its backend (modem through oFono, sensors
   through iio-sensor-proxy or sensorfw, the camera, vibration, the LED,
   the torch, suspend and resume).
2. Turn on the backends that answer and record the rest in `device.json`
   terms, so the shell and Settings hide what the device lacks instead of
   showing switches that do nothing.
3. Fetch missing firmware or an updated adaptation package from the feed
   when one exists (the driver manager above, on phones; built as the
   Hardware app: [below](#hardware-support-and-the-hardware-app)).
4. With the user's consent, send the result to the public device table
   (Settings > Device Info > Report hardware), so every install improves
   the list of what works where.

**Reverse engineering, for devices without open drivers.** Allowed for
interoperability (US: DMCA §1201(f); EU: Software Directive article 6),
and how most mainline phone support came about (postmarketOS, Freedreno,
Panfrost, Asahi Linux's Apple GPU driver). The usual methods are reading
the device tree and partition layout from the Android boot image and
`/proc/device-tree`, tracing how the vendor driver drives the hardware
(ftrace, mmiotrace) and writing an open driver to match. Firmware the
vendor does not license for redistribution is copied from the user's own
device at install time, never shipped. This is slow work that needs the
device in hand; Phoenix leaves it to (and contributes to) postmarketOS and
the kernel, and reaches the rest through Halium.

## Hardware support and the Hardware app

Owner's direction (9 October 2026): make Phoenix as easy as possible to
adopt and to develop for, on as much hardware as possible. Common hardware
works out of the box; for the rest, an application, as Ubuntu's
"Additional Drivers" (`ubuntu-drivers`), Fedora's and Windows' driver
installers are, finds the device and installs the driver, firmware or
service it needs. Firmware licensing (the owner's "Mix" decision): **open
source drivers are built into the image; firmware that is not open source
but may be redistributed (the `linux-firmware` blobs for Wi-Fi, Bluetooth
and GPUs) is not in the image, and the Hardware app offers it on first boot
and later, downloaded only when the user says so.**

**Status (October 2026):** the plan below is built in the simulator: the
service (`services/hardware`), Settings > Hardware, First Use's Hardware
step, the signed driver catalog and its tool (`server/drivers`), and the
packaging in `meta-phoenix` (kernel config fragments, the firmware policy,
`phoenix-driver-feed`). Not run on a device yet (M1). How to publish a
driver: [DRIVERS.md](DRIVERS.md).

### What is built in

Every open source driver the kernel has for the hardware Phoenix aims at,
as modules, in every image (`kernel-modules` in `webos-phoenix-image`),
loaded by modalias when the device is there. The OSE kernels Phoenix builds
are `linux-yocto` 6.6 (`qemux86-64`, generic x86-64) and
`linux-raspberrypi` 6.6 (`raspberrypi4-64`); `meta-phoenix` appends config
fragments to both (`recipes-kernel/linux/files/phoenix-hardware*.cfg`), and
phone kernels from postmarketOS get the same fragments when their BSPs are
added:

| Area | Drivers (modules) |
| --- | --- |
| USB classes | storage and UAS, CDC ACM/ECM/NCM/MBIM, RNDIS, QMI modems, USB serial (FTDI, PL2303, CH341, CP210x, option), printers, Ethernet adapters (ASIX, Realtek r8152, SMSC), iPhone tethering, USB-C (`typec`, UCSI on PCs) |
| HID and input | generic HID, multitouch, Apple, Logitech, Microsoft, Sony/PlayStation, Nintendo, Steam, Wacom, I2C-HID (ACPI and device tree), HID sensor hubs, `uinput`, Xbox controllers (`xpad`), touchscreens (Goodix, FocalTech/EDT, Elan, Atmel mXT, Silead), GPIO vibrators |
| Storage | NVMe, SDHCI (PCI, ACPI), Realtek card readers, FAT, exFAT, NTFS |
| Wi-Fi | ath9k (no firmware needed), ath9k_htc, ath10k, ath11k, iwlwifi, rtw88 (PCIe, SDIO, USB), rtw89, rtl8xxxu, MediaTek mt7601u, mt76x2u, mt7921, brcmfmac (SDIO, USB, PCIe), Marvell mwifiex |
| Bluetooth | btusb (with Realtek and Broadcom), btsdio, hci_uart (H5, BCM, QCA), Marvell |
| Graphics | x86: i915, amdgpu, radeon, nouveau, virtio-gpu; ARM: Panfrost, Lima, MSM (Adreno), etnaviv, VC4/V3D, simple panels; DisplayLink-like USB displays (`udl`) |
| Camera, sound | UVC webcams, gspca; USB audio; HD Audio (x86) |
| Sensors | IIO with HID sensors, BMC150, KXCJK1013, MXC4005, MPU6050, STK3310, LTR501 |

The kernel loads firmware compressed (`FW_LOADER_COMPRESS_XZ`/`_ZSTD`) and
without a user-space helper. What the drivers expose is found by
`phoenix-devices` as before ([Finding the hardware](#finding-the-hardware-and-following-it)).

### Firmware: not in the image, offered on the device

- `linux-firmware` and the other firmware recipes are **built** (their
  packages are split per chip by OE: `linux-firmware-rtl8821`,
  `linux-firmware-iwlwifi-misc`, ...), **not installed**:
  `phoenix-firmware-policy.bbclass` fails an image that would install a
  firmware package and names it; firmware a machine recommends (the
  Raspberry Pi 4's Wi-Fi and Bluetooth) is dropped with
  `BAD_RECOMMENDATIONS`. `PHOENIX_FIRMWARE_IN_IMAGE` lists exceptions: open
  source firmware, or what the owner decides a device cannot do without.
- `phoenix-driver-feed` collects the firmware packages with a driver manifest
  each (`recipes-phoenix/phoenix-driver-feed/files/drivers/*.json`: Realtek
  rtw88, Intel iwlwifi, Qualcomm ath10k, MediaTek, Broadcom BCM43455, AMD,
  Intel and NVIDIA graphics), for `server/drivers` to check, sign and
  publish.
- Only firmware whose licence allows redistribution is ever offered; the
  catalog refuses anything else, and the device drops it too. A licence that
  is not open source is shown in full before installing, with its name and
  source. The legal side is in [LEGAL.md](LEGAL.md#firmware-and-drivers).
- Firmware a vendor does not allow passing on stays out entirely; for those
  devices the reverse-engineering and "copy it from the device's own
  Android" routes above apply.

**The first-boot problem.** Firmware for the Wi-Fi itself cannot be
downloaded over that Wi-Fi. In order of preference: a wired or USB
connection (Ethernet, a phone's USB tethering, which the image's open
drivers cover); the **installer**, which already identifies the device and
can put the firmware it needs on the data partition, after showing the
licence on the computer, for First Use to install offline; a USB drive with
the packages (the catalog's `file://` sources: the signature check is the
same). Phones get their own Wi-Fi firmware with their adaptation package
(above), which the owner decides per device, so this is mostly a PC and
board question.

### Detection

`org.webosphoenix.hardware` (`services/hardware/lib/sysfs.js`) reads what
udev reads, without libudev:

- **PCI, USB, SDIO**: every device (these buses enumerate), with its
  modalias (`pci:v…d…sv…sd…bc…sc…i…`; USB per interface,
  `usb:v…p…d…dc…ic…`), class, the driver bound to it (the `driver` link),
  and names from the device (USB strings) or `pci.ids`/`usb.ids`. Bridges,
  hubs and host controllers are left out.
- **Device tree, ACPI, I2C, SPI** (`platform`, `i2c`, `spi` buses): the
  devices that do something the user knows (an input device, a sensor, a
  network interface, a display, a camera, a sound card, Bluetooth), named by
  their compatible string (`of:N…T…Cgoodix,gt911`) or ACPI ID
  (`acpi:GDIX1001:`); the others only when the catalog has something for them.
- **The machine**: the device tree's root compatible strings and the DMI
  modalias, for board-specific packages; never sent in a report.
- **Missing firmware**: the kernel's "Direct firmware load for X failed"
  lines (`dmesg`, else `journalctl -k`), tied to the device that asked, minus
  files that have appeared in `/lib/firmware` since.

Each device's state: **working** (a driver is bound), **needs firmware**,
**needs a driver** (the catalog has one), **no driver** (nothing knows it),
**restart to finish**; and **optional driver available** for a working
device the catalog has an extra for.

### The driver catalog

The Marketplace's model ([APP-STORE.md](APP-STORE.md), 3.4 and 3.6): a static
JSON index any web host or mirror serves, signed with Ed25519
(`drivers.json`, `drivers.json.sig`, `key.json`), written by a small PHP tool
(`server/drivers/bin/drivers.php`) that uses the Marketplace's `.ipk` reader
and signer. Each entry maps hardware to packages:

```json
{"id": "firmware-rtw88", "kind": "firmware", "title": "Realtek Wi-Fi firmware (rtw88)",
 "match": ["usb:v0BDApC811d*", "pci:v000010ECd0000C821sv*"],
 "firmware": ["rtw88/rtw8821*.bin"], "modules": ["rtw88_8821cu"], "optional": false, "after": "reload",
 "license": {"id": "LicenseRef-rtlwifi-firmware", "name": "Realtek firmware licence", "text": "…",
             "url": "…", "free": false, "redistributable": true},
 "source": "https://git.kernel.org/…/linux-firmware.git",
 "packages": [{"name": "linux-firmware-rtl8821", "version": "20240909-r0", "arch": "all",
               "kernel": null, "url": "packages/…ipk", "size": 1234, "installedSize": 5678, "sha256": "…"}]}
```

`match` holds the kernel's own modalias globs (`modules.alias` syntax), so
an entry names its devices as its driver does; `firmware` (names or globs)
also matches a device whose driver asked for one of those files. `kind` is
`firmware`, `module` (an out-of-tree kernel module, built per kernel:
`kernel` must equal `uname -r`) or `service` (a user-space HAL or daemon,
reviewed by a person). Packages are picked per architecture (`arch`, or
`all`). The full format and the checks: [DRIVERS.md](DRIVERS.md).

**Trust: the same Ed25519 model as the Marketplace, with one change.**
Drivers install as root, so the driver catalog's key is **pinned in the
system image** (`/etc/palm/hardware/catalog.json`), not trusted on first use,
and the user cannot add driver catalogs (Developer Mode could, later; an
open question below). The device takes only an index signed with that key,
not expired, and not older than the last one it took (no rollback to an
index with a withdrawn driver), and installs only a package whose size and
SHA-256 are the signed ones. A catalog that fails is reported and the last
good one kept.

### Installing, and putting it back

`install {driverId, deviceId, acceptLicense}`, one at a time, also an
ongoing activity in the notification area:

1. **Licence**: not open source? The call needs the licence's id, which the
   app sends after the user has read it and tapped Accept and Install.
2. **Download and check** each package (size, SHA-256). Kept in
   `/var/lib/phoenix/hardware/packages` while installed, to roll back to.
3. **opkg install** (the image keeps opkg and its database:
   `package-management`). The service is the privileged part, as
   appinstalld is for apps: it runs as root, its methods are for `oem`
   clients (Settings and First Use) only.
4. **Activate**: `after: reload` unloads and loads the modules again (a driver
   asks for firmware when it probes); `rebind` unbinds and probes the device;
   then udev is asked to look again. `reboot`: the device says "Restart to
   finish", and the driver counts as started once the boot id changes.
5. **Check**: the device must now be working. If not, or if opkg failed:
   **roll back**: remove what was new, reinstall the previous version from
   the kept package, reload, and say "Your device was put back as it was."

`remove {driverId}` removes the packages and reloads (or asks for a restart).
A daily activity (and the first look after start-up) tells the user about
new hardware that needs something ("Realtek … needs firmware", opening
Settings > Hardware).

### The anonymous hardware report (opt-in)

Settings > Hardware > Unsupported hardware: off by default. When on, the
daily check sends, when it changed, **only the IDs** of devices nothing
drives (no driver, or needs something the catalog does not have): their bus,
modaliases and missing firmware names; the architecture and kernel version
(`6.6.23`). No device names, serial numbers, MAC or IP addresses, DMI or
board strings, account or device identifiers. "See What Is Sent" shows the
exact IDs and can send them once. The catalog service keeps them with the
day only (`POST /v1/report`, `data/reports.jsonl`); `drivers.php reports`
lists the devices no driver is for yet, most reported first, which is what
the people adding drivers work on next.

### For developers: publishing a driver

[DRIVERS.md](DRIVERS.md): write a manifest (`driver.json`), build the `.ipk`
(OE recipe, or `opkg-build`), run `drivers.php add` for the automatic checks
(files only where the kind allows, no install scripts but `depmod`, the
licence and its text, the firmware it names is there), a person reviews
(services always), and the catalog's maintainer publishes a signed build.
`meta-phoenix`'s `phoenix-driver-feed` does the first two steps for the
firmware OE builds.

### First boot

First Use has a **Hardware** step after Wi-Fi (so downloads work), shown
only when a device needs firmware or a driver the catalog has: each such
device, what it needs, and Install (the licence first). Optional extras
wait in Settings > Hardware. When the Wi-Fi itself needs firmware, the
offline routes above apply.

### Where it lives

| Piece | Where |
| --- | --- |
| The service (`org.webosphoenix.hardware`) | `services/hardware` (`hardwareservice.js`; device side `service.js`, `lib/sysfs.js`, `lib/node.js`; the Marketplace's Ed25519 code, kept identical by a test) |
| The app | Settings > Hardware (`apps/settings/src/pages/Hardware.tsx`, its own launch point, as webOS's preference panes were), First Use's step (`apps/firstuse`), `@phoenix/luna` `hardware` |
| The catalog | `server/drivers` (`drivers.php`, `public/router.php`); the simulator's signed sample catalog in `server/drivers/sample` |
| In the simulator | `runtime/phoenix-runtime.js` "Hardware and drivers": a simulated device (a Realtek dongle without its firmware, an RTL8812AU without its driver, an NVIDIA card with an optional firmware, a USB gadget nothing knows), opkg and kernel |
| Packaging | `meta-phoenix`: `recipes-kernel/linux` (fragments), `classes/phoenix-firmware-policy.bbclass`, `recipes-phoenix/phoenix-driver-feed` |
| Tests | `services/hardware/*.test.ts`, `apps/settings/src/pages/Hardware.test.tsx`, `server/drivers/tests/run.php`, `tools/test-hardware.cjs` |

**Why a Settings pane, not its own app:** webOS's preferences were one
launcher icon per pane, and Phoenix's Settings keeps that (launch points);
Hardware is one more pane with its own icon, so it is found where Wi-Fi,
Bluetooth and USB are, opened by its notification and its ongoing activity,
and shares Settings' look and code.

### Decisions for the owner

1. **Exceptions to "no firmware in the image".** Candidates: the GPU
   firmware a PC needs to show anything (AMD's `amdgpu`; without it the
   shell runs on the firmware framebuffer, slowly), the Wi-Fi firmware of
   reference devices (the Pi 4's), and phones' adaptation packages, which
   carry their own firmware. Each would go in `PHOENIX_FIRMWARE_IN_IMAGE`
   with a note here.
2. **The driver catalog's key and host**: who holds the key (offline, like
   the Marketplace's), and the address (`drivers.webosphoenix.org` is a
   placeholder in `/etc/palm/hardware/catalog.json`).
3. **Third-party driver catalogs**: never, or with Developer Mode on and the
   key shown (as the Marketplace does for app catalogs)?
4. **The report endpoint**: the same server as the Marketplace, and whether
   the counts are published (as linux-hardware.org does).
5. **Out-of-tree drivers** (RTL8812AU, xone, ...): build them in
   `meta-phoenix` per kernel and offer them, or only upstream drivers?

## Device tiers

### Support levels

Phoenix uses its own four levels, modelled on postmarketOS's
[device categories](https://wiki.postmarketos.org/wiki/Device_categorization):

| Level | Meaning | Who maintains it |
| --- | --- | --- |
| **Reference** | Built and boot-tested in CI for every release; all core features work; OTA updates | Core team, at least two maintainers |
| **Supported** | Built for every release; calls, texts, Wi-Fi, battery, suspend and camera work; known issues listed | A named maintainer |
| **Community** | Builds; boots to the shell; feature table on the wiki may have gaps | One community maintainer |
| **Experimental** | Someone got it booting | Anyone; no promises |

A device drops a level after one release without a maintainer.

### (a) webOS OSE targets

| Machine | Status in OSE | Notes |
| --- | --- | --- |
| `qemux86-64` | Official, the "emulator" image, run in VirtualBox or QEMU | Builds from the same `build-webos` Phoenix pins. Our CI and demo image |
| `raspberrypi4-64` | Official, "Raspberry Pi 4 with 4 GB or more" | With the official 7" touch display this is the cheapest real touch device. Our first hardware target |
| `raspberrypi3`, `raspberrypi3-64`, `raspberrypi4`, `qemux86` | Still listed as machines in `weboslayers.py` | The docs say OSE 2.x does not support the Pi 3. Not worth our time |
| Raspberry Pi 5 | **Not supported by OSE** | `meta-raspberrypi` has a Pi 5 machine, so a port is possible, but nobody has done it for OSE. Experimental at best |

The OSE release is **2.28.0 (27 March 2025)**: Yocto 5.0 scarthgap and
Qt 6.8.1, with Chromium 120 in the web runtime (`webosose/chromium120`).
`scripts/setup-build.sh` pins build-webos commit `ae3601d`, which is the
`v2.28.0` tag and, as of September 2026, still the head of `master`. Release
images are published for Raspberry Pi 4 64-bit and the VirtualBox emulator
only. Sources: [system requirements](https://www.webosose.org/docs/guides/setup/system-requirements/),
[building OSE](https://www.webosose.org/docs/guides/setup/building-webos-ose/),
[2.28.0 release](https://www.webosose.org/blog/2025/03/27/webos-ose-2-28-0-release/),
[build-webos releases](https://github.com/webosose/build-webos/releases).

**Risk: OSE has been quiet for 18 months.** There has been no release, blog
post or build-webos commit since March 2025. Scarthgap is supported until
April 2028, so we have time, but LuneOS has already moved its layers to
Yocto 6.0 "wrynose" (May 2026, supported to April 2030,
[announcement](https://www.yoctoproject.org/blog/2026/05/13/yocto-project-6-0-wrynose-is-here/))
with OSE 2.28 components rebased on top. If OSE does not move by the time
M3 starts, we should decide whether to build device images on LuneOS's
layer stack (`meta-webos-ports`) instead of `build-webos`. This is the
single largest open question in this plan.

### (b) Mainline Linux phones and tablets

postmarketOS is the source of truth for mainline device support. It renamed
itself **Nura** on 27 September 2026
([announcement](https://nura.eco/blog/2026/09/27/nura-rename/)); the wiki and
package names still say postmarketOS during the transition. Its "main"
category is **empty** at the moment (the project is rebuilding it with
hardware CI), so "community" is the best level any device has. In the
[v26.06 release](https://nura.eco/blog/2026/06/21/v26.06-release/) the
community category has about 40 devices, and 254 more are in "testing".

| Device | SoC, GPU driver | pmOS level (v26.06) | For Phoenix |
| --- | --- | --- | --- |
| **OnePlus 6 / 6T** | Snapdragon 845, Adreno 630 (freedreno) | Community | Best mainline phone: calls, data, GPU, suspend. Cameras are limited. 8 GB RAM is plenty for Chromium. **Reference candidate** |
| **Google Pixel 3a / 3a XL** | Snapdragon 670, Adreno 615 (freedreno) | Community | Also a Halium device (below). $50–80 used. **Reference candidate** |
| **PINE64 PinePhone Pro** | RK3399S, Mali-T860 (panfrost) | Community | Open hardware, LuneOS layer exists, 4 GB RAM. Modem (Quectel EG25-G) is well understood. Slow and poor battery. **Supported** |
| PINE64 PinePhone | Allwinner A64, Mali-400 (lima, OpenGL ES 2.0 only) | Community | 2–3 GB RAM and GLES 2 only: likely too slow for OSE's Chromium web runtime. Community at best |
| Purism Librem 5 | i.MX 8M Quad, GC7000L (etnaviv) | Community | Good mainline support, hardware kill switches, expensive. Community |
| SHIFT6mq | Snapdragon 845 | Community | Same SoC as the OnePlus 6, so it mostly comes for free. Community |
| Xiaomi Poco F1 | Snapdragon 845 | Community | Same again; common and cheap. Community |
| Fairphone 4 | Snapdragon 750G, Adreno 619 | Community | Sold new until recently, repairable. Supported candidate |
| Fairphone 5 | QCM6490, Adreno 643 | Testing (known brightness bug) | Better on Halium today (Ubuntu Touch's promoted device) |
| Samsung Galaxy S9 | Exynos/Snapdragon variants | Community | Check which variant before promising anything |
| PINE64 PineTab2 | RK3566, Mali-G52 (panfrost) | Testing | LuneOS supports it; a cheap 10" tablet. Community |
| Generic x86_64 | Any | Community | See (d) |
| Chromebooks (several families) | Various | Community | Good tablets/convertibles; later |

Kernels: pmOS's per-SoC trees (for example the SDM845 mainline kernel used by
the OnePlus 6, SHIFT6mq and Poco F1) and firmware packages are the upstream
we reuse. pmOS v26.06 also ships generic kernel packages
(`linux-postmarketos-{mainline,stable,lts}`) that cover many devices at once.

### (c) Android devices through Halium

Halium runs the device's Android vendor blobs (in an LXC container) for the
parts mainline Linux cannot drive, and bridges them to Linux through
libhybris (graphics, camera, sensors, audio HALs) and binder (radio). It is
how most people will get Phoenix onto a phone they already own.

| Project | Approach | Devices (Sept 2026) |
| --- | --- | --- |
| **LuneOS** (webOS-ports) | Yocto, `meta-smartphone` per-vendor layers; **one generic `halium-arm64` rootfs booting Halium 14 and 16 system images, with GKI kernels** where possible | Machines in [`meta-smartphone`](https://github.com/shr-distribution/meta-smartphone): Pixel 3a (`sargo`), Pixel 6a (`bluejay`), Pixel 7 (`panther`), BlackBerry KEY2 (`athena`), Xiaomi Mi A1 (`tissot`), Redmi Note 4 (`mido`), Redmi 5 Plus (`rosy`) and others, plus older Nexus 4/5 and the HP TouchPad. Testing images from September 2026 also cover the Pixel 4a 5G (`bramble`) and Pixel Tablet (`tangorpro`) ([releases](https://github.com/webOS-ports/luneos-testing/releases/)). Roughly 10 active devices |
| **Ubuntu Touch** (UBports) | Debian packaging, Halium 9–13, Lomiri shell; 24.04-2.0 released July 2026 | About 110 devices listed at [devices.ubuntu-touch.io](https://devices.ubuntu-touch.io/) across all maturity levels; the best are the Fairphone 4/5, Volla phones, Pixel 3a and several tablets. Not all run 24.04-2.0 yet |
| **Droidian** | Debian (now trixie) with Phosh on Halium; basis of FuriOS on the FuriLabs FLX1s phone | About 18 official devices and a handful unofficial per [LINMOB](https://linmob.net/droidian-project/); the live list is [devices.droidian.org](https://devices.droidian.org/). *Uncertain: we could not read the current count directly* |

What we reuse: LuneOS is the closest relative (Yocto, webOS services, Qt 6)
so its layers and device configs are the starting point. Ubuntu Touch and
Droidian are where the **device ports** are; their kernels, device trees and
Halium adaptations are the source for devices LuneOS lacks. The LuneOS team
also published a porting knowledge base
([luneos-porting-mcp](https://github.com/webOS-ports/luneos-porting-mcp))
covering GKI kernels, Halium GSIs and MediaTek ports.

Halium limits: Android kernels (often old), vendor blobs we cannot fix, and
libhybris graphics instead of Mesa. It is the right path for reach, not for
long-term quality; mainline is.

### (d) x86 tablets, 2-in-1s and generic UEFI

A generic x86-64 UEFI image is nearly free: OSE's `qemux86-64` is already
x86-64, and pmOS keeps "Generic x86_64" in its community category.

| Device | Notes |
| --- | --- |
| Microsoft Surface Go 1–3 | Touch and pen need the [linux-surface](https://github.com/linux-surface/linux-surface) kernel patches; cameras only partly work through libcamera (*uncertain per model*). 4–8 GB RAM. Good TouchPad-like tablet |
| Other Intel/AMD tablets and 2-in-1s | Mostly work with a mainline kernel; rotation through iio-sensor-proxy. Quality varies |
| x86 Chromebooks | In pmOS community; need developer mode and custom firmware for UEFI boot |
| Any PC or VM | The demo image. Mouse and keyboard work; gestures need a touchscreen or the simulator's key bindings |

Image: a `genericx86-64`-style machine (or meta-intel's `intel-corei7-64`)
producing a UEFI disk image with systemd-boot, installable from USB.

### (e) Keyboard phones (the Pre's spirit)

Checked 29 September 2026. All are MediaTek or Qualcomm Android phones, so
they are Halium targets (tier c), not mainline. Square screens (720x720,
1440x1440) need the phone layout checked at that shape, and a built-in
keyboard makes the hardware keyboard work ([spec/GAPS.md](spec/GAPS.md) V8)
a must.

| Device | SoC, RAM | Bootloader | Status | For Phoenix |
| --- | --- | --- | --- | --- |
| **Zinwa Q25** (BlackBerry Classic restomod) | Helio G99, 12 GB | **Unlocked** from the factory | Shipping since late 2025 (~$400, or a ~$300 kit for your own Classic); Ubuntu Touch offered | **First keyboard target.** LuneOS already has a machine config (`q25`) |
| **Minimal Phone 2** (QWERTY, 3.92" 1080x1240 AMOLED, 90 Hz) | Dimensity 8300, 8 GB (12 GB founders edition) | Unlockable (per the Kickstarter FAQ) | Due December 2026 | Good candidate. The first Minimal Phone (E Ink, MediaTek) has a LuneOS config (`mp01`); E Ink would need a low-refresh mode |
| **BlackBerry KEY2** | Snapdragon 660, 6 GB | *Check per unit* | Used market only | LuneOS config (`athena`) |
| **Unihertz Titan 2 / Titan 2 Elite** | Dimensity 7300 / 7400 / 8400, 12 GB | *Not confirmed*; ask Unihertz | Titan 2 shipped October 2025; Elite June and October 2026 | Candidate once unlocking is confirmed |
| **Clicks Communicator** | Dimensity 8300, 12 GB, Android 17 | *Not announced*; users have asked | Due Q4 2026 | Candidate only if Clicks allows unlocking; worth asking them directly |
| F(x)tec Pro1-X (slider) | Snapdragon 662 | Unlocked, built for LineageOS and Ubuntu Touch | Shipped late and in small numbers; availability unclear | Community level at best |
| Planet Computers Astro Slide | Dimensity 800 | Multi-boot by design | Few units ever shipped | Not a target |

### (f) Phones sold for Linux

Checked 29 September 2026. These makers expect other operating systems, so
unlocking, documentation and a buying audience that likes to try things
come with the phone. The mainline ones (PinePhone family, Librem 5,
Fairphone 4/5) are in tier (b).

| Device | SoC, RAM | Runs today | Status | For Phoenix |
| --- | --- | --- | --- | --- |
| **Volla Phone X23** / **Quintus** / **22** | Snapdragon 778G+ 8 GB / Helio G85 6 GB / Snapdragon 680 4 GB | Volla OS, Ubuntu Touch, Droidian; **multi-boot** | Shipping (€450-€720) | Halium; multi-boot means Phoenix can sit next to the owner's OS. Strong candidate |
| **FuriLabs FLX1** / **FLX1s** | Snapdragon 778G+ 8 GB / Dimensity 900 8 GB, kill switches | FuriOS (Debian on Halium) | Shipping ($550) | LuneOS has a config for the FLX1s (`radon`) |
| **Jolla Phone** (2025) and Jolla C2 | *not checked* | Sailfish OS | Shipping (€649) | Halium-style; check unlocking |
| **Liberux NEXX** | RK3588S, 8-32 GB | LiberuxOS (Debian, mainline) | Crowdfunding; delivery promised July 2026, first product of a new company | Would be mainline and powerful if it ships |
| **ClockworkPi uConsole** | Raspberry Pi compute modules (ARM or RISC-V), 1-4 GB | Debian, Raspberry Pi OS | Shipping ($139-$209, 4G add-on) | A keyboard handheld; the Pi image covers it |

### (g) Small tablets and handhelds for local AI

Checked 29 September 2026. There is no open 5-6" tablet with a fast chip
and lots of RAM; the closest things are Android gaming handhelds whose makers
publish mainline Linux work, and x86 pocket PCs. For a local LLM, RAM decides
the model size (16 GB fits a 7-8B model at Q4 comfortably; 32 GB a 30B
mixture-of-experts model) and memory bandwidth decides the speed. Speeds
below are estimates until measured ([AI-AND-MCP.md](AI-AND-MCP.md)).

| Device | Screen | SoC, RAM | Linux | For Phoenix |
| --- | --- | --- | --- | --- |
| **AYN Odin 2 Mini** / **Odin 2 Portal** | 5" / 7" OLED | Snapdragon 8 Gen 2, 8-16 GB by model | AYN published its mainline kernel work; ROCKNIX runs on the family; the Portal's device tree was posted to the kernel list (March 2026) | **Best small candidate**: the fastest ARM chip with mainline Linux in reach, freedreno GPU, no modem (a tablet) |
| **GPD MicroPC 2** | 7" | Intel N300/N350, 16 GB | Standard x86 Linux | Covered by the generic x86 image; modest AI speed |
| **GPD Pocket 4** | 8.8" (mini laptop, twisting screen) | Ryzen AI 9 HX 370, up to 64 GB LPDDR5X-7500 | Standard x86 Linux | The strongest local-AI device that fits a pocket; generic x86 image; a desktop-mode (2.0) machine as much as a tablet |
| Liberux NEXX (phone) | 6.34" | RK3588S, up to 32 GB | Mainline, Debian | See (f): most RAM of any Linux phone if it ships |

### Devices we will not target

- **Original Palm/HP hardware** (Pre, Veer, TouchPad): 512 MB–1 GB RAM and
  32-bit SoCs cannot run OSE's Chromium runtime. LuneOS keeps the TouchPad
  alive; that is the place for it. Revisit the TouchPad (1 GB) once the light
  profile's minimum is measured.
- **LG webOS TVs**: a different product with its own signed firmware.
- **Anything with a locked bootloader.**

## Hardware abstraction plan

The apps talk to Luna services. For each area: the Linux component we use,
the Luna API the apps need, what OSE already has, and the adapter work.
"Legacy" means the Palm `com.palm.*` API from Open webOS / LuneOS; "OSE" means
the `com.webos.*` services in the
[LS2 API index](https://www.webosose.org/docs/reference/ls2-api/ls2-api-index/).

OSE's device layer is **nyx** (`nyx-lib` plus modules). OSE's
[`nyx-modules`](https://github.com/webosose/nyx-modules) only have battery,
charger, display, GPS, device info, OS info, security and system; LuneOS's
fork adds ambient light, haptics, keys, LED controller, torch and touch panel
modules, plus a hybris variant for Halium. Porting those modules is the
cheapest way to back several legacy APIs at once.

| Area | Linux component | Luna API to back | In OSE today? | Adapter work |
| --- | --- | --- | --- | --- |
| **Modem, calls, SMS** | **[oFono](https://git.kernel.org/pub/scm/network/ofono/ofono.git)**; on Halium with [ofono-binder-plugin](https://github.com/mer-hybris/ofono-binder-plugin) and libgbinder. ModemManager as fallback on mainline | Legacy `com.palm.telephony` (calls, SMS, network status), db8 `com.palm.smsmessage`, plus the Phoenix call-state additions listed in [APP-RUNTIME.md](APP-RUNTIME.md#phone-and-messaging) | **No.** `com.webos.service.hfp` is Bluetooth hands-free only | Port LuneOS's [`webos-telephonyd`](https://github.com/webOS-ports/webos-telephonyd) (oFono) and add call state. ConnMan's oFono plugin gives mobile data with no extra work. If a mainline modem (e.g. SDM845's QRTR modem) works badly under oFono, add a ModemManager backend to telephonyd rather than switching stacks. Droidian's [oFono2MM](https://github.com/droidian/oFono2MM) shows the reverse bridge is possible if we ever need MM-only tools. Also: `lpac` for eSIM (LuneOS ships it), cell broadcast alerts |
| **VoLTE, VoWiFi and IMS** | On Halium, the vendor's IMS stack in the Android container, reached through oFono's binder plugin *(which devices work is unverified)*; on mainline, no working open IMS stack yet | Same `com.palm.telephony` calls; no new API | **No** | Required: carriers have switched off 3G, so calls on many networks need VoLTE. Check VoLTE per reference device before choosing it. The IMS registration is shared with RCS ([SYNERGY-MODERN.md](SYNERGY-MODERN.md#22b-rcs)), which needs its own open client either way |
| **Audio routing, in-call audio** | PulseAudio (what OSE's `audiod-pro` and [`pulseaudio-webos`](https://github.com/webosose/pulseaudio-webos) are built on); [callaudiod](https://gitlab.com/mobian1/callaudiod) for call routing on mainline; `pulseaudio-modules-droid` on Halium | Legacy `com.palm.audio`; OSE `com.webos.service.audio` (volumes, streams, feedback sounds) | Yes for media and system sounds. No voice-call audio policy | Keep PulseAudio for M3 (audiod depends on it; LuneOS does the same). Add a voice-call stream type and routing (earpiece, speaker, headset, Bluetooth HFP) to audiod, driven by telephonyd call state; on mainline delegate the UCM profile switch to callaudiod. PipeWire/WirePlumber (with its PulseAudio compat) is a later migration, only when OSE or LuneOS moves |
| **Camera** | [libcamera](https://libcamera.org/) on mainline; `droidmedia` + `gst-droid` on Halium (both in LuneOS's layer) | OSE `com.webos.service.camera2` and `com.webos.pipeline.camera`; the apps use `getUserMedia` in the web runtime | Yes, for V4L2/UVC cameras | Phone cameras are not simple V4L2 devices. Mainline: a camera2 HAL plugin on libcamera, or route Chromium's capture through libcamera's V4L2 compatibility layer (*uncertain which is less work*). Halium: a gst-droid source. Expect camera to lag every other area |
| **Sensors** | [iio-sensor-proxy](https://gitlab.freedesktop.org/hadess/iio-sensor-proxy) on mainline; [sensorfw](https://github.com/sailfishos/sensorfw) (Sailfish OS, Ubuntu Touch) with its hybris adaptor on Halium | Legacy `com.palm.ambientLightSensor`, orientation and acceleration events to apps, proximity during calls | **No sensor service** (nyx-lib defines the light, proximity and orientation interfaces; OSE's nyx-modules implement none of them) | **Light: done** in `phoenix-devices` (below), straight from IIO (`in_illuminance_input` / `_raw` × `_scale`). Still to do: orientation and acceleration (QtSensors in the shell for rotation; the legacy accelerometer events), proximity during calls. On Halium, sensorfw instead of IIO. Note: iio-sensor-proxy exposes orientation, light, proximity and compass, not raw acceleration or steps; sensorfw on Halium does expose a step counter |
| **GPS** | [GeoClue](https://gitlab.freedesktop.org/geoclue/geoclue) (with ModemManager/oFono or gpsd for the GNSS source) | Legacy `com.palm.location`; OSE `com.webos.service.location`; `navigator.geolocation` in the web runtime | Yes: OSE's location service has GPS and network handlers, and nyx has a GPS module | Write a nyx GPS module (or location handler) that reads GeoClue. On Halium, a hybris GNSS module (LuneOS has one). Wire Chromium's geolocation provider to the same service |
| **Wi-Fi** | ConnMan + wpa_supplicant/iwd | OSE `com.webos.service.wifi`, `com.webos.service.connectionmanager` (webos-connman-adapter) | **Yes** | None beyond firmware. Settings already codes against these |
| **Bluetooth** | BlueZ | OSE `com.webos.service.bluetooth2` | **Yes** | Check profiles on phones: HFP for calls (with oFono's HFP support or `com.webos.service.hfp`), A2DP, HID |
| **VPN** | ConnMan `connman-vpnd` (OpenVPN, WireGuard) | Legacy `com.palm.app.vpn` pane; LuneOS `com.webos.service.vpn` | Partly (ConnMan has it; webos-connman-adapter does not expose it) | Use LuneOS's [`luneos-vpn-adapter`](https://github.com/webOS-ports/luneos-vpn-adapter) (Apache-2.0), which Settings > VPN already codes against (the simulator reimplements it); build it and `connman-vpnd` with the OpenVPN, WireGuard, OpenConnect, vpnc and L2TP plugins into the image |
| **Power, suspend, battery** | Kernel power_supply, [UPower](https://upower.freedesktop.org/), systemd-logind/`systemctl suspend` | Legacy `com.palm.power` (`batteryStatusQuery`), sleep/activity wakeups; OSE `com.webos.service.power2`, `com.webos.service.sleep`, `com.webos.service.alarm`, `com.webos.service.activitymanager` | Partly: power2 does power states, wake locks, shutdown and reboot, but **no battery status**; nyx has battery and charger modules | Battery service on nyx battery/charger (or UPower) that answers the legacy API and feeds the status bar. Opportunistic suspend: a policy service using wake locks, suspend on screen off, wake on modem ring, RTC alarm and power key. This is the hardest non-camera item on phones |
| **Display and backlight** | sysfs `backlight` class; DRM/KMS for panel on/off | Legacy `com.palm.display`; OSE `com.webos.settingsservice` `picture.backlight` | **No**: `picture.backlight` is a stored setting, OSE's nyx display module only reads the framebuffer's size and DPI, and no OSE service (power2, sleepd, luna-surfacemanager) has a display state or `com.palm.display` | **Done** in `phoenix-devices` (below): `com.palm.display` from the shell's own display state (`Display.qml`), the backlight through `/sys/class/backlight` (`bl_power` with it off), auto-brightness from the light sensor. Still to do: the panel's own power (DPMS) with the screen off, which luna-surfacemanager has no API for; proximity during calls |
| **Touch** | evdev/libinput through Qt's Wayland compositor | None (compositor input) | Yes | Per-device calibration and palm rejection only. Gesture area: on phones with no capacitive gesture strip, reserve the bottom edge of the touchscreen (already how the simulator works) |
| **Haptics** | The kernel's force-feedback input devices (`FF_RUMBLE`, the mainline vibrator drivers), the LED class's `vibrator` with the transient trigger, Android's `timed_output`; [feedbackd](https://source.puri.sm/Librem5/feedbackd) on mainline distros | Legacy `com.palm.vibrate`; OSE nothing | **No** (nyx-lib has `NYX_DEVICE_HAPTICS`; OSE's nyx-modules do not implement it) | **Done** in `phoenix-devices` (below), on those three kernel interfaces. On Halium, the Android vibrator HAL: LuneOS's `luna-haptics` over its nyx-modules-hybris haptics module instead |
| **Keyboard and IME** | Maliit, which OSE's `com.webos.service.ime` and webOS keyboard are built on; hardware keyboards through evdev | OSE `com.webos.service.ime`; Wayland `text-input` | Yes (TV-oriented keyboard) | The Phoenix keyboard as a Maliit plugin: [The keyboard as the input method](#the-keyboard-as-the-input-method-gaps-v5) |
| **Notification LED** | Kernel LED class via feedbackd | Legacy: the core navi pulse and the `blinkNotifications` preference | No (LuneOS has a nyx LED controller module) | Drive the LED from notification state; blink on new notifications when the screen is off |
| **Torch** | Kernel LED class: the flash LED's `/sys/class/leds/<name>/brightness` (a `*torch*` node, else `*flash*`, or the one named in `/etc/nyx.conf`); on `LEDS_CLASS_FLASH` devices `brightness` is the torch current and `flash_brightness`/`flash_strobe` are left alone; Qualcomm `qpnp-flash-v2` also needs its `led:switch*` node; MediaTek has `/dev/flashlight` ioctls | LuneOS `org.webosports.service.torch` (torchd: `getStatus {subscribe}`, `set {on \| brightness}`, `toggle`); none in legacy webOS or OSE | No (LuneOS has torchd and a nyx `led_torch` module, both Apache-2.0) | Use LuneOS's torchd and nyx `led_torch` module as they are (`meta-phoenix/recipes-bsp/torchd`, a stub). The Flashlight app and QR Scanner call it; the simulator implements the same API. No system menu toggle (the original system menu had none) |
| **Fingerprint** | [fprintd](https://fprint.freedesktop.org/) on mainline (few phone sensors supported); Android biometrics HAL on Halium (Droidian's approach) | None in legacy webOS | No | A PAM/lock-screen integration after PIN lock works. Low priority |
| **Hardware keys, switches** | evdev (power, volume, ringer switch on devices that have one, headset jack) | Legacy `com.palm.keys` (switches, headset, media keys) | **No** (no OSE service; the compositor gets the keys, never the switches) | **Done** in `phoenix-devices` (below), from evdev, found by their capabilities and followed as they come and go (a USB or Bluetooth headset's media keys, a USB keyboard, a dock: inotify on `/dev/input` and the kernel's uevents); the shell still handles Power and volume itself |

### Device configuration

What the shell needs to know about a device's hardware that it cannot
detect comes from `/etc/phoenix/device.json`, installed by the device's
layer in `meta-phoenix` (or the file named by `PHOENIX_DEVICE_CONFIG`). A
missing file or key means the default. Read by `Phoenix.Native`'s
`DeviceConfig`.

| Key | Default | Meaning |
| --- | --- | --- |
| `hardwareHomeButton` | `false` | The device has a Home button (physical or capacitive) that its maker uses **instead of** the on-screen gesture bar. The shell then hides the bar, the key does its job (`Key_Home`), and tablets take the bottom-edge flick for swipe up. |
| `backlight` | the first under `/sys/class/backlight` by the kernel's preference (`type` firmware, then platform, then raw) | The panel's backlight, by name (`phoenix-devices`), for a device with several where that picks the wrong one. |
| `lightSensor` | the first IIO device with illuminance | The light sensor's IIO device, e.g. `"iio:device1"` (`phoenix-devices`). |
| `ringerSwitch` | none (the ringer is always on) | The ringer switch: `{"type": "EV_SW" \| "EV_KEY", "code": n, "silentValue": 1}`, the input event code it sends and its value when silent. Linux has no code of its own for it (`SW_MUTE_DEVICE`, 14, is the nearest; OnePlus's alert slider sends keys), so each device names its own (`phoenix-devices`). `phoenix-devices --probe` points at any device with `SW_MUTE_DEVICE` and prints the line to add. |

Phoenix keeps the gesture bar on every phone and tablet by default,
including the TouchPad, whose Home button was a step back from the Pre's
gesture area: a device goes without the bar only when its maker chooses
the button. The bar is on the screen, so it follows the UI to the bottom
as the device turns.

### LunaSysMgr's device services (phoenix-devices)

The apps of webOS 1-3 call four services LunaSysMgr itself registered
(luna-sysmgr `README.md:24-128`): `com.palm.display`, `com.palm.keys`,
`com.palm.vibrate` and `com.palm.ambientLightSensor`. webOS OSE has none of
them, nor the hardware behind them: nyx-lib (webosose/nyx-lib) declares
haptics, keys and light-sensor devices, but OSE's nyx-modules only build
battery, charger, display (the framebuffer's size), GPS, device and OS
info, security and system; meta-webosose has no haptics, sensor or keys
service; `com.webos.service.mediaindexer` indexes media files, and
`com.webos.service.tv.display` is LG's TV platform, not OSE. So Phoenix
has its own: **`phoenix-devices`** (`services/devices`, C++ on
luna-service2 and GLib like `services/pty`; `meta-phoenix`'s
`phoenix-devices` recipe, in `webos-phoenix-image`), with luna-sysmgr's
requests, replies, events and error texts (each cited in the source). The
display's state is the shell's (`Display.qml`, as in the simulator); the
service owns the rest. In the simulator each page's runtime answers the
same API (`runtime/phoenix-runtime.js`, "LunaSysMgr's device services"),
over the shell's `DeviceServices.qml`.

| Service | In the simulator | On a device | Not done |
| --- | --- | --- | --- |
| `com.palm.display` `status`, `control/status`, `setState`, `getProperty`, `setProperty` | The shell's display (on, dimmed, off; its timeout; what keeps it on; dock mode) and its events. `setState` is the shell's (on, dimmed, off, unlock as the padlock, dock, undock). `requestBlock` holds the display on, locked or not (the Clock while an alarm rings); `powerKeyBlock` gives Power to the app; timeout, `maximumBrightness` and `onWhenConnected` are the system's preferences | The shell reports its display to `com.palm.display/phoenix/report` and hears the apps on `/phoenix/requests` (only `com.webos.surfacemanager` may call them; `LsmWindowSource`). The service sets the backlight (`/sys/class/backlight/*/brightness`, `bl_power`) from the shell's level | Proximity (`proximityEnabled` is counted, nothing senses); the panel's power (DPMS); the original's lower brightness on a low battery (`DisplayManager.cpp:2053-2062`) |
| `com.palm.keys` `audio`, `media`, `headset`, `switches` | Volume (F10, F11), Power (F3) and media keys; the headset in or out (Ctrl+Shift+H) and its button (Ctrl+Shift+B: click, double click within a second; hold is the device's); the ringer switch (Ctrl+Shift+R; down mutes); `switches/status {get}` | evdev: `KEY_VOLUMEUP`/`DOWN`, `KEY_POWER`, the media keys, `KEY_MEDIA` (a wired headset's button), `SW_HEADPHONE_INSERT` and `SW_MICROPHONE_INSERT`, the ringer's code from `device.json`; `LsmSystemStatus` follows the ringer and headset | The slider (no device has one; it reads closed); a USB or Bluetooth headset's arrival is not a "headset" in (only a jack's switch is: the audio route is PulseAudio's) |
| `com.palm.vibrate` `vibrate`, `vibrateNamedEffect` | Every vibration (an app's, a banner's "vibrate") is counted (`SystemSounds.vibrations`); the window shakes under "Vibrating: …" for as long as it lasts | The first of: a force-feedback device (`EV_FF`, `FF_RUMBLE`), `/sys/class/leds/vibrator` with the transient trigger, `/sys/class/timed_output/vibrator`. The named effects' lengths are Phoenix's (the Castle's were its haptics driver's) | `period` is taken but not pulsed; no device without one of the three (Halium: `luna-haptics`) |
| `com.palm.ambientLightSensor` `control/status` | A simulated light (Ctrl+Shift+L: 1, 50, 300, 20000 lux) and its region; automatic brightness (`enableALS`) dims the screen in dim and dark light | IIO `in_illuminance_input`, or `_raw` × `_scale`, read every 0.5 s while the display is on, with AmbientLightSensor's ten-reading regions | The sensor's own rates (nyx's fast and slow report rates) |

What it still needs on a device, and the owner's call:

- **ACG.** `sysbus/` gives the status, keys, vibrate and light-sensor
  methods to every app (`dev`) and the display's control methods to `oem`
  apps; `org.webosphoenix.devices.shell.perm.json` lets
  luna-surfacemanager call them. Whether an original app (no
  `requiredPermissions`) gets `dev` on OSE is the same open question as
  for every legacy service. *Unverified on a device.*
- **Root.** It runs as root under systemd with `ProtectSystem=strict`,
  because the backlight, LED and `/dev/input` nodes are root's on an OSE
  image. udev rules giving a `phoenix-devices` account those nodes would
  let it drop root.
- **LuneOS's daemons instead.** [LUNEOS.md](LUNEOS.md) suggests reusing
  LuneOS's `luna-displaymanager` (`com.palm.display` and
  `com.palm.ambientLightSensor`: luna-sysmgr's eight-state display machine
  split out, Apache-2.0) and `luna-haptics` (`com.palm.vibrate` over nyx).
  Phoenix did not, for now: `luna-displaymanager` owns the display's state
  itself, where Phoenix's shell does (so the shell would become its client
  on a device, and the simulator and device would differ), and it needs
  LunaSysMgrCommon, Qt Widgets and Sensors, luna-prefs and LuneOS's nyx
  module forks, none of which OSE has; neither serves `com.palm.keys`.
  `luna-haptics` plus LuneOS's nyx haptics modules is the better choice on
  Halium, where only the Android HAL drives the motor.
- **QEMU.** `qemux86-64` has none of this hardware: the service then
  reports no backlight, vibrator or light sensor (vibrate answers "Unable
  to vibrate", as luna-sysmgr did without haptics), and QEMU's keyboard
  device gives the volume and media keys. `PHOENIX_DEVICES_ROOT` points it
  at a fake `/sys` to try it there.

#### Finding the hardware, and following it

Nothing in `phoenix-devices` names a device. It finds the hardware the
way the kernel describes it (`services/devices/src/hardware.cpp`):

- **Input devices** by what they can do: each `/dev/input/eventN`'s
  name, bus and capability bitmaps from sysfs
  (`/sys/class/input/eventN/device/{name,id/bustype,capabilities/*}`,
  the kernel's `input_print_bitmap` format), or from the device itself
  (`EVIOCGBIT`) where sysfs does not have them. It opens the ones with a
  headset jack (`SW_HEADPHONE_INSERT`, `SW_MICROPHONE_INSERT`), the
  ringer's code, or one of the keys it reports (volume, Power, the media
  keys, `KEY_MEDIA`), whatever their driver or bus: the built-in
  `gpio-keys`, a codec's jack, a USB headset, a USB keyboard's media keys,
  BlueZ's AVRCP device for a Bluetooth headset.
- **The backlight** from `/sys/class/backlight` (the kernel's preferred
  `type` first), **the vibrator** from the first of a force-feedback
  device, the LED class's `vibrator`, `timed_output`, and **the light
  sensor** from the first IIO device with illuminance.

**Hotplug.** Two sources, no libudev: inotify on `/dev/input` (devtmpfs
makes and removes the event nodes; `IN_ATTRIB` covers udev setting a
node's permissions after it appears), and the kernel's uevents on a
`NETLINK_KOBJECT_UEVENT` socket (group 1, the kernel's own messages, sent
by port 0) for what has no node and gives sysfs no inotify events: an IIO
sensor, a backlight, an LED or `timed_output` vibrator. OSE images run
systemd's udevd, so libudev is there, but reading the kernel's messages
needs no library, and phoenix-devices only uses them as a cue to look
again. A burst of events (a device's input and event nodes, several
uevents) is one rescan when the main loop is idle. A rescan opens the
devices that came, closes the ones that went (an event node reused by
another device counts as a new one; an fd that hangs up is a device that
went), replaces the backlight, vibrator or light sensor if they changed
(a new backlight gets the display's level; the light sensor starts over
or stops), and re-reads the switches: a switch no device has any more is
off, so a headset jack that goes with its device sends the headset "up"
to `com.palm.keys/headset`. One read's events go together, so a headset
plugged in, which reports its jack and its microphone at once, is one
`headset-mic` "down", as luna-sysmgr's single `Key_HeadsetMic` was.

**The log.** At start-up it logs each part and every event device with
what it can do and whether it is used, and on each change what came or
went, to the journal:

```
phoenix-devices: input /dev/input/event0 "gpio-keys" (host): keys volume_up, volume_down, power [used]
phoenix-devices: input /dev/input/event1 "Synaptics TM2" (i2c): touchscreen [not used]
phoenix-devices: hotplug: inotify on /dev/input; kernel uevents
phoenix-devices: hotplug: /dev/input/event4 created
phoenix-devices: input added /dev/input/event4 "Jabra EVOLVE 20" (usb): keys volume_up, togglePausePlay, next, prev [used]
```

**`phoenix-devices --probe`** prints the same, plus `device.json`, the
headset jack and hints (a `SW_MUTE_DEVICE` that may be the ringer, with
the line to add), and exits without touching anything (no LED trigger
set, no vibrator taken): the first command to run on a new phone.
`PHOENIX_DEVICES_ROOT` runs it against a copied `/sys` and `/dev`.

Tests: `build/devices/devices-test` (the logic, the hardware against a
fake sysfs and `/dev` whose event devices are FIFOs carrying real
`input_event`s, devices appearing and going while the service runs,
`--probe` through the service's own `main` (`phoenix-devices-stub`),
every method over the luna-service2 stand-in;
`services/common/ls2stub`), `shell/tests/tst_deviceservices.qml`,
`apps/shared/luna/src/device.test.ts`, `tools/test-device-services.cjs`.

### The keyboard as the input method (GAPS V5)

How webOS OSE's input method works (webosose/maliit-framework-webos,
webosose/ime-manager, luna-surfacemanager):

1. Apps (WAM's Chromium, Qt apps through `qtwayland-webos`) speak webOS's
   own Wayland text protocol (`wl_text_model`, webos-wayland-extensions).
   luna-surfacemanager receives it (`WaylandTextModel`,
   `modules/weboscompositor/input/`) and relays it to the one Wayland
   client bound to its `input_method` interface (`WaylandInputMethod`,
   `WaylandInputMethodContext`), whose input panel it shows.
2. That client is `maliit-server` (maliit-framework-webos, run by
   `maliit-server.service`; its Wayland connection is
   `connection/minputcontextwestonimprotocolconnection.cpp`). It loads
   input method plugins from `/usr/lib/maliit/plugins`
   (`MALIIT_DEFAULT_PLUGIN=libplugin-global.so` in the OSE recipe) and
   keeps the active one in its settings (`maliit/onscreen/active`,
   `mimonscreenplugins.cpp`).
3. OSE's keyboard is `ime-manager`'s `maliit-plugin-global`: a C++
   `Maliit::Plugins::InputMethodPlugin` whose `MAbstractInputMethod`
   shows a `QQuickView` of QML (`plugin/keyboard.cpp` loads
   `qml/view-global/main.qml`), registered with the host
   (`registerWindow`), and types with the host's `sendCommitString`,
   `sendPreeditString` and `sendKeyEvent`; it reads the field's
   `contentType`, `enterKeyType` and `surroundingText` from the host.
4. `com.webos.service.ime` (maliit-framework-webos `src/imelunaservice.cpp`)
   is only for remote keyboards (`registerRemoteKeyboard`, `insertText`,
   `deleteCharacters`, `sendEnterKey`); the on-screen keyboard does not
   use it.

The plan (V5's route, chosen with V7): **`phoenix-keyboard`, a Maliit
plugin installed beside OSE's**, made active in `maliit/onscreen/active`:

- `services/keyboard` (C++, Qt 6, linked against maliit-framework-webos's
  `maliit-plugins`): `PhoenixKeyboardPlugin : InputMethodPlugin` and
  `PhoenixInputMethod : MAbstractInputMethod`, which shows a `QQuickView`
  loading `/usr/share/phoenix/qml` and a small wrapper,
  `Phoenix/Keyboard/MaliitKeyboard.qml`, around the shell's own
  `VirtualKeyboard.qml`. That component already has the narrow interface
  this needs (`editorState` in; `keyTyped`, `textCommitted`,
  `hideRequested`, `feedback`, `keyboardSelected` out), so it does not
  change.
- The wrapper's adapter: `textCommitted` → `sendCommitString`;
  `keyTyped` (Backspace, Enter, the arrows of cursor control) →
  `sendKeyEvent`; `hideRequested` → `notifyImInitiatedHiding`; the
  keyboard's height → `setInputMethodArea` and `setScreenRegion`; the
  field's `contentType` and `enterKeyType` (Maliit's
  `Maliit::TextContentType`, `EnterKeyType`) → its PalmIME
  `editorState`; `surroundingText` for prediction and auto-capitals;
  `feedback` → audiod's `playFeedback`. Dictation keeps calling
  `org.webosphoenix.transcriber` over the bus.
- The shell needs no change for the panel: on a device it already draws
  no keyboard of its own (`Shell.virtualKeyboard` is false there) and
  makes room for the input method's panel, shown in luna-surfacemanager's
  stock `KeyboardView` (`platformKeyboardHeight` in
  `shell/qml/WebOSCompositor/views/PhoenixViewsRoot.qml`), whichever
  plugin draws it.
- Settings > Text Assist writes the same preferences the keyboard reads in
  the simulator; the plugin reads them from the system service.
- To check on OSE first: that maliit-server finds a second plugin and
  switches to it by its settings key, and that a Qt 6 `QQuickView` plugin
  loads the Phoenix QML module path (`QML_IMPORT_PATH`) in maliit-server.

The other route, luna-surfacemanager answering the text protocol itself
(its `WaylandTextModel` exports `commitString`, `preEditString` and
`keySym`), would put the keyboard in the shell's process as in the
simulator, but means rebuilding the keyboard switching and the hardware
keyboard handling Maliit already has (V7 settled it).

## Graphics

- **Mainline: Mesa.** freedreno for Adreno (OnePlus 6, Pixel 3a, SHIFT6mq,
  Poco F1, Fairphone 4/5), panfrost for Mali Midgard/Bifrost (PinePhone Pro,
  PineTab2), etnaviv for Vivante (Librem 5), lima for Mali-400 (PinePhone,
  GLES 2 only), v3d on the Raspberry Pi 4, virtio-gpu in QEMU. OSE already
  builds Mesa for the Pi, so this path needs no new architecture.
- **Halium: libhybris.** The Android EGL/GLES drivers run through libhybris,
  and Qt's Wayland compositor uses the hwcomposer for output. LuneOS runs its
  Qt 6 compositor this way, so the recipes exist; Chromium's GPU process on
  libhybris is the part most likely to break (*uncertain until tried*).
- **Compositor:** `luna-surfacemanager` is a Qt 6 Wayland compositor and the
  Phoenix shell is its QML. The same QML runs on either graphics path; only
  the Qt platform plugin (`eglfs`/`wayland-egl` on KMS vs. hwcomposer)
  differs, set per machine in `meta-phoenix`.
- **RAM:** OSE recommends 4 GB on the Pi. Plan for 4 GB as the practical
  minimum for phones; 2–3 GB devices get "Community" at most.
- **The assistant's share:** `packagegroup-phoenix-assistant` adds about
  270 MB to the image (whisper's base.en model 148 MB, the wake word's Vosk
  model 71 MB and library 7-26 MB, `whisper-cli`, `llama-server`, Flite).
  The on-device language model is downloaded later, 0.5 to 2.5 GB by the
  device's memory (2, 4 or 8 GB; AI-AND-MCP.md, "What's installed where").
  A 2-3 GB community image can take whisper's tiny.en instead.

## Distribution and updates

### Images

One image per machine, built by `webos-phoenix-image` with a machine
config. Output formats follow the bootloader: `.wic` disk images (Pi, x86,
PinePhone family), Android `boot.img` plus a `rootfs.img` for fastboot
devices, and a flashable zip for Halium devices (the LuneOS convention).

### Installer

- **Desktop installer:** the [UBports Installer](https://github.com/ubports/ubports-installer)
  is driven by per-device YAML configs and already knows how to detect,
  unlock and flash most of these phones. Contribute Phoenix entries to its
  config repository if its maintainers agree (*to be asked*); fork it only
  if they do not.
- **Browser installer:** a WebUSB page using fastboot in JavaScript (the
  approach of Android's and GrapheneOS's web flashers) for fastboot devices,
  so nobody needs to install anything to try Phoenix.
- **SD card / USB:** Raspberry Pi Imager and balenaEtcher for `.wic` images.

### OTA with A/B updates

webOS OSE once had an OTA client (`com.webos.service.swupdater`, a hawkBit
client) but retired it in OSE 2.16, so there is **no OTA in OSE today**
([swupdater](https://github.com/webosose/com.webos.service.swupdater)).

| Option | Yocto support | Fit |
| --- | --- | --- |
| **[RAUC](https://rauc.io/)** | [`meta-rauc`](https://github.com/rauc/meta-rauc) has scarthgap and later branches | **Recommended.** Image-based A/B, signed bundles, adaptive (delta) updates, bootloader backends for U-Boot, GRUB, barebox, EFI and custom scripts, D-Bus API a Luna service can wrap. No server required: a static HTTPS feed works; hawkBit if we ever want one |
| [SWUpdate](https://swupdate.org/) | `meta-swupdate` has scarthgap | Good second choice; strong hawkBit support. More configuration, less opinionated A/B story |
| [Mender](https://mender.io/) | `meta-mender` | Works, but tied to the Mender server model; heavier than we need |
| systemd-sysupdate | In systemd | Worth watching: it fits OSE's systemd base, and postmarketOS's immutable variant [Duranium](https://postmarketos.org/blog/2026/03/17/introducing-duranium/) does A/B with dm-verity and EROFS. *We have not confirmed which updater Duranium uses* |

Plan: a read-only root (EROFS or squashfs, later dm-verity), two root slots,
`/var` and `/home` on a data partition, RAUC bundles signed in CI, and the
Settings > Updates pane talking to a small Luna service over RAUC.

The service is written: `services/updates`, `com.palm.update` (Palm's update
daemon's name and API, which luna-systemui's update alerts still use), over
RAUC's command line (`rauc status`, `info`, `install`, `status mark-active`).
The feed is static JSON per device type and channel (`server/updates`). See
[APP-RUNTIME.md](APP-RUNTIME.md#system-updates). Still to do per device: the
slot layout in `system.conf`, the bootloader backend, the keyring, and
`rauc-mark-good` after a good start.

### Bootloader constraints

| Device family | Boot | A/B implication |
| --- | --- | --- |
| Raspberry Pi 4 | Pi firmware + `tryboot` or U-Boot | RAUC has a documented Pi setup |
| x86 UEFI | systemd-boot or GRUB | Standard RAUC EFI/GRUB backend |
| PinePhone, PinePhone Pro, PineTab2 | U-Boot or Tow-Boot | Standard U-Boot backend |
| Qualcomm phones (OnePlus 6, Pixel 3a, Fairphone) | Android ABL with fastboot; Android A/B slots on most | Either use the Android slots (`qbootctl`-style slot switching as a RAUC custom backend) or chain-load U-Boot/lk2nd and manage slots ourselves (Duranium avoids Android slots) |
| Halium devices | Android bootloader, Android A/B or single slot | Same as above; vendor partitions stay untouched |

Bootloader unlocking is a hard limit: carrier-locked US phones (for example
Verizon Pixels) cannot be unlocked and are out.

## Build

- **Layers:** `meta-phoenix` on OSE's `build-webos`, plus per-family BSP
  layers:
  - [`meta-raspberrypi`](https://github.com/agherzan/meta-raspberrypi) (already in OSE)
  - [`meta-pine64-luneos`](https://github.com/webOS-ports/meta-pine64-luneos) (PinePhone, PinePhone Pro, PineTab2; has a scarthgap branch) and [`meta-pine64`](https://github.com/alistair23/meta-pine64) (PineTab2 and boards; now declares styhead to wrynose only)
  - [`meta-qcom`](https://github.com/qualcomm-linux/meta-qcom) for Qualcomm firmware and tooling, with SDM845/SM7225/QCM6490 kernels taken from the postmarketOS device packages
  - [`meta-smartphone`](https://github.com/shr-distribution/meta-smartphone) (`meta-android` for Halium, and vendor layers `meta-google`, `meta-xiaomi`, `meta-blackberry`, ...) and LuneOS's `meta-luneos` recipes for libhybris, ofono-binder-plugin, droidmedia, gst-droid, pulseaudio-modules-droid
- **Layer series:** OSE is scarthgap; several of these layers have moved to
  wrynose. Pin scarthgap branches where they exist, and carry backports in a
  `meta-phoenix-bsp` layer where they do not.
- **Build host:** x86-64 only, as today (see [BUILDING-MAC.md](BUILDING-MAC.md)).
- **Parse check, no build host needed:** `scripts/parse-check.sh [MACHINE...]`
  (default `qemux86-64 raspberrypi4-64`) sets up `build-webos` at the pinned
  commit, clones its layers without history (about 200 MB), adds `meta-phoenix`, and for each machine runs `bitbake -p`
  (parse every recipe) and `bitbake -n webos-phoenix-image` (a dry run that
  resolves the whole task graph, including every `RDEPENDS`, and runs
  nothing; the `torchd` stub is resolved too). Nothing
  is fetched (`BB_NO_NETWORK`) or built. Each machine adds about 300 MB
  and about 12 minutes on 4 cores. The build directory is
  `${TMPDIR:-/tmp}/webos-phoenix-parse` unless `PHOENIX_PARSE_DIR` says
  otherwise; delete it afterwards. Host packages beyond a stock Ubuntu
  24.04: `gawk diffstat chrpath cpio zstd lz4` and the `en_US.UTF-8`
  locale. bitbake will not run as root; in a root-only container use
  `unshare --user --map-user=1000 --map-group=1000 scripts/parse-check.sh`.
  On Ubuntu 24.04 hosts (GitHub's runners included) AppArmor stops
  unprivileged programs from creating user namespaces, which BitBake needs
  ("User namespaces are not usable by BitBake"); the CI job lifts that with
  `sysctl kernel.apparmor_restrict_unprivileged_userns=0` on its throwaway
  runner, as the Yocto manual suggests. **To harden later:** an AppArmor
  profile that grants `userns` to BitBake alone, and the same for build hosts
  that aren't throwaway.

### Device CI matrix

| Job | Machines | When |
| --- | --- | --- |
| Parse and resolve (`bitbake -p`, `bitbake -n`): **exists**, `.github/workflows/parse.yml` | `qemux86-64`, `raspberrypi4-64` today; every Reference and Supported machine as its BSP layers are added | Every PR |
| Full image build (shared sstate) | `qemux86-64`, `raspberrypi4-64` | Every merge to main |
| Boot test in QEMU (reach the card view, run app smoke tests) | `qemux86-64` | Every merge |
| Full image build | Phone machines (Pixel 3a mainline and Halium, OnePlus 6, PinePhone Pro) | Nightly |
| Hardware-in-the-loop boot test | Reference devices on a USB relay / fastboot rig, as postmarketOS is building | Nightly, once we have the rig (M3) |
| Release images, signed RAUC bundles | All Reference and Supported | Each release |

The parse job (`scripts/parse-check.sh`, see Build above) catches recipes
that do not parse, missing `DEPENDS`/`RDEPENDS` providers, wrong
`bbappend` targets and layer-series mismatches. It cannot catch what only
shows when sources arrive: a wrong `LIC_FILES_CHKSUM` md5, a `SRC_URI` or
`SRCREV` that does not exist upstream, a missing `file://` file (bitbake
only notes its absence while parsing) or a compile error. Those wait for the
full build. PinePhone Pro, the one Supported phone, is not in it yet: its
BSP (`meta-pine64-luneos`, scarthgap branch) needs `meta-rockchip` and
`meta-arm`, and its machine pulls `sensorfw`, `qtsensors-sensorfw-plugin`,
`eg25-manager`, `linux-firmware-pine64` and `initramfs-uboot-image` from
LuneOS's own layers (`meta-webos-ports`), which are built for the `luneos`
distro rather than OSE's `webos`.

## Community and adoption

- **Porting guide** (`docs/PORTING.md`, to write in M3): machine config,
  kernel and firmware sources, the nyx modules and services a device needs,
  a feature checklist that maps to the support levels, and how to submit.
  Model it on LuneOS's porting docs and pmOS's device wiki pages.
- **Device support table:** a generated page (from machine metadata in
  `meta-phoenix`) showing level, maintainer and a per-feature status grid,
  like [devices.ubuntu-touch.io](https://devices.ubuntu-touch.io/).
- **Partners:**
  - **webOS-ports / LuneOS**: the natural partner. Same heritage, same
    services, device layers we depend on. Offer our Luna service work
    (telephony call state, sensors, battery) upstream; check licences
    before copying their shell code ([ROADMAP.md](ROADMAP.md#related-projects)).
  - **postmarketOS / Nura**: upstream kernels and firmware; report and fix
    device bugs there, not in private patches.
  - **UBports and Droidian/FuriLabs**: Halium device ports and the installer.
  - **webOS Archive and the homebrew community**: the
    [App Museum II](https://appcatalog.webosarchive.org/) catalog and
    Preware are how legacy webOS users find software today; Phoenix should
    install their `.ipk` apps (see [APP-GAPS.md](APP-GAPS.md)). webOS
    Archive also ships **webOS Community Edition 3.1** (September 2026), a
    patched HP webOS 3.0.5 for the TouchPad with a community App Catalog
    back end, Preware feeds, libpurple Synergy and the LunaCE launcher. Its
    users are the fans Phoenix 1.x is for, and its catalog back end is what
    the store's Classics phase needs. How CE, LuneOS, OSE and Phoenix
    differ: [WEBOS-FAMILY.md](WEBOS-FAMILY.md).
- **Demo for people without spare hardware:**
  1. the desktop simulator (works today),
  2. the `qemux86-64` image packaged for VirtualBox and QEMU/UTM (M1),
  3. a Raspberry Pi 4 image for the official 7" touchscreen (M1),
  4. a browser demo: the web apps already run in a browser with
     `runtime/phoenix-runtime.js`; the QML shell could follow with Qt for
     WebAssembly (*untested*). Added to an iPad's Home Screen it is also a
     touch development device ([ROADMAP.md](ROADMAP.md#development-devices)),
  5. a native iPad app through TestFlight, and an ARM64 image for UTM on
     Apple silicon Macs (same section).

## Timeline

Phases line up with the roadmap milestones. Quarters are indicative and
assume a small volunteer team.

| Phase | Milestone | Target | Hardware work |
| --- | --- | --- | --- |
| 1 | **M1** OSE boot | Q4 2026 – Q1 2027 | `qemux86-64` boots Phoenix in CI; Raspberry Pi 4 + 7" display; VirtualBox demo image; status bar on OSE services (Wi-Fi, Bluetooth); battery service on nyx |
| 2 | M2 parity | Q1 – Q2 2027 | Portrait and rotation on the Pi display; RAUC A/B on Pi and x86; generic x86-64 UEFI image (Surface Go as test tablet) |
| 3a | **M3** first phone | Q2 – Q3 2027 | OnePlus 6 and Pixel 3a on mainline: display, touch, backlight, battery, sensors, haptics, suspend; CI builds nightly |
| 3b | M3 telephony | Q3 – Q4 2027 | webos-telephonyd on oFono, call audio (audiod + callaudiod), SMS, mobile data through ConnMan; PinePhone Pro |
| 3c | M3 Halium | Q4 2027 – Q1 2028 | Generic `halium-arm64` image from LuneOS's work; Pixel 3a (Halium), Fairphone 5, Pixel 6a/7; camera through gst-droid |
| 4 | M3 reach | 2028 | Installer (UBports config + WebUSB), porting guide, device table, hardware CI rig; decision on scarthgap vs. wrynose before scarthgap's April 2028 end of life |

## Open questions

- Stay on `build-webos` (scarthgap, quiet since March 2025) or follow
  LuneOS's wrynose layer stack for devices?
- oFono on SDM845's QRTR modem: good enough, or do mainline phones need the
  ModemManager backend from the start?
- Chromium (web runtime) GPU acceleration on libhybris: does it work with
  OSE's Chromium 120 as it does with LuneOS's?
- Can we share one Luna service implementation with LuneOS instead of
  keeping two?
- How low can the light profile go: the minimum RAM for the classic UI with
  OSE's web runtime, and whether 32-bit ARM is worth building for?
- Does `fastboot boot` of a Phoenix image work on the reference phones, for
  "try before installing"?
