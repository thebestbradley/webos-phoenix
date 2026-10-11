# meta-phoenix

OpenEmbedded layer that adds the Phoenix shell to a webOS OSE build.

| Recipe | What it does |
| --- | --- |
| `phoenix-shell` | Installs the QML shell and Open webOS artwork to `/usr/share/phoenix`, plus `/etc/surface-manager.d/product.env` pointing luna-surfacemanager at it. |
| `phoenix-apps` | The original Open webOS apps and frameworks, the Phoenix web apps, their Node.js Luna services (Files' `org.webosphoenix.filemanager`, Voice Memos' `org.webosphoenix.transcriber`, the Hardware app's `org.webosphoenix.hardware`) and the web app runtime, installed by `tools/install-rootfs.py`, with each app's luna-service2 role and permissions (as meta-webos writes them for OSE's apps) and its activities for the configurator. The built web apps come from `PHOENIX_APPS_DIST` (an archive `tools/pack-apps-dist.sh` or CI's `apps-dist` artifact makes): BitBake runs no npm. |
| `phoenix-diag` | `phoenix-diag`: the journal of the last boots, the kernel log, units, boot timing, memory, storage, devices, network state and a few Luna answers in one archive under `/media/internal/phoenix-diag` (docs/PRE-IMAGE-CHECKLIST.md G2). |
| `phoenix-pty` | `org.webosphoenix.pty`, the Terminal's PTY service (`services/pty`, C++), its luna-service2 files and systemd unit, and the unprivileged `user` account (uid 1000) its shells run as. |
| `phoenix-devices` | LunaSysMgr's device services, which OSE lacks: `com.palm.display`, `com.palm.keys`, `com.palm.vibrate`, `com.palm.ambientLightSensor` (`services/devices`, C++), over the backlight (sysfs), evdev, the vibrator and the IIO light sensor; its luna-service2 files and systemd unit. |
| `phoenix-pdeath` | `phoenix-pdeath SIGNAL -- PROGRAM`: runs a program that ends when its parent dies (`services/pdeath`, C, Apache-2.0); the Assistant service starts llama-server through it. |
| `packagegroup-phoenix-terminal` | The Terminal's shells and tools: bash (the default), zsh, coreutils, less, nano, vim-tiny, tmux, htop, ssh, curl, the xterm-256color terminfo and DejaVu Sans Mono. |
| `packagegroup-phoenix-assistant` | What the Assistant and dictation run: `whisper-cpp` + `whisper-cpp-model-base-en`, `llama-cpp-server` + `phoenix-pdeath`, `qwen3-0.6b-gguf` (the built-in language model, 639 MB; `PHOENIX_BASE_MODEL`), `libvosk` + `vosk-model-small-en-us` (the wake word; x86-64, aarch64 and armv7 only), the voice: `onnxruntime` + `kitten-tts-nano` + `cmudict` for `phoenix-tts` (Kitten TTS, which `phoenix-shell` builds; x86-64 and aarch64, `PHOENIX_KITTEN`), and a fallback speech program (`PHOENIX_TTS`, Flite by default). Larger language models are downloaded in Settings > Assistant. |
| `webos-phoenix-image` | `webos-image` + `phoenix-shell` + `phoenix-apps` + `phoenix-pty` + `phoenix-devices` + `phoenix-diag` + `packagegroup-phoenix-terminal` + `packagegroup-phoenix-assistant` + `kernel-modules` (every open source driver built) + `packagegroup-phoenix-firmware` + `opkg`. `PHOENIX_FIRMWARE_EXCLUDE` leaves firmware out of a small image; `PHOENIX_PRODUCTION = "1"` leaves out OSE's pre-release debug-tweaks (root without a password) and its SSH server. |
| `linux-yocto`, `linux-raspberrypi` (bbappends) | Config fragments (`recipes-kernel/linux/files/phoenix-hardware*.cfg`) that build the drivers for as much hardware as possible as modules: USB classes, HID and input, storage, Wi-Fi, Bluetooth, GPUs, cameras, sensors. OE packages each module on its own (`kernel-module-*`). |
| `packagegroup-phoenix-firmware` | The redistributable firmware for common Wi-Fi, Bluetooth, Ethernet and graphics hardware (linux-firmware split per chip, with its licence packages), recommended so it can be excluded; about 570 MB as shipped, 216 MB with `PHOENIX_FIRMWARE_COMPRESS = "xz"`, 232 MB with `"zstd"` (docs/HARDWARE.md, "Firmware in the image"). |
| `linux-firmware` (bbappend) | `PHOENIX_FIRMWARE_COMPRESS` (in `local.conf`; default `""`, the files as shipped): `"xz"` or `"zstd"` compresses the firmware after `do_install` as upstream's `copy-firmware.sh --xz/--zstd` does (links remade to the compressed names, licence files left as they are, each package's `FILES` matching the new names) and logs the size before and after. |
| `phoenix-firmware-policy` (class) | Fails an image that would install firmware whose licence does not allow redistribution (`PHOENIX_FIRMWARE_LICENSES`), and writes `/usr/share/phoenix/firmware/licences.json` (each firmware package, its licence and licence files, shown in Settings > Device Info). |
| `rtl8812au`, `rtl8814au` | Out-of-tree USB Wi-Fi drivers (aircrack-ng's 88XXau for RTL8812AU/8821AU; morrownr's 8814au) built per kernel into `lib/modules/<kernel>/updates`, for the Hardware app; not in the image. GPL-2.0. |
| `phoenix-driver-feed` | Collects what the Hardware app offers beyond the image (the out-of-tree drivers; firmware for images built without it), with a driver manifest each (`files/drivers/*.json`), into `${DEPLOY_DIR_IMAGE}/phoenix-drivers/` for `server/drivers` (docs/DRIVERS.md). Not in the image. |
| `phoenix-device-config` | `/etc/phoenix/device.json` (form factor, density, Home button, ringer switch) and `/etc/phoenix/compositor.env` (the compositor's geometry, which `product.env` sources) for the `MACHINE` (`files/<MACHINE>/`, else the defaults). In the image. |
| Machines (`conf/machine/`) | `fairphone-fp6` (Fairphone 6 and 6+), `ayn-odin2portal`, `pinephone`, `pinephonepro`, `pinetab2`, on `include/phoenix-mobile.inc`; no BSP layer needed. `scripts/setup-build.sh` adds them to build-webos's `Machines`. docs/HARDWARE.md, "First targets". |
| `linux-phoenix-milos`, `-ayn`, `-megi`, `-pinetab2` | Each device's kernel tree at a pinned commit (milos-mainline, AYN's, megi's, DanctNIX's) with the configuration its distribution uses (pmaports, ROCKNIX), plus `phoenix-hardware*.cfg` (never demoting a built-in) and `phoenix-ose.cfg` (`linux-phoenix-device.inc`). GPL-2.0-only. |
| `phoenix-bootimg`, `mkbootimg-native` | The Fairphone's Android boot image (`boot-<MACHINE>.img`, header v2, AOSP's mkbootimg at `android-16.0.0_r1`). The other devices boot `wic/phoenix-extlinux.wks.in` (GPT, FAT boot partition with `extlinux.conf`, ext4 root). |

None of these has been built on real hardware yet: CI parses and
dry-runs them (below). Sizes, licences and why each model is in the image
or downloaded: docs/AI-AND-MCP.md, "What's installed where".

Depends on `meta-webos` and `meta-qt6` (scarthgap, Qt 6.8), as pinned by
webOS OSE's `build-webos/weboslayers.py`. Use `scripts/setup-build.sh` from
the repository root to set up a build directory with this layer added.

## Checking the layer without a build host

Before the first image: docs/PRE-IMAGE-CHECKLIST.md, and
`./phoenix check-device` (the static checkers: Luna calls and ACG groups,
the image's contents against these recipes' `FILES`, the recipes'
licences, pins and units, simulator-only references, licences of what
ships), which CI runs on every change.

`scripts/parse-check.sh [MACHINE...]` (default `qemux86-64 raspberrypi4-64`;
CI also runs `fairphone-fp6 ayn-odin2portal pinephone pinephonepro pinetab2`)
parses every recipe and dry-runs `webos-phoenix-image` (plus the `torchd`
stub; and, on the first machine, the image again with
`PHOENIX_FIRMWARE_COMPRESS` set to `xz` and to `zstd`) for each machine, with the same pinned layers but
without fetching or building anything: about 200 MB of layers plus 300 MB
and about 12 minutes per machine. CI runs it on every pull request
(`.github/workflows/parse.yml`). The recipes take `PHOENIX_SRCREV` from the
checkout's HEAD there. Run it as an ordinary user (bitbake will not run as
root); see the script's header and docs/HARDWARE.md, "Build".
