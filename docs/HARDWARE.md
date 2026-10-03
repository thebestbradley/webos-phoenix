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

**On the device: a hardware check that heals.** A `org.webosphoenix.hardware`
service runs at first boot and after each update:

1. Probe each part through its backend (modem through oFono, sensors
   through iio-sensor-proxy or sensorfw, the camera, vibration, the LED,
   the torch, suspend and resume).
2. Turn on the backends that answer and record the rest in `device.json`
   terms, so the shell and Settings hide what the device lacks instead of
   showing switches that do nothing.
3. Fetch missing firmware or an updated adaptation package from the feed
   when one exists (the driver manager above, on phones).
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
| **Sensors** | [iio-sensor-proxy](https://gitlab.freedesktop.org/hadess/iio-sensor-proxy) on mainline; [sensorfw](https://github.com/sailfishos/sensorfw) (Sailfish OS, Ubuntu Touch) with its hybris adaptor on Halium | Legacy `com.palm.ambientLightSensor`, orientation and acceleration events to apps, proximity during calls | **No sensor service** | A small Phoenix service (`org.webosphoenix.sensors`, with the legacy names as aliases) over either backend, and QtSensors in the shell for rotation. Note: iio-sensor-proxy exposes orientation, light, proximity and compass, not raw acceleration or steps; sensorfw on Halium does expose a step counter |
| **GPS** | [GeoClue](https://gitlab.freedesktop.org/geoclue/geoclue) (with ModemManager/oFono or gpsd for the GNSS source) | Legacy `com.palm.location`; OSE `com.webos.service.location`; `navigator.geolocation` in the web runtime | Yes: OSE's location service has GPS and network handlers, and nyx has a GPS module | Write a nyx GPS module (or location handler) that reads GeoClue. On Halium, a hybris GNSS module (LuneOS has one). Wire Chromium's geolocation provider to the same service |
| **Wi-Fi** | ConnMan + wpa_supplicant/iwd | OSE `com.webos.service.wifi`, `com.webos.service.connectionmanager` (webos-connman-adapter) | **Yes** | None beyond firmware. Settings already codes against these |
| **Bluetooth** | BlueZ | OSE `com.webos.service.bluetooth2` | **Yes** | Check profiles on phones: HFP for calls (with oFono's HFP support or `com.webos.service.hfp`), A2DP, HID |
| **VPN** | ConnMan `connman-vpnd` (OpenVPN, WireGuard) | Legacy `com.palm.app.vpn` pane; LuneOS `com.webos.service.vpn` | Partly (ConnMan has it; webos-connman-adapter does not expose it) | Use LuneOS's [`luneos-vpn-adapter`](https://github.com/webOS-ports/luneos-vpn-adapter) (Apache-2.0), which Settings > VPN already codes against (the simulator reimplements it); build it and `connman-vpnd` with the OpenVPN, WireGuard, OpenConnect, vpnc and L2TP plugins into the image |
| **Power, suspend, battery** | Kernel power_supply, [UPower](https://upower.freedesktop.org/), systemd-logind/`systemctl suspend` | Legacy `com.palm.power` (`batteryStatusQuery`), sleep/activity wakeups; OSE `com.webos.service.power2`, `com.webos.service.sleep`, `com.webos.service.alarm`, `com.webos.service.activitymanager` | Partly: power2 does power states, wake locks, shutdown and reboot, but **no battery status**; nyx has battery and charger modules | Battery service on nyx battery/charger (or UPower) that answers the legacy API and feeds the status bar. Opportunistic suspend: a policy service using wake locks, suspend on screen off, wake on modem ring, RTC alarm and power key. This is the hardest non-camera item on phones |
| **Display and backlight** | sysfs `backlight` class through logind; DRM/KMS for panel on/off | Legacy `com.palm.display`; OSE `com.webos.settingsservice` `picture.backlight` | Partly (TV-style backlight setting; nyx display module) | Map the settings value to the real panel backlight, add auto-brightness from the light sensor, and panel off/on with the lock screen and proximity sensor |
| **Touch** | evdev/libinput through Qt's Wayland compositor | None (compositor input) | Yes | Per-device calibration and palm rejection only. Gesture area: on phones with no capacitive gesture strip, reserve the bottom edge of the touchscreen (already how the simulator works) |
| **Haptics** | [feedbackd](https://source.puri.sm/Librem5/feedbackd) (event-based themes, LED and vibra) | Legacy `com.palm.vibrate`; OSE nothing | **No** | Map `com.palm.vibrate` and the shell's feedback events to feedbackd; on Halium use the Android vibrator HAL (feedbackd has no hybris backend, so the LuneOS nyx haptics module instead) |
| **Keyboard and IME** | Maliit, which OSE's `com.webos.service.ime` and webOS keyboard are built on; hardware keyboards through evdev | OSE `com.webos.service.ime`; Wayland `text-input` | Yes (TV-oriented keyboard) | Phone and tablet layouts in the webOS style (M2 item), prediction, and later swipe typing (see [APP-GAPS.md](APP-GAPS.md)) |
| **Notification LED** | Kernel LED class via feedbackd | Legacy: the core navi pulse and the `blinkNotifications` preference | No (LuneOS has a nyx LED controller module) | Drive the LED from notification state; blink on new notifications when the screen is off |
| **Torch** | Kernel LED class: the flash LED's `/sys/class/leds/<name>/brightness` (a `*torch*` node, else `*flash*`, or the one named in `/etc/nyx.conf`); on `LEDS_CLASS_FLASH` devices `brightness` is the torch current and `flash_brightness`/`flash_strobe` are left alone; Qualcomm `qpnp-flash-v2` also needs its `led:switch*` node; MediaTek has `/dev/flashlight` ioctls | LuneOS `org.webosports.service.torch` (torchd: `getStatus {subscribe}`, `set {on \| brightness}`, `toggle`); none in legacy webOS or OSE | No (LuneOS has torchd and a nyx `led_torch` module, both Apache-2.0) | Use LuneOS's torchd and nyx `led_torch` module as they are (`meta-phoenix/recipes-bsp/torchd`, a stub). The Flashlight app and QR Scanner call it; the simulator implements the same API. No system menu toggle (the original system menu had none) |
| **Fingerprint** | [fprintd](https://fprint.freedesktop.org/) on mainline (few phone sensors supported); Android biometrics HAL on Halium (Droidian's approach) | None in legacy webOS | No | A PAM/lock-screen integration after PIN lock works. Low priority |
| **Hardware keys, switches** | evdev (power, volume, ringer switch on devices that have one, headset jack) | Legacy `com.palm.keys` (switches, headset, media keys) | Partly (nyx keys module in LuneOS) | Port the keys module; the shell handles power and volume |

### Device configuration

What the shell needs to know about a device's hardware that it cannot
detect comes from `/etc/phoenix/device.json`, installed by the device's
layer in `meta-phoenix` (or the file named by `PHOENIX_DEVICE_CONFIG`). A
missing file or key means the default. Read by `Phoenix.Native`'s
`DeviceConfig`.

| Key | Default | Meaning |
| --- | --- | --- |
| `hardwareHomeButton` | `false` | The device has a Home button (physical or capacitive) that its maker uses **instead of** the on-screen gesture bar. The shell then hides the bar, the key does its job (`Key_Home`), and tablets take the bottom-edge flick for swipe up. |

Phoenix keeps the gesture bar on every phone and tablet by default,
including the TouchPad, whose Home button was a step back from the Pre's
gesture area: a device goes without the bar only when its maker chooses
the button. The bar is on the screen, so it follows the UI to the bottom
as the device turns.

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

### Device CI matrix

| Job | Machines | When |
| --- | --- | --- |
| Parse and resolve (`bitbake -p`, `--check`) | All Reference and Supported machines | Every PR |
| Full image build (shared sstate) | `qemux86-64`, `raspberrypi4-64` | Every merge to main |
| Boot test in QEMU (reach the card view, run app smoke tests) | `qemux86-64` | Every merge |
| Full image build | Phone machines (Pixel 3a mainline and Halium, OnePlus 6, PinePhone Pro) | Nightly |
| Hardware-in-the-loop boot test | Reference devices on a USB relay / fastboot rig, as postmarketOS is building | Nightly, once we have the rig (M3) |
| Release images, signed RAUC bundles | All Reference and Supported | Each release |

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
