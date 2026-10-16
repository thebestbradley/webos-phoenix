#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Every build, run and test command, kept in one place.

The commands below are the single source for docs/COMMANDS.md (GitHub gives
each code block a copy button) and for a searchable page with a copy button
per command and a Mac/Linux filter (tools/commands-page.html, filled in).

  python3 tools/commands-doc.py               rewrite docs/COMMANDS.md
  python3 tools/commands-doc.py --check       fail if docs/COMMANDS.md is stale
  python3 tools/commands-doc.py --html FILE   write the page to FILE

Each command was checked against its source, the file and line given with
it. When a script, flag or npm script changes, change its command here and
rerun this. An entry is it(title, description, os, folder, source, rows):
os is B (Mac and Linux), M or L; a row is a command, (command, note), or
(command, note, {"os": ..., "r": folder}) where it differs from its entry.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

S = []
def sec(title, note=""):
    S.append({"title": title, "note": note, "items": []})
def it(title, desc, os, run, src, rows):
    out = []
    for r in rows:
        if isinstance(r, str): r = (r, "")
        d = {"c": r[0], "n": r[1]}
        if len(r) > 2: d.update(r[2])
        out.append(d)
    S[-1]["items"].append({"title": title, "desc": desc, "os": os, "runIn": run, "source": src, "rows": out})
B, M, L = "both", "mac", "linux"
WP, PDA, EG, AP = "webos-phoenix", "phoenix-default-apps", "ember-glass-ui", "webos-phoenix/apps"
SYS = "phoenix-ember-glass-ui"
X = "QTWEBENGINE_DISABLE_SANDBOX=1 xvfb-run -a -s \"-screen 0 1920x1200x24\" "
N = 'NODE_PATH="$(npm root -g)" node tools/'

sec("Get the code", "phoenix-ember-glass-ui is webos-phoenix with the 2.0 shell: it takes 1.0's changes by merging webos-phoenix's main. The default apps build against the webos-phoenix commit named in `phoenix-default-apps/phoenix.pin.json`. Ember Glass checks its facade against phoenix-default-apps (`tools/facade-check/facade/SOURCE.json`). The 2.0 shell carries a copy of Ember Glass's tokens (`shell/qml/Phoenix/Shell/EmberGlass.qml`).")
it("Clone webOS Phoenix with its submodules", "", B, "parent folder", "webos-phoenix/docs/GETTING-STARTED.md:123",
   ["git clone --recurse-submodules https://github.com/thebestbradley/webos-phoenix.git && cd webos-phoenix"])
it("Clone the private repos beside it", "They need your GitHub sign-in (a credential helper or an SSH key). The tools look for `../webos-phoenix` and `../phoenix-default-apps`.", B, "parent folder of webos-phoenix",
   "phoenix-default-apps/tools/lib/phoenix.mjs:30 · ember-glass-ui/tools/facade-check.mjs:17",
   [("git clone https://github.com/thebestbradley/phoenix-default-apps.git", "the rebuilt built-in apps"),
    ("git clone https://github.com/thebestbradley/ember-glass-ui.git", "the 2.0 UI layer the apps use"),
    ("git clone --recurse-submodules https://github.com/thebestbradley/phoenix-ember-glass-ui.git", "the 2.0 shell")])
it("Fetch the submodules", "The original Open webOS apps in `third_party/`. `./phoenix` does this too.", B, WP, "webos-phoenix/CLAUDE.md:42 · phoenix:579",
   ["git submodule update --init"])
it("Update to the latest main", "", B, WP, "webos-phoenix/docs/GETTING-STARTED.md:129",
   ["git checkout main && git pull && git submodule update --init"])
it("Bring 1.0's changes into the 2.0 shell", "", B, "phoenix-ember-glass-ui", "phoenix-ember-glass-ui/docs/SYSTEM-UI-2.md",
   [("git remote add upstream https://github.com/thebestbradley/webos-phoenix.git", "once"),
    ("git fetch upstream && git merge upstream/main && git submodule update --init", "")])

sec("Set up a Mac")
it("See what's installed and what's missing", "A dry run: it changes nothing.", B, WP, "webos-phoenix/phoenix:31", ["./phoenix check"])
it("Install everything and build", "One command installs Xcode's command line tools, Homebrew, Qt, CMake, Ninja, Node 22, Python 3.12, PHP and the assistant's programs and models, then builds.", B, WP,
   "webos-phoenix/phoenix:9-10,55-62 · docs/GETTING-STARTED.md:142-151",
   [("./phoenix", "install what's missing, then build"),
    ("./phoenix --tests", "also the test tools: Playwright, plus Radicale, WsgiDAV, Pillow and NumPy in .venv"),
    ("./phoenix --no-assistant", "skip the assistant's models and its two Homebrew packages"),
    ("./phoenix --offline", "download nothing"),
    ("./phoenix setup", "install without building"),
    ("./phoenix --dry-run", "show what it would do"),
    ("./phoenix --help", "")])
it("Put Node 22 on the PATH for new terminals", "", M, "any folder", "webos-phoenix/docs/GETTING-STARTED.md:162",
   ["echo 'export PATH=\"$(brew --prefix)/opt/node@22/bin:$PATH\"' >> ~/.zprofile"])
it("Turn on the Python test packages", "Once per terminal, before the DAV, backup and HiDPI tests.", M, WP, "webos-phoenix/docs/GETTING-STARTED.md:321-323",
   ["source .venv/bin/activate"])
it("Set up by hand instead", "", M, WP, "webos-phoenix/docs/GETTING-STARTED.md:135,168-172",
   ["xcode-select --install", "brew install qt cmake ninja node@22", "export PATH=\"$(brew --prefix)/opt/node@22/bin:$PATH\"",
    "git submodule update --init", "cmake -S shell -B build -G Ninja -DCMAKE_PREFIX_PATH=\"$(brew --prefix qt)\"", "cmake --build build"])
it("Optional extras", "", M, "any folder", "webos-phoenix/docs/GETTING-STARTED.md:278 · docs/BUILDING-MAC.md:108",
   [("brew install --cask flutter", "to build the Flutter Notes demo"), ("brew install qemu", "for the ARM64 VM and the UTM bundles")])
it("Older wrapper script", "It calls `./phoenix`, and takes `--tests`, `--all`, `--no-assistant` and `--check`.", M, WP, "webos-phoenix/scripts/mac-setup.sh:10-19",
   ["scripts/mac-setup.sh"])

sec("Set up Linux (Ubuntu 24.04)")
it("Install everything and build", "It asks for sudo. It installs apt packages, Qt 6.11.3 into `/opt/Qt`, Node 22, and builds `whisper-cli` and `llama-server` into `/usr/local/bin`.", L, WP, "webos-phoenix/docs/GETTING-STARTED.md:283-287",
   [("./phoenix", ""), ("./phoenix --tests", "also the test tools, xvfb among them"), ("./phoenix --no-assistant", "")])
it("Install without building", "For a cloud environment's setup script. The two lines do the same thing.", L, WP, "webos-phoenix/docs/GETTING-STARTED.md:382,385 · scripts/linux-setup.sh:50",
   ["./phoenix setup --tests", "scripts/linux-setup.sh --deps"])
it("Configure and build by hand with the Qt that ./phoenix installed", "", L, WP, "webos-phoenix/docs/GETTING-STARTED.md:386",
   ["cmake -S shell -B build -DCMAKE_PREFIX_PATH=/opt/Qt/6.11.3/gcc_64 && cmake --build build"])
it("No sound card (containers)", "Lets the assistant's voice play into nothing.", L, "any folder", "webos-phoenix/docs/GETTING-STARTED.md:295-297",
   ["echo 'pcm.!default { type null }' > ~/.asoundrc"])
it("Older wrapper script", "It calls `./phoenix`, and takes `--tests`, `--deps` and `--no-assistant`.", L, WP, "webos-phoenix/scripts/linux-setup.sh:18-27",
   ["scripts/linux-setup.sh"])

sec("Build")
it("Build", "Incremental. `./phoenix build` is the same.", B, WP, "webos-phoenix/phoenix:9-10", ["./phoenix"])
it("Start the build over", "", B, WP, "webos-phoenix/docs/GETTING-STARTED.md:395-408", ["rm -rf build && ./phoenix"])
it("Rebuild only the web apps", "", B, AP, "webos-phoenix/docs/GETTING-STARTED.md:409-411", ["npm run build"])
it("Build into another folder", "Other overrides: `PHOENIX_QT_DIR` (a Qt 6.8 or newer; 6.11.3 is the simulator's, 6.8.1 the device's), `QT_PREFIX` (Linux, default `/opt/Qt`), `CMAKE_BUILD_PARALLEL_LEVEL`.", B, WP, "webos-phoenix/phoenix:80-82",
   ["PHOENIX_BUILD_DIR=build-other ./phoenix"])
it("What ./phoenix runs for a new build folder", "", B, WP, "webos-phoenix/phoenix:699,723",
   [("cmake -S shell -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_PREFIX_PATH=\"$(brew --prefix qt)\"", "", {"os": M}),
    ("cmake -S shell -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_PREFIX_PATH=/opt/Qt/6.11.3/gcc_64", "", {"os": L}),
    ("cmake --build build --parallel", "")])
it("A release build without the npm step", "CMake switches: `PHOENIX_BUILD_SIM`, `PHOENIX_BUILD_KEYBOARD` and `PHOENIX_BUILD_APPS`, all on by default.", M, WP,
   "webos-phoenix/shell/CMakeLists.txt:11,51,166 · .github/workflows/ci.yml:165,252",
   ["cmake -S shell -B build -DCMAKE_BUILD_TYPE=Release -DPHOENIX_BUILD_APPS=OFF -DCMAKE_PREFIX_PATH=\"$(brew --prefix qt)\""])

sec("Simulator: start")
it("Build if needed, then run", "Adaptive is the default: the layout follows the window's size. Everything after the mode goes to phoenix-sim.", B, WP, "webos-phoenix/phoenix:11-15 · README.md:226-229",
   [("./phoenix run", "adaptive"), ("./phoenix run phone", ""), ("./phoenix run tablet", ""), ("./phoenix run tablet --scene cards", ""), ("./phoenix run --dry-run tablet", "show the command it would run")])
it("Run without building", "", B, WP, "webos-phoenix/docs/GETTING-STARTED.md:182,192",
   [("./build/phoenix-sim", ""), ("./build/phoenix-sim --help", "every option")])
it("Start as a new device", "", B, WP, "webos-phoenix/shell/sim/main.cpp:190,226-257 · CLAUDE.md:78",
   [("./build/phoenix-sim --first-use", "run First Use again"),
    ("./build/phoenix-sim --tablet --instance try1", "another device with its own data: a clean start on a Mac too; delete its phoenix-sim-try1 folder after"),
    ("HOME=$(mktemp -d) ./build/phoenix-sim --tablet", "a fresh home folder: a clean device (documented for Linux)", {"os": L})])
it("Run two simulators at once", "Each `--instance` is a device of its own: its own data, installed apps, web storage and settings. Without it, two simulators would share one device and one web storage. Each one's **Window** menu lists every simulator running for you, from any checkout or build (its layout and size, look and checkout), and brings the one you choose to the front; **Next Simulator** (Ctrl+Shift+\\) goes to the next.", B, WP,
   "webos-phoenix/shell/sim/main.cpp:226-257,749-782 · shell/sim/siminstances.h · shell/sim/simchrome.cpp:572-729 · docs/GETTING-STARTED.md:234-257",
   [("./build/phoenix-sim --tablet --instance v1", "1.0"),
    ("./build/phoenix-sim --tablet --instance v2 --extra-rootfs ../phoenix-default-apps/build/rootfs -- --look ember-glass", "2.0, with the rebuilt apps", {"r": "phoenix-ember-glass-ui"})])
it("Run without a display", "SSH sessions and containers. `./phoenix run` does this itself when xvfb-run is installed.", L, WP, "webos-phoenix/docs/GETTING-STARTED.md:312-313 · phoenix:759-771",
   [X + "./build/phoenix-sim --tablet --scene cards --screenshot out.png"])

sec("Simulator: devices and layouts")
it("Phone, tablet or adaptive", "", B, WP, "webos-phoenix/shell/sim/main.cpp:181-184",
   ["./build/phoenix-sim --phone", "./build/phoenix-sim --tablet", ("./build/phoenix-sim --adaptive", "the layout switches live as you resize the window")])
it("A custom screen", "", B, WP, "webos-phoenix/shell/sim/main.cpp:188,201,286-288",
   [("./build/phoenix-sim --size 480x800 --scale 1.5 --scene cards", "a Pre 3"),
    ("./build/phoenix-sim --tablet --size 2560x1600 --scale 2", "a HiDPI tablet"),
    ("./build/phoenix-sim --home-button", "a hardware Home button instead of the gesture bar")])
it("Run as one of the target devices", "Device IDs: `fairphone-fp6`, `ayn-odin2portal`, `pinephonepro`, `pinetab2`, `raspberrypi4-64`. Don't add phone or tablet with it.", B, WP,
   "webos-phoenix/phoenix:16-20,159-166 · shell/sim/main.cpp:185,187",
   [("./phoenix run --device fairphone-fp6", ""), ("./build/phoenix-sim --device pinetab2 --zoom 0.5", "--zoom 0.1 to 1 shrinks the window")])
it("Orientation", "", B, WP, "webos-phoenix/shell/sim/main.cpp:199-200 · README.md:409-412",
   [("./build/phoenix-sim --size 320x480 --orientation left", "up, left, down or right"),
    ("./build/phoenix-sim --turn left --screenshot turn.png --delay 1450", "turns the device a second after start-up")])

sec("Simulator: scenes and apps")
it("Open a scene", "`./build/phoenix-sim --help` lists them all: `locked` `cards` `stacks` `reorder` `maximized` `heldcard` `launcher` `launcheredit` `launchermenu` `launchergroup` `launchergroupopen` `launchertabs` `launcherinstall` `wave` `powermenu` `pin` `emergency` `firstuse` `lowbattery` `banner` `notified` `dashboard` `justtype` `keyboard` `clipstrip` `assistant` `systemmenu` `modal` `empty` `longstack` `hot` `notifystacks` `notifystacksbar` `notifystackslocked` `drawer` `capture` `capturepreview` `assistantbird` `assistantbirds` `assistantbirdmoves` `wakeword` `wakewordlocked` `followup` `followupanswer` `followuplater` `followupaction` `followupchat` `airpods` `airpodsbattery` `airpodsmenu` `airpodssettings` `trackeralert`.", B, WP,
   "webos-phoenix/shell/sim/main.cpp:189 · shell/qml/sim.qml:523-541,1345-1348,2124-2173",
   [("./build/phoenix-sim --tablet --scene dashboard --screenshot dash.png", ""),
    ("./build/phoenix-sim --scene 'assistant:@notified|what did I miss'", "the assistant, asked one or more questions separated by |")])
it("Open apps at start-up", "Repeat `--launch` for several apps.", B, WP, "webos-phoenix/shell/sim/main.cpp:197-198 · README.md:401,444-448",
   [("./build/phoenix-sim --launch com.palm.app.notes", ""),
    ("./build/phoenix-sim --launch org.webosphoenix.settings.wifi", ""),
    ("./build/phoenix-sim --launch 'com.palm.app.clock:{\"action\": \"edit\"}'", "with launch params, as the application manager's {id, params}"),
    ("./build/phoenix-sim --open https://example.com", "a web page in the browser")])
it("Choose the open app to view", "The menu bar's **Window** menu lists the simulators running on this computer first (as in Run two simulators at once), then the open cards, in card view's order with the windows stacked on a card under it, and brings the one you choose to the front, maximized; a check mark is on the card in front. It also has Card View, Launcher, Next Card (Ctrl+Shift+], ⇧⌘] on a Mac) and Previous Card (Ctrl+Shift+[). Locked, the card chosen is the one in front once you unlock.", B, WP,
   "webos-phoenix/shell/sim/simchrome.cpp:272-286,499-570,731-749 · shell/qml/Phoenix/Sim/SimWindowMenu.qml · shell/qml/sim.qml:950-960",
   [("./build/phoenix-sim --tablet --launch org.webosphoenix.settings --launch org.webosphoenix.weather --launch org.webosphoenix.tasks", "three cards to choose from")])
it("Use apps built in another checkout", "`--extra-rootfs` can be repeated. `--installed-dir DIR` changes where installed apps go.", B, WP, "webos-phoenix/shell/sim/main.cpp:195-196 · docs/APP-RUNTIME.md:72",
   ["./phoenix run tablet --extra-rootfs ../phoenix-default-apps/build/rootfs --launch com.palm.app.notes"])
it("Take a screenshot", "Saves a PNG and exits. The default delay is 1500 ms.", B, WP, "webos-phoenix/CLAUDE.md:64-65 · shell/sim/main.cpp:191-192",
   ["./phoenix run tablet --launch org.webosphoenix.settings --screenshot out.png --delay 8000",
    "./build/phoenix-sim --tablet --launch org.webosphoenix.settings --screenshot out.png --delay 8000"])

sec("Simulator: more options")
it("Simulated hardware and state", "Also: `--low-memory` `--stay-awake` `--quiet` `--usb` `--usb-busy` `--touch-to-share` `--boot-animation` `--no-boot-animation` `--no-toolbar` `--check-chrome`. `./build/phoenix-sim --help` explains each.", B, WP, "webos-phoenix/shell/sim/main.cpp:202-225",
   [("./build/phoenix-sim --tablet --hardware-keyboard", ""),
    ("./build/phoenix-sim --touchstone", ""),
    ("./build/phoenix-sim --security-policy minLength=6,maxRetries=4,alphaNumeric,noSimple,inactivity=300", "a passcode policy; none turns it off")])
it("Services and the assistant", "Also: `--host-shell PATH`, `--no-tcp-relay`, `--llama-server PATH`, `--speech-command CMD`, `--wake-model DIR`, `--vosk-library FILE`, `--wake-file FILE`, `--qml-dir DIR`, `--repo-dir DIR`. Environment: `PHOENIX_WHISPER_CLI`, `PHOENIX_WHISPER_MODEL`, `PHOENIX_TTS_PROGRAM`.", B, WP,
   "webos-phoenix/shell/sim/main.cpp:193-194,207-217 · README.md:358-359",
   [("./phoenix run --marketplace", "start the catalog and open the Marketplace"),
    ("./phoenix run --no-marketplace", "no catalog this run"),
    ("./build/phoenix-sim --no-host-shell", "the Terminal app gets no shell on your computer"),
    ("./build/phoenix-sim --microphone-file call.wav --microphone-file yes.wav", "WAV files as the microphone, in turn")])

it("Without a GPU", "The shell tells by the renderer whether a GPU draws, and prints it (`phoenix: renderer ...`). Without one it leaves out the blur behind translucent surfaces, as it always did with Qt Quick's software renderer: also for OpenGL or Vulkan on a software rasteriser such as Mesa's llvmpipe (a VM, a container, a board without its GPU driver). `PHOENIX_SOFTWARE_RENDERING` (`1`, `0` or `auto`) does the same on a device.", B, WP,
   "webos-phoenix/shell/sim/main.cpp:228,301-310 · shell/native/renderinfo.h",
   [("./build/phoenix-sim --software-rendering on", "as without a GPU: no blur"),
    ("./build/phoenix-sim --software-rendering off", "the blur, even on a software rasteriser"),
    ("PHOENIX_SOFTWARE_RENDERING=1 ./build/phoenix-sim", "the same through the environment")])

sec("Test: as CI runs them", "CI (`.github/workflows/ci.yml`) runs these on Linux, beside the QML and C++ tests below. `./phoenix test` builds and installs nothing first.")
it("The quick checks", "What CI checks without a build, its first job: generated docs and art against their sources, lockfiles, launch contracts, the web tests' list, the tool, PHP and `./phoenix` tests, the apps' typecheck and unit tests. Every check runs, cheapest first; a summary gives each one's result and time. Needs what `./phoenix --tests` installs.", B, WP,
   "webos-phoenix/phoenix:39-44 · tools/ci-checks.sh:14-17,133-156",
   [("./phoenix test --quick", "every check (tools/ci-checks.sh)"), ("./phoenix test --quick --list", "their IDs"),
    ("./phoenix test --quick typecheck unit-tests", "only these"), ("./phoenix test --quick --fail-fast", "stop at the first failure")])
it("Every web app test, or CI's shard of them", "The tests in `tools/web-tests.txt`, one after another, each one's time in a summary; CI runs them in four shards balanced by the times in the list. Build the apps first (`./phoenix`, or `npm run build` in `apps/` and the demos as their READMEs say) and install Playwright (`./phoenix --tests`).", B, WP,
   "webos-phoenix/phoenix:45-52 · tools/run-web-tests.cjs:9-14",
   [("./phoenix test --web", "every web app test (tools/run-web-tests.cjs)"), ("./phoenix test --web --shard 2/4", "CI's second shard"),
    ("./phoenix test --web settings media", "the tests of test-settings.cjs and test-media.cjs"),
    ("node tools/run-web-tests.cjs --plan 4", "which tests each of four shards runs"), ("node tools/check-web-tests.cjs", "that the shards together run the list, each test once")])

sec("Test: shell")
it("Point QMLTEST at Qt's test runner", "Once per terminal.", B, WP, "webos-phoenix/CLAUDE.md:86-87 · docs/GETTING-STARTED.md:335-337",
   [("export QMLTEST=\"$(brew --prefix qt)/bin/qmltestrunner\"", "", {"os": M}),
    ("export QMLTEST=/opt/Qt/6.11.3/gcc_64/bin/qmltestrunner", "", {"os": L})])
it("Run the QML tests", "", B, WP, "webos-phoenix/.github/workflows/ci.yml:175,189,193,548 · README.md:481",
   [("QT_QUICK_BACKEND=software QT_QPA_PLATFORM=offscreen \"$QMLTEST\" -import shell/qml -import build/qml -input shell/tests", "all of them, as CI runs them on the Mac (offscreen Metal stalls animations)", {"os": M}),
    ("QT_QPA_PLATFORM=offscreen \"$QMLTEST\" -import shell/qml -import build/qml -input shell/tests", "all of them", {"os": L}),
    ("QT_QPA_PLATFORM=offscreen \"$QMLTEST\" -import shell/qml -import build/qml -input shell/tests/tst_launcher.qml", "one file"),
    ("QT_QPA_PLATFORM=offscreen \"$QMLTEST\" -import shell/qml -import build/qml -import shell/tests-device/fakes -input shell/tests-device", "the device shell over fake modules"),
    ("QT_SCALE_FACTOR=2 QT_QPA_PLATFORM=offscreen \"$QMLTEST\" -import shell/qml -import build/qml -input shell/tests/tst_hidpi.qml", "HiDPI at 2x")])
it("Run the C++ tests", "There's nothing for `ctest` to find: run each test program by name after a build.", B, WP, "webos-phoenix/.github/workflows/ci.yml:258-332,346,558-574,588 · shell/CMakeLists.txt:69-75,127-197",
   ["build/pty/pty-test", "QT_QPA_PLATFORM=offscreen build/keyboard/keyboard-test", "build/siminstaller-test", "build/simlaunch-test",
    ("QT_QPA_PLATFORM=offscreen build/simchrome-test", "the menu bar and its Window menu"),
    ("build/siminstances-test", "the simulators' registry: Window > Simulators"), "build/dictation-test",
    ("python3 tools/get-wakeword.py && build/wakeword-test", "fetches the wake-word model first"), "build/simnet-test", ("build/useragent-test", "the user agent policy: Chrome's version on its cadence, the strings per form factor"), "build/simmarketplace-test", "build/localmodels-test",
    ("build/renderinfo-test", "which renderers count as no GPU, where the shell's blur steps down"),
    ("python3 tools/get-kitten.py && build/tts-test", "fetches the voice first"),
    ("./build/phoenix-sim --check-chrome --no-boot-animation --quiet", "the simulator's own start-up check"),
    ("build/devices/devices-test", "", {"os": L}), ("build/simfonts-test", "", {"os": L})])
it("Device-readiness checks", "The static checks a device image would trip on.", B, WP, "webos-phoenix/phoenix:33-38,89-92 · tools/check-device.sh:8-15",
   ["./phoenix check-device", "./phoenix check-device --all", "./phoenix check-device --strict",
    ("./phoenix check-device --parse fairphone-fp6", "also BitBake's parse check of the named machines (Linux, not as root)", {"os": L})])
it("Python, shell and PHP tests", "", B, WP, "webos-phoenix/tools/ci-checks.sh:145,147-153 · .github/workflows/ci.yml:81-82 · tools/test-make-utm.py:10-11",
   ["sh tools/test-phoenix-script.sh", "python3 tools/test-devicecheck.py", "python3 tools/test-device-firmware.py", "python3 tools/test-device-profiles.py", "python3 tools/test-wam-user-agent.py",
    "python3 tools/test-make-utm.py", "python3 tools/test-install-rootfs.py", "python3 tools/test-sounds-pcm.py",
    ("php server/marketplace/tests/run.php", "the Marketplace catalog"), ("php server/updates/tests/run.php", "the update feed"), ("php server/drivers/tests/run.php", "the driver catalog")])
it("Art and generated-file checks", "`hidpi-art.py` needs Pillow and NumPy (on a Mac, from `.venv`); `make-feedback-sounds.py` needs ffmpeg.", B, WP, "webos-phoenix/CLAUDE.md:93 · tools/ci-checks.sh:134-144",
   [("python3 tools/hidpi-art.py --check", "whenever art or stylesheets change"), "python3 tools/keyboard-charcoal.py --check", "node tools/render-app-icons.cjs --check",
    "python3 tools/upscale-app-icons.py --check", "python3 tools/make-feedback-sounds.py --check", "python3 tools/gen-assistant-bird.py --check",
    "python3 tools/debrand-overlays.py --check", ("node tools/check-launch-contracts.cjs", "every app-to-app launch"),
    ("python3 tools/release-notes-doc.py --check", "docs/RELEASE-NOTES.md against the release notes")])

sec("Test: apps")
it("Typecheck and unit tests", "On a Mac, turn on `.venv` first: the DAV tests need Radicale.", B, AP, "webos-phoenix/CLAUDE.md:90 · apps/package.json:55-58",
   [("npm run typecheck && npx vitest run", ""), ("npx vitest run --maxWorkers=2", "on a busy machine"), ("npx vitest run marketplace/service/platform.test.ts", "one file"),
    "npm test", "npm run check", "node ../tools/check-lockfile.cjs"])
it("Install Playwright for the Chromium tests", "`./phoenix --tests` does this for you.", B, "any folder", "webos-phoenix/phoenix:658-662",
   [("npm install -g playwright@1 && npx --yes playwright@1 install chromium", "", {"os": M}),
    ("sudo npm install -g playwright@1 && sudo npx --yes playwright@1 install --with-deps chromium", "", {"os": L})])
tests = [("accounts","Account templates as connectors install and go, Find More, {templateId}"),("activities-sim","Activities in phoenix-sim: an alarm with Clock closed, --launch appId:{json}"),
("alarm","A Clock alarm rings as a popup alert"),("app-sdk","The SDK's build without a bundler, with and without a bus"),("appmanager","Launch points, handlers, installer queries"),
("apps","Every app starts and renders without errors (add app IDs to pick)"),("assistant-followups","The assistant's follow-up questions"),("assistant-maps","The assistant with Maps, end to end"),
("assistant-synergy-sim","The assistant on Todoist, Bluesky and Jabber in phoenix-sim"),("assistant","The Assistant app, Settings > Assistant, permissions, conversations"),
("authenticator","Authenticator (TOTP and HOTP)"),("back","The back gesture across Enyo 1 and 2, Phoenix and Ionic apps"),("backup","Settings > Backup against WsgiDAV"),
("browser","Browser: downloads, Save as PDF, find, private, content blocker"),("clipboard","Clipboard app and Settings > Clipboard"),("community","Community features: Advanced, repeat alerts, tones"),
("connectors","Todoist and Bluesky connectors"),("contacts","The simulated contacts service and vCards"),("dav-sync","CardDAV and CalDAV against Radicale"),("db8-pages","db8 shared by pages writing at once"),
("deltachat","A Delta Chat account in Messaging"),("device-services","Display and keys services, the ringer switch"),("docs","PDF View and Doc View"),("drives","Drives: WebDAV, Nextcloud, Dropbox stand-ins"),
("editing","Edit menus, edit state, keyboard in menus and alerts"),("email","The simulated mail transports under the original Email"),("emergency","Emergency Info, restricted Phone, Accessibility"),
("enact-notes","The Enact Notes demos (build them first)"),("exhibition","Dock-mode exhibitions and their Settings pane"),("fediverse","Fediverse against a fake Mastodon (needs PHP)"),
("filepicker","File pickers"),("files","Files"),("firstuse","First Use, every step"),("flashlight","Flashlight with the simulated torch"),("flutter-notes","The Flutter Notes demo (build it first)"),
("hardware","Settings > Hardware and the driver catalog (needs PHP)"),("help","Help, and Just Type finding it"),("hidpi","The original apps' art at pixel ratios 2 and 3"),
("index-sim","Search your phone in phoenix-sim (python3 tools/get-index-model.py first: its model and llama-server)"),("ionic-notes","The Ionic Notes demo"),("justtype","The original Just Type"),
("keyboard","Web fields and the on-screen keyboard"),("launch-contracts","App-to-app launch buttons"),("links","Links between apps: web, mailto:, tel:, sms:"),("location","Location Services and permissions"),
("maps","Maps, with no live servers"),("marketplace","Marketplace against the real PHP catalog"),("matrix","A Matrix account"),("media-index","The media indexer's EXIF date and place"),
("media","Camera, Photos, Music"),("notification-stacks","Notification stacks"),("notificationlab","Notification Lab"),("orientation","Apps asking for an orientation"),("passwords","Passwords (KeePass)"),
("phone-messaging","Calls, texts, MMS, Buddies"),("platform-client","Platform conformance against the mock"),("podcasts","Podcasts"),("runtime-device","The runtime in a WebAppMgr stand-in"),
("scanner","QR Scanner with the fake camera"),("screenshot","The screen-capture preview"),("security","Security policy, erase, USB drive mode"),("settings","Settings"),("sftp","SFTP drives (part needs sshd)"),
("sharing","DropShare, .ics subscriptions, temperature warnings"),("signin-card-sim","The Sign In card in phoenix-sim"),("signin-card","OAuth device sign-in against a fake provider"),
("tasks","Tasks and reminders"),("telegram","A Telegram account"),("useragent-sim","What sites are sent and pages read: the user agent and client hints in phoenix-sim"),("terminal","Terminal: the simulated shell, then /bin/sh"),("updates","Settings > Updates against the update feed (PHP)"),
("videos","Videos"),("voicedial","Voice Dial"),("voicememos","Voice Memos"),("weather","Weather, with recorded Open-Meteo replies"),("webfiles","A web page's own files: file inputs, the File System Access API, downloads"),("instance-sim","Two simulators at once with --instance, each with its own data"),("xmpp-server","Jabber against a real Prosody (skipped without it)"),("xmpp","Jabber against the demo server")]
rows = [(N + "test-%s.cjs" % t, d) for t, d in tests] + [(N + "smoke-apps.cjs", "Uses each app, beyond starting it")]
it("Web apps in Chromium", "Add `--tablet` for the tablet layout and `--out DIR` to keep the screenshots. Tests ending in `-sim` start phoenix-sim: on Linux without a display, put `xvfb-run -a -s \"-screen 0 1920x1200x24\"` in front. Search for an app to find its test.", B, WP,
   "webos-phoenix/CLAUDE.md:91-92 · tools/test-*.cjs (each file's usage line)", rows)

sec("Apps (webos-phoenix)")
it("Install, build, typecheck, test", "", B, AP, "webos-phoenix/apps/package.json:54-59 · CLAUDE.md:56",
   ["npm ci --no-audit --no-fund", ("npm run build", "every app"), ("npm run build -w settings", "one app"), "npm run typecheck", "npm test", "npm run check",
    ("npm run dev -w settings", "Vite, without the webOS runtime (undocumented)")])
it("The Enact demos", "Separate npm projects, in `apps/enact-notes-limestone` and `apps/enact-notes-agate`.", B, "webos-phoenix/apps/enact-notes-limestone", "webos-phoenix/.github/workflows/ci.yml:92",
   ["npm ci --no-audit --no-fund && npm run typecheck && npm run build", ("npm run serve", "enact serve")])
it("The Flutter demo and the Dart services package", "Needs Flutter.", B, WP, "webos-phoenix/.github/workflows/ci.yml:107-117 · apps/flutter-notes/README.md:55-58",
   ["(cd apps/shared/phoenix_services && dart pub get && dart analyze --fatal-infos && dart test)",
    "(cd apps/flutter-notes && flutter pub get --enforce-lockfile && dart analyze --fatal-infos && flutter test && tool/build.sh)"])
it("The connector developer tool", "Build the kit first.", B, AP, "webos-phoenix/apps/shared/connector-kit/src/tools/cli.ts:6-20 · docs/SYNERGY-SDK.md:719",
   ["npm run build -w @phoenix/connector-kit", ("npx phoenix-connector new <app id>", "options: --capability CONTACTS, --share, --dir DIR"),
    "npx phoenix-connector validate <folder or .ipk>", ("npx phoenix-connector pack <folder>", "--out DIR"), "npx phoenix-connector publish <folder or .ipk> --local", "npx phoenix-connector test <folder>"])
it("Pack the built apps for an image", "Then set `PHOENIX_APPS_DIST = \"/path/to/apps-dist.tar.gz\"` in local.conf.", B, WP, "webos-phoenix/tools/pack-apps-dist.sh:7-17 · tools/install-rootfs.py:28",
   ["tools/pack-apps-dist.sh apps-dist.tar.gz", ("python3 tools/install-rootfs.py out/rootfs --list", "show the image's layout")])

sec("Default apps (phoenix-default-apps)")
it("Install and build", "", B, PDA, "phoenix-default-apps/README.md:38-41 · tools/fetch-phoenix.mjs:11",
   [("npm install --prefer-offline --no-audit --no-fund", ""),
    ("node tools/fetch-phoenix.mjs", "fetch the webos-phoenix commit in phoenix.pin.json into .phoenix/ (or set PHOENIX_DIR, or keep ../webos-phoenix)"),
    ("npm run build", "every app"), ("npm run build -w apps/memos", "one app")])
it("Run in the simulator", "First word: the app. Second: `phone`, `tablet` or `adaptive` (defaults: memos, adaptive). Own flags: `--no-build`, `--shared`, `--fresh`. Everything else goes to phoenix-sim.", B, PDA,
   "phoenix-default-apps/tools/sim.mjs:10-12,27,55-63 · docs/APP-GUIDE.md:265-268",
   [("npm run sim -- memos tablet", ""),
    ("npm run sim -- tasks tablet --fresh", "a new home folder: a clean device"),
    ("npm run sim -- notes phone --screenshot out.png --delay 8000", "this screenshot lands in the webos-phoenix checkout"),
    ("npm run sim -- memos adaptive --no-build --shared", "skip the build; use the shared frameworks"),
    ("PHOENIX_DIR=../webos-phoenix PHOENIX_SIM=../webos-phoenix/build/phoenix-sim npm run sim -- phone phone", "your own webos-phoenix build, directly")])
it("Run in a browser on Phoenix's runtime", "", B, PDA, "phoenix-default-apps/tools/serve.mjs:11-12",
   ["npm run serve", "npm run serve -- --port 8765 --shared"])
it("Typecheck and unit tests", "", B, PDA, "phoenix-default-apps/package.json:37-38,46",
   ["npm run typecheck", ("npm test", "Vitest with 2 workers"), "npm run check"])
it("Chromium tests", "Screenshots go to `build/test-results/`.", B, PDA, "phoenix-default-apps/tools/test-apps.mjs:10-12 · README.md:58-59",
   [("npm install -g playwright@1 && playwright install chromium", "once"),
    ("npm run build && npm run test:chromium", "every app"),
    ("npm run build:shared && npm run test:chromium -- --shared", "against the shared frameworks"),
    ("npm run test:chromium -- notes", "one app"),
    ("npm run build -w apps/memos && node tools/test-memos.mjs", "one app's test file")])
it("Shared frameworks, packages and icons", "", B, PDA, "phoenix-default-apps/README.md:66-68 · tools/package-ipk.mjs:13-15 · tools/stage.mjs:12",
   ["npm run frameworks && npm run build:shared", ("npm run package", "an .ipk per app"), "npm run package -- memos --shared", "npm run package -- --shared --frameworks",
    "node tools/stage.mjs", ("npm run build && npm run package && node tools/test-ipk.mjs", "check the packages"),
    ("node tools/render-icon.mjs apps/notes/art/icon.svg apps/notes/public", "an app's icon from its SVG")])
it("The Ember Glass preview", "Only on the `ember-glass-preview` branch. Run the fetch after every `npm ci`. The repo is private: git's own sign-in is used, or an `EMBER_GLASS_TOKEN` you set.", B, PDA,
   "phoenix-default-apps@ember-glass-preview/tools/fetch-ember-glass.mjs:12-24 · tools/preview-shots.mjs:12-13",
   ["git switch ember-glass-preview", ("node tools/fetch-ember-glass.mjs", "link the pinned ember-glass-ui into node_modules/@ember-glass"),
    ("EMBER_GLASS_DIR=../ember-glass-ui node tools/fetch-ember-glass.mjs", "use your own checkout instead"),
    ("npm run build && node tools/preview-shots.mjs build/eg-shots", "comparison screenshots; add app names, --png")])

sec("Ember Glass UI (ember-glass-ui)")
it("Install, build, test", "", B, EG, "ember-glass-ui/README.md:54-62 · package.json:18-31",
   ["npm install --no-audit --no-fund", "npm run build", ("npm test", "the token tests (Node 21 or later)"), "npm run typecheck", "npm run tokens:check", "npm run icons:check",
    ("npx playwright install chromium", "once, before test:visual"), "npm run test:visual", "npm run compare", "npm run framework", "npm run framework:check"])
it("Regenerate tokens and icons", "", B, EG, "ember-glass-ui/README.md:89-91",
   [("npm run tokens", "after editing tokens/ember-glass.tokens.json"), ("npm run icons", "after editing packages/icons/glyphs.json")])
it("Check Ember Glass against the default apps' UI facade", "", B, EG, "ember-glass-ui/tools/facade-check.mjs:15-18 · tools/facade-test.mjs:10",
   [("npm run facade:check", "against ../phoenix-default-apps main"), ("npm run facade:check -- --update", "take the facade's contract again"),
    ("npm run build && npm run facade:test -- ../phoenix-default-apps", "run npm ci there first")])
it("Swap Ember Glass into the default apps by hand", "Steps 2-3 of `docs/FACADE-MAP.md`. Steps 4-8 there are hand edits.", B, EG, "ember-glass-ui/docs/FACADE-MAP.md:47-102",
   ["cp tools/facade-check/swap/index.ts ../phoenix-default-apps/packages/app-ui/src/index.ts",
    "cp tools/facade-check/swap/tokens.css ../phoenix-default-apps/packages/app-ui/src/tokens.css"])
it("The galleries", "Then open `http://127.0.0.1:4173/gallery/sim/?app=/gallery/enact/dist/&title=Settings`, or `…/gallery/ionic/dist/` and add `&theme=dark`.", B, EG, "ember-glass-ui/README.md:68-74 · tools/serve.mjs:8-10",
   [("npm run serve", "on port 4173, in the simulated shell"), ("npm run dev -w gallery/enact", "Vite, without the shell")])
it("Flutter", "", B, EG, "ember-glass-ui/README.md:80-81 · .github/workflows/ci.yml:94-104",
   ["(cd flutter && flutter pub get && flutter analyze && flutter test)", ("(cd flutter/example && flutter pub get && flutter test && flutter run -d chrome)", "the gallery in Chrome"),
    ("(cd flutter && tool/test.sh)", "what CI runs")])
it("Flutter without the SDK", "Downloads about 800 MB. x86-64 Linux only.", L, EG, "ember-glass-ui/tools/flutter-lite.sh:9-11,35,49",
   ["tools/flutter-lite.sh setup", "tools/flutter-lite.sh analyze", ("tools/flutter-lite.sh test", "--update-goldens, or test files")])

sec("System UI 2.0 (phoenix-ember-glass-ui)", "The 2.0 shell's repo is webos-phoenix with the Ember Glass shell, so everything under Build, Simulator and Test works there too.")
it("Build", "The same `./phoenix` as 1.0.", B, SYS, "phoenix-ember-glass-ui/phoenix", ["./phoenix"])
it("Run in the Ember Glass look", "Also in the simulator: Settings > Advanced > Look.", B, SYS, "phoenix-ember-glass-ui/docs/SYSTEM-UI-2.md:32,54,65,411 · shell/qml/sim.qml:630-660",
   ["./build/phoenix-sim --phone -- --look ember-glass", "./build/phoenix-sim --phone -- --look ember-glass --glass-theme light",
    ("./build/phoenix-sim --size 1116x2484 --scale 2.5 --phone -- --look ember-glass", "a tall HiDPI phone"),
    ("./phoenix run phone -- -- --look ember-glass", "through ./phoenix it takes two --")])
it("2.0 tests and tools", "", B, SYS, "phoenix-ember-glass-ui/tools/gen-ember-glass-qml.cjs:26-28 · tools/glass-screenshots.sh:36-40 · docs/SYSTEM-UI-2.md:372-386",
   [("node tools/gen-ember-glass-qml.cjs", "copy Ember Glass's tokens into the shell"), ("node tools/gen-ember-glass-qml.cjs --check", "what CI runs"),
    ("node tools/gen-ember-glass-qml.cjs --from ../ember-glass-ui", "from your checkout"), "node tools/gen-ember-glass-icons.cjs --from ../ember-glass-ui/node_modules",
    "QT_QPA_PLATFORM=offscreen \"$QMLTEST\" -import shell/qml -import build/qml -input shell/tests/tst_emberglass.qml",
    N + "test-glass.cjs", ("python3 tools/test-glass-sim.py --out app-tests/glass-sim", "needs Pillow and NumPy; xvfb on Linux"),
    ("tools/glass-screenshots.sh screenshots/ember-glass", "PHOENIX_SHOT_DELAY and SHOTS=\"a b\" adjust it"),
    "tools/glass-compare.py screenshots/ember-glass app-tests/glass-sim docs/design-2.0/img/system-ui-2"])

sec("Device images and VMs", "Machines: `qemux86-64` and `raspberrypi4-64` (OSE's own); `fairphone-fp6`, `ayn-odin2portal`, `pinephonepro`, `pinetab2`, and `phoenix-vm-arm64`, one ARM64 VM image that runs as any of them. None of these images has been built or booted yet.")
it("Build an image on the Mac", "Uses Apple's `container` (macOS 26, Apple silicon). Also `PHOENIX_VOLUME_SIZE` (default `300g`).", M, WP, "webos-phoenix/scripts/mac-build.sh:8-25,69-76 · docs/BUILDING-MAC.md:40-45,62",
   [("scripts/mac-build.sh --check", "always checks qemux86-64"), ("scripts/mac-build.sh", "qemux86-64, webos-phoenix-image"),
    ("scripts/mac-build.sh phoenix-vm-arm64", "the ARM64 VM: the 1.0 image to try first"), "scripts/mac-build.sh fairphone-fp6", "scripts/mac-build.sh raspberrypi4-64",
    ("scripts/mac-build.sh --shell", "a shell inside the build container"), "PHOENIX_CPUS=8 PHOENIX_MEMORY=24g scripts/mac-build.sh phoenix-vm-arm64"])
it("Copy images out, or start the build over", "", M, WP, "webos-phoenix/docs/BUILDING-MAC.md:70,76,353",
   [("cp /work/build-webos-phoenix/BUILD/deploy/images/raspberrypi4-64/*.wic* /src/webos-phoenix/out/", "inside scripts/mac-build.sh --shell", {"r": "build container"}),
    ("container volume delete webos-phoenix-work", "deletes the whole build")])
it("Build an image on Linux", "x86-64 Ubuntu with about 200 GB free. Naming several machines configures them all; `MCF_COMMAND=configure` only writes the configuration.", L, WP,
   "webos-phoenix/README.md:566-571 · scripts/setup-build.sh:7-17",
   ["scripts/setup-build.sh ../build-webos-phoenix qemux86-64 fairphone-fp6",
    ("cd ../build-webos-phoenix && . ./oe-init-build-env && bitbake webos-phoenix-image", ""),
    ("MACHINE=fairphone-fp6 bitbake webos-phoenix-image", "one machine", {"r": "build-webos-phoenix"})])
it("Build an image on LuneOS's layers", "Where device images are moving: Yocto wrynose, Qt 6.12, Chromium 151 (docs/DECISIONS.md, 15 October 2026). The layers' pins are in `scripts/luneos-layers.txt`; `PHOENIX_LUNEOS_COMMAND=configure` only writes the configuration; your own settings go in `phoenix-local.conf` in the build directory.", L, WP,
   "webos-phoenix/scripts/setup-build-luneos.sh:10-31 · docs/HARDWARE.md, \"The web runtime: Chromium 151 on LuneOS's layers\"",
   ["scripts/setup-build-luneos.sh ../build-phoenix-luneos qemux86-64 fairphone-fp6",
    ("cd ../build-phoenix-luneos && . ./setup-env && bitbake webos-phoenix-image", ""),
    ("MACHINE=fairphone-fp6 bitbake webos-phoenix-image", "one machine", {"r": "build-phoenix-luneos"})])
it("Parse check", "About 12 minutes per machine, not as root. `PHOENIX_PARSE_STACK` (`ose` or `luneos`), `PHOENIX_PARSE_DIR`, `PHOENIX_PARSE_TARGET` and `PHOENIX_PARSE_COMPRESS` adjust it.", L, WP, "webos-phoenix/scripts/parse-check.sh:8,22-39 · docs/HARDWARE.md, \"Build\"",
   ["sudo apt-get install -y --no-install-recommends gawk diffstat chrpath cpio zstd lz4", "scripts/parse-check.sh",
    "scripts/parse-check.sh fairphone-fp6 phoenix-vm-arm64", ("PHOENIX_PARSE_STACK=luneos scripts/parse-check.sh qemux86-64", "on LuneOS's layers"),
    ("unshare --user --map-user=1000 --map-group=1000 scripts/parse-check.sh", "when you are root"),
    ("sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0", "Ubuntu 24.04's AppArmor blocks BitBake otherwise (CI does this on a throwaway machine)")])
it("Run the ARM64 VM as a device", "QEMU 8.2 or later. HVF on Apple silicon, KVM on an ARM64 Linux host, emulation otherwise. Ctrl+A X quits. Options: `--image PATH` `--kernel FILE` `--cpus N` `--memory MIB` `--cap-cpu PCT` `--gl on|off` `--audio virtio|hda|none` `--display SPEC` `--accel hvf|kvm|tcg` `--ssh-port N` `--fresh` and `-- <QEMU options>`.", B, WP,
   "webos-phoenix/scripts/vm.sh:11-44,240,260 · docs/BUILDING-MAC.md:97-131",
   [("scripts/vm.sh --list", "the devices it can be"), "scripts/vm.sh fairphone-fp6", ("scripts/vm.sh fairphone-fp6 --dry-run", "show the QEMU command"),
    ("ssh -p 2222 root@127.0.0.1", "into the running VM"),
    ("journalctl -u phoenix-device-select", "inside the VM: which device it became", {"r": "inside the VM"}), ("systemd-analyze", "boot time", {"r": "inside the VM"}), ("phoenix-diag", "collect logs", {"r": "inside the VM"})])
it("A UTM bundle for the Mac", "", B, WP, "webos-phoenix/scripts/make-utm.sh:17-46 · docs/BUILDING-MAC.md:168",
   ["scripts/make-utm.sh fairphone-fp6 --for mac", ("scripts/make-utm.sh fairphone-fp6 --for mac --force", "replace an existing bundle")])
it("Flash the Fairphone", "fastboot comes with Android's platform tools. Firmware extraction needs mtools, simg2img, lpunpack and debugfs and hasn't been run against a real factory image yet.", B, "the image's deploy folder",
   "webos-phoenix/docs/HARDWARE.md:200,214-223,239-243 · tools/device-firmware.py:14-16,30-36",
   [("tools/device-firmware.py extract fairphone-fp6 --factory-zip <factory zip> --out fw/", "", {"os": L}),
    ("tools/device-firmware.py inject --image webos-phoenix-image-fairphone-fp6.ext4 --firmware fw/", "", {"os": L}),
    "fastboot flashing unlock", ("fastboot boot boot-fairphone-fp6.img", "try it without flashing"),
    "fastboot flash boot boot-fairphone-fp6.img", "fastboot flash userdata webos-phoenix-image-fairphone-fp6.ext4", "fastboot erase dtbo", "fastboot reboot"])
it("Odin 2 Portal and PINE64 devices", "Write the image to an SD card: `bmaptool copy`, Raspberry Pi Imager or balenaEtcher.", L, "the image's deploy folder", "webos-phoenix/docs/HARDWARE.md:255",
   [("tools/device-firmware.py extract ayn-odin2portal --from-dir <blobs folder> --out fw/", "the Odin's firmware"),
    ("bmaptool copy webos-phoenix-image-pinetab2.wic.gz /dev/<sd card>", "")])

sec("iPad", "The iPad web build and the native iPad app haven't been started: they are roadmap items. UTM is the route that exists.")
it("A UTM bundle for the iPad", "Build the ARM64 VM image first. pinetab2 is the default device and `ipad` (UTM with JIT) the default target. Copy the bundle with AirDrop or the Finder.", B, WP,
   "webos-phoenix/docs/BUILDING-MAC.md:245-249,275 · scripts/make-utm.sh:11-46,89",
   ["scripts/mac-build.sh phoenix-vm-arm64", "brew install qemu", ("scripts/make-utm.sh", "for UTM with JIT"), ("scripts/make-utm.sh --for ipad-se", "for UTM SE"),
    ("scripts/make-utm.sh fairphone-fp6", "as the Fairphone"), ("scripts/make-utm.sh --gl off --force", "if the screen stays black"), ("scripts/make-utm.sh --dry-run", "")])
it("Check a bundle against UTM's own source", "`--qemu` takes `macos`, `ios` or `ios-se`.", B, WP, "webos-phoenix/tools/check-utm-bundle.py:23-26,200-215",
   ["python3 tools/check-utm-bundle.py out/Phoenix-pinetab2.utm --qemu ios"])

sec("Local servers")
it("Marketplace catalog", "PHP 8 with sodium and pdo_sqlite, on port 8088. One for every simulator of every checkout, in `~/.local/share/phoenix/catalog` (on a Mac `~/Library/Application Support/Phoenix/catalog`; `MARKETPLACE_DATA` elsewhere; the first start imports a checkout's old `server/marketplace/data`). The simulator starts it itself, and it runs while any simulator does; `serve.sh` by hand serves until stopped (`--no-fill`: without filling itself). Its review page is `/admin`; the token is `admin.token` in that folder. `availability` turns kinds of app, feeds and apps on or off per device class (docs/APP-STORE.md 3.17).", B, WP,
   "webos-phoenix/server/marketplace/bin/serve.sh:9-16,35-43,135-185 · bin/marketplace.php:43-52,207-245 · README.md \"On this computer (for now)\", \"Device classes and kinds\"",
   ["server/marketplace/bin/serve.sh", ("php server/marketplace/bin/marketplace.php seed", "also init, publish, admin, queue, approve, reject, key, developer, versions"),
    ("php server/marketplace/bin/marketplace.php upload FILE.ipk", "--phoenix for a Phoenix app, with --listing LISTING.json"),
    ("php server/marketplace/bin/marketplace.php availability off kind legacy phone", "what is on where: also on, feed NAME, app ID classes CLASS,..., app ID kind KIND; alone, prints it"),
    "python3 server/marketplace/bin/probe-pwas.py"])
it("The Marketplace's hosted apps", "Open-source web apps from their upstreams' releases (pinned in `server/marketplace/catalog/web-apps.json`; docs/WEB-APP-CATALOG.md), and the 2.0 apps from a phoenix-default-apps checkout (`--from` or `PHOENIX_DEFAULT_APPS`; skipped without one). Downloads go to a cache outside the repository (`--cache`, `PHOENIX_WEB_APPS_CACHE`). `--software-gl` for WebGL 2 apps on a machine without a GPU.", B, WP,
   "webos-phoenix/server/marketplace/bin/web-apps.py:28-58,738-975 · bin/marketplace.php:26,177 · README.md \"Open-source web apps and the 2.0 apps\"",
   [("python3 -I server/marketplace/bin/web-apps.py check", "the manifest, offline; also list"),
    ("python3 -I server/marketplace/bin/web-apps.py publish", "every app, or IDs; also fetch, pack"),
    ("python3 -I server/marketplace/bin/web-apps.py shoot photocraft --software-gl", "screenshots for the listing"),
    ("python3 -I server/marketplace/bin/web-apps.py default-apps --from ../phoenix-default-apps --publish", "the 2.0 apps"),
    ("python3 -I server/marketplace/bin/web-apps.py fill --force", "the local catalog fills itself (serve.sh runs it; Services > Refill Catalog)")])
it("Update feed", "The catalog server also serves `/updates/` (from the catalog's folder); alone, the feed runs on port 8089. `--release-notes FILE` takes the release's notes from a release notes file (its entry for the version).", B, WP, "webos-phoenix/server/updates/README.md:28-30,46-50 · bin/serve.sh:9 · bin/updates.php:20-33",
   ["UPDATES_FEED=~/.local/share/phoenix/catalog/updates php server/updates/bin/updates.php simulator --version 0.2.0 --build 2 --note \"What changed\"",
    "server/updates/bin/serve.sh", ("php server/updates/bin/updates.php show", "also publish, withdraw")])
it("Driver catalog", "Port 8090. `DRIVERS_DATA=sample` serves the simulator's sample catalog.", B, WP, "webos-phoenix/server/drivers/bin/serve.sh:5-9 · README.md:36-41",
   ["server/drivers/bin/serve.sh", ("php server/drivers/bin/drivers.php init", "also add, remove, publish, show, verify, reports, sample, keygen, pubkey, build, sign, attach, handover")])
it("The apps in a browser", "Port 8765. `--terminal` gives the Terminal app a real shell on your computer, so keep it on 127.0.0.1. Also `--terminal-shell PATH`, `--installed-dir DIR`, `--no-tcp`, `--extra-rootfs DIR`, `-v`.", B, WP,
   "webos-phoenix/tools/serve-rootfs.py:10-11,1156-1166",
   ["python3 tools/serve-rootfs.py", "python3 tools/serve-rootfs.py --port 8765 --host 127.0.0.1 --terminal"])
it("Platform mock", "Then set Settings > Developer Mode > Platform Servers to `http://127.0.0.1:8099/api/v1/servers.json`.", B, WP, "webos-phoenix/docs/PLATFORM-CLIENT.md:346 · tools/platform-mock/server.cjs:22-23",
   ["node tools/platform-mock/server.cjs --port 8099 --seed --write-servers /tmp/servers.json"])
it("The assistant's models", "`./phoenix` fetches these itself.", B, WP, "webos-phoenix/phoenix:614,624,637,645 · tools/get-whisper-model.py:33-34",
   [("python3 tools/get-whisper-model.py", "--model base.en or tiny.en"), "python3 tools/get-wakeword.py", "python3 tools/get-kitten.py", "python3 tools/get-base-model.py"])
it("Search your phone's model, for its test", "EmbeddingGemma 2 and, on Linux x86-64, llama.cpp's own build of `llama-server`, into `build/index`, where `tools/test-index-sim.cjs` finds them. The simulator downloads the model itself when Search your phone is turned on.", B, WP,
   "webos-phoenix/tools/get-index-model.py:16 · tools/test-index-sim.cjs:21-22",
   ["python3 tools/get-index-model.py"])
it("Evaluate the assistant", "`laya-server.py` needs `pip install laya`.", B, WP, "webos-phoenix/docs/AI-AND-MCP.md:953-961 · tools/laya-server.py:9-10",
   ["llama-server -m build/models/qwen3-0.6b-q8_0.gguf --port 8091 --jinja -c 4096 -np 1 -fa on -b 512",
    "node tools/eval-assistant.cjs --model http://127.0.0.1:8091/v1", "tools/laya-server.py --port 8093"])

sec("Maintenance")
it("Regenerate files", "Each has a `--check` twin under Test.", B, WP, "webos-phoenix/tools/hidpi-art.py:715-719 · tools/render-app-icons.cjs:27-30 · tools/check-launch-contracts.cjs:24-27",
   [("python3 tools/hidpi-art.py --missing", "write only the missing @2x/@3x art; --only PATH limits it"), ("node tools/render-app-icons.cjs", "app IDs to pick; --svg DIR also writes the SVGs"),
    ("node tools/check-launch-contracts.cjs --write-doc", "rewrite the table in docs/LAUNCH-CONTRACTS.md"), "python3 tools/make-feedback-sounds.py",
    ("python3 tools/release-notes-doc.py", "docs/RELEASE-NOTES.md from the release notes product.json names")])
it("Convert assistant models", "", B, WP, "webos-phoenix/tools/convert-model.sh:13 · tools/models-converted.py:8-11",
   ["tools/convert-model.sh --id <id> --repo Qwen/<name> --revision <sha> --quant Q8_0 --out <folder>", ("tools/models-converted.py wanted", "also add, official")])

gotchas = [
 "`./phoenix run` uses up the first `--`: for the 2.0 look, write `./phoenix run phone -- -- --look ember-glass`.",
 "phoenix-sim has no `--terminal`. That flag belongs to `tools/serve-rootfs.py`; in the simulator it's `--no-host-shell` or `--host-shell PATH`.",
 "`ctest` finds nothing: run the C++ test programs by name.",
 "Without `PHOENIX_SIM`, phoenix-default-apps' `npm run sim` runs inside the webos-phoenix checkout, so a relative `--screenshot` file lands there.",
 "There's no run or flash script yet for the `qemux86-64` and Raspberry Pi images.",
 "For a clean device on a Mac, start with a new `--instance NAME`; on Linux a fresh `HOME` works too.",
 "The repos pin each other: `phoenix-default-apps/phoenix.pin.json` (the webos-phoenix commit), `ember-glass.pin.json` on its `ember-glass-preview` branch, ember-glass-ui's `tools/facade-check/facade/SOURCE.json`, and the 2.0 shell's copy of the tokens. Move a pin when the repo it names moves.",
]

LEDE = ("Every build, run and test command across webos-phoenix, phoenix-ember-glass-ui (the 2.0 shell), "
        "phoenix-default-apps and ember-glass-ui, checked against the scripts themselves. Each command has its "
        "own Copy button; the line above it names the folder to run it in. Search finds a command by any word "
        "in it or its note.")
REPOS = [["webos-phoenix", "1.0: the shell, the simulator, the original apps"],
         ["phoenix-ember-glass-ui", "2.0: webos-phoenix with the Ember Glass shell"],
         ["phoenix-default-apps", "the rebuilt built-in apps"],
         ["ember-glass-ui", "the 2.0 UI layer the apps use"]]
OS_NAME = {"both": "Mac + Linux", "mac": "Mac", "linux": "Linux"}


def anchor(title):
    # GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens.
    return re.sub(r"[^a-z0-9 _-]", "", title.lower()).replace(" ", "-")


def markdown():
    out = ["<!-- Generated by tools/commands-doc.py: change the commands there, then run it. -->", "",
           "# Commands", "",
           "Every build, run and test command across webos-phoenix, phoenix-ember-glass-ui (the 2.0 shell), "
           "phoenix-default-apps and ember-glass-ui, checked against the scripts themselves. Each command is its "
           "own code block, so GitHub's copy button copies just that command. For a searchable page with a "
           "Mac/Linux filter, run `python3 tools/commands-doc.py --html build/commands.html` and open it in a browser.",
           "", "| Repo | What it holds |", "| --- | --- |"]
    out += ["| %s | %s |" % (repo, what) for repo, what in REPOS]
    out += ["", "## Contents", ""]
    out += ["- [%s](#%s)" % (s["title"], anchor(s["title"])) for s in S] + ["- [Gotchas](#gotchas)", ""]
    for s in S:
        out += ["## " + s["title"], ""]
        if s["note"]:
            out += [s["note"], ""]
        for i in s["items"]:
            out += ["### " + i["title"], ""]
            if i["desc"]:
                out += [i["desc"], ""]
            out += ["Run in `%s` · %s · Source: `%s`" % (i["runIn"], OS_NAME[i["os"]], i["source"]), ""]
            for r in i["rows"]:
                label = []
                if r.get("os") and r["os"] != i["os"]:
                    label.append("**%s:**" % OS_NAME[r["os"]])
                if r.get("r"):
                    label.append("in `%s`:" % r["r"])
                if r["n"]:
                    label.append(r["n"][0].upper() + r["n"][1:])
                if label:
                    out += [" ".join(label).rstrip(":") + ":", ""]
                out += ["```sh", r["c"], "```", ""]
    out += ["## Gotchas", ""] + ["- " + g for g in gotchas] + [""]
    return "\n".join(out)


def html():
    with open(os.path.join(ROOT, "tools", "commands-page.html")) as f:
        page = f.read()
    data = {"sections": S, "gotchas": gotchas, "lede": LEDE, "pins": REPOS}
    return page.replace("/*DATA*/null", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))


def main(argv):
    md_path = os.path.join(ROOT, "docs", "COMMANDS.md")
    if len(argv) == 2 and argv[0] == "--html":
        with open(argv[1], "w") as f:
            f.write(html())
        return 0
    if argv == ["--check"]:
        with open(md_path) as f:
            if f.read() != markdown():
                print("docs/COMMANDS.md is stale: run python3 tools/commands-doc.py", file=sys.stderr)
                return 1
        return 0
    if argv:
        print(__doc__, file=sys.stderr)
        return 2
    with open(md_path, "w") as f:
        f.write(markdown())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
