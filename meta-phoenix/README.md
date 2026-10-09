# meta-phoenix

OpenEmbedded layer that adds the Phoenix shell to a webOS OSE build.

| Recipe | What it does |
| --- | --- |
| `phoenix-shell` | Installs the QML shell and Open webOS artwork to `/usr/share/phoenix`, plus `/etc/surface-manager.d/product.env` pointing luna-surfacemanager at it. |
| `phoenix-apps` | The original Open webOS apps and frameworks, the Phoenix web apps, their Node.js Luna services (Files' `org.webosphoenix.filemanager`, Voice Memos' `org.webosphoenix.transcriber`, the Hardware app's `org.webosphoenix.hardware`) and the web app runtime, installed by `tools/install-rootfs.py`. |
| `phoenix-pty` | `org.webosphoenix.pty`, the Terminal's PTY service (`services/pty`, C++), its luna-service2 files and systemd unit, and the unprivileged `user` account (uid 1000) its shells run as. |
| `phoenix-devices` | LunaSysMgr's device services, which OSE lacks: `com.palm.display`, `com.palm.keys`, `com.palm.vibrate`, `com.palm.ambientLightSensor` (`services/devices`, C++), over the backlight (sysfs), evdev, the vibrator and the IIO light sensor; its luna-service2 files and systemd unit. |
| `packagegroup-phoenix-terminal` | The Terminal's shells and tools: bash (the default), zsh, coreutils, less, nano, vim-tiny, tmux, htop, ssh, curl, the xterm-256color terminfo and DejaVu Sans Mono. |
| `packagegroup-phoenix-assistant` | What the Assistant and dictation run: `whisper-cpp` + `whisper-cpp-model-base-en`, `llama-cpp-server`, `libvosk` + `vosk-model-small-en-us` (the wake word; x86-64, aarch64 and armv7 only) and a speech program (`PHOENIX_TTS`, Flite by default). The language models are downloaded in Settings > Assistant. |
| `webos-phoenix-image` | `webos-image` + `phoenix-shell` + `phoenix-apps` + `phoenix-pty` + `phoenix-devices` + `packagegroup-phoenix-terminal` + `packagegroup-phoenix-assistant` + `kernel-modules` (every open source driver built) + `packagegroup-phoenix-firmware` + `opkg`. `PHOENIX_FIRMWARE_EXCLUDE` leaves firmware out of a small image. |
| `linux-yocto`, `linux-raspberrypi` (bbappends) | Config fragments (`recipes-kernel/linux/files/phoenix-hardware*.cfg`) that build the drivers for as much hardware as possible as modules: USB classes, HID and input, storage, Wi-Fi, Bluetooth, GPUs, cameras, sensors. OE packages each module on its own (`kernel-module-*`). |
| `packagegroup-phoenix-firmware` | The redistributable firmware for common Wi-Fi, Bluetooth, Ethernet and graphics hardware (linux-firmware split per chip, with its licence packages), recommended so it can be excluded; about 570 MB as shipped, 216 MB with `PHOENIX_FIRMWARE_COMPRESS = "xz"`, 232 MB with `"zstd"` (docs/HARDWARE.md, "Firmware in the image"). |
| `linux-firmware` (bbappend) | `PHOENIX_FIRMWARE_COMPRESS` (in `local.conf`; default `""`, the files as shipped): `"xz"` or `"zstd"` compresses the firmware after `do_install` as upstream's `copy-firmware.sh --xz/--zstd` does (links remade to the compressed names, licence files left as they are, each package's `FILES` matching the new names) and logs the size before and after. |
| `phoenix-firmware-policy` (class) | Fails an image that would install firmware whose licence does not allow redistribution (`PHOENIX_FIRMWARE_LICENSES`), and writes `/usr/share/phoenix/firmware/licences.json` (each firmware package, its licence and licence files, shown in Settings > Device Info). |
| `rtl8812au`, `rtl8814au` | Out-of-tree USB Wi-Fi drivers (aircrack-ng's 88XXau for RTL8812AU/8821AU; morrownr's 8814au) built per kernel into `lib/modules/<kernel>/updates`, for the Hardware app; not in the image. GPL-2.0. |
| `phoenix-driver-feed` | Collects what the Hardware app offers beyond the image (the out-of-tree drivers; firmware for images built without it), with a driver manifest each (`files/drivers/*.json`), into `${DEPLOY_DIR_IMAGE}/phoenix-drivers/` for `server/drivers` (docs/DRIVERS.md). Not in the image. |

None of these has been built on real hardware yet: CI parses and
dry-runs them (below). Sizes, licences and why each model is in the image
or downloaded: docs/AI-AND-MCP.md, "What's installed where".

Depends on `meta-webos` and `meta-qt6` (scarthgap, Qt 6.8), as pinned by
webOS OSE's `build-webos/weboslayers.py`. Use `scripts/setup-build.sh` from
the repository root to set up a build directory with this layer added.

## Checking the layer without a build host

`scripts/parse-check.sh [MACHINE...]` (default `qemux86-64 raspberrypi4-64`)
parses every recipe and dry-runs `webos-phoenix-image` (plus the `torchd`
stub; and, on the first machine, the image again with
`PHOENIX_FIRMWARE_COMPRESS` set to `xz` and to `zstd`) for each machine, with the same pinned layers but
without fetching or building anything: about 200 MB of layers plus 300 MB
and about 12 minutes per machine. CI runs it on every pull request
(`.github/workflows/parse.yml`). The recipes take `PHOENIX_SRCREV` from the
checkout's HEAD there. Run it as an ordinary user (bitbake will not run as
root); see the script's header and docs/HARDWARE.md, "Build".
