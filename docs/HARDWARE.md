# Hardware and drivers

How webOS Phoenix gets onto as many real devices as possible: which devices
to target, how the legacy webOS services are backed by standard Linux
components, and how images are built, installed and updated.

This is a plan, not a status report. Nothing here has run on a device yet
(see [ROADMAP.md](ROADMAP.md), Milestone 1). Facts are as of September 2026
(the first targets below: 11 October 2026); where something is uncertain it
says so.

## First targets

The owner's choice (11 October 2026): the emulator and the Raspberry Pi 4,
which OSE supports itself, then a flagship phone, a tablet, and the PINE64
devices because people already have them. Each has a machine in
`meta-phoenix` now; none has been built or booted yet.

| Target | Role | SoC, GPU | RAM | Route | Boots from | `MACHINE` | Kernel (pinned) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QEMU / VirtualBox | Emulator, CI, demo | x86-64, virtio-gpu (virgl) | any | OSE's own machine | OSE's `.wic`/`.vmdk` | `qemux86-64` | OSE's `linux-yocto` |
| **Raspberry Pi 4** + Touch Display 2 (7") | First hardware | BCM2711, V3D | 4 GB+ | OSE's own machine | SD card | `raspberrypi4-64` | OSE's `linux-raspberrypi` |
| **Fairphone (Gen. 6) / (Gen. 6+)** | Flagship phone | SM7635 / SM7635-AC ("milos"), Adreno 810 | 8 GB / 12 GB | Mainline; Halium if audio and camera lag | Android boot image (fastboot) + `userdata` | `fairphone-fp6` | milos-mainline `v7.2.0-milos`, `1b485d5` |
| **AYN Odin 2 Portal** | Tablet (7" OLED) | QCS8550 (Snapdragon 8 Gen 2), Adreno 740 | 8, 12 or 16 GB | Mainline (AYN's tree, going upstream) | microSD through ROCKNIX's bootloader | `ayn-odin2portal` | AYNTechnologies `ayn/v7.0`, `d0bd123` |
| **PINE64 PinePhone Pro** | Linux phone people own | RK3399S, Mali-T860 (panfrost) | 4 GB | Mainline (megi's tree) | Tow-Boot (SPI) → SD or eMMC | `pinephonepro` | megi `orange-pi-7.2-20260903-2131`, `facc871` |
| PINE64 PineTab2 | Cheap 10" tablet | RK3566, Mali-G52 (panfrost) | 4 / 8 GB | Mainline + DanctNIX's patches | U-Boot (SPI) → SD or eMMC | `pinetab2` | DanctNIX `v7.1.8-danctnix1`, `344dbbd` |
| ARM64 VM | Each target above before its hardware ([Device VMs](#device-vms)) | QEMU `virt`, virtio-gpu (virgl where the host has it) | the device's | OSE's `qemuarm64` with the phones' packages | QEMU's or UTM's kernel boot, ext4 root | `phoenix-vm-arm64` | OSE's `linux-yocto` 6.6, qemuarm64 BSP |
| GPD Pocket 4 | x86 alternative (8.8") | Ryzen AI 9 HX 370, Radeon 890M | up to 64 GB | The generic x86-64 UEFI image | USB / NVMe (UEFI) | none yet: the generic x86-64 machine of [(d)](#d-x86-tablets-2-in-1s-and-generic-uefi) (`qemux86-64` is QEMU's, not a PC image) | the x86 `linux-yocto` with `phoenix-hardware-x86.cfg`, `amdgpu` firmware |

**Future: Fairphone 7.** Not announced; only a teaser from Fairphone's CEO
so far. Fairphone has supported mainline from launch day for two
generations (Luca Weiss posted the Fairphone 6's support the day it was
announced), so the next one is a natural target when it exists.

### What is in meta-phoenix

- **Machines** (`meta-phoenix/conf/machine/`): `fairphone-fp6`,
  `ayn-odin2portal`, `pinephonepro`, `pinetab2`, and the ARM64 VM that
  stands in for each of them, `phoenix-vm-arm64` ([Device VMs](#device-vms)), all on
  `conf/machine/include/phoenix-mobile.inc` (webOS's "hardware" machine
  implementation and `webos-graphics-drm`, as meta-webosose's
  `webos-rpi.inc` sets for the Pi). They need **no BSP layer** beyond OSE's:
  each kernel is a recipe of ours; no meta-qcom (its scarthgap branch is
  built around Qualcomm's own Linux releases and boards, not these phones'
  community trees), no meta-rockchip/meta-arm, no LuneOS layer (its
  machines pull `meta-webos-ports` recipes built for the `luneos` distro;
  [Device CI matrix](#device-ci-matrix)). The PINE64 machine names are
  LuneOS's (`meta-pine64-luneos`, scarthgap `9b16114`), so its recipes can
  be reused where their licences allow. `scripts/setup-build.sh` adds the
  machines to build-webos's `Machines` list (mcf refuses others).
- **Kernels** (`recipes-kernel/linux/linux-phoenix-*.bb`, on
  `linux-phoenix-device.inc`): the device distribution's tree at a pinned
  commit, with **that distribution's own configuration** (postmarketOS/Nura
  pmaports `2116628` for the Fairphone and PINE64; ROCKNIX `20261001`
  for the Odin), then Phoenix's generic driver fragments
  (`phoenix-hardware*.cfg`, never demoting the device's built-ins to
  modules) and `phoenix-ose.cfg` (systemd, Chromium's sandbox, OSE's own
  kernel fragments: PSI, zram, uinput, audit, the crypto user API, the
  netfilter connman tethers with). Licence: GPL-2.0-only, `COPYING`'s md5
  checked against each tree.
- **Boot artefacts:** `phoenix-bootimg` (an Android boot image, header v2,
  made by AOSP's `mkbootimg`, `recipes-devtools/mkbootimg`, Apache-2.0,
  tag `android-16.0.0_r1`) for the Fairphone; `wic/phoenix-extlinux.wks.in`
  (GPT: a FAT boot partition with the kernel, the device trees and the
  machine's `extlinux.conf`, then the ext4 root, found by
  `root=PARTLABEL=phoenix-root` without an initramfs) for the others.
- **Device configuration** (`recipes-phoenix/phoenix-device-config`, in
  every image): `/etc/phoenix/device.json` and the compositor's geometry
  per machine ([Device configuration](#device-configuration)).
- **Firmware:** linux-firmware's redistributable packages per machine
  (`MACHINE_EXTRA_RRECOMMENDS`); the rest [below](#firmware-the-phone-brings).
- **Media:** OSE's GStreamer media stack is built only for OSE's own
  machines (per-machine resource tables), so on these WebAppMgr's Chromium
  plays media itself (`phoenix-mobile.inc`; OPEN-QUESTIONS Q87).
- **Graphics:** these GPUs need a newer Mesa than OSE's 24.0.7 (Q82).

### Per device: what works today

"Works" is what the device's own distribution reports, not Phoenix: none of
this has run Phoenix. Y works, P partly, N not, - not applicable or not
reported. Sources: the Nura (postmarketOS) wiki's device pages, read raw on
11 October 2026; ROCKNIX's device pages.

| Component | Fairphone 6 / 6+ | Odin 2 Portal | PinePhone Pro | PineTab2 |
| --- | --- | --- | --- | --- |
| Display | Y | Y (ROCKNIX's Sway UI runs on it) | Y | Y |
| Touch | Y | in the device tree (FocalTech FT5426); not documented | Y | Y |
| GPU (3D) | Y (needs Mesa 26: Adreno gen 8) | Y (freedreno GL, Turnip Vulkan) | Y | Y |
| Wi-Fi | P | Y | Y | P (out-of-tree BES2600) |
| Bluetooth | Y | Y (audio, controllers) | Y | P |
| Battery, charging | Y | battery level shown (stick LEDs); not documented further | P | Y |
| Modem: data / SMS / calls | Y / Y / P | - | Y / P / P | - |
| Audio (speakers, headset) | N | not documented (amplifiers and codec in the device tree) | Y | Y |
| Camera | N (an experimental ultra-wide stack exists) | - | P | - |
| GPS | N | - | Y | - |
| Sensors | Hall Y; accelerometer, light, proximity N | not documented | accelerometer, light, proximity Y | accelerometer Y |
| Haptics | Y | Y (rumble) | - | - |
| Suspend | not reported | "fake suspend" only (ROCKNIX) | not reported | not reported |
| USB | P (SoC page) | USB-C dual role in the device tree | OTG N | not reported |

Sources: Fairphone: [Nura wiki, "Fairphone (Gen. 6) (fairphone-fp6)"](https://wiki.postmarketos.org/wiki/Fairphone_(Gen._6)_(fairphone-fp6))
and ["Qualcomm Snapdragon 7s Gen 3/7s Gen 4/6 Gen 4 (Milos)"](https://wiki.postmarketos.org/wiki/Qualcomm_Snapdragon_7s_Gen_3/7s_Gen_4/6_Gen_4_(Milos))
(SoC: display, GPU, storage, Wi-Fi, Bluetooth, modem, video Y; USB P;
audio, GPS, camera N); the ultra-wide camera:
[nondescriptpointer/fairphone6-wide-camera-linux](https://github.com/nondescriptpointer/fairphone6-wide-camera-linux)
(not checked). Odin: [ROCKNIX, Odin 2 Portal](https://rocknix.org/devices/ayn/odin2portal/)
(Wi-Fi, Bluetooth, fan, rumble, stick LEDs; suspend is ROCKNIX's "fake
suspend"); the device tree (AYN `ayn/v7.0`) for the rest. PINE64: the Nura
wiki's PinePhone Pro and PineTab 2 pages.

**Where each stands:**

- **Fairphone 6 / 6+.** Verified: Fairphone's Luca Weiss posted the SoC
  and device support the day the phone was announced
  ([Phoronix, 25 June 2025](https://www.phoronix.com/news/Fairphone-6-Linux)),
  renamed "milos" at Qualcomm's request in v2
  ([Phoronix](https://phoronix.com/news/Fairphone-6-Linux-v2)); the device
  tree `milos-fairphone-fp6.dts` is in Linux's master today. The working
  tree is [milos-mainline/linux](https://github.com/milos-mainline/linux)
  (tags `vX.Y.Z-milos`), which pmaports' `linux-postmarketos-qcom-milos`
  builds. pmaports keeps `device-fairphone-fp6` in **`device/testing`**
  (not community, as first reported to the owner), with prebuilt images and
  a web flasher. The **6+** (August 2026: Snapdragon 7s Gen 4, SM7635-AC,
  12 GB, same display and cameras) has no device tree of its own: the Nura
  wiki says the two are "software-compatible, so you can install the Nura
  image on either model". One machine covers both.
- **Odin 2 Portal.** AYN publishes its mainline work as
  [AYNTechnologies/linux](https://github.com/AYNTechnologies/linux)
  (branch `ayn/v7.0`, Linux 7.0, with `qcs8550-ayn-odin2portal.dts` and the
  panel, gamepad, LED and amplifier drivers mainline lacks); the initial
  port is Teguh Sobirin's for ROCKNIX. Aaron Kling posted the device trees
  upstream as "arm64: dts: qcom: Support AYN QCS8550 Devices": v1 in March
  2026 (as this document said), **v9 on 27 July 2026**
  ([lkml](https://lkml.iu.edu/2607.3/06614.html)), without the nodes whose
  drivers are not upstream; not in Linux 7.3-rc6. ROCKNIX builds kernel.org
  7.2 plus its own patches and device trees for its SM8550 image; Phoenix
  takes AYN's tree (one pinned commit, the drivers included) with ROCKNIX's
  configuration. postmarketOS has no Odin 2 package (only the original
  Odin and the Odin 3).
- **PinePhone Pro.** pmaports' **community** device; Tow-Boot in SPI is
  required ([tow-boot.org](https://tow-boot.org/devices/pine64-pinephonePro.html)).
  Modem: Quectel EG25-G, powered by `eg25-manager` (GPL-3.0) and driven by
  ModemManager in pmOS; Phoenix's telephony plan is oFono
  ([Hardware abstraction plan](#hardware-abstraction-plan)), which
  supports the EG25-G as LuneOS does. Camera through libcamera (Megapixels
  in pmOS).
- **PineTab2.** Testing; Wi-Fi only with DanctNIX's out-of-tree BES2600
  driver and its firmware.

**Performance, honestly.** The Fairphone 6 (8-12 GB) and the Odin 2 Portal
(8-16 GB, the fastest ARM chip here) have room for OSE's Chromium web
runtime and the on-device assistant. The PinePhone Pro (4 GB, RK3399) will
run Phoenix but slowly: each card is a Chromium renderer (60-120 MB each,
PRE-IMAGE-CHECKLIST P1). The PineTab2 sits between them. The original
PinePhone (2-3 GB, Cortex-A53, GLES 2.0 only) is no longer a target (the
owner's decision, 11 October 2026: keep the PinePhone Pro); it was probably
too slow for OSE's Chromium-based WebAppMgr anyway.

### Bring-up order (every device)

1. **Boot to a console**: kernel, root, serial or USB networking
   (`phoenix-diag`, ssh in a pre-release image).
2. **Display, touch, GPU**: luna-surfacemanager on KMS with a hardware
   Mesa; the geometry (`compositor.env`), density and form factor
   (`device.json`); the card view at full frame rate.
3. **Wi-Fi and Bluetooth**: connman and BlueZ (OSE's), the firmware.
4. **Modem, calls, SMS** (phones): oFono and `webos-telephonyd`; mobile
   data through connman.
5. **Audio**: PulseAudio/audiod with the device's ALSA UCM profile; in-call
   routing.
6. **Camera**: libcamera (Fairphone: the ultra-wide only, experimental).
7. **GPS**: GeoClue (Qualcomm: through the modem's QMI location service).
8. **Suspend**: wake on modem, RTC alarm, power key; battery life.

**Halium fallback for the Fairphone.** If audio and camera stay broken on
mainline when telephony works, the Fairphone can run Phoenix on Halium as
LuneOS and Ubuntu Touch run other phones (tier (c) below: the Android
vendor partition's HALs through libhybris). Ubuntu Touch supports the
Fairphone 4 and 5 that way; whether a Fairphone 6 Halium port exists is
not checked. Decide after step 5 ([OPEN-QUESTIONS.md](OPEN-QUESTIONS.md)).

### Unlocking and flashing, step by step

Build first: `bitbake webos-phoenix-image` with the machine
(`MACHINE=fairphone-fp6`, ...), on an x86-64 Linux host ([Build](#build)).
The images land in `BUILD/deploy/images/<machine>/`.

**Fairphone 6 / 6+** (wipes the phone)

1. Update Fairphone OS to the latest release first (the Nura wiki: work is
   done against the latest firmware).
2. Settings > About phone: tap Build number seven times; Developer options:
   turn on USB debugging and **OEM unlocking**, which asks for Fairphone's
   **unlock code**: get it from Fairphone's bootloader page with the
   phone's IMEI and serial number
   ([Fairphone support, "Manage the bootloader"](https://support.fairphone.com/hc/en-us/articles/10492476238865);
   that page refused our reader, so the code's exact form is the owner's
   to check).
3. Power off; hold **Power + Volume Down** for fastboot. Then
   `fastboot flashing unlock` and confirm on the phone. **This erases the
   phone.** Critical partitions need not be unlocked (Nura wiki); some
   users report Fairphone's tools wanting `fastboot flashing
   unlock_critical` as well.
4. **Never re-lock.** Re-locking with a system whose security patch level
   is older than the bootloader's has soft-bricked phones and needed
   Fairphone's service to recover (community reports:
   [Fairphone forum](https://forum.fairphone.com/t/fairphone-6-oem-bootloader-soft-bricked/132109),
   [/e/ forum](https://community.e.foundation/t/unable-to-lock-the-bootloader-fairphone-6-e-installation/84282)).
   Also never switch the A/B slot with `qbootctl` from Linux: the Nura
   wiki warns it bricks the phone until an EDL repair only Fairphone's
   service can do.
5. Firmware (the phone's own, see below): download **Fairphone's factory
   image** for the FP6 and run
   `tools/device-firmware.py extract fairphone-fp6 --factory-zip <zip> --out fw/`
   then `tools/device-firmware.py inject --image webos-phoenix-image-fairphone-fp6.ext4 --firmware fw/`.
6. Flash, from fastboot:
   ```sh
   fastboot flash boot boot-fairphone-fp6.img
   fastboot flash userdata webos-phoenix-image-fairphone-fp6.ext4
   fastboot erase dtbo        # Android's overlays do not fit the mainline device tree
   fastboot reboot
   ```
   To try without installing: `fastboot boot boot-fairphone-fp6.img` with
   the root already on `userdata`. The root image is only as big as its
   files; growing it to the 208 GB partition at first boot is still to do
   (PRE-IMAGE-CHECKLIST H5).
7. Back to Android: Fairphone's own [manual install
   instructions](https://support.fairphone.com/hc/en-us/articles/18896094650513).

**Odin 2 Portal** (Android stays)

1. In Android, copy ROCKNIX's `rocknix_abl` folder (from a ROCKNIX SM8550
   release) to internal storage and run its `backup_abl.sh`, then
   `flash_abl.sh`, as root (AYN's Handheld Settings, "Run script as root").
   **Keep the backup** on a computer: it is AYN's bootloader. Only needed
   if the fastboot menu has no "Switch boot mode" yet
   ([ROCKNIX, Odin 2 Portal](https://rocknix.org/devices/ayn/odin2portal/)).
2. Firmware: copy the device's own blobs (below) to a computer, then
   `tools/device-firmware.py extract ayn-odin2portal --from-dir <blobs> --out fw/`
   and inject them into the `.ext4`, or into the card's root partition after
   writing it.
3. Write `webos-phoenix-image-ayn-odin2portal.wic.gz` to a good microSD card
   (`bmaptool copy`, or Raspberry Pi Imager / balenaEtcher).
4. Insert it, hold **Volume Down** while powering on, choose "Switch boot
   mode" (Volume keys, Power to confirm), then Power to start.
5. Whether ROCKNIX's bootloader reads Phoenix's `extlinux.conf` as it reads
   ROCKNIX's own boot partition is the first thing to confirm (H6).

**PinePhone Pro / PineTab2** (SD card first, eMMC later)

1. Install Tow-Boot once: PinePhone Pro to **SPI** (hold RE at power-on
   with Tow-Boot's SPI installer on an SD card). PineTab2: its factory U-Boot
   boots from SD; installing to the eMMC needs U-Boot in SPI (Debian's
   PineTab2 page warns a bad SPI write needs a UART adapter to recover).
2. Write `webos-phoenix-image-<machine>.wic.gz` to an SD card (or, booted
   into Tow-Boot's USB mass storage mode with Volume Up, to the eMMC).
3. Boot. PinePhone Pro: hold Volume Down at the second vibration to boot
   the SD card (LED aqua).

### Firmware the phone brings

| Device | In the image (redistributable) | Taken from the owner's copy at install (not shipped) |
| --- | --- | --- |
| Fairphone 6 / 6+ | `linux-firmware-ath11k`, `-qca` | ADSP, CDSP, modem (+`modem_pr/`), IPA, WPSS (Wi-Fi), video (`vpu20_2v`), GPU zap shader and microcode (`gen80300_*`), Bluetooth (`msbtfw12.mbn`, `msnv12.bin`): from Fairphone's factory image (`NON-HLOS.bin`, `BTFM.bin`, `vendor_a`) |
| Odin 2 Portal | `linux-firmware-ath12k`, `-qca` (WCN7850) | GPU zap shader, ADSP, CDSP, the amplifiers' `aw883xx_acf.bin` (AYN's), and the Adreno 740 microcode unless linux-firmware's catch-all package is installed |
| PinePhone Pro | `-rockchip-dptx`, `-bcm43455` | Bluetooth `BCM4345C5.hcd` and the Wi-Fi board file: Hardware app catalog |
| PineTab2 | `-rockchip-dptx` | BES2600 firmware: Hardware app catalog |

The Qualcomm firmware is signed for each phone and its licence does not
allow redistribution: pmaports packages it as `license="proprietary"` from
[FairBlobs/FP6-firmware](https://github.com/FairBlobs/FP6-firmware) (no
licence file), and `phoenix-firmware-policy` would rightly fail an image
carrying it (docs/LEGAL.md). So `tools/device-firmware.py` (Apache-2.0)
does at install what FairBlobs' `extract.sh` does at packaging: reads the
owner's factory image, joins split `.mdt`/`.bNN` firmware as linux-msm's
`pil-squasher` does, lays it out where the device tree asks
(`qcom/milos/fairphone/fp6/...`), and writes it into the root image's
`/lib/firmware/updates` with `debugfs`, without mounting anything.
postmarketOS's other approach, `msm-firmware-loader` (MIT), mounts the
phone's firmware partitions at every boot; it cannot reach `vendor_a`
inside `super` without `make-dynpart-mappings` (GPL-3.0), and the device
trees ask for paths it does not create, so it is not used. Where the
Odin 2 Portal keeps its blobs in Android (`/vendor/firmware`,
`/vendor/firmware_mnt/image` on Qualcomm devices) is to be confirmed on the
device; LuneOS's `linux-firmware-pine64` (licence "Proprietary", mixing
sources) is not reused for the same reason.

### First boot: what to check

Each device's first image checks the general rows of
[PRE-IMAGE-CHECKLIST.md](PRE-IMAGE-CHECKLIST.md) (F1-F9 first boot, D1-D5
display, I1-I4 input, A1-A3 audio, N1-N3 networking, G1-G3 debugging,
P1-P3 performance) and its own row, H5-H9:

1. It boots to the shell: the boot animation hands over (F4), the lock
   screen shows; `phoenix-diag` collects the logs (G2).
2. Display: the geometry and rotation (`compositor.env`), the density and
   form factor (`device.json`); the card view at 60 fps (D2, D4, P3).
3. Touch matches the panel, gestures and edge swipes work (I1, I4).
4. Buttons: Power, Volume, the Fairphone's switch as the ringer switch
   (`phoenix-devices --probe`), the Odin's sticks and buttons (I2).
5. Wi-Fi joins a network from First Use; Bluetooth pairs (N1-N3).
6. Battery level and charging in the status bar (com.palm.power).
7. Sound: system sounds, headphones, Bluetooth audio (A1, A2).
8. Phones: a SIM is seen, SMS in and out, a call each way, mobile data.
9. Sensors: rotation follows the accelerometer (D5), auto-brightness.
10. Suspend and wake: screen off, wake on power key, on a call, on an alarm.
11. Firmware licences listed in Settings > Device Info match the image (L4).

### Device profiles: the simulator as each device

Before the hardware arrives, the simulator can be each first target:
`phoenix-sim --device <id>` (or `./phoenix run --device <id>`, or
View > Device), with the panel's exact pixels, its density, layout and
buttons, and its rounded corners and camera cutout drawn over the screen
in black. The values come from the same files the images ship: the table
`meta-phoenix/recipes-phoenix/phoenix-device-config/files/device-profiles.json`
(panel, diagonal, orientation, buttons, CPUs, memory) and each device's
`device.json` (form factor, density, Home button, ringer switch, corners,
cutouts), compiled into `phoenix-sim` (`shell/sim/simdevices.h`); the
shell reads that `device.json` through `DeviceConfig` as it does on the
device. A phone's panel is taller than most monitors: the window is shown
at what fits (`--zoom`; the window's title says the percentage),
and `--screenshot` saves the panel's exact pixels.
`python3 tools/test-device-profiles.py` checks the table against the
`device.json` files and the machines' `compositor.env`, and that each
density is the shell's own rule for the panel's ppi (`Theme.densityFor`).

| `--device` | Panel (used upright) | Diagonal, ppi, density | Layout | Corners, cutout | Buttons | CPU | RAM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `fairphone-fp6` | 1116x2484, portrait | 6.31", ~432 ppi, 2.5 | phone | 100 px radius; a 90 px punch hole at the top centre (x 513-603, y 16-106) | Power, Volume Up/Down, the Moment switch (the ringer switch) | 8 cores: 1x 2.5 GHz + 3x 2.4 GHz Cortex-A720, 4x 1.8 GHz Cortex-A520 (Gen. 6) | 8 GB (Gen. 6), 12 GB (Gen. 6+) |
| `ayn-odin2portal` | 1920x1080, landscape (the panel is 1080x1920, mounted turned) | 7", ~315 ppi, 1.75 | tablet | none known (unverified) | Power, Volume Up/Down (the gamepad is not modelled) | 8 cores: 1x Cortex-X3 3.2 GHz, 2x A715 + 2x A710 2.8 GHz, 3x A510 2.0 GHz | 8, 12 or 16 GB |
| `pinephonepro` | 720x1440, portrait | 6", ~268 ppi, 1.5 | phone | none (camera in the bezel; square corners assumed, unverified) | Power, Volume Up/Down | 6 cores: 2x Cortex-A72 + 4x A53, 1.5 GHz | 4 GB |
| `pinetab2` | 1280x800, landscape (the panel is 800x1280, mounted turned) | 10.1", ~150 ppi, 1.0 | tablet | none (camera in the bezel; square assumed) | Power, Volume Up/Down | 4x Cortex-A55, 1.8 GHz | 4 or 8 GB |
| `raspberrypi4-64` | 1280x720, landscape (Touch Display 2, 7": a 720x1280 portrait panel) | 7" (6.98"), ~210 ppi, 1.25 | tablet | none | none (the gesture bar does it all) | 4x Cortex-A72, 1.8 GHz | 1, 2, 4 or 8 GB (the VM: 4) |

The Raspberry Pi's display is the current official one, **Touch Display 2**
(720x1280, five-finger touch, DSI; the 7" model, which the Pi 4 takes: the
10" one is for the Pi 5 and Compute Modules only, and a 5" one has the same
pixels). Its profile's `device.json` (`files/rpi-touch-display-2/`) is
for the simulator and the VM only: the Pi image (`raspberrypi4-64`) keeps
the defaults (everything detected), since a Pi may as well drive an HDMI
monitor. The profiles' **orientation** is how each is used: the phones
upright, the tablets and the Pi on their side, as the TouchPad's 1024x768
is upright in the simulator.

**The cutout and the status bar.** webOS's own devices had square screens
and no cutouts, so luna-sysmgr has nothing to follow here. Phoenix does what
Android and Phosh do: while the UI is upright, a cutout at the top edge
makes the status bar at least as tall as the cutout (`Theme.safeAreaTop`;
Android: "content renders into the cutout area when the display cutout is
contained in a system bar. Otherwise, the window does not overlap the
display cutout", developer.android.com, "Support display cutouts"), so
cards and apps start below it; and the centred clock moves beside the hole
(to its left when that leaves the title clear, else to its right), while
both ends of the bar keep out of the rounded corners (Phosh's
`src/layout-manager.c`, `get_clock_pos` and `get_corner_shift`, which reads
the same gmobile panel data). On the Fairphone the bar is 106 px (42 legacy
pixels) instead of 70. Turned on its side the hole is at a side of the UI
and covers a little of the cards and apps there (GAPS, "Device profiles").

**Sources.** Fairphone 6: [GSMArena](https://m.gsmarena.com/fairphone_6-13955.php)
(6.31", 1116x2484, ~432 ppi, LTPO OLED, the CPU's cores and clocks, 8 GB);
Fairphone's [technical specifications](https://support.fairphone.com/hc/en-us/articles/38046290703122)
(the Gen. 6 with 8 GB and the 7s Gen 3, the Gen. 6+ with 12 GB and the 7s
Gen 4; Fairphone's page refuses automated reading, so read through search
results and GSMArena) and its [Fairphone Moments](https://support.fairphone.com/hc/en-us/articles/26886939326610-Fairphone-Moments)
page (the side switch); the corner radius and the punch hole from Phosh's
gmobile panel data, [`data/devices/display-panels/fairphone,fp6.json`](https://gitlab.gnome.org/World/Phosh/gmobile/-/raw/main/data/devices/display-panels/fairphone,fp6.json)
("border-radius": 100, the notch `M 558 16 a 42 42 0 0 0 0 90 ...`: a
90 px circle centred at x 558 from y 16, on a 66x146 mm panel), checked
against LineageOS's device tree ([android_device_fairphone_FP6](https://github.com/LineageOS/android_device_fairphone_FP6),
lineage-24.0, `overlay/FrameworksResCommon_Sys/res/values/config.xml`:
`config_mainBuiltInDisplayCutout` "M 38,64 a 38,39 0 0 0 -76,0 a 38,39 0 0 0 76,0",
a 76x78 px hole centred 64 px down, inside gmobile's). LineageOS's
`config_mainDisplayShape` (a 20 px radius on a 1080x2400 outline) is not
this panel's and is not used. Odin 2 Portal: 1920x1080 from AYN's device
tree (`qcs8550-ayn-odin2portal.dts`, `ayn/v7.0`); ~314 ppi from
[Retro Catalog](https://retrocatalog.com/retro-handhelds/odin-2-portal);
RAM tiers from [Notebookcheck](https://www.notebookcheck.net/AYN-Odin2-Portal-Full-specs-confirmed-for-high-end-Android-gaming-handheld-shortly-before-release.905071.0.html);
the cores from [Liliputing](https://liliputing.com/?p=172670) (AYN's own
product page lists no specifications). PinePhone Pro and PineTab2:
PINE64's wiki, [PinePhone Pro](https://wiki.pine64.org/wiki/PinePhone_Pro)
and [PineTab2](https://wiki.pine64.org/wiki/PineTab2). Raspberry Pi:
[Touch Display 2](https://www.raspberrypi.com/products/touch-display-2/)
(720x1280, active area 86.94x154.56 mm for the 7"),
[Raspberry Pi 4 specifications](https://www.raspberrypi.com/products/raspberry-pi-4-model-b/specifications/)
(BCM2711, 4x Cortex-A72 at 1.8 GHz, 1-8 GB). All read on 11 October 2026.

**Not verified** (best documented estimates, to measure on the devices,
OPEN-QUESTIONS Q97): the Odin 2 Portal's, the PinePhone Pro's and the
PineTab2's corner radii (gmobile has no entry for them, and their makers
publish none: square assumed); the Fairphone's radius is gmobile's
(Phosh's), not Fairphone's own figure.

### Device VMs

The second layer: the real OS image, on an ARM64 virtual machine, as each
device. One machine, **`phoenix-vm-arm64`** (`meta-phoenix/conf/machine/`),
builds the phones' package set (it requires `phoenix-mobile.inc`, so it
leaves out OSE's camera and media recorder as they do) on OE's
`qemuarm64`: linux-yocto with the yocto-kernel-cache's qemuarm64 BSP
(`KMACHINE`), the virtual devices built in (`phoenix-vm.cfg`) and OSE's
needs (`phoenix-ose.cfg`), a raw ext4 root, and QEMU's `virt` machine.
**The device is chosen at boot**, not when building: the kernel's command
line says `phoenix.device=fairphone-fp6`, and `phoenix-device-select` (a
oneshot unit before `sysinit.target`, from `phoenix-device-config`) copies
that device's `device.json` and compositor geometry from
`/usr/share/phoenix/devices/<id>/` to `/run/phoenix/`, where
`/etc/phoenix/device.json` and `compositor.env` point. No or an unknown
`phoenix.device`: the defaults (everything detected), and a line in the
journal. The geometry is the panel upright as QEMU's virtio-gpu shows it
(`1116x2484+0+0r0s1`; the tablets' landscape modes directly, so no turn),
and the VM's `compositor.env` shows the pointer's cursor, which the
devices hide (`WEBOS_CURSOR_HIDE`, `product.env`).

**Does OSE accept it?** Yes: `scripts/parse-check.sh phoenix-vm-arm64`
parses and resolves `webos-phoenix-image` (11 October 2026). meta-webos's
machine handling is by override, not by machine name:
`webos_machine_impl_dep.bbclass` takes `WEBOS_TARGET_MACHINE_IMPL`
("emulator" by default; "hardware" here, as `phoenix-mobile.inc` and
`webos-rpi.inc` set it), and the `qemuall` override, which `qemu.inc` adds,
brings meta-webos's emulator settings that suit a VM
(luna-surfacemanager's `virtual_display_support`, Mesa's `gallium-llvm`)
and OSE's qemu-only extras (`packagegroup-webos-audio`'s audio services,
`packagegroup-webos-media`'s media indexer). The machine puts `qemuarm64`
in `MACHINEOVERRIDES`, which linux-yocto's `COMPATIBLE_MACHINE` needs, and
sets `KMACHINE` to it in the linux-yocto bbappend: the cache has no
`phoenix-vm-arm64` BSP, and `do_kernel_metadata` would stop on that, which
the parse check cannot see. OSE's media stack stays out exactly as on the
phones (`media-resource-calculator`'s `COMPATIBLE_MACHINE` lists only OSE's
machines).

**Running it.** `scripts/vm.sh <device> [--image path]` starts QEMU with
the device's CPU count (at most the host's), memory and panel resolution:
HVF on Apple silicon, KVM on an arm64 Linux host, TCG (emulation, slow)
otherwise; virtio-gpu (with virgl's GL where the host's QEMU has it:
Linux; UTM on a Mac), `virtio-multitouch-pci` (QEMU 8.0+: a touchscreen,
`ABS_MT_*`, so the host's touches arrive as touches) beside
`virtio-tablet-pci` for the mouse, virtio-net (ssh on port 2222),
`virtio-sound-pci` (QEMU 8.2+) or Intel HDA (`--audio hda`), virtio-blk.
Each device keeps its own disk, a copy-on-write overlay over the image.
`--cap-cpu PCT` approximates the slower cores: a CPU quota per virtual CPU
on Linux, the efficiency cores on a Mac. `--dry-run` prints the command;
`--utm` prints UTM's settings. The procedure on the Mac:
[BUILDING-MAC.md, "Run it in a VM"](BUILDING-MAC.md#run-it-in-a-vm).

**Not booted yet.** No `phoenix-vm-arm64` image has been built: the
container this was written in cannot build Chromium. The first boot is the
owner's, on the Mac: `scripts/mac-build.sh phoenix-vm-arm64`, then
`scripts/vm.sh fairphone-fp6`.

**What a VM cannot match**, per device:

| | Fairphone 6 | Odin 2 Portal | PinePhone Pro | PineTab2 | Raspberry Pi 4 |
| --- | --- | --- | --- | --- | --- |
| GPU | Adreno 810 (freedreno, Mesa 26+) vs virgl or llvmpipe | Adreno 740 (freedreno, Turnip) vs virgl | Mali-T860 (panfrost, GLES 3.1 at most) vs virgl, which can do more | Mali-G52 (panfrost) vs virgl | VideoCore VI (v3d) vs virgl |
| Kernel, device tree | milos-mainline 7.2 and its device tree vs linux-yocto 6.6, QEMU's `virt` | AYN's 7.0 tree, the turned panel vs none | megi's 7.2 vs linux-yocto | DanctNIX's 7.1.8 vs linux-yocto | the Pi's kernel vs linux-yocto |
| Modem | Qualcomm's (calls, SMS, data) | none on the device either | Quectel EG25-G (eg25-manager, oFono) | none | none |
| Camera | not in the images yet (OSE's camera stack is left out) | none | not in the images yet | not in the images yet | not in the images yet |
| Sensors | accelerometer, light, proximity, Hall | the sticks, the gamepad | accelerometer, light, proximity | accelerometer | none |
| Battery, suspend | real battery, suspend | battery, "fake suspend" | battery, suspend | battery | mains power |
| Performance | big cores at 2.5 GHz vs the host's (HVF/KVM: the host's speed; `--cap-cpu` only approximates) | the fastest here | slow: A72/A53 at 1.5 GHz, 4 GB | slow: four A55 | four A72, memory as chosen |

**Input in the VM.** QEMU's `virtio-multitouch-pci` is a touchscreen
(`ABS_MT_*`), so a host's touchscreen reaches the shell as touches; a Mac's
trackpad and mouse arrive through `virtio-tablet-pci` as an absolute pointer
with wheel notches. OSE builds Qt without libinput (meta-webos d7ed46c,
`qtbase_git.bbappend:76`), so luna-surfacemanager's eglfs reads them through
Qt's evdev handlers: the wheel has no pixel delta or scroll phase, which
takes `TrackpadSwipe.qml`'s mouse-wheel path (a card or page a notch), and
there are no libinput settings (tap-to-click, natural scrolling) to set
(OPEN-QUESTIONS Q100). The first boot checks the pointer, the trackpad and
the keyboard shortcuts in card view and with an app maximized
([BUILDING-MAC.md, "Run it in a VM"](BUILDING-MAC.md#run-it-in-a-vm), step 5).

In every case the VM has no ringer switch, vibrator, light sensor or
backlight to drive (phoenix-devices finds none and says so), no Wi-Fi or
Bluetooth radio (virtio-net is wired networking to connman), and no
device firmware. It checks the OS itself: the image boots, systemd and
the Luna bus come up, luna-surfacemanager drives a DRM display at the
device's resolution, the shell lays out with the device's density, form
factor and cutout, the web apps run in WebAppMgr's Chromium, the touch
gestures arrive as touches, sound plays, and the network works.

### Keyboard phones (looked at, not targets)

A phone with a hardware keyboard is the closest thing to a Palm Pre. Checked
on 11 October 2026 (OPEN-QUESTIONS Q101; the owner: the Pro1 X is a
tentative future target, the KEY2 is skipped unless it unlocks properly):

| Phone | Can it boot Phoenix? | Linux today | Status |
| --- | --- | --- | --- |
| F(x)tec Pro1 X (QX1050): Snapdragon 662, 8 GB, 5.99" 1080x2160 AMOLED, slide-out QWERTY | Yes: `fastboot flashing unlock`, official ([LineageOS install](https://wiki.lineageos.org/devices/pro1x/install/)) | Device tree in mainline (`arch/arm64/boot/dts/qcom/sm6115-fxtec-pro1x.dts`: panel, GPU, touch, modem, Wi-Fi, USB); no keyboard node. postmarketOS (now Nura): display, 3D, Wi-Fi, USB work; touch unreliable on mainline; keyboard, modem and audio untested ([wiki](https://wiki.postmarketos.org/wiki/F(x)tec_Pro1X_(fxtec-qx1050))). Ubuntu Touch and LineageOS 24 support it | **Tentative future target.** Fxtec no longer sells phones (fxtec.com is a B2B studio; the Pro1 X page is gone): used units only, some reported not to power on after storage |
| F(x)tec Pro1 (QX1000): Snapdragon 835, same keyboard | Yes, the same way | Mainline device tree without display or GPU nodes; postmarketOS boots it unpackaged | Not pursued (no mainline display) |
| BlackBerry KEY2 / KEY2 LE: Snapdragon 660 / 636, 6 / 4 GB, 4.5" 1620x1080, keyboard | Only by a community exploit (Kibo, with the Blackberry_Key2_Unlocker loaders) on firmware ACQ160 / ACI448 (KEY2) or ACT575 (LE), with a brick risk and no recovery ([postmarketOS wiki](https://wiki.postmarketos.org/wiki/BlackBerry_KEY2_Generic_(blackberry-key2-generic))) | Mainline 6.19: display, touch, keyboard, Wi-Fi, Bluetooth, battery work; the GPU hangs it; no audio, calls, SMS, data, camera or GPS | **Skipped** (no proper unlock) |
| BlackBerry KEYone | No public unlock | None | Out |
| BlackBerry Passport | No: BlackBerry 10 (QNX), signed boot | None | Out |

Whatever the hardware, the simulator's `--device` profiles can model a
keyboard phone's screen (a 4.5" 3:2 or 1:1 panel) with the hardware
keyboard support (GAPS V8), so Phoenix's layouts are ready for one.

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
- **Drivers like a distro**: open source drivers and redistributable
  firmware in the image, the gaps filled by the Hardware app from a signed
  driver catalog ([Hardware support and the Hardware app](#hardware-support-and-the-hardware-app)).

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
adopt and to develop for, on as much hardware as possible. **As much as
possible works out of the box**, as on Ubuntu or Debian: the image carries
the open source drivers **and the firmware whose licence allows
redistribution** (the `linux-firmware` files for Wi-Fi, Bluetooth, Ethernet
and GPUs), unmodified, with their licence files. **The Hardware app fills
the gaps and is the avenue for more**, as Ubuntu's "Additional Drivers"
(`ubuntu-drivers`) and Windows' driver installer are: firmware the image
does not have (new or rare hardware, firmware added after a release, or
left out of a small image), newer firmware than the image's, drivers that
are not in the kernel, optional extras, and, with Developer Mode on,
drivers from other catalogs.

**Status (October 2026):** built in the simulator: the service
(`services/hardware`), Settings > Hardware, the firmware licences in
Settings > Device Info, First Use's Hardware step, the signed driver catalog
and its tool (`server/drivers`) with off-server signing in CI
(`.github/workflows/drivers-catalog.yml`), and the packaging in
`meta-phoenix` (kernel config fragments, `packagegroup-phoenix-firmware`, the
firmware licence check, out-of-tree driver recipes, `phoenix-driver-feed`).
Parsed and dry-run for both machines; not built or run on a device yet (M1).
How to publish a driver and release the catalog: [DRIVERS.md](DRIVERS.md).

### What is built in: drivers

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
| Wi-Fi | ath9k, ath9k_htc, ath10k, ath11k, iwlwifi, rtw88 (PCIe, SDIO, USB), rtw89, rtl8xxxu, MediaTek mt7601u, mt76x2u, mt7921, brcmfmac (SDIO, USB, PCIe), Marvell mwifiex |
| Bluetooth | btusb (with Realtek and Broadcom), btsdio, hci_uart (H5, BCM, QCA), Marvell |
| Graphics | x86: i915, amdgpu, radeon, nouveau, virtio-gpu; ARM: Panfrost, Lima, MSM (Adreno), etnaviv, VC4/V3D, simple panels; USB displays (`udl`) |
| Camera, sound | UVC webcams, gspca; USB audio; HD Audio (x86) |
| Sensors | IIO with HID sensors, BMC150, KXCJK1013, MXC4005, MPU6050, STK3310, LTR501 |

The kernel loads firmware compressed (`FW_LOADER_COMPRESS_XZ`/`_ZSTD`) and
without a user-space helper. What the drivers expose is found by
`phoenix-devices` as before ([Finding the hardware](#finding-the-hardware-and-following-it)).

### Firmware in the image

`packagegroup-phoenix-firmware` installs the redistributable firmware for
common hardware, as OE splits `linux-firmware` per chip, each with the
licence package it depends on (`linux-firmware-rtl-license`, ...):

| Group | Packages | Size (uncompressed, linux-firmware 20240909) |
| --- | --- | --- |
| Graphics | `amdgpu`, `radeon`, `i915`, `nvidia-gpu` | 93 + 7 + 31 + 66 MB |
| Intel Wi-Fi and Bluetooth | `iwlwifi-misc` and the 7260 to 9260 packages, `ibt-*` | up to 201 + 29 MB (`iwlwifi-*` files, all versions; the packages carry the ones the kernel asks for) |
| Realtek | `rtl8188`, `rtl8192cu/ce/su`, `rtl8723`, `rtl8761`, `rtl8821`, `rtl8822`, `rtl-nic`, `rtl8168` | about 4 MB |
| Qualcomm Atheros | `ath9k`, `ath10k`, `ath11k`, `ath12k`, `ath3k`, `ar3k`, `qca` | 21 + 52 + 8 + 3 MB |
| MediaTek | `mediatek`, `mt7601u`, `mt76x2`, `mt7650` | about 37 MB |
| Broadcom/Cypress, Marvell/NXP | `bcm43430`, `bcm43455`, `bcm4350`, `bcm4354`, `bcm4356-pcie`, `bcm43602`, `bcm4373`; `sd8887`, `sd8897`, `sd8997`, `pcie8997`, `usb8997`; `bnx2` | about 20 MB, plus the Marvell files used |
| Machines | the Raspberry Pi 4's Wi-Fi and Bluetooth (`linux-firmware-rpidistro-bcm43455`/`43456`, `bluez-firmware-rpidistro-*`, recommended by `meta-raspberrypi`); a phone's adaptation package | a few MB |

**Size cost:** about 570 MB uncompressed for the whole set, all of
`linux-firmware` being 1.23 GB; Intel's Wi-Fi files and the GPUs are most.
Measured from the 20240909 release, each file compressed on its own as the
switch below does:

| | Uncompressed (default) | `xz` (CRC32) | `zstd` (-19) |
| --- | --- | --- | --- |
| The set in the image | 570 MB | 216 MB | 232 MB |
| Of which: iwlwifi / amdgpu / nvidia / ath / Intel BT | 201 / 93 / 66 / 85 / 29 MB | 62 / 27 / 40 / 29 / 18 MB | 67 / 30 / 41 / 32 / 19 MB |
| All of linux-firmware | 1228 MB | 499 MB | 528 MB |

The image build logs the exact figure (`phoenix-firmware-policy`: "Phoenix
firmware: N packages, X MB", from the packages' installed sizes, compressed
or not; the linux-firmware build logs "compressed with xz: X MB to Y MB").

- **`PHOENIX_FIRMWARE_COMPRESS`** (in `local.conf`, as it changes the
  `linux-firmware` packages; owner's decision: off by default, the files as
  shipped): `"xz"` or `"zstd"` compresses every firmware file after
  `linux-firmware`'s `do_install` (`meta-phoenix`'s bbappend), as upstream's
  `copy-firmware.sh --xz/--zstd` does: `file.xz` or `file.zst`, links remade
  to the compressed names, licence files left as they are, and each
  package's file patterns matching the new names. The kernel reads them
  (`CONFIG_FW_LOADER_COMPRESS_XZ`/`_ZSTD`, in `phoenix-hardware.cfg` either
  way); xz is the smaller, zstd the faster to load. `scripts/parse-check.sh`
  resolves the image with each value. The Hardware app works either way: it
  finds a firmware file with or without the suffix, and newer firmware goes
  in **uncompressed** to `/lib/firmware/updates`, because the kernel looks for
  the plain name in every folder before it tries `.zst` and `.xz` (the
  catalog tool refuses a compressed update).
- **Keeping only the newest `iwlwifi` version per chip** (it would save about
  155 MB, 49 MB compressed) is **not** offered: each kernel asks for the
  newest firmware API *it* supports, which is often older than the newest
  file in `linux-firmware` (6.6 predates many), so "newest only" would leave
  some cards without firmware. Doing it right needs each kernel's supported
  API range per chip; a later bbappend could read it from the kernel's
  `iwlwifi` sources.

- **`PHOENIX_FIRMWARE_EXCLUDE`** (in the image or `local.conf`): firmware
  packages to leave out of a small image, e.g.
  `"linux-firmware-amdgpu linux-firmware-nvidia-gpu"` for an ARM tablet. The
  Hardware app offers them (`phoenix-driver-feed` publishes them).
- **The licence check** (`phoenix-firmware-policy.bbclass`): the image fails
  if it would install a firmware package whose licence is not on the
  allow-list of licences that permit redistribution
  (`PHOENIX_FIRMWARE_LICENSES`: OE's `Firmware-*` licences of linux-firmware,
  whose WHENCE file records each file's redistribution terms; `WHENCE`;
  meta-raspberrypi's `binary-redist-Cypress-rpidistro`,
  `Firmware-cypress-rpidistro` (through `Firmware-*`) and
  `Synaptics-rpidistro`; open source licences), naming the package and its
  licence. It writes `/usr/share/phoenix/firmware/licences.json`: each
  firmware package, its version, licence, licence files and size, which
  Settings > Device Info > Open source licenses shows (the licence files'
  text on a tap).

**Wi-Fi firmware at first boot** is no longer a problem for the hardware in
the image. For hardware whose firmware is not in it, the routes are: a wired
or USB connection (Ethernet, a phone's USB tethering), the installer putting
the firmware it found on the computer on the data partition, or a USB drive
with the packages (`file://` catalog sources; the signature check is the
same).

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
- **What is installed**: opkg's list, so an entry the image already has shows
  as "Included with Phoenix" and newer firmware as an update.

Each device's state: **working**, **needs firmware**, **needs a driver** (the
catalog has one), **no driver** (nothing knows it), **restart to finish**;
and for a working device, **newer firmware available** or **optional driver
available**.

### The driver catalog

The Marketplace's model ([APP-STORE.md](APP-STORE.md), 3.4 and 3.6): a static
JSON index any web host or mirror serves, signed with Ed25519
(`drivers.json`, `drivers.json.sig`, `key.json`), written by a small PHP tool
(`server/drivers/bin/drivers.php`) that uses the Marketplace's `.ipk` reader
and signer. Each entry maps hardware to packages:

```json
{"id": "firmware-rtw88-update", "kind": "firmware", "title": "Newer Realtek Wi-Fi firmware (rtw88)",
 "match": ["usb:v0BDApC811d*", "pci:v000010ECd0000C821sv*"],
 "firmware": ["rtw88/rtw8821c_fw.bin"], "modules": ["rtw88_8821cu"], "optional": true, "after": "reload",
 "supersedes": ["linux-firmware-rtl8821"],
 "license": {"id": "LicenseRef-rtlwifi-firmware", "name": "Realtek firmware licence", "text": "…",
             "url": "…", "free": false, "redistributable": true},
 "source": "https://git.kernel.org/…/linux-firmware.git",
 "packages": [{"name": "linux-firmware-rtw88-update", "version": "20250311-r0", "arch": "all",
               "kernel": null, "url": "packages/…ipk", "size": 1234, "installedSize": 5678, "sha256": "…"}]}
```

`match` holds the kernel's own modalias globs (`modules.alias` syntax);
`firmware` (names or globs) also matches a device whose driver asked for one
of those files. `kind` is `firmware`, `module` (an out-of-tree kernel module,
built per kernel: `kernel` must equal `uname -r`) or `service` (a user-space
HAL or daemon, reviewed by a person). **Newer firmware** names the image
package it updates (`supersedes`) and installs its files in
`/lib/firmware/updates`, which the kernel reads before `/lib/firmware`: the
image's package stays, and removing the update goes back to it. Packages are
picked by architecture: one of those opkg installs on the device
(`/etc/opkg/arch.conf`: `all`, the CPU's tune such as `core2-64` or
`cortexa72`, the machine's such as `qemux86_64`), the most specific there is.
The full format and the checks: [DRIVERS.md](DRIVERS.md).

**Trust.** The same Ed25519 model as the Marketplace, with these rules:

- **Phoenix's catalog key is pinned in the system image**
  (`/etc/palm/hardware/catalog.json`), not trusted on first use: drivers
  install as root. The device takes only an index signed with it, not
  expired, and not older than the last one it took, and installs only a
  package whose size and SHA-256 are the signed ones. A catalog that fails
  is reported and the last good one kept.
- **The owner holds the key offline** (a USB drive or security key, a copy in
  a password manager). CI builds the catalog; the owner signs it on their
  own computer; a CI job that the owner must approve checks the signature
  against the pinned key and publishes ([DRIVERS.md](DRIVERS.md#releasing-the-catalog)).
  The simulator and tests use the sample key (`server/drivers/sample`),
  which only the simulator trusts.
- **Key rotation is built in**: the old key signs a hand-over to a new one
  (`key-handover.json`); a device whose catalog no longer verifies with its
  key follows a hand-over signed by that key and then trusts only the new
  one. A key listed in `revoked` (`catalog.json`) is never trusted again; a
  lost or leaked key is replaced by a system update that pins the new key
  and revokes the old.
- **Other catalogs, with Developer Mode only**: added by their address in
  Settings > Hardware, trusted by their own key once the user has seen its
  fingerprint (as the Marketplace does for app catalogs), shown under "Other
  driver catalogs" by the name the user saw. Their drivers are marked "From
  X, a catalog you added, not Phoenix's", never replace a Phoenix entry with
  the same id, and are neither used nor installable while Developer Mode is
  off.

### Out-of-tree drivers

Built per kernel in `meta-phoenix` (`recipes-kernel/rtl8812au`,
`recipes-kernel/rtl8814au`, into `lib/modules/<kernel>/updates`), offered by
the Hardware app through `phoenix-driver-feed`, **never in the image and
never installed for a device a built-in driver already binds** (the service
refuses it: "A built-in driver already drives this device"):

| Driver | Hardware | Why |
| --- | --- | --- |
| `rtl8812au` (aircrack-ng's `88XXau`, GPL-2.0) | USB Wi-Fi with the RTL8812AU or RTL8821AU: most AC600/AC1200 dongles (TP-Link Archer T2U/T4U, Alfa AWUS036AC/ACH, Netgear A6100, ...) | Among the most sold USB Wi-Fi chips and the most asked-about Linux Wi-Fi drivers; mainline drives them only from Linux 6.14 (`rtw88_8812au`/`_8821au`), after OSE's 6.6 kernels |
| `rtl8814au` (morrownr's, GPL-2.0) | USB Wi-Fi with the RTL8814AU (AC1900, four antennas: Asus USB-AC68, Alfa AWUS1900, TP-Link Archer T9UH) | The popular high-end dongle; mainline support came in 2025, after 6.6 |

Not included: RTL88x2BU and RTL8821CU (in the 6.6 kernel's `rtw88`),
RTL8188EU (`rtl8xxxu` in 6.6), and drivers whose firmware may not be
redistributed (the Xbox Wireless adapter's `xone`) or whose licence is not
compatible with the kernel's. The list follows the opt-in reports
(`drivers.php reports`): what is most reported without a driver is next.

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
   The image's own packages are never replaced (updates go beside them).

`remove {driverId}` removes the packages and reloads (or asks for a restart).
A daily activity (and the first look after start-up) tells the user about
new hardware that needs something.

### The anonymous hardware report (opt-in)

Settings > Hardware > Unsupported hardware: off by default. When on, the
daily check sends, when it changed, **only the IDs** of devices nothing
drives (no driver, or needs something the catalog does not have): their bus,
modaliases and missing firmware names; the architecture and kernel version
(`6.6.23`). No device names, serial numbers, MAC or IP addresses, DMI or
board strings, account or device identifiers. "See What Is Sent" shows the
exact IDs and can send them once. The catalog service keeps them with the
day only (`POST /v1/report`, `data/reports.jsonl`); `drivers.php reports`
lists the devices no driver is for yet, most reported first.

### First boot

First Use has a **Hardware** step after Wi-Fi, which looks at the hardware
first and is shown only when a device needs firmware or a driver the image
lacks and the catalog has (for the simulated device: the RTL8812AU dongle);
newer firmware and optional extras wait in Settings > Hardware.

### Where it lives

| Piece | Where |
| --- | --- |
| The service (`org.webosphoenix.hardware`) | `services/hardware` (`hardwareservice.js`; device side `service.js`, `lib/sysfs.js`, `lib/node.js`; trust config `etc/palm/hardware/catalog.json`; the Marketplace's Ed25519 code, kept identical by a test) |
| The app | Settings > Hardware (`apps/settings/src/pages/Hardware.tsx`, its own launch point, as webOS's preference panes were), the firmware licences in Device Info, First Use's step (`apps/firstuse`), `@phoenix/luna` `hardware` |
| The catalog | `server/drivers` (`drivers.php`, `public/router.php`, reviewed entries in `catalog/entries`); releases: `.github/workflows/drivers-catalog.yml`; the simulator's signed sample catalog in `server/drivers/sample` |
| In the simulator | `runtime/phoenix-runtime.js` "Hardware and drivers": a simulated device whose image has its firmware (an Atheros card, a Realtek RTL8821CU dongle with newer firmware in the catalog, an NVIDIA card), its gaps (an RTL8812AU dongle without a driver, a USB gadget nothing knows), opkg and kernel |
| Packaging | `meta-phoenix`: `recipes-kernel/linux` (fragments), `recipes-kernel/rtl8812au`, `rtl8814au`, `recipes-core/packagegroups/packagegroup-phoenix-firmware.bb`, `classes/phoenix-firmware-policy.bbclass`, `recipes-phoenix/phoenix-driver-feed` |
| Tests | `services/hardware/*.test.ts`, `apps/settings/src/pages/Hardware.test.tsx`, `server/drivers/tests/run.php`, `tools/test-hardware.cjs`, `tools/test-firstuse.cjs`; `scripts/parse-check.sh` resolves the packagegroup, the feed and the driver recipes |

**Why a Settings pane, not its own app:** webOS's preferences were one
launcher icon per pane, and Phoenix's Settings keeps that (launch points);
Hardware is one more pane with its own icon, found where Wi-Fi, Bluetooth and
USB are, opened by its notification and its ongoing activity.

### Decided, and still open

Decided (October 2026): redistributable firmware in the image; the Hardware
app for the gaps; other catalogs with Developer Mode only; a short list of
out-of-tree drivers built per kernel; the catalog key held offline by the
owner, releases signed off-server and approved in CI, rotation by signed
hand-over.

Open, for the owner:

1. **Image size** (decided): the owner chose to ship all of it as is, about
   570 MB uncompressed, so as much hardware as possible works out of the
   box. `PHOENIX_FIRMWARE_COMPRESS = "xz"` (216 MB) or `"zstd"` (232 MB) is
   there for builds that want it, and `PHOENIX_FIRMWARE_EXCLUDE` for anyone
   building a small image.
2. **Synaptics' Pi firmware**: `meta-raspberrypi` puts the BCM43456 firmware
   (Pi 400, CM4) under `Synaptics-rpidistro` with a licence flag
   (`synaptics-killswitch`, which OSE's `webos.conf` accepts). It allows
   redistribution but Synaptics can withdraw it; it is on the allow-list
   for now.
3. **The catalog's host** (`drivers.webosphoenix.org` is a placeholder) and
   whether the report counts are published (as linux-hardware.org does).

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
| PINE64 PinePhone | Allwinner A64, Mali-400 (lima, OpenGL ES 2.0 only) | Testing (pmaports, October 2026; was community) | 2–3 GB RAM and GLES 2 only: likely too slow for OSE's Chromium web runtime. Community at best; dropped from the first targets (the owner, 11 October 2026: the PinePhone Pro stays) |
| Purism Librem 5 | i.MX 8M Quad, GC7000L (etnaviv) | Community | Good mainline support, hardware kill switches, expensive. Community |
| SHIFT6mq | Snapdragon 845 | Community | Same SoC as the OnePlus 6, so it mostly comes for free. Community |
| Xiaomi Poco F1 | Snapdragon 845 | Community | Same again; common and cheap. Community |
| Fairphone 4 | Snapdragon 750G, Adreno 619 | Community | Sold new until recently, repairable. Supported candidate |
| Fairphone 5 | QCM6490, Adreno 643 | Testing (known brightness bug) | Better on Halium today (Ubuntu Touch's promoted device) |
| **Fairphone 6 / 6+** | SM7635 / SM7635-AC (milos), Adreno 810 | Testing (pmaports `device/testing`, October 2026) | **First target, the flagship phone** ([First targets](#first-targets)) |
| **AYN Odin 2 Portal** | QCS8550, Adreno 740 | Not in pmaports (ROCKNIX supports it) | **First target, the tablet** |
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
| **Sensors** | [iio-sensor-proxy](https://gitlab.freedesktop.org/hadess/iio-sensor-proxy) on mainline; [sensorfw](https://github.com/sailfishos/sensorfw) (Sailfish OS, Ubuntu Touch) with its hybris adaptor on Halium | Legacy `com.palm.ambientLightSensor`, orientation and acceleration events to apps, proximity during calls | **No sensor service** (nyx-lib defines the light, proximity and orientation interfaces; OSE's nyx-modules implement none of them) | **Light: done** in `phoenix-devices` (below), straight from IIO (`in_illuminance_input` / `_raw` × `_scale`). **Orientation: written, not run** in `phoenix-devices`: the IIO accelerometer (`in_accel_*_raw` × scale, the driver's mount matrix) to the shell's rotation (below; not iio-sensor-proxy, GPL-3.0). Still to do: the legacy accelerometer events to apps, proximity during calls. On Halium, sensorfw instead of IIO. Note: iio-sensor-proxy exposes orientation, light, proximity and compass, not raw acceleration or steps; sensorfw on Halium does expose a step counter |
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
detect comes from `/etc/phoenix/device.json`, installed by
`meta-phoenix`'s `phoenix-device-config` for the machine
(`files/<MACHINE>/device.json`, else the defaults), or the file named by
`PHOENIX_DEVICE_CONFIG`. A missing file or key means the default. Read by
`Phoenix.Native`'s `DeviceConfig`. The same recipe installs
`/etc/phoenix/compositor.env`, which `phoenix-shell`'s `product.env`
sources: the machine's `WEBOS_COMPOSITOR_GEOMETRY`
(`<w>x<h>+<x>+<y>r<rotation>s<scale>`).

| Key | Default | Meaning |
| --- | --- | --- |
| `formFactor` | `"auto"` | `"phone"`, `"tablet"` or `"auto"` (the shell's `formFactor`): "auto" takes the tablet layout when the screen's shorter side is at least 600 legacy pixels (`Theme.tabletMinSide`). A device names its own so its layout does not depend on its size (the Odin 2 Portal's 7" is the tablet). |
| `density` | `0` (from the panel) | Device pixels per legacy pixel (the shell's `density`: 1.0 on a Pre and the TouchPad, 1.5 on a Pre 3). 0 derives it from the panel's size as DRM reports it, about the screen's ppi / 180 in quarters (`Theme.densityFor`), which some panels report wrongly. |
| `hardwareHomeButton` | `false` | The device has a Home button (physical or capacitive) that its maker uses **instead of** the on-screen gesture bar. The shell then hides the bar, the key does its job (`Key_Home`), and tablets take the bottom-edge flick for swipe up. |
| `homeButtonOrientationAngle` | `0` | Where that Home button is, as the angle from the screen's own bottom edge: `0`, `90`, `180` or `270` (luna-sysmgr's `HomeButtonOrientationAngle`; the TouchPad's was `270`, its button beside its landscape screen). The boot animation is drawn upright with the button below, and the Touch to Share glow comes from its edge. |
| `backlight` | the first under `/sys/class/backlight` by the kernel's preference (`type` firmware, then platform, then raw) | The panel's backlight, by name (`phoenix-devices`), for a device with several where that picks the wrong one. |
| `lightSensor` | the first IIO device with illuminance | The light sensor's IIO device, e.g. `"iio:device1"` (`phoenix-devices`). |
| `accelerometer` | the first IIO device with `in_accel_x_raw`, `_y_`, `_z_` | The accelerometer's IIO device, for the orientation (`phoenix-devices`). Its axes are taken through the driver's mount matrix (`in_accel_mount_matrix`, from the device tree's `mount-matrix`); a device whose driver has none and whose sensor is mounted turned needs one in its device tree. |
| `displayCornerRadius` | `0` | The screen's rounded corners' radius in device pixels. The status bar's ends keep out of them (as Phosh's top bar does); the simulator draws them (`--device`). |
| `displayCutouts` | none | The camera's holes or notches in the screen: `[{"shape": "circle" \| "rect", "x", "y", "width", "height"}]`, device pixels on the screen upright (the compositor's output, unturned). One that starts within the status bar makes the bar tall enough to hold it while the UI is upright, and moves the clock beside it ([Device profiles](#device-profiles-the-simulator-as-each-device)). |
| `ringerSwitch` | none (the ringer is always on) | The ringer switch: `{"type": "EV_SW" \| "EV_KEY", "code": n, "silentValue": 1}`, the input event code it sends and its value when silent. Linux has no code of its own for it (`SW_MUTE_DEVICE`, 14, is the nearest; OnePlus's alert slider sends keys), so each device names its own (`phoenix-devices`). `phoenix-devices --probe` points at any device with `SW_MUTE_DEVICE` and prints the line to add. |

The machines' values (`meta-phoenix/recipes-phoenix/phoenix-device-config/files/`):

| Machine | `formFactor` | `density` | Screen, geometry | Hardware keys and switches |
| --- | --- | --- | --- | --- |
| `qemux86-64`, `raspberrypi4-64` | auto | from the panel | OSE's configd geometry | none (the gesture bar does it all) |
| `fairphone-fp6` | phone | 2.5 (6.31", 1116x2484, ~432 ppi) | `1116x2484+0+0r0s1`; corners of 100 px and a 90 px punch hole at the top centre (`displayCornerRadius`, `displayCutouts`: gmobile's panel data) | Power, Volume Up/Down; the side switch, `SW_MUTE_DEVICE` (EV_SW 14) in the device tree, as `ringerSwitch` with silentValue 1 (to confirm with `phoenix-devices --probe`); Hall sensor (`SW_LID`) |
| `ayn-odin2portal` | tablet | 1.75 (7", 1920x1080, ~315 ppi) | panel mounted turned (1080x1920, `rotation = <270>`): geometry to find on the device (H6) | Power, Volume Up/Down, the gamepad (UART, `rsinput`) |
| `pinephonepro` | phone | 1.5 (6", 720x1440, ~270 ppi) | `720x1440+0+0r0s1` | Power, Volume Up/Down |
| `pinetab2` | tablet | 1.0 (10.1", 1280x800, ~150 ppi) | panel mounted turned (800x1280): to find on the device (H8) | Power, Volume Up/Down |

| `phoenix-vm-arm64` | each device's, chosen at boot (`phoenix.device=`, [Device VMs](#device-vms)) | | the device's panel, upright: `<w>x<h>+0+0r0s1` | none (virtual) |

No device here has a Home button, so every one keeps the gesture bar.

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
| `com.palm.display` `phoenix/orientation` (the shell's only) | `SimSystemStatus.deviceOrientation` (`--orientation`, Ctrl+Left / Ctrl+Right) | The IIO accelerometer, ten readings a second while the display is on (as LunaSysMgr's orientation sensor ran, `DisplayStates.cpp:298, 814, 1097, 1369-1372`): up, down, left, right, faceup, facedown, with Phoenix's thresholds (a reading far from 1 g ignored, flat within ~30 degrees, 15 degrees of hysteresis past each diagonal; nyx's own rules were not released). `LsmSystemStatus.deviceOrientation` follows it. *Written, not run* | Acceleration for apps (Mojo's `acceleration` events); the thresholds checked on hardware |
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

### Written for the device, not yet run

What the device shell and its services do on OSE, written against OSE's
sources (cloned and cited: WebAppMgr, luna-surfacemanager, SAM,
webos-connman-adapter, com.webos.service.bluetooth2, luna-sysservice,
audiod-pro, bootd) and tested here with fakes. None of it has run on a
device. Each needs checking on the first image (OPEN-QUESTIONS Q2).

| Area | What it does | How it is checked here |
| --- | --- | --- |
| Cards (C8, C12, G2, R1, R2, S6) | `LsmWindowSource` reads each card surface's window properties (`LsmCards.js`): WebAppMgr's `launchingAppId` places a launched app in the stack of the card in front; `_WEBOS_ACCESS_POLICY_KEYS_BACK` "false" ("LSM should handle it") minimizes the card or returns to its caller without sending Back; a page's `phoenixBack` (a Back it did not take, after the runtime offered it as Escape) does the same later; `phoenixOrientation`, `phoenixFullScreen`, `phoenixStatusBarColor`, `phoenixBlockScreenTimeout` and `phoenixReturnTo` come from the runtime on the device, which sets them with WebAppMgr's `setWindowProperty` for the `PalmSystem` calls WebAppMgr lacks. The image's apps are marked `disableBackHistoryAPI` (`tools/install-rootfs.py`) | `tst_lsmcards`, `tools/test-runtime-device.cjs`. To check: which JavaScript name WebAppMgr's page API gives `setWindowProperty` (the runtime tries `webOSSystem.window.setProperty` first) |
| Status (M2, S2, R1) | `LsmSystemStatus` reads Wi-Fi (com.webos.service.wifi), Bluetooth (bluetooth2: adapter, paired devices, A2DP), VPN (com.webos.service.vpn, LuneOS's adapter), a modem's TTY, HAC, roaming, call forwarding and mobile data (com.palm.telephony, com.palm.wan: none on OSE), audiod's volume, the preferences (tones, System Sounds, keyboard clicks, time format, alerts when locked, airplane mode, Mute Sound, the rotation lock, all of Settings > Advanced) and the orientation (`LsmStatus.js`). The shell's own client permissions for those services: `shell/sysbus/com.webos.surfacemanager.phoenix.perm.json` | `tst_lsmstatus`, `tst_shell` test_modemAndRadioIndicators |
| Start-up | The start-up animation from the first frame, in the style Settings chose: `services/systemmanager` keeps the start-up preferences in `/var/lib/phoenix/systemmanager/startup.json`, which `LsmSystemStatus` reads synchronously (`QML_XHR_ALLOW_FILE_READ` in `product.env`); it ends on bootd's `boot-done` (at least 4 s, at most 90 s: Q19); the shell comes up locked | `systemmanager.test.ts` (the file and its keys) |
| Device lock (K1) | `services/systemmanager`: com.palm.systemmanager (getDeviceLockMode, getSecurityPolicy, setDevicePasscode, matchDevicePasscode, getLockStatus, getDockModeStatus, getSystemStatus; `/phoenix/report` from the shell only), the passcode as salted scrypt (`/var/lib/phoenix/systemmanager/lock.json`, 0600), db8's security policies | `systemmanager.test.ts`. To check: the erase on a policy's last try (Q20) |
| Sounds (A1) | A raw PCM twin (16-bit, 44.1 kHz, stereo) beside every MP3 and WAV the image has, made at build time (`tools/sounds-to-pcm.py`, mpg123-native), because audiod-pro plays a file's bytes as they are; `LsmWindowSource.playSound` plays the twins, loops on audiod's "stopped", stops at the duration | `tools/test-sounds-pcm.py`. To check: the sinks' volumes; sounds added later (Q22) |
| Clipboard (E2) | `services/clipboard`: the runtime's clipboard service in a Node page of its own (store 0600, the passcode from com.palm.systemmanager); the pages' copies go there | `services/clipboard/host.test.ts`, `tools/test-runtime-device.cjs`. To check: the service's name beside the app's (Q21) |
| Orientation (R1) | `phoenix-devices` reads the IIO accelerometer (above) | `devices-test` |
| The pages' line to the shell | `services/shellhost` (`org.webosphoenix.shellhost`, with `.ongoing` and `.system`): a page's `postToHost` posts there with its app id from the bus; the shell alone listens and answers one app (`send`, the page's `events`). Banners, sounds, scene transitions, the edit popup, screen captures, dictation, Just Type, the app menu and card activation go this way (DEVICE-AUDIT.md 1) | `shellhost.test.ts`, `tools/test-runtime-device.cjs`, `tst_lsm` |
| The runtime on WebAppMgr | WebAppMgr's injection has `addBannerMessage`, `setWindowOrientation`, `enableFullScreenMode`, `paste`, `simulateMouseClick` and others, which its `HandleBrowserControlMessage` drops: the runtime replaces them. The page features (fonts, border images, HiDPI art, editing, links, share sheet) run on a device; com.palm.power's timeouts become activity manager activities; the media store writes real files; `com.palm.activitymanager` and `com.palm.downloadmanager` go to OSE's | `tools/test-runtime-device.cjs` (a fake WebAppMgr) |
| Legacy application manager | `services/appmanager`: `com.palm.applicationManager` over SAM (open by type and URL, handlers, listApps, launch points, dock mode), which OSE's SAM lacks; headless apps start with `preload: "partial"` | `appmanager.test.ts` (its tables checked against the runtime's) |
| Device shell | `LsmWindowSource`: the pages' messages, OSE toasts as banners (the stock view's `acceptToasts: false`), the edit popup over a page (`SurfaceHost`), screen captures filed by the file manager's service, Just Type's page as a surface, com.palm.systemui started hidden at boot | `tst_lsm` |
| com.palm.power | `phoenix-devices`: battery and charger from `/sys/class/power_supply` (`batteryStatus`, `USBDockStatus` signals, the queries), activities, `machineOff`/`machineReboot` (the shell is told, then `systemctl` 4.5 s later); the shell's battery reads it | `devices-test` testPower, `tst_lsm` batteryFromPowerd, shutdownFromPowerd |
| DropShare | `services/dropshare`: the simulator's `simdropshare.cpp` as a Node HTTP server, files into `/media/internal/Downloads` | `dropshare.test.ts` (real sockets) |
| Accessories (E4) | `services/accessories`: game controllers and USB drives from PDM, tethering through the connman adapter, battery use per app | `accessories.test.ts` |
| Media keys, now playing | `org.webosphoenix.system`; a media key goes through the shell to `phoenix-devices`, which posts the key | `shellhost.test.ts`, `tst_lsm` mediaKeyIsPressedByPhoenixDevices |
| Open webOS app services | accounts, contacts, linker, calendar reminders under OSE's mojoservicelauncher, with OSE bus files (`compat/app-services`), their db8 kinds and activities | `tools/test-install-rootfs.py` |

`LsmWindowSource` and `LsmSystemStatus` themselves also run in
`shell/tests-device` (`tst_lsm`), over fake luna-surfacemanager modules
(a recording bus the test answers, `LS`, launch points) and fake card
surfaces with WebAppMgr's window properties.

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

#### What is written (10 October 2026; written, not run on a device)

**One keyboard, two hosts.** `VirtualKeyboard.qml` and its JS are the same
files in the simulator and on a device; what differs is its host,
`KeyboardHost.qml` (`sendKey`, `commitText`, `setPreedit`, `hideKeyboard`,
`feedback`, `panelHeight`, `surroundingText`; the host sets `shown`,
`editorState` and calls `inputClientChanged()`). In the simulator
`Shell.qml` is the host (`KeyInjector`, unchanged behaviour); on a device
`Phoenix/Keyboard/MaliitKeyboard.qml` is, over the plugin. What a key types
is one header for both, `shell/native/keytext.h` (a character is committed,
Backspace, Return, Tab and the arrows of cursor control are key events, as
OSE's keyboard sends them: ime-manager `inputmethod.cpp:1104-1105,
1157-1169`).

**The plugin**, `services/keyboard` → `/usr/lib/maliit/plugins/libphoenix-keyboard.so`:

| Maliit (maliit-framework-webos) | The plugin (`PhoenixInputMethod`) |
| --- | --- |
| `InputMethodPlugin` (`inputmethodplugin.h:43-64`) | `PhoenixKeyboardPlugin`: `PhoenixKeyboard`, OnScreen and Hardware (hardware keys handed back unchanged, the base class's `processKeyEvent`) |
| `registerWindow` (`windowgroup.cpp:55-84`: the input panel surface, center bottom) | a `QQuickView` (transparent, frameless) loading `/usr/share/phoenix/qml/Phoenix/Keyboard/MaliitKeyboard.qml`, its width the screen's, its height the keyboard's (`setPanelHeight`, as `keyboard.cpp:247-251`); `setInputMethodArea` all of it; luna-surfacemanager's `KeyboardView` takes the panel's height from the surface (`KeyboardView.qml:58-65`), and the shell makes room for it (`platformKeyboardHeight`) |
| `show`, `hide`, `update` (called after every field change, `mimpluginmanager.cpp:1739-1745`), `handleFocusChange`, `handleClientChange` | the keyboard shown or hidden; `contentType`, `enterKeyType`, `hiddenText`, `autoCapitalizationEnabled`, `surroundingText` read again (`clientChanged`, `cursorMoved` to the QML) |
| `sendCommitString`, `sendKeyEvent`, `sendPreeditString` | the keyboard's characters and commits, its keys, a preedit |
| `notifyImInitiatedHiding` | the hide key: the panel hides (as `keyboard.cpp:134-141`), the server is told |
| `switchPlugin("libplugin-global.so")` | the globe key's "webOS OSE" (V7): OSE's own keyboard |

The field's type (`DeviceKeyboard.editorState`): Maliit's content type and
hidden text (`minputcontextwestonimprotocolconnection.cpp:705-758,
1296-1320`) become the keyboard's PalmIME type: a hidden-text field is a
password, numbers, phone numbers, e-mail and URLs theirs, an enter key
"Search" a search field; no prediction outside text and search fields (the
keyboard's own rule); the enter key's label from the enter key type;
auto-capitals (V1) where the app's field sets the text model's
auto-capitalization hint.

**What the keyboard needs from the system, inside maliit-server**
(`MaliitKeyboard.qml`, `KeyboardBus.qml`; WebOSServices' `Service` as OSE's
keyboard calls the bus, appId `com.webos.service.ime.phoenixKeyboard`):

| Need | How | Permission |
| --- | --- | --- |
| Settings: layouts, Text Assist, number row, style, sounds | `com.webos.service.systemservice/getPreferences` (subscribed): `x_palm_virtualkeyboard_prefs`, `x_palm_virtualkeyboard_settings`, `x_palm_textinput`, `keyboardNumberRow`, `keyboardStyle`, `systemSounds`, read by the runtime's rules (`DeviceKeyboard.js`) | `systemsettings.query` |
| The keyboard in use, "Add" to the dictionary | `setPreferences` | `systemsettings.management` |
| Key sounds | `com.webos.service.audio/playSound`, the file's PCM twin on `pfeedback` (as `LsmWindowSource.playSound`) | `audio.management` |
| Dictation (V2) | Phoenix.Native's `Dictation`: the microphone and `luna-send` to `org.webosphoenix.transcriber` (whisper.cpp). The microphone needs Qt Multimedia, and OSE's `qtmultimedia` recipe is skipped (it fails to build against OSE's Qt), so on a device the keyboard has no microphone key yet (OPEN-QUESTIONS Q35) | luna-send's own |
| Prediction, swipe, emoji | `TextAssist.js`, `EmojiWords.js` in the QML: nothing from outside | none |
| The words it learned, recent emoji | the plugin's files, `/var/lib/phoenix/keyboard/{words,emoji}.json` (0600); the learned words to `com.palm.systemmanager/phoenix/learnedWords` (keyboard only), in `getSystemStatus` for Settings > Personal Dictionary | `systemmanager.keyboard` (new group) |
| The clip strip (E2) | `org.webosphoenix.clipboard` through `ClipboardClient`; the clipboard service takes the keyboard's bus name (and the shell's) as the system UI, which may paste a sensitive clip | `phoenix.clipboard` |
| Haptics | none here: the shell buzzes every tap (UserActivity sees the panel's touches as the compositor) | none |

The groups are granted to `com.webos.service.ime*` in
`/usr/share/luna-service2/client-permissions.d/com.webos.service.ime.phoenix.perm.json`
(phoenix-keyboard). maliit-server's role is imemanager's
(`com.webos.service.ime.role.json`), and luna-service2 lets a client call
only the services its role's `outbound` lists (ls-hubd `security.cpp:684-700`),
a second role for the same executable being skipped
(`service_permissions.cpp:110-141`): meta-phoenix's `imemanager.bbappend`
adds the four services to that list.

**meta-phoenix:** `phoenix-keyboard` (built against maliit-framework-webos's
headers and `libmaliit-plugins`; RDEPENDS phoenix-shell, imemanager,
qml-webos-bridge), in `webos-phoenix-image`;
`maliit-framework-webos.bbappend`: `MALIIT_DEFAULT_PLUGIN=libphoenix-keyboard.so`
and, in `maliit-server.sh`'s first-boot `/var/lib/maliit/server.conf`,
`onscreen\active=libphoenix-keyboard.so:` and Phoenix's keyboard first in
`onscreen\enabled` (maliit-server switches only to enabled plugins,
`mimpluginmanager.cpp:648-653`); OSE's keyboard stays installed and enabled.

**Built and tested here:** the plugin builds against a stand-in of the part
of Maliit's API it uses (`services/keyboard/maliit-stub`, written from
maliit-framework-webos's headers, not copied: they are LGPL); with
`-DPHOENIX_MALIIT_SOURCE_DIR=<maliit-framework-webos checkout>` it is also
compiled against the real headers (`phoenix-keyboard-realapi`; CI does), every
reimplemented method marked `override`. `build/keyboard/keyboard-test` runs
the plugin over a fake Maliit host with the shell's QML (the window
registered, the panel's height and area, letters committed, Backspace and
Return as key events, a candidate's commit, a preedit, the field types,
the text around the cursor and a sentence's capital, show and hide, the
switch to OSE's keyboard, its files); `shell/tests-device/tst_maliitkeyboard.qml`
runs `MaliitKeyboard.qml` over a fake input method and the fake bus (the
settings, sounds, writes, learned words, the clip strip).

#### What the first image must check

1. maliit-server loads `libphoenix-keyboard.so` beside OSE's plugins and
   makes it active (journal: "is loaded successfully"); a fresh
   `/var/lib/maliit/server.conf` has it active and enabled.
2. The plugin's `QQuickView` imports Phoenix.Shell from
   `/usr/share/phoenix/qml` and Phoenix.Native from Qt's QML directory in
   maliit-server's process (no QML errors in the journal), and its window
   becomes the input panel (`KeyboardView` shows it; the shell's
   `platformKeyboardHeight` follows the keyboard's height, number row and
   candidate bar included).
3. Typing in a web app (WAM/Chromium) and a Qt app: letters by
   `commit_string`, Backspace, Return and the arrows (cursor control) by
   `keysym`; corrections (backspaces then a commit) arrive in order;
   `surrounding_text` and the cursor reach the keyboard (prediction from the
   field's words, a capital after ". " where the page asks for one).
4. The field types: Chromium's text-input content purpose and hints for
   password, number, tel, email and url inputs, and `enterkeyhint`.
5. The bus: the role edit took (`ls-monitor`, no "outbound permissions"
   errors), the client permissions merge, `getPreferences` answers, key
   sounds play, the learned words reach Settings, the clip strip lists clips
   and pastes a password into a password field.
6. Dictation, once Qt Multimedia builds (Q35): the microphone opens from
   maliit-server's process (PulseAudio access for its user) and the
   transcriber reads its WAV.
7. The globe key's "webOS OSE" switches to OSE's keyboard, and OSE's
   keyboard's language switching comes back to Phoenix's.
8. Rotation and size: the panel at the bottom of the turned UI
   (`handleAppOrientationChanged`), phone or tablet keyboard by the screen,
   the phone's key popups of the top row (the window is only the keyboard's
   height, so what rises above it is cut off).
9. The hide key: the panel goes but the field keeps the focus (Maliit
   cannot blur the app's field; OPEN-QUESTIONS Q34).

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
| Qualcomm phones (OnePlus 6, Pixel 3a, Fairphone) | Android ABL with fastboot; Android A/B slots on most | Either use the Android slots (`qbootctl`-style slot switching as a RAUC custom backend) or chain-load U-Boot/lk2nd and manage slots ourselves (Duranium avoids Android slots). **Not the Android slots on the Fairphone 6**: switching them with `qbootctl` from Linux bricks it (Nura wiki) |
| AYN Odin 2 Portal | ROCKNIX's replacement ABL, booting the SD card's `extlinux.conf` | Two root partitions on the card, the bootloader's config naming the good one (to design) || Halium devices | Android bootloader, Android A/B or single slot | Same as above; vendor partitions stay untouched |

Bootloader unlocking is a hard limit: carrier-locked US phones (for example
Verizon Pixels) cannot be unlocked and are out.

## Build

- **Layers:** `meta-phoenix` on OSE's `build-webos`, plus per-family BSP
  layers:
  - [`meta-raspberrypi`](https://github.com/agherzan/meta-raspberrypi) (already in OSE)
  - [`meta-pine64-luneos`](https://github.com/webOS-ports/meta-pine64-luneos) (PinePhone, PinePhone Pro, PineTab2; has a scarthgap branch) and [`meta-pine64`](https://github.com/alistair23/meta-pine64) (PineTab2 and boards; now declares styhead to wrynose only)
  - [`meta-qcom`](https://github.com/qualcomm-linux/meta-qcom) for Qualcomm firmware and tooling, with SDM845/SM7225/QCM6490 kernels taken from the postmarketOS device packages. **Not used for the first targets** (11 October 2026): the Fairphone 6 and Odin 2 Portal need only a kernel recipe, `mkbootimg` and the phone's own firmware, which meta-phoenix carries itself ([First targets](#first-targets))
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
| Parse and resolve (`bitbake -p`, `bitbake -n`): **exists**, `.github/workflows/parse.yml` | `qemux86-64`, `raspberrypi4-64`, and the first targets' `fairphone-fp6`, `ayn-odin2portal`, `pinephonepro`, `pinetab2` (11 October 2026), `phoenix-vm-arm64`; every Reference and Supported machine as it is added | Every PR |
| Full image build (shared sstate) | `qemux86-64`, `raspberrypi4-64` | Every merge to main |
| Boot test in QEMU (reach the card view, run app smoke tests) | `qemux86-64` | Every merge |
| Full image build | The first targets' machines | Nightly |
| Hardware-in-the-loop boot test | Reference devices on a USB relay / fastboot rig, as postmarketOS is building | Nightly, once we have the rig (M3) |
| Release images, signed RAUC bundles | All Reference and Supported | Each release |

The parse job (`scripts/parse-check.sh`, see Build above) catches recipes
that do not parse, missing `DEPENDS`/`RDEPENDS` providers, wrong
`bbappend` targets and layer-series mismatches. It cannot catch what only
shows when sources arrive: a wrong `LIC_FILES_CHKSUM` md5, a `SRC_URI` or
`SRCREV` that does not exist upstream, a missing `file://` file (bitbake
only notes its absence while parsing) or a compile error. Those wait for the
full build. LuneOS's PinePhone family machines were not usable for it: their
BSP (`meta-pine64-luneos`, scarthgap branch) needs `meta-rockchip` and
`meta-arm`, and its machines pull `sensorfw`, `qtsensors-sensorfw-plugin`,
`eg25-manager`, `linux-firmware-pine64` and `initramfs-uboot-image` from
LuneOS's own layers (`meta-webos-ports`), which are built for the `luneos`
distro rather than OSE's `webos`. meta-phoenix's own machines of the same
names ([First targets](#first-targets)) need no layer beyond OSE's, so CI
parses them; `eg25-manager` and the sensor stack are still to bring in.
The new machines skip the firmware compression cases, which do not depend
on the machine.

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
