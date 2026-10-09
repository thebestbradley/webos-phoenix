# Getting started: install, run, test, deploy

This page takes you from a new machine to a running webOS Phoenix simulator,
the test suites, and (later) an OS image for a device. It covers a Mac
(Apple silicon or Intel), Ubuntu, and Claude Code agents working on the
repository.

Everything is in this one repository, the simulator included:

| Part | Where | What it is |
| --- | --- | --- |
| The system UI | `shell/qml/Phoenix/Shell` | The QML shell a device runs |
| The simulator, the Phoenix WebOS Simulator | `shell/sim` (`phoenix-sim`) | A desktop app that runs that same shell, with simulated hardware and services |
| The web app runtime | `runtime/` | webOS's `PalmSystem` and Luna services, for the simulator and browsers |
| Phoenix's apps | `apps/` | Settings, Phone, Messaging and the rest (React + TypeScript) |
| The original apps | `third_party/` (git submodules) | Open webOS apps and frameworks, unmodified |
| The OS image layer | `meta-phoenix/`, `scripts/` | Adds Phoenix to a webOS OSE image for devices |

The simulator doesn't need a repository of its own. It builds the same QML,
runtime and apps a device runs, and keeping them together means one change
and one test run covers both.

## The one command

```sh
./phoenix run
```

`./phoenix` at the top of the checkout is all a Mac or Ubuntu needs: it
checks what is installed, installs only what is missing, builds, and starts
the simulator. Run again with everything there, it takes about two seconds
plus the incremental build.

| Command | What it does |
| --- | --- |
| `./phoenix` (or `./phoenix build`) | Install what is missing, then build |
| `./phoenix run` | Build if needed, then start the simulator, adaptive (below) |
| `./phoenix run phone` / `./phoenix run tablet` | A fixed phone (Pre, 320x480) or tablet (TouchPad, 1024x768) |
| `./phoenix run tablet --scene cards` | Anything after the mode goes to `phoenix-sim` (`--help` lists it all) |
| `./phoenix check` | Only say what is there and what would be installed (also `--dry-run`) |
| `./phoenix setup` | Install what is missing, without building |
| `--no-assistant` | Without the assistant's parts (whisper.cpp, llama.cpp, their models, the wake word, the voice) |
| `--offline` | Download nothing; it fails only when something the build needs is missing |
| `./phoenix run --marketplace` | With the Marketplace's catalog running on this computer, and the Marketplace open |
| `--tests` | Also the test tools (Playwright, Radicale, WsgiDAV, PHP's MySQL driver, xvfb) |

What it checks, and installs when missing (it prints each one's size first):

- **Mac:** Xcode's command line tools (Apple's installer opens; run it again
  after), Homebrew (asks for your password), then Homebrew's `qt`, `cmake`,
  `ninja`, `node@22`, `git`, `python@3.12`, `php`, `whisper-cpp`,
  `llama.cpp` and `onnxruntime`, in one `brew install`.
- **Ubuntu:** the apt packages (build tools, the libraries Qt loads, and
  `php-cli` and `php-sqlite3` for the Marketplace's catalog),
  Qt 6.8.1 into `/opt/Qt` with aqtinstall (Ubuntu's own Qt is 6.4),
  Node.js 22 (NodeSource), espeak-ng, and `whisper-cli` and `llama-server`
  built from the commits meta-phoenix pins into `/usr/local/bin`. It asks
  for sudo when it installs.
- **Both:** the git submodules, the apps' npm packages, whisper's model
  (148 MB) and the wake word (Vosk, about 90 MB) into `build/`, each
  checked by its SHA-256; then CMake, configured with the Qt it found
  (`brew --prefix qt`, `/opt/Qt/6.8.1/gcc_64`, `PHOENIX_QT_DIR`, or the one
  `build/` already has), and the build.

At the end it lists what it installed. `scripts/mac-setup.sh` and
`scripts/linux-setup.sh` still work, with their options: they call
`./phoenix`. The sections below are the same steps by hand.

### Phone, tablet, or both: the adaptive simulator

`./phoenix run` (and `phoenix-sim --adaptive`, or `phoenix-sim` without
`--phone` or `--tablet`) is adaptive: resize the window and the shell is a
phone while the screen's shorter side is under 600 pixels and a tablet from
there, switching live, with the apps running on. The card view, the
launcher and dock, the status bar, the keyboard (a keyboard that is up stays
up, as the other one), notifications and the assistant lay themselves out
again; the web apps get a resize, as on a turn, and their
`PalmSystem.deviceInfo` reports the new screen. The window's title says the
size and the layout.

**View > Device Size** snaps the window to a device: the Pre (320x480), the
Pre 3 (its 480x800 at 1.5x is 320x533), a modern phone (393x852), a
foldable folded (344x882) and open (690x829), the TouchPad (1024x768) and a
modern tablet (1180x820). **View > Phone** and **Tablet** snap to the Pre
and the TouchPad. Turning the device (Ctrl+Left, Ctrl+Right) still works at
any size: a phone on its side stays a phone, a tablet stands up.

What does not change live: the density (**View > Scale** restarts, keeping
the size), and the apps the system starts at boot and keeps alive (the
phone's and the TouchPad's lists differ; luna.conf, luna-topaz.conf): they
are the ones of the layout the simulator started in, until a restart. Apps
that read the screen's size only once (some original Mojo and Enyo apps)
keep their first layout until they are relaunched; their window still
resizes.

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

`./phoenix` does it all (above). Run each command on its own (zsh doesn't
treat `#` as a comment when you paste, so don't paste notes after a
command):

| Command | What it does |
| --- | --- |
| `./phoenix check` | What is installed and what is missing |
| `./phoenix` | Install Qt, CMake, Ninja, Node 22, Python; build; the assistant's voice and model runner (see 4) |
| `./phoenix --tests` | The same, plus the test tools |
| `./phoenix --no-assistant` | Without the assistant's parts (about 230 MB of models and two Homebrew packages) |

It uses Homebrew's `qt` (it includes Qt WebEngine and Qt 5 Compat,
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
| `./phoenix run` | Adaptive: a phone or a tablet by the window's size (above) |
| `./build/phoenix-sim` | The same, without building first |
| `./build/phoenix-sim --phone` | A phone (Pre, 320x480) |
| `./build/phoenix-sim --tablet` | A tablet (TouchPad, 1024x768) |
| `./build/phoenix-sim --size 480x800 --scale 1.5` | Pre 3 |
| `./build/phoenix-sim --tablet --size 2560x1600 --scale 2` | A large tablet |
| `./build/phoenix-sim --launch com.palm.app.notes` | Open an app at start-up |
| `./build/phoenix-sim --no-toolbar` | Without the toolbar beside the screen |
| `./build/phoenix-sim --marketplace` | With the Marketplace's catalog (below), the Marketplace open |
| `./build/phoenix-sim --help` | Every option |

On a Retina screen it draws at 2x by itself.

The window is the **Phoenix WebOS Simulator**. Its menus (on a Mac, in the
menu bar at the top of the screen) do everything the simulator can: **Device**
(Power, Home, Back, volume, rotate, screen capture, the key chords),
**Simulate** (calls, messages, notifications, battery, chargers, USB,
Touchstone, Touch to Share, headset, light), **View** (phone, tablet or adaptive, device sizes, scale,
demo scenes, developer overlays), **Services** (the Marketplace's catalog,
below) and **Help > Keyboard Shortcuts…**, a window listing every key. The toolbar beside the screen has the most used ones as
icons (hover for the key); **View > Hide Toolbar** or `--no-toolbar` hides it.
Its two keyboard buttons say what they do: **Attach / Detach Hardware
Keyboard** (Ctrl+Shift+K) and **Show / Hide Virtual Keyboard** (Ctrl+Shift+O).

On a Mac the simulator is started from a terminal, which keeps the menu bar
until the simulator's window comes to the front (macOS shows the active
app's menus). Click the simulator's window if its menus (Device, Simulate,
View, Services, Help) are not at the top of the screen; they then stay
whatever you click in it. `./build/phoenix-sim --check-chrome` prints what
the menu bar has and whether the simulator is the active app.

Keys: **Esc** is Back and **Home** the Home button. The function keys are
the device's buttons and events (F3 Power, F4 an incoming call, F5 a text,
F12 a Touchstone, and so on; each menu item shows its key, and Help >
Keyboard Shortcuts and the README have the full list). **On a Mac, F1 to F12
need fn**, because macOS keeps them for itself (the menus and the shortcuts
window say "fn F4"). You can change that in System Settings > Keyboard >
"Use F1, F2, etc. keys as standard function keys".

The simulator keeps the device's data (apps' data, installed apps, media) in
`~/Library/Application Support/webos-phoenix/phoenix-sim/` and its own
settings (First Use done, window, Touchstone) in
`~/Library/Preferences/com.webos-phoenix.phoenix-sim.plist`. `--first-use`
runs First Use again. Full Erase (hold F3 and F11, then Home) wipes the
device's data the way a phone does. On Linux they are
`~/.local/share/webos-phoenix/phoenix-sim/` and
`~/.config/webos-phoenix/phoenix-sim.conf`.

**The Marketplace's catalog.** The Marketplace app reads the Phoenix
catalog from a service on this computer for now (`server/marketplace`, PHP 8
with sodium and pdo_sqlite, which `./phoenix` installs), at
`http://127.0.0.1:8088/`. To start it, pick **Services > Marketplace
Catalog**. The first time it sets itself up (its database, its signing key,
the curated web apps), which takes a moment; the menu item says "setting
up", then "running at 127.0.0.1:8088", and the Marketplace opens. The first
time, the Marketplace shows the catalog's key: tap **Trust This Catalog**.
Other ways in: **Start Local Catalog** on the Marketplace's "Can't reach
Phoenix Marketplace" card, `./phoenix run --marketplace`, or **Services >
Start Catalog with the Simulator**, which starts it with every run (off by
default). If it fails, a box says why (most often PHP missing or without
sodium) with **Show Log** (`server/marketplace/data/simulator.log`; the menu
has **Show Catalog Log** too). **Open Catalog in Browser** opens its review
page, `/admin`, whose token is in `server/marketplace/data/admin.token`. It
stops with the simulator; if another simulator already runs one, it is used.

### 4. Voice and the assistant

The keyboard's microphone, Voice Memos, Voice Dial and the assistant
transcribe with whisper.cpp; the assistant's on-device model runs on
llama.cpp (Qwen3 0.6B built in), "Hey Phoenix" on Vosk, and answers are
spoken by Kitten TTS (`phoenix-tts`; `say` when it cannot).
`./phoenix` installs them by default: Homebrew's `whisper-cpp`,
`llama.cpp` and `onnxruntime`, whisper's English model (148 MB) into
`build/whisper`, the wake word (Vosk, 84 MB) into `build/wakeword`, Kitten
TTS's model and the CMU dictionary (28 MB) into `build/kitten` and Qwen3
0.6B (397 MB) into `build/models`, each checked by its SHA-256
(`tools/get-whisper-model.py`, `tools/get-wakeword.py`,
`tools/get-kitten.py` and `tools/get-base-model.py` fetch them on their
own). phoenix-sim finds them there; it logs a line for anything missing,
and Settings > Assistant says what is missing and how to get it. Larger
language models are downloaded in Settings > Assistant; Settings >
Assistant > Voice chooses the speaking voice.
What goes where, on the simulator and the device:
[AI-AND-MCP.md](AI-AND-MCP.md), "What's installed where".

macOS asks for microphone access the first time. Without a microphone,
`--microphone-file some.wav` plays a WAV file as one.

### 5. Optional demos

- **Flutter Notes:** built when Flutter is installed (`brew install --cask flutter`).
- **Enact Notes:** built when Node is 22 or 24.

## On Ubuntu 24.04 (desktop, VM or a cloud container)

| Command | What it does |
| --- | --- |
| `./phoenix` | Qt 6.8.1 (into `/opt/Qt`; Ubuntu's own is 6.4), CMake, Node 22; fetch submodules; build; the assistant's parts |
| `./phoenix --tests` | Also the test tools |
| `./phoenix --no-assistant` | Without the assistant's parts |

The assistant's parts, installed by default: espeak-ng (apt; the voice's
fallback), whisper.cpp's `whisper-cli` and llama.cpp's `llama-server`
built from the commits meta-phoenix pins into `/usr/local/bin` (a few
minutes), whisper's English model into `build/whisper`, the wake word into
`build/wakeword`, Kitten TTS with its dictionary and ONNX Runtime into
`build/kitten` (57 MB) and Qwen3 0.6B into `build/models` (about 740 MB
in all). In a container without sound, phoenix-tts says "no sound
output"; an `~/.asoundrc` of `pcm.!default { type null }` lets it speak
into nothing. As on a Mac, phoenix-sim and Settings > Assistant say what
is missing.

Then `./phoenix run` (or `./build/phoenix-sim`). Without a display
`./phoenix run` starts it under Xvfb by itself when `xvfb-run` is there
(`./phoenix --tests` installs it), and sets `QTWEBENGINE_DISABLE_SANDBOX=1`
when running as root:

```sh
./phoenix run tablet --scene cards --screenshot out.png
```

By hand, without a display (SSH, containers):

```sh
QTWEBENGINE_DISABLE_SANDBOX=1 xvfb-run -a -s "-screen 0 1920x1200x24" \
  ./build/phoenix-sim --tablet --scene cards --screenshot out.png
```

`QTWEBENGINE_DISABLE_SANDBOX=1` is only needed when running as root
(containers); Chromium's sandbox refuses root.

## Testing

Install the test tools first: `./phoenix --tests`. On a Mac, activate the Python packages the
script put in `.venv` before the DAV and backup tests:
`source .venv/bin/activate`.

| What | Command |
| --- | --- |
| Shell behaviour tests (QML) | `QT_QPA_PLATFORM=offscreen qmltestrunner -import shell/qml -import build/qml -input shell/tests` |
| One QML test file | the same with `-input shell/tests/tst_launcher.qml` |
| Web apps: typecheck and unit tests | `cd apps && npm run typecheck && npx vitest run` |
| Web apps in headless Chromium | `NODE_PATH="$(npm root -g)" node tools/test-apps.cjs` (and the other `tools/test-*.cjs`, listed in the README) |
| HiDPI art | `python3 tools/hidpi-art.py --check` |
| `./phoenix` itself (dry runs on a pretend Mac and Linux) | `sh tools/test-phoenix-script.sh` |
| Image recipes (parse only) | `scripts/parse-check.sh` (Linux only, about 25 minutes, see [HARDWARE.md](HARDWARE.md#build)) |

`qmltestrunner` is in Qt's `bin` directory: on a Mac
`"$(brew --prefix qt)/bin/qmltestrunner"`; on Ubuntu (Qt 6.8.1 from
`./phoenix`) `/opt/Qt/6.8.1/gcc_64/bin/qmltestrunner`.

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
  ./phoenix setup --tests
  ```

  (`scripts/linux-setup.sh --deps` does the same.) The session then builds
  with `./phoenix` (or `cmake -S shell -B build -DCMAKE_PREFIX_PATH=/opt/Qt/6.8.1/gcc_64 && cmake --build build`)
  and runs the simulator under Xvfb as above.
- **Agents in parallel:** each works in its own git worktree under
  `.claude/worktrees/`. A worktree needs its own `build/` (CMake) and can
  share `apps/node_modules` by a symlink to the main checkout's. Remove the
  symlink, not what it points to, when the worktree is done.

## Troubleshooting

- **"Could not find a package configuration file provided by Qt6":** CMake
  can't find Homebrew's Qt. Pass `-DCMAKE_PREFIX_PATH="$(brew --prefix qt)"`,
  or delete `build/` and run `./phoenix` again.
- **Apps show placeholders instead of web apps:** Qt WebEngine wasn't found
  at configure time. On Ubuntu run `./phoenix` (its Qt 6.8.1
  includes it); then delete `build/` and configure again.
- **"Could not find ... Qt6 (requested version 6.8)" on Ubuntu:** Ubuntu's
  own Qt is 6.4. Run `./phoenix`, or configure with
  `-DCMAKE_PREFIX_PATH=/opt/Qt/6.8.1/gcc_64`.
- **"phoenix-apps: npm not found" or the Enact demos are skipped:** Node 22
  isn't on the PATH in the terminal you ran CMake from. Add it (above), then
  run `cmake -S shell -B build` again.
- **"generator Ninja does not match":** `build/` was made with another
  generator. Delete `build/` or keep using its generator.
- **A web app shows an old version:** `cmake --build build` rebuilds the apps
  when a file in `apps/` changed since their last build; to force it,
  `cd apps && npm run build`.
- **`./phoenix` stops at something missing:** its line says what to do;
  `./phoenix check` lists everything without changing anything.
- **F-keys do nothing on a Mac:** hold **fn**, or change the keyboard setting
  above.
- **The window is blank on a Linux VM:** set `QT_QUICK_BACKEND=software` or
  enable 3D acceleration in the VM.
