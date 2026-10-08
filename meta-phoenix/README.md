# meta-phoenix

OpenEmbedded layer that adds the Phoenix shell to a webOS OSE build.

| Recipe | What it does |
| --- | --- |
| `phoenix-shell` | Installs the QML shell and Open webOS artwork to `/usr/share/phoenix`, plus `/etc/surface-manager.d/product.env` pointing luna-surfacemanager at it. |
| `phoenix-apps` | The original Open webOS apps and frameworks, the Phoenix web apps, their Node.js Luna services (Files' `org.webosphoenix.filemanager`, Voice Memos' `org.webosphoenix.transcriber`) and the web app runtime, installed by `tools/install-rootfs.py`. |
| `phoenix-pty` | `org.webosphoenix.pty`, the Terminal's PTY service (`services/pty`, C++), its luna-service2 files and systemd unit, and the unprivileged `user` account (uid 1000) its shells run as. |
| `phoenix-devices` | LunaSysMgr's device services, which OSE lacks: `com.palm.display`, `com.palm.keys`, `com.palm.vibrate`, `com.palm.ambientLightSensor` (`services/devices`, C++), over the backlight (sysfs), evdev, the vibrator and the IIO light sensor; its luna-service2 files and systemd unit. |
| `packagegroup-phoenix-terminal` | The Terminal's shells and tools: bash (the default), zsh, coreutils, less, nano, vim-tiny, tmux, htop, ssh, curl, the xterm-256color terminfo and DejaVu Sans Mono. |
| `packagegroup-phoenix-assistant` | What the Assistant and dictation run: `whisper-cpp` + `whisper-cpp-model-base-en`, `llama-cpp-server`, `libvosk` + `vosk-model-small-en-us` (the wake word; x86-64, aarch64 and armv7 only) and a speech program (`PHOENIX_TTS`, Flite by default). The language models are downloaded in Settings > Assistant. |
| `webos-phoenix-image` | `webos-image` + `phoenix-shell` + `phoenix-apps` + `phoenix-pty` + `phoenix-devices` + `packagegroup-phoenix-terminal` + `packagegroup-phoenix-assistant`. |
| `whisper-cpp` | whisper.cpp's `whisper-cli` (static) and the `ggml-base.en.bin` model (`whisper-cpp-model-base-en`, 148 MB, to `/usr/share/whisper`) for the transcriber (dictation, Voice Memos, Voice Dial, the Assistant). MIT. |
| `llama-cpp` | llama.cpp's `llama-server` (`llama-cpp-server`, static, b11239), the Assistant's on-device model runner. MIT. |
| `libvosk` | Vosk's `libvosk.so` for the wake word, **prebuilt** (Alpha Cephei's PyPI wheels, SHA-256 checked); Apache-2.0 with BSD-3-Clause parts. A from-source recipe (Kaldi, OpenFST, OpenBLAS) is to do. |
| `vosk-model-small-en-us` | The wake word's model (71 MB) in `/usr/share/phoenix/wakeword`. Apache-2.0. |

None of these has been built on real hardware yet: CI parses and
dry-runs them (below). Sizes, licences and why each model is in the image
or downloaded: docs/AI-AND-MCP.md, "What's installed where".

Depends on `meta-webos` and `meta-qt6` (scarthgap, Qt 6.8), as pinned by
webOS OSE's `build-webos/weboslayers.py`. Use `scripts/setup-build.sh` from
the repository root to set up a build directory with this layer added.

## Checking the layer without a build host

`scripts/parse-check.sh [MACHINE...]` (default `qemux86-64 raspberrypi4-64`)
parses every recipe and dry-runs `webos-phoenix-image` (plus the `torchd`
stub) for each machine, with the same pinned layers but
without fetching or building anything: about 200 MB of layers plus 300 MB
and about 12 minutes per machine. CI runs it on every pull request
(`.github/workflows/parse.yml`). The recipes take `PHOENIX_SRCREV` from the
checkout's HEAD there. Run it as an ordinary user (bitbake will not run as
root); see the script's header and docs/HARDWARE.md, "Build".
