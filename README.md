# webOS Phoenix

Bringing the classic Palm webOS phone and tablet experience back, built on the
open-source **webOS Open Source Edition (OSE)**.

webOS OSE is a modern, maintained, Apache-2.0 platform (Linux, systemd, Qt 6,
Wayland, Chromium-based web runtime), but its UI is designed for TVs and
kiosks. Phoenix replaces that UI with the one that made webOS great on the Pre,
Pre 2, Pre 3, Veer and TouchPad: cards, gestures, the quick launch bar, stacked
notifications, Just Type. It reuses the original Open webOS artwork and
measurements wherever the license allows.

| Lock screen | Card view | Card stack | Reordering | App | Launcher | Dashboard | Just Type | System menu |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ![](docs/screenshots/locked.png) | ![](docs/screenshots/cards.png) | ![](docs/screenshots/stacks.png) | ![](docs/screenshots/reorder.png) | ![](docs/screenshots/maximized.png) | ![](docs/screenshots/launcher.png) | ![](docs/screenshots/dashboard.png) | ![](docs/screenshots/justtype.png) | ![](docs/screenshots/systemmenu.png) |

*Simulator at the Pre's native 320×480. Status bar, lock clock, quick launch,
launcher tabs and menus use the original Open webOS art.*

| Settings tab | Wi-Fi | Settings cards | System menu and Settings |
| --- | --- | --- | --- |
| ![](docs/screenshots/settings-launcher.png) | ![](docs/screenshots/settings-wifi.png) | ![](docs/screenshots/settings-cards.png) | ![](docs/screenshots/settings-systemmenu.png) |

*Phoenix Settings, a new React app drawn with the Enyo 1.0 artwork, running in
the simulator against simulated webOS OSE services. Turning Wi-Fi on in the
system menu updates the Settings card behind it.*

| Dial pad | In call | Incoming call | Messaging | Conversation |
| --- | --- | --- | --- | --- |
| ![](docs/screenshots/phone-dialpad.png) | ![](docs/screenshots/phone-incall.png) | ![](docs/screenshots/phone-incoming.png) | ![](docs/screenshots/messaging.png) | ![](docs/screenshots/messaging-thread.png) |

*Phoenix Phone and Messaging, drawn with the webOS dial pad and Enyo 1.0
art, against simulated legacy webOS telephony and messaging services
(F4 rings the phone, F5 delivers a text).*

| Camera | Photos | Viewer | Music | Now Playing | Media cards |
| --- | --- | --- | --- | --- | --- |
| ![](docs/screenshots/media-camera.png) | ![](docs/screenshots/media-photos.png) | ![](docs/screenshots/media-viewer.png) | ![](docs/screenshots/media-music.png) | ![](docs/screenshots/media-nowplaying.png) | ![](docs/screenshots/media-cards.png) |

*Camera, Photos and Music, new React apps in the webOS 2.x style, against the
simulated media indexer, camera and audio services. The camera uses
Chromium's test camera here; the wallpaper behind the cards was set from
Photos. The demo photos and chiptunes are generated.*

| Files | Select | Text editor | Info | Image viewer |
| --- | --- | --- | --- | --- |
| ![](docs/screenshots/files-browse.png) | ![](docs/screenshots/files-select.png) | ![](docs/screenshots/files-editor.png) | ![](docs/screenshots/files-info.png) | ![](docs/screenshots/files-viewer.png) |

*Files, a file manager with the feature set of Internalz Pro (the favourite
Preware file manager), designed anew in the webOS 2.x style, against a
simulated filesystem service.*

## Status

**Milestone 0: the shell runs in a desktop simulator.** You can use the card
view (swipe between cards, flick up to close, tap to maximize), card stacks
(an app's extra windows stack with it; press and hold a card to reorder it or
drag it into another stack), the gesture
area (swipe up for cards or the launcher, swipe left for back), the quick launch
bar and launcher, notification banners and the dashboard, the lock screen, Just
Type and the system menu. It runs on macOS and Linux.

The webOS OSE integration (a `meta-phoenix` Yocto layer and a compositor
adapter) is written but **has not yet run on a device**. That is Milestone 1.
See [docs/ROADMAP.md](docs/ROADMAP.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `shell/qml/Phoenix/Shell` | The system UI in QML: card view, status bar, launcher, notifications, lock screen, gestures |
| `shell/qml/Phoenix/Sim` | Mock apps and device status for the desktop simulator |
| `shell/qml/Phoenix/Lsm`, `shell/qml/WebOSCompositor` | Adapter that plugs the shell into webOS OSE's `luna-surfacemanager` |
| `shell/sim` | `phoenix-sim`, the desktop runner (also takes screenshots) |
| `apps/` | New Phoenix web apps in React + TypeScript (Settings, Phone, Messaging, Camera, Photos, Music, Files), with the shared `@phoenix/ui` components and `@phoenix/luna` service client, generated demo media (`apps/media-samples`), the Files app's Node.js Luna service (`apps/files/service`), and the CardDAV & CalDAV Synergy account with its sync service (`apps/dav`, see [docs/SYNERGY.md](docs/SYNERGY.md)) |
| `runtime/` | The webOS web app runtime for the simulator and browsers (`PalmSystem`, simulated Luna services) |
| `shell/tests` | Behaviour tests (`qmltestrunner`) |
| `shell/assets/openwebos` | Original Open webOS system UI artwork (Apache-2.0) |
| `meta-phoenix` | OpenEmbedded layer that adds Phoenix to a webOS OSE image |
| `scripts/setup-build.sh` | Sets up a webOS OSE build with `meta-phoenix` |
| `docs/` | Architecture, roadmap, licensing, and the legacy UI spec |

## Run the simulator

Requires Qt 6.4 or newer with Qt Quick and Qt5Compat. Qt WebEngine is
needed to run the web apps (the original webOS apps and new Phoenix apps);
without it the simulator shows placeholder apps only. Node.js 20 or newer
builds the Phoenix apps (Settings, Phone, Messaging); `cmake --build` runs `npm ci` and
`npm run build` in `apps/` for you, and warns if npm is missing.

First fetch the original Open webOS apps and frameworks (git submodules):

```sh
git submodule update --init
```

**macOS**

```sh
brew install qt cmake node
cmake -S shell -B build -DCMAKE_PREFIX_PATH="$(brew --prefix qt)"
cmake --build build
./build/phoenix-sim            # Pre (320x480)
./build/phoenix-sim --size 480x800 --scene cards   # Pre 3
./build/phoenix-sim --tablet   # TouchPad (1024x768)
```

**Ubuntu 24.04**

```sh
sudo apt install qt6-base-dev qt6-declarative-dev qml6-module-qtquick \
  qml6-module-qtquick-window qml6-module-qtqml-workerscript \
  qml6-module-qt5compat-graphicaleffects qml6-module-qttest \
  qt6-webengine-dev qml6-module-qtwebengine
sudo snap install node --classic   # Node.js 20+; Ubuntu's nodejs package is too old
cmake -S shell -B build && cmake --build build
./build/phoenix-sim
```

Controls: drag with the mouse as you would with a finger. The black strip at
the bottom is the gesture area. Keys: **Esc** back, **Home**/**F1** swipe up,
**F2** demo notification, **F3** lock/unlock, **F4** incoming call (rings
the Phone app), **F5** incoming text message (for Messaging), type in card
view for Just Type. `./build/phoenix-sim --open https://example.com` opens a
page in the browser.

The **+** button in each placeholder app opens a second window, which joins
that app's card stack.

`--launch com.palm.app.notes` opens an app at start-up (repeatable);
`--launch org.webosphoenix.settings.wifi` opens a Settings pane.

`--scene locked|cards|stacks|reorder|maximized|launcher|dashboard|justtype|systemmenu` opens
a demo state; add `--screenshot out.png` to save a PNG and exit.

Tests:

```sh
QT_QPA_PLATFORM=offscreen qmltestrunner -import shell/qml -input shell/tests
(cd apps && npm test && npm run typecheck)
node tools/test-apps.cjs && node tools/test-settings.cjs   # needs Playwright
node tools/test-phone-messaging.cjs                        # calls and texts
node tools/test-media.cjs                                   # Camera, Photos, Music
node tools/test-files.cjs                                   # Files
```

## Build a webOS OSE image (experimental)

On an Ubuntu build host with about 200 GB free:

```sh
scripts/setup-build.sh ../build-webos-phoenix qemux86-64
cd ../build-webos-phoenix && . ./oe-init-build-env
bitbake webos-phoenix-image
```

This pins webOS OSE `build-webos` and adds `meta-phoenix`. On a Mac, use
`scripts/mac-build.sh`, which runs the same build in a Linux container with
Apple's `container` tool; see [docs/BUILDING-MAC.md](docs/BUILDING-MAC.md). See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the shell is installed.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): how Phoenix sits on top of webOS OSE
- [Roadmap](docs/ROADMAP.md): milestones from simulator to phones
- [Web app runtime](docs/APP-RUNTIME.md): how the original webOS apps run
- [Legacy UI spec](docs/spec/legacy-ui-spec.md): measurements and timings taken from the original source
- [Feature inventory](docs/spec/feature-inventory.md): everything legacy webOS did, as a checklist
- [Licensing and assets](docs/LEGAL.md)

## License

Apache-2.0, like webOS OSE and Open webOS. See [LICENSE](LICENSE) and
[NOTICE](NOTICE). "webOS" is a trademark of LG Electronics; this is an
independent community project and is not affiliated with LG, HP or Palm.
