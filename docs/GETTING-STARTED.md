# Getting started: install, run, test, deploy

This page takes you from a new machine to a running webOS Phoenix simulator,
the test suites, and (later) an OS image for a device. It covers a Mac
(Apple silicon or Intel), Ubuntu, and Claude Code agents working on the
repository.

Everything is in this one repository, the simulator included:

| Part | Where | What it is |
| --- | --- | --- |
| The system UI | `shell/qml/Phoenix/Shell` | The QML shell a device runs |
| The simulator | `shell/sim` (`phoenix-sim`) | A desktop app that runs that same shell, with simulated hardware and services |
| The web app runtime | `runtime/` | webOS's `PalmSystem` and Luna services, for the simulator and browsers |
| Phoenix's apps | `apps/` | Settings, Phone, Messaging and the rest (React + TypeScript) |
| The original apps | `third_party/` (git submodules) | Open webOS apps and frameworks, unmodified |
| The OS image layer | `meta-phoenix/`, `scripts/` | Adds Phoenix to a webOS OSE image for devices |

The simulator doesn't need a repository of its own. It builds the same QML,
runtime and apps a device runs, and keeping them together means one change
and one test run covers both.

## Get the code

```sh
git clone --recurse-submodules https://github.com/thebestbradley/webos-phoenix.git
cd webos-phoenix
```

`main` has the current work. In a checkout from before October 2026, which
used the `tbb/nice-maxwell-ps69wb` branch, switch back with
`git checkout main && git pull && git submodule update --init`.

## On a Mac

### 1. Prerequisites (once)

- **Xcode command line tools:** `xcode-select --install`
- **Homebrew:** see [brew.sh](https://brew.sh). On Apple silicon it lives in
  `/opt/homebrew`; follow the lines it prints at the end to put it on your PATH.
- **Disk:** about 6 GB for the tools, the checkout and a build.

### 2. Install and build

Run each command on its own (zsh doesn't treat `#` as a comment when you
paste, so don't paste notes after a command):

| Command | What it does |
| --- | --- |
| `scripts/mac-setup.sh --check` | What is installed and what is missing |
| `scripts/mac-setup.sh` | Install Qt, CMake, Ninja, Node 22, Python; build |
| `scripts/mac-setup.sh --all` | The same, plus the test tools and voice (whisper.cpp) |

The script uses Homebrew's `qt` (it includes Qt WebEngine and Qt 5 Compat,
which the simulator needs), `cmake`, `ninja`, `node@22` and
`python@3.12`. It is safe to run again; it skips what is already there.

Node: use **Node 22** (or 24). Homebrew's plain `node` can be an
odd-numbered release, which Enact's tools refuse. `node@22` isn't put on
the PATH by Homebrew, so add it once:

```sh
echo 'export PATH="$(brew --prefix)/opt/node@22/bin:$PATH"' >> ~/.zprofile
```

Doing it by hand instead of the script:

```sh
brew install qt cmake ninja node@22
export PATH="$(brew --prefix)/opt/node@22/bin:$PATH"
git submodule update --init
cmake -S shell -B build -G Ninja -DCMAKE_PREFIX_PATH="$(brew --prefix qt)"
cmake --build build
```

`cmake --build build` also runs `npm ci` and builds the apps in `apps/`.

### 3. Run it

| Command | What it does |
| --- | --- |
| `./build/phoenix-sim` | A phone (Pre, 320x480) |
| `./build/phoenix-sim --tablet` | A tablet (TouchPad, 1024x768) |
| `./build/phoenix-sim --size 480x800 --scale 1.5` | Pre 3 |
| `./build/phoenix-sim --tablet --size 2560x1600 --scale 2` | A large tablet |
| `./build/phoenix-sim --launch com.palm.app.notes` | Open an app at start-up |
| `./build/phoenix-sim --help` | Every option |

On a Retina screen it draws at 2x by itself.

Keys: **Esc** is Back and **Home** the Home button. The function keys are
the device's buttons and events (F3 Power, F4 an incoming call, F5 a text,
F12 a Touchstone, and so on; the README has the full list). **On a Mac, F1
to F12 need fn**, because macOS keeps them for itself. You can change that in
System Settings > Keyboard > "Use F1, F2, etc. keys as standard function keys".

The simulator keeps the device's data (apps' data, installed apps, media) in
`~/Library/Application Support/webos-phoenix/phoenix-sim/` and its own
settings (First Use done, window, Touchstone) in
`~/Library/Preferences/com.webos-phoenix.phoenix-sim.plist`. `--first-use`
runs First Use again. Full Erase (hold F3 and F11, then Home) wipes the
device's data the way a phone does. On Linux they are
`~/.local/share/webos-phoenix/phoenix-sim/` and
`~/.config/webos-phoenix/phoenix-sim.conf`.

### 4. Voice (optional)

The keyboard's microphone, Voice Memos and Voice Dial transcribe with
whisper.cpp. `scripts/mac-setup.sh --voice` installs it with the English
model, then:

```sh
echo 'export PHOENIX_WHISPER_MODEL="$HOME/Library/Application Support/webos-phoenix/whisper/ggml-base.en.bin"' >> ~/.zprofile
```

macOS asks for microphone access the first time. Without a microphone,
`--microphone-file some.wav` plays a WAV file as one.

### 5. Optional demos

- **Flutter Notes:** built when Flutter is installed (`brew install --cask flutter`).
- **Enact Notes:** built when Node is 22 or 24.

## On Ubuntu 24.04 (desktop, VM or a cloud container)

| Command | What it does |
| --- | --- |
| `scripts/linux-setup.sh` | Qt 6, CMake, Node 22; fetch submodules; build |
| `scripts/linux-setup.sh --tests` | Also the test tools |

Then `./build/phoenix-sim`.

Without a display (SSH, containers), run it under Xvfb:

```sh
QTWEBENGINE_DISABLE_SANDBOX=1 xvfb-run -a -s "-screen 0 1920x1200x24" \
  ./build/phoenix-sim --tablet --scene cards --screenshot out.png
```

`QTWEBENGINE_DISABLE_SANDBOX=1` is only needed when running as root
(containers); Chromium's sandbox refuses root.

## Testing

Install the test tools first: `scripts/mac-setup.sh --tests` or
`scripts/linux-setup.sh --tests`. On a Mac, activate the Python packages the
script put in `.venv` before the DAV and backup tests:
`source .venv/bin/activate`.

| What | Command |
| --- | --- |
| Shell behaviour tests (QML) | `QT_QPA_PLATFORM=offscreen qmltestrunner -import shell/qml -import build/qml -input shell/tests` |
| One QML test file | the same with `-input shell/tests/tst_launcher.qml` |
| Web apps: typecheck and unit tests | `cd apps && npm run typecheck && npx vitest run` |
| Web apps in headless Chromium | `NODE_PATH="$(npm root -g)" node tools/test-apps.cjs` (and the other `tools/test-*.cjs`, listed in the README) |
| HiDPI art | `python3 tools/hidpi-art.py --check` |
| Image recipes (parse only) | `scripts/parse-check.sh` (Linux only, about 25 minutes, see [HARDWARE.md](HARDWARE.md#build)) |

`qmltestrunner` is in Qt's `bin` directory: on a Mac
`"$(brew --prefix qt)/bin/qmltestrunner"`; on Ubuntu
`/usr/lib/qt6/bin/qmltestrunner`.

CI runs all of this on every push (`.github/workflows/ci.yml`); what passes
there should pass locally, and the reverse.

## Deploying to devices

The simulator is for developing the UI and apps. A device needs an OS image:
webOS OSE with the `meta-phoenix` layer.

1. **Check the layer** (any Linux machine, no build host needed):
   `scripts/parse-check.sh qemux86-64 raspberrypi4-64`. Every recipe parses and
   the whole image resolves, in about 25 minutes and 1 GB.
2. **Build an image** (about 200-300 GB of disk and hours the first time):
   - On a Mac with Apple silicon and macOS 26: `scripts/mac-build.sh`
     ([BUILDING-MAC.md](BUILDING-MAC.md)). It runs the x86-64 build under Rosetta
     with Apple's `container` tool.
   - On an x86-64 Ubuntu machine or server: `scripts/setup-build.sh`, then
     `bitbake webos-phoenix-image` (see the README's "Build a webOS OSE image").
3. **Run it:** `qemux86-64` in QEMU; `raspberrypi4-64` written to an SD card
   (`*.wic`). Which phones and tablets are supported, and how drivers are found
   and installed, is in [HARDWARE.md](HARDWARE.md).

A MacBook isn't a target device; on a Mac you develop with the simulator,
and build images with `scripts/mac-build.sh` when you need one.

## Working with Claude Code

[CLAUDE.md](../CLAUDE.md) at the root of the repository tells Claude Code
(on your Mac, or in a cloud session) how the project is built and tested and
what its rules are. It is read automatically at the start of each session.

- **On your Mac:** install Claude Code, run `claude` in the checkout. It
  uses your local build and simulator; it can launch the simulator, take
  screenshots with `--screenshot`, and run the tests above.
- **Cloud sessions (claude.ai/code):** each session starts in a fresh Ubuntu
  container. Put this in the cloud environment's **Setup script** (the
  environment's settings, Edit) so every session starts with the tools
  installed:

  ```sh
  scripts/linux-setup.sh --deps
  ```

  The session then builds with `cmake -S shell -B build && cmake --build build`
  and runs the simulator under Xvfb as above.
- **Agents in parallel:** each works in its own git worktree under
  `.claude/worktrees/`. A worktree needs its own `build/` (CMake) and can
  share `apps/node_modules` by a symlink to the main checkout's. Remove the
  symlink, not what it points to, when the worktree is done.

## Troubleshooting

- **"Could not find a package configuration file provided by Qt6":** CMake
  can't find Homebrew's Qt. Pass `-DCMAKE_PREFIX_PATH="$(brew --prefix qt)"`,
  or delete `build/` and run `scripts/mac-setup.sh` again.
- **Apps show placeholders instead of web apps:** Qt WebEngine wasn't found
  at configure time. On Ubuntu install `qt6-webengine-dev
  qml6-module-qtwebengine`; then delete `build/` and configure again.
- **"phoenix-apps: npm not found" or the Enact demos are skipped:** Node 22
  isn't on the PATH in the terminal you ran CMake from. Add it (above), then
  run `cmake -S shell -B build` again.
- **"generator Ninja does not match":** `build/` was made with another
  generator. Delete `build/` or keep using its generator.
- **A web app shows an old version:** `cmake --build build` rebuilds the apps
  when their sources change; to force it, `cd apps && npm run build`.
- **F-keys do nothing on a Mac:** hold **fn**, or change the keyboard setting
  above.
- **The window is blank on a Linux VM:** set `QT_QUICK_BACKEND=software` or
  enable 3D acceleration in the VM.
