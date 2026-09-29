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

| Keyboard | Keyboard, sideways | TouchPad keyboard |
| --- | --- | --- |
| ![](docs/screenshots/keyboard.png) | ![](docs/screenshots/keyboard-landscape.png) | ![](docs/screenshots/tablet-keyboard.png) |

*The Open webOS phone and tablet keyboards (keyboard-efigs) on Just Type's
field: the app above shrinks into what is left of the screen.*

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

| Tasks | Editor | Reminder | Tablet |
| --- | --- | --- | --- |
| ![](docs/screenshots/tasks-list.png) | ![](docs/screenshots/tasks-editor.png) | ![](docs/screenshots/tasks-reminder.png) | ![](docs/screenshots/tasks-tablet.png) |

*Tasks, after the webOS 1.x app: lists, due dates, priorities, Today /
Upcoming / Overdue, and reminders scheduled with the activity manager that
reach the shell as notifications (tap one to snooze it or mark it done).*

| Voice Memos | Recording | Transcript | Share |
| --- | --- | --- | --- |
| ![](docs/screenshots/voicememos-list.png) | ![](docs/screenshots/voicememos-recording.png) | ![](docs/screenshots/voicememos-transcript.png) | ![](docs/screenshots/voicememos-share.png) |

*Voice Memos in the webOS 2.x style: record with a level meter, play,
transcribe and search. On a device it transcribes with whisper.cpp; the
simulator records with Chromium's fake microphone and knows only the demo
memos' scripts.*

| Flashlight | On | Tablet |
| --- | --- | --- |
| ![](docs/screenshots/flashlight-off.png) | ![](docs/screenshots/flashlight-on.png) | ![](docs/screenshots/flashlight-tablet.png) |

*Flashlight: the flash LED with a brightness slider through LuneOS's torch
service (`org.webosports.service.torch`, simulated here), or a white screen
on devices without one.*

| QR Scanner | Web address | Authenticator key | Tablet |
| --- | --- | --- | --- |
| ![](docs/screenshots/scanner-wifi.png) | ![](docs/screenshots/scanner-url.png) | ![](docs/screenshots/scanner-otpauth.png) | ![](docs/screenshots/scanner-tablet.png) |

*QR Scanner reads QR codes and barcodes with zxing-wasm on the device and
acts on them: join a Wi-Fi network in Settings, open a web address, add a
contact, hand an `otpauth://` key to the authenticator, call, write, copy.
The codes here are videos for Chromium's fake camera.*

| Weather | Places | Offline | Tablet |
| --- | --- | --- | --- |
| ![](docs/screenshots/weather-current.png) | ![](docs/screenshots/weather-places.png) | ![](docs/screenshots/weather-offline.png) | ![](docs/screenshots/weather-tablet.png) |

*Weather from Open-Meteo (no API key; data CC BY 4.0): now, 24 hours and
7 days for the device's location and saved cities, in the region's units,
with the last forecast kept for offline use. It sends only coordinates
rounded to about a kilometre.*

| Maps | Directions | Navigation | Tablet |
| --- | --- | --- | --- |
| ![](docs/screenshots/maps-place.png) | ![](docs/screenshots/maps-directions.png) | ![](docs/screenshots/maps-navigation.png) | ![](docs/screenshots/maps-tablet.png) |

*Maps on OpenStreetMap: search, directions for driving, walking and cycling
with a turn list, turn-by-turn navigation with spoken directions, saved
places, sharing, and offline maps with offline search and directions. The
map tiles, search and routing servers are all configurable; the defaults
are keyless public services (see [docs/MAPS.md](docs/MAPS.md)). It ships
with a small demo region (downtown San Jose), which the simulator starts
in.*

| Passwords | Generator | Tablet | Locked in card view |
| --- | --- | --- | --- |
| ![](docs/screenshots/passwords-entry.png) | ![](docs/screenshots/passwords-generator.png) | ![](docs/screenshots/passwords-tablet.png) | ![](docs/screenshots/passwords-card-view.png) |

*Passwords, a KeePass password manager: KDBX 4 files that KeePassXC and
KeePassDX open too, TOTP codes from their `otp` fields, a generator, and a
clipboard that clears itself. It locks when the screen locks, when the card
is minimized (right: in phoenix-sim's card view) and after a while.*

| Authenticator | Unlock | Add from a scan | Import | Tablet |
| --- | --- | --- | --- | --- |
| ![](docs/screenshots/authenticator-codes.png) | ![](docs/screenshots/authenticator-lock.png) | ![](docs/screenshots/authenticator-confirm.png) | ![](docs/screenshots/authenticator-import.png) | ![](docs/screenshots/authenticator-tablet.png) |

*Authenticator: two-factor codes (TOTP and HOTP) with a countdown ring, tap
to copy, encrypted with the device passcode; codes from the QR scanner are
confirmed before they are added. Threat model:
[docs/SECURITY-APPS.md](docs/SECURITY-APPS.md).*

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
| `apps/` | New Phoenix web apps in React + TypeScript (Settings, Phone, Messaging, Camera, Photos, Music, Files, Tasks, Voice Memos, Flashlight, QR Scanner, Weather, Maps, Passwords, Authenticator), with the shared `@phoenix/ui` components, `@phoenix/luna` service client and `@phoenix/secrets` (TOTP, sealing, auto-lock), generated demo media (`apps/media-samples`), the Node.js Luna services of Files (`apps/files/service`) and Voice Memos (`apps/voicememos/service`, speech to text with whisper.cpp), and the CardDAV & CalDAV Synergy account with its sync service (`apps/dav`, see [docs/SYNERGY.md](docs/SYNERGY.md)) |
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
./build/phoenix-sim --size 480x800 --scale 1.5 --scene cards   # Pre 3
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
the bottom is the gesture area. Keys: **Esc** back, **F1** swipe up, **Home** the Home button,
**F2** demo notification, **F3** lock/unlock, **F4** incoming call (rings
the Phone app), **F5** incoming text message (for Messaging), **F6** low
battery, **F7** plug a charger in or out, **F8** battery charged to full,
**Ctrl+Left** / **Ctrl+Right**
turn the device a quarter turn counter-clockwise / clockwise, type in card
view for Just Type. `./build/phoenix-sim --open https://example.com` opens a
page in the browser. A text field taking the focus brings up the virtual
keyboard (the Open webOS phone and TouchPad keyboards); click its keys, or
keep typing on the desktop keyboard.

The window shows the device as it is held: turned on its side it becomes a
landscape window, and the UI follows 200 ms later with the original
300 ms turn, unless the rotation lock (system menu) or the app in front
holds it. `--orientation left|right|down` starts the device turned (`--size`
stays the screen upright, e.g. `--size 320x480 --orientation left` is a
480x320 window); `--turn left` turns it a second after start-up, for
screenshots of the turn (`--delay 1450` catches it halfway).

The **+** button in each placeholder app opens a second window, which joins
that app's card stack.

System sounds play as on the original: Open webOS's own sounds
(notifications, alerts, the ringtone for an incoming call, charging, battery
full, boot and, when the window closes, shutdown) and Phoenix-made keyboard
clicks, at the volumes set in Settings > Sounds & Ringtones. The simulator
plays them with the web engine's audio; `--quiet` leaves out the boot and
shutdown sounds (so do `--screenshot` and the offscreen platform).

`--launch com.palm.app.notes` opens an app at start-up (repeatable);
`--launch org.webosphoenix.settings.wifi` opens a Settings pane.

`--scene locked|cards|stacks|reorder|maximized|heldcard|launcher|dashboard|justtype|keyboard|systemmenu` opens
a demo state (`keyboard`: Just Type with the virtual keyboard up; `heldcard`: a card that keeps the upright orientation, drawn
turned in card view with `--orientation left`); add `--screenshot out.png`
to save a PNG and exit.

Tests:

```sh
QT_QPA_PLATFORM=offscreen qmltestrunner -import shell/qml -import build/qml -input shell/tests
(cd apps && npm test && npm run typecheck)
node tools/test-apps.cjs && node tools/test-settings.cjs   # needs Playwright
node tools/test-phone-messaging.cjs                        # calls and texts
node tools/test-media.cjs                                   # Camera, Photos, Music
node tools/test-files.cjs                                   # Files
node tools/test-tasks.cjs                                   # Tasks and reminders
node tools/test-alarm.cjs                                   # a Clock alarm rings as a popup alert
node tools/test-keyboard.cjs                                # web fields and the virtual keyboard
node tools/test-voicememos.cjs                              # Voice Memos
node tools/test-maps.cjs                                    # Maps (no live map servers)
node tools/test-passwords.cjs                               # Passwords (KeePass)
node tools/test-authenticator.cjs                           # Authenticator (TOTP/HOTP)
node tools/test-orientation.cjs                             # apps asking for and following an orientation
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
- [Hardware](docs/HARDWARE.md): target devices, drivers, installer and updates
- [App gaps](docs/APP-GAPS.md): the apps a modern phone needs, and which Phoenix still lacks
- [App store](docs/APP-STORE.md): PWAs as webOS apps, legacy `.ipk` apps, and the catalog
- [Android apps](docs/ANDROID.md): Android apps as webOS cards through Waydroid
- [Legacy UI spec](docs/spec/legacy-ui-spec.md): measurements and timings taken from the original source
- [Feature inventory](docs/spec/feature-inventory.md): everything legacy webOS did, as a checklist
- [Synergy](docs/SYNERGY.md) and [modern Synergy](docs/SYNERGY-MODERN.md): accounts, sync and merged messaging
- [HiDPI art](docs/spec/hidpi-art.md): how the shell picks art and app icons for dense screens, and how to add variants
- [Licensing and assets](docs/LEGAL.md)

## License

Apache-2.0, like webOS OSE and Open webOS. See [LICENSE](LICENSE) and
[NOTICE](NOTICE). "webOS" is a trademark of LG Electronics; this is an
independent community project and is not affiliated with LG, HP or Palm.
