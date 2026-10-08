# webOS Phoenix

Bringing the classic Palm webOS phone and tablet experience back, built on the
open-source **webOS Open Source Edition (OSE)**.

webOS OSE is a modern, maintained, Apache-2.0 platform (Linux, systemd, Qt 6,
Wayland, Chromium-based web runtime), but its UI is designed for TVs and
kiosks. Phoenix replaces that UI with the one that made webOS great on the Pre,
Pre 2, Pre 3, Veer and TouchPad: cards, gestures, the quick launch bar, stacked
notifications, Just Type. It reuses the original Open webOS artwork and
measurements wherever the license allows.

There are two lines. **1.x** stays very close to the original webOS and is
never deprecated: it is for the fans. **2.0** is a modern revamp in style
and features, including docking to monitors and TVs, to bring webOS back.
See [docs/ROADMAP.md](docs/ROADMAP.md#two-lines-1x-and-20).

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

| Terminal | top | Tablet | vim |
| --- | --- | --- | --- |
| ![](docs/screenshots/terminal-phone.png) | ![](docs/screenshots/terminal-top.png) | ![](docs/screenshots/terminal-tablet.png) | ![](docs/screenshots/terminal-tablet-vim.png) |

*Terminal: a real shell (bash by default, zsh in Preferences) in a card,
drawn by xterm.js, with an extras row of Esc, sticky Ctrl and Alt, Tab and
arrows above the keyboard. On a device the shells run as the unprivileged
user under the `org.webosphoenix.pty` service; in the simulator they are
your own shell on your computer. See [docs/TERMINAL.md](docs/TERMINAL.md).*

| Videos | Podcasts | Now Playing | PDF View | Doc View | Excel |
| --- | --- | --- | --- | --- | --- |
| ![](docs/screenshots/videos-player.png) | ![](docs/screenshots/podcasts-episodes.png) | ![](docs/screenshots/podcasts-nowplaying.png) | ![](docs/screenshots/pdfview-search.png) | ![](docs/screenshots/docview-book.png) | ![](docs/screenshots/docview-excel.png) |

*Videos (resume, WebVTT/SRT subtitles, free rotation), Podcasts (RSS,
directory search, downloads, speed, sleep timer, OPML, background refresh),
PDF View on PDF.js, and Doc View for EPUB, Word, Excel, PowerPoint and
Markdown. Demo videos and documents are generated (CC0).*

| First Use | Tutorial | Help | Emergency Call | Restricted Phone | Medical ID | Location Services |
| --- | --- | --- | --- | --- | --- | --- |
| ![](docs/screenshots/firstuse-welcome.png) | ![](docs/screenshots/firstuse-tutorial.png) | ![](docs/screenshots/help-topic.png) | ![](docs/screenshots/lock-emergency.png) | ![](docs/screenshots/emergency-dialpad.png) | ![](docs/screenshots/emergency-medical-id.png) | ![](docs/screenshots/location-settings.png) |

| First Use, TouchPad | Emergency Call, TouchPad | Help, TouchPad |
| --- | --- | --- |
| ![](docs/screenshots/tablet-firstuse.png) | ![](docs/screenshots/tablet-emergency.png) | ![](docs/screenshots/tablet-help.png) |

*First Use runs at the first start, as on webOS, and ends with a cards and
gestures tutorial. Help's topics are Markdown files, found by Just Type.
The PIN pad's Emergency Call opens Phone in a restricted mode over the lock
screen, with the owner's Medical ID (Settings > Emergency Info). Location
Services lists the apps that asked for the position; the first ask raises
the original luna-systemui location alert.*

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
| `apps/` | New Phoenix web apps in React + TypeScript (Settings, Phone, Messaging, Camera, Photos, Music, Files, Tasks, Voice Memos, Flashlight, QR Scanner, Weather, Maps, Passwords, Authenticator, Terminal, Videos, Podcasts, PDF View, Doc View, First Use, Help, Print Manager, Voice Dial), with the shared `@phoenix/ui` components, `@phoenix/luna` service client and `@phoenix/secrets` (TOTP, sealing, auto-lock), generated demo media (`apps/media-samples`), the Node.js Luna services of Files (`apps/files/service`) and Voice Memos (`apps/voicememos/service`, speech to text with whisper.cpp), and the CardDAV & CalDAV Synergy account with its sync service (`apps/dav`, see [docs/SYNERGY.md](docs/SYNERGY.md)) |
| `services/pty` | `org.webosphoenix.pty`, the Terminal's PTY Luna service (C++), whose core phoenix-sim also uses |
| `services/devices` | `phoenix-devices`: LunaSysMgr's `com.palm.display`, `com.palm.keys`, `com.palm.vibrate` and `com.palm.ambientLightSensor` on a device, which OSE lacks (C++; docs/HARDWARE.md); finds the hardware by looking and follows it as it comes and goes; `phoenix-devices --probe` prints what it finds |
| `runtime/` | The webOS web app runtime for the simulator and browsers (`PalmSystem`, simulated Luna services) |
| `shell/tests` | Behaviour tests (`qmltestrunner`) |
| `shell/assets/openwebos` | Original Open webOS system UI artwork (Apache-2.0) |
| `meta-phoenix` | OpenEmbedded layer that adds Phoenix to a webOS OSE image |
| `scripts/setup-build.sh` | Sets up a webOS OSE build with `meta-phoenix` |
| `docs/` | Architecture, roadmap, licensing, and the legacy UI spec |

## Run the simulator

Requires Qt 6.8 or newer (6.8 is what a device's webOS OSE image ships)
with Qt Quick and Qt5Compat. Qt WebEngine is
needed to run the web apps (the original webOS apps and new Phoenix apps);
without it the simulator shows placeholder apps only. Node.js 22 or 24
(the LTS lines; 20.19+ also works) builds the Phoenix apps (Settings, Phone,
Messaging); `cmake --build` runs `npm ci` and `npm run build` in `apps/` for
you, and warns if npm is missing. Odd-numbered Node releases (such as 23)
are short-lived and Enact's CLI refuses them, so with one the Enact demos
are skipped with a warning (`brew install node@22` on a Mac). The Flutter
demo is built when Flutter is installed (`brew install --cask flutter`) and
skipped otherwise.

First fetch the original Open webOS apps and frameworks (git submodules):

```sh
git submodule update --init
```

Step by step, with troubleshooting and the test tools:
[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md). `scripts/mac-setup.sh`
and `scripts/linux-setup.sh` install everything and build it.

**macOS**

```sh
brew install qt cmake ninja node@22
export PATH="$(brew --prefix)/opt/node@22/bin:$PATH"
cmake -S shell -B build -G Ninja -DCMAKE_PREFIX_PATH="$(brew --prefix qt)"
cmake --build build
```

| Command | What it does |
| --- | --- |
| `./build/phoenix-sim` | Pre (320x480) |
| `./build/phoenix-sim --size 480x800 --scale 1.5 --scene cards` | Pre 3 |
| `./build/phoenix-sim --tablet` | TouchPad (1024x768) |
| `./build/phoenix-sim --tablet --size 2560x1600 --scale 2` | A large tablet |

**Ubuntu 24.04**

```sh
scripts/linux-setup.sh
./build/phoenix-sim
```

Ubuntu's own Qt packages stop at 6.4, so the script installs Qt 6.8.1 into
`/opt/Qt` with aqtinstall (and Node.js 22, as Ubuntu's nodejs is too old),
then builds with `-DCMAKE_PREFIX_PATH=/opt/Qt/6.8.1/gcc_64`.

The window is the **Phoenix WebOS Simulator**: the device's screen under a
menu bar (on a Mac, the one at the top of the screen) and beside a toolbar.
**Device** has its buttons and switches (Power, Home, Back, the volume keys,
the ringer switch, turning it left or right, a screen capture, the Full Erase
and USB drive chords, a hardware keyboard), **Simulate** what happens to it
(an incoming call, text, picture message or IM, a notification, the battery
and chargers, a USB cable, the Touchstones, Touch to Share, a headset and its
button, the play/pause key, the light), **View** the device it starts as
(phone or tablet, the scale, a demo scene: these restart it) and the
developer overlays, and **Help > Keyboard Shortcuts…** lists every key below
in a window. Each menu item shows its key, so the menus teach them; they are
made from one list in `shell/qml/sim.qml` (`simActions`), as the keys are.
The toolbar has icons for the most used: Power, Home, Back, rotate, screen
capture, incoming call, text, notification, low battery, charger, Touchstone,
phone and tablet; their tooltips name the keys. It sits beside the screen
(down the right of an upright screen, along the top of one on its side), so
the screen keeps its size and `--screenshot` saves the screen alone; **View >
Show Toolbar** or `--no-toolbar` hides it. Its icons need Qt's SVG plugin
(`libqt6svg6` on Ubuntu; Homebrew's `qt` has it); without it its buttons
show their names.

Controls: drag with the mouse as you would with a finger. In card view a
two-finger trackpad swipe sideways moves between cards and a swipe up throws
the card under the pointer away; a mouse wheel moves one card per notch. The
same two-finger swipe moves between the launcher's pages and the keyboard's
clips (snapping to one, as card view does), scrolls the launcher's icons and
the notification list, and swiped sideways on a notification dismisses it
(`TrackpadSwipe.qml`). The strip at the
bottom is the gesture bar, on phones and tablets alike; it moves to the
bottom of the screen as you hold it. Press on it and drag (up: card view,
or out of Just Type; left: back), or swipe two fingers on a trackpad with
the pointer on it. With Settings > Advanced > Wave launcher on, drag up from
the bar's left or right quarter, slide along the wave and let go on an app;
with Switch apps on (also Screen & Lock > Advanced gestures), drag across the
bar's centre about half a phone's width (160 px) for the app beside. `--home-button` simulates a device
whose maker uses a hardware Home button instead (no gesture bar; tablets
then take the bottom-edge flick). A big `--size` needs a matching
`--scale` to look like a real device (2 for most tablets of 2560 px). The
keyboard's microphone and Voice Dial transcribe with whisper.cpp on your
computer (`PHOENIX_WHISPER_CLI`, `PHOENIX_WHISPER_MODEL`); without a
microphone, `--microphone-file call.wav --microphone-file yes.wav` plays
WAV files as one, one per recording. Keys: **Esc** back, **F1** swipe up, **Home** the Home button,
**F2** demo notification, **F3** the Power button (the screen off and locked, or on again), **F4** incoming call (rings
the Phone app), **F5** incoming text message (for Messaging; **Shift+F5** a picture message, **Ctrl+F5** an instant message from a buddy once an IM account is set up), **F6** low
battery, **Shift+F6** the battery stops reporting (or reports again), **F7** plug a charger in or out, **F8** battery charged to full,
**Shift+F7** brings a Touch to Share phone in range (the glow) or takes it away, **Ctrl+F7** touches it to the device: the app in front sends what it shares (the browser its page) and its card is thrown (`--touch-to-share` starts with one in range),
**F12** set the device on a Touchstone (the inductive charger) or lift it off,
**Shift+F12** onto another Touchstone,
**F9** (or **Home**+**F3**, **Print Screen**, **Ctrl+Alt+P**) a screen capture,
**F10** / **F11** the volume keys (down / up),
**Ctrl+Shift+R** the ringer switch (silent mutes), **Ctrl+Shift+H** a headset
in or out, **Ctrl+Shift+B** its button (twice within a second: a double
click), **Ctrl+Shift+M** the play/pause media key, **Ctrl+Shift+L** the
light on the light sensor (dark, dim, indoor, outdoor: with automatic
brightness the screen dims in dim and dark light); **Ctrl+Shift+G** a
Bluetooth game controller (**Ctrl+Shift+A** presses its A), **Ctrl+Shift+U**
a USB drive in the device's port (OTG), **Ctrl+Shift+T** the battery's
temperature (31, 46, 51 °C: luna-systemui's heat warnings); apps hear them through
`com.palm.keys` and `com.palm.ambientLightSensor`, and an app's vibration
shakes the window under "Vibrating: …",
**Ctrl+Left** / **Ctrl+Right**
turn the device a quarter turn counter-clockwise / clockwise, type in card
view for Just Type. The original's key chords: hold **F3** and **F11**
(Power and Volume Up), then press **Home**: Full Erase's six-second
countdown; keep holding and the device is erased and starts again into
First Use (let go to stop it). **F3** with **F10** (Power and Volume Down)
on a USB cable: USB drive mode. **Shift+F8** plugs a USB cable from a
computer in or out (`--usb` starts with it in): luna-systemui asks
"Connected"; "USB Drive" puts the device into USB drive mode, until the
computer ejects it (**Ctrl+F8**) or the cable is pulled (then the drive is
checked: "OWWW! That hurts!"). `--usb-busy` makes it fail ("USB Drive
connection failed"). Left alone the screen dims and turns off as on a device
(Settings > Screen & Lock > Turn off after; 5 s on the lock screen); a
click, **F3** or **Home** turns it on (on a Mac, F3 to F11 need **fn**:
macOS keeps them for itself). `--stay-awake` keeps it on (as `--screenshot`
does). `--hardware-keyboard` starts with a hardware keyboard attached, and **Ctrl+Shift+K** attaches or detaches one: the virtual keyboard then stays down when a field takes the focus, a keyboard button above the gesture bar brings it up, and typing on the keyboard puts it away. **Ctrl+Shift+O** (the toolbar's keyboard button) brings the on-screen keyboard up or puts it down; with no text field in use it opens Just Type, whose field it types into. `--low-memory` acts as if memory were low: launching an app shows
"Sorry, Too Many Cards" instead. On a Touchstone the device goes into dock
mode, "Exhibition", as on webOS: at once with the screen off (or Power), or
when the screen would have turned off; an exhibition shows full screen (the
Time clocks, Photos' slideshow, the Agenda, any app that declares
`exhibitionMode`), picked from the status bar's title; Home, the swipe up
or lifting it off leaves (Settings > Exhibition). `--touchstone` starts on
one, in dock mode. `./build/phoenix-sim --open https://example.com` opens a
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
clicks, at the volumes and with the ringtone, alert tone and notification
tone set in Settings > Sounds & Ringtones. The simulator
plays them with the web engine's audio; `--quiet` leaves out the boot and
shutdown sounds (so do `--screenshot` and the offscreen platform).

The boot animation shows at start-up, as on a device, until the system UI
has loaded (not with `--screenshot` or `--no-boot-animation`;
`--boot-animation` shows it anyway, e.g. for a screenshot). After a system
update's Install Now it says "Updating the system" first.

`--security-policy minLength=6,maxRetries=4,alphaNumeric,noSimple,inactivity=300`
sets a device security policy, as an Exchange account did (any of the
parts; `none` removes it): the lock screen asks for a PIN or password that
meets it, counts the tries left, warns before the last one and erases the
device after it. Settings > Developer Mode (when on) has switches for the
frame rate counter and the touch plot.

`--launch com.palm.app.notes` opens an app at start-up (repeatable);
`--launch org.webosphoenix.settings.wifi` opens a Settings pane.

`--scene locked|cards|stacks|reorder|maximized|heldcard|launcher|launcherinstall|dashboard|justtype|keyboard|systemmenu|pin|emergency|firstuse` opens
a demo state (`keyboard`: Just Type with the virtual keyboard up; `heldcard`: a card that keeps the upright orientation, drawn
turned in card view with `--orientation left`; `emergency`: the PIN pad's
Emergency Call; `firstuse`: First Use; `launcherinstall`: the launcher's
Downloads page with an app being installed and one whose install failed); add `--screenshot out.png`
to save a PNG and exit.

**First Use** runs at start-up, as on a new device, until it has been
finished or skipped once (the simulator remembers it in its settings
file); `--first-use` runs it again. It does not run with `--scene` or
`--launch`.

Tests:

```sh
QT_QPA_PLATFORM=offscreen qmltestrunner -import shell/qml -import build/qml -input shell/tests
(cd apps && npm test && npm run typecheck)
```

| Command | What it does |
| --- | --- |
| `node tools/test-apps.cjs && node tools/test-settings.cjs` | Needs Playwright |
| `node tools/test-phone-messaging.cjs` | Calls, texts, MMS and IM |
| `node tools/test-voicedial.cjs` | Voice Dial |
| `node tools/test-media.cjs` | Camera, Photos, Music |
| `node tools/test-files.cjs` | Files |
| `node tools/test-tasks.cjs` | Tasks and reminders |
| `node tools/test-db8-pages.cjs` | Db8 shared by pages writing at once |
| `node tools/test-alarm.cjs` | A Clock alarm rings as a popup alert |
| `node tools/test-device-services.cjs` | The Clock's alarm holds the display on (`com.palm.display`), a volume key or Power snoozes it (`com.palm.keys`), the ringer switch |
| `node tools/test-keyboard.cjs` | Web fields and the virtual keyboard |
| `node tools/test-voicememos.cjs` | Voice Memos |
| `node tools/test-maps.cjs` | Maps (no live map servers) |
| `node tools/test-passwords.cjs` | Passwords (KeePass) |
| `node tools/test-authenticator.cjs` | Authenticator (TOTP/HOTP) |
| `node tools/test-clipboard.cjs` | Clipboard history: the Clipboard app and Settings > Clipboard |
| `node tools/test-sharing.cjs` | Sharing, sync and health (M6 F4): DropShare (Settings, receiving into Downloads, sending, the share sheet, Touch to Share), a subscribed .ics calendar, the temperature warnings |
| `node tools/test-community.cjs` | The community's features (M6 F4): Settings > Advanced, repeat alerts and lock screen previews reaching the shell, Contacts' tones and a text's tone, Email's cycling dashboard |
| `node tools/test-assistant.cjs` | The Phoenix Assistant: the app's commands, read-backs and choices, Settings > Assistant with a stand-in cloud provider, the permission gate, conversations |
| `node tools/test-terminal.cjs` | Terminal (simulated shell, then /bin/sh for real) |
| `build/pty/pty-test` | The Terminal's PTY service |
| `build/devices/devices-test` | phoenix-devices: the display, keys, vibrator and light sensor services; the hardware found by looking, devices appearing and going, `--probe` |
| `node tools/test-videos.cjs` | Videos |
| `node tools/test-podcasts.cjs` | Podcasts |
| `node tools/test-docs.cjs` | PDF View and Doc View |
| `node tools/test-orientation.cjs` | Apps asking for and following an orientation |
| `node tools/test-firstuse.cjs` | First Use, every step |
| `node tools/test-help.cjs` | Help, and Just Type finding it |
| `node tools/test-emergency.cjs` | Emergency Info, restricted Phone, Accessibility |
| `node tools/test-location.cjs` | Location Services and permissions |
| `node tools/test-appmanager.cjs` | Launch points apps add, handlers, the installer's queries |
| `node tools/test-security.cjs` | Security policy, erase, USB drive mode, debugging |
| `node tools/test-browser.cjs` | The browser: pages, downloads, printing (Save as PDF), find on page, private browsing, the content blocker, user agent and search engine preferences |

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

- [Getting started](docs/GETTING-STARTED.md): install on a Mac or Ubuntu, run, test, build images for devices, and set up Claude Code
- [Building an OS image on a Mac](docs/BUILDING-MAC.md)
- [Architecture](docs/ARCHITECTURE.md): how Phoenix sits on top of webOS OSE
- [Roadmap](docs/ROADMAP.md): milestones from simulator to phones
- [Status](docs/STATUS.md): where the project stands, open decisions and next work
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
