# Roadmap

Goal: the full legacy webOS phone and tablet experience, pixel for pixel and
feature for feature, on webOS OSE. Once that works, modernize it.

The checklist of legacy features is in
[spec/feature-inventory.md](spec/feature-inventory.md), and the measurements
are in [spec/legacy-ui-spec.md](spec/legacy-ui-spec.md).

## M0: shell in a simulator (done in this repo's first PR)

- [x] Legacy measurements, timings and artwork extracted from Open webOS `luna-sysmgr`
- [x] Card view: swipe, flick to close, tap to maximize, shuffle after close
- [x] Card stacks: fanned open stack, collapsed neighbours, child windows join their app's stack
- [x] Card reorder: press and hold, shuffle within a stack, move out of / into stacks via the edge zones
- [x] Status bar with original indicator art, system menu
- [x] Quick launch bar and tabbed launcher (Apps / Downloads / Settings)
- [x] Notification banner, notification bar and dashboard
- [x] Lock screen with bitmap clock and padlock drag
- [x] Gesture area: up, back, tap
- [x] Just Type (basic app search)
- [x] Desktop simulator for macOS/Linux, screenshot mode, behaviour tests, CI
- [x] `meta-phoenix` layer and OSE compositor adapter (untested on device)

## Source material still to mine

The spec so far comes from `openwebos/luna-sysmgr`, which is the webOS 3.x
(TouchPad-era) system manager with tablet mode on by default. Several
phone-era (2.x) details are therefore marked *(inferred)* in `Theme.qml`.
These Open webOS repositories are also public and should fill the gaps:

- [ ] `openwebos/luna-systemui`: system UI web components (status bar menus, dashboards, notifications)
- [ ] `openwebos/luna-applauncher`: launcher and Just Type web app
- [ ] `openwebos/core-apps`: the original Enyo core apps (useful for M4)
- [ ] Reference photos/screenshots of real Pre / Pre 2 / Pre 3 / Veer / TouchPad for pixel comparison

## Build infrastructure

- [x] Linux build container, and `scripts/mac-build.sh` for Apple's `container` on macOS
- [ ] Native ARM64 build host (Apple silicon without Rosetta, ARM Linux servers). OSE's
      build currently needs an x86-64 host: `gcc-multilib`/`g++-multilib` for 32-bit
      `pseudo` and Chromium's V8 snapshot tool. Target devices can already be ARM64.
- [ ] Shared sstate/download cache so rebuilds and CI don't start from scratch

## M1: running on webOS OSE

Targets: `qemux86-64` (emulator) and Raspberry Pi 4 with the official
7" touchscreen, both supported by OSE today.

- [ ] Build `webos-phoenix-image` and boot it in QEMU; fix adapter issues
- [ ] Positive space: apps sized to the area between status bar and gesture area
- [ ] Back gesture delivered to apps (C++ compositor extension)
- [ ] Status bar fed by OSE Luna services (battery, Wi-Fi, Bluetooth, time)
- [ ] Notifications from OSE's notification service into banner and dashboard
- [ ] Portrait output and rotation
- [ ] Pixel comparison against reference screenshots of real devices

## M2: legacy UI parity

- [ ] Launch zoom from icon to card, loading card pulse
- [ ] Wave launcher (slow swipe up and hold)
- [ ] Launcher editing: reorder, move between pages, delete
- [ ] Advanced gestures: long swipe to switch apps while maximized
- [ ] App menu (tap the app name in the status bar)
- [ ] PIN and password lock (`images/pin/` art)
- [ ] Exhibition / dock mode (clock, slideshow while charging)
- [ ] Phone and tablet virtual keyboards (`images/keyboard-*` art)
- [ ] Full Just Type: actions, search providers, contacts, messages
- [ ] Remaining items in the feature inventory

## M3: phones and tablets

- [ ] PinePhone / PinePhone Pro (mainline Linux, `meta-pine64`)
- [ ] Android phones through Halium, following LuneOS's `meta-smartphone` approach
- [ ] Telephony and SMS (oFono or ModemManager), cellular indicators
- [ ] Sensors: accelerometer, proximity, ambient light
- [ ] Power management: screen timeout, suspend, wake on notification

## M4: core apps

Rebuilt as web apps on OSE's runtime (Enact/React TypeScript), styled after the
originals: Phone, Messaging, Email, Calendar, Contacts (with Synergy-style
account merging), Web, Camera, Photos, Music, Maps, Memos, Tasks, Clock,
Calculator, Settings panes, and an app catalog.

- [x] App scaffolding: `apps/` npm workspace (React + TypeScript + Vite),
      `@phoenix/ui` (webOS 2.x look from the Enyo 1.0 artwork) and
      `@phoenix/luna` (typed Luna service client); built by CMake and CI
- [x] Settings (`apps/settings`): Wi-Fi, Bluetooth, Airplane Mode, Screen & Lock,
      Sounds & Ringtones, Date & Time, Language & Region, Device Info, Updates (stub),
      one launcher icon per pane; coded against OSE's services, simulated in
      `runtime/phoenix-runtime.js`, and in step with the status bar and system menu
- [x] Phone (`apps/phone`): dial pad, call log (all / missed), favourites from
      `com.palm.person:1`, in-call screen (mute, speaker, keypad, hold, end),
      incoming call with banner, voicemail entry (stub); Messaging (`apps/messaging`):
      conversations, threaded chat, compose with a contact picker, SMS, IM transports
      as stubs. Coded against the legacy `com.palm.telephony` and LuneOS messaging
      APIs and db8 kinds, simulated in the runtime (F4 / F5 ring and text in phoenix-sim)
- [ ] Phone and Messaging on a device: a telephony service for OSE (port LuneOS's
      `webos-telephonyd` on oFono, plus call state), MMS, IM transports, active-call
      banner in the shell
- [x] Camera, Photos and Music (`apps/camera`, `apps/photos`, `apps/music`):
      viewfinder with photo/video capture, albums and a swipe viewer with share,
      delete and set as wallpaper, library and now playing; coded against OSE's
      media indexer, camera and audio services, simulated in the runtime, with
      generated demo photos and songs (`apps/media-samples`)
- [ ] Media on a device: configure the media indexer for `/media/internal`
      (`STORAGE_DEVS`), a Phoenix service to write and delete media files, and
      check capture through OSE's camera pipeline (`camera2` + uMediaServer
      `takeCameraSnapshot`) against the page's getUserMedia
- [ ] Settings on a device: check each OSE call on real hardware; a Phoenix
      service for the device passcode (OSE has no `setDevicePasscode`),
      brightness and screen timeout
- [ ] Lock screen asks for the PIN / password set in Screen & Lock
- [ ] Localization: apps follow `localeInfo`

## M5: modernize

Once parity is reached: high-DPI artwork redraws, dark/light themes, modern
notification actions, Wayland app compatibility (Linux mobile apps),
accessibility, and whatever else the community agrees fits webOS.

## Related projects

- **LuneOS** (webos-ports) has kept a community webOS running on phones since
  2014, with its own card shell (luna-next) and Halium device support. Its
  device and telephony work is the best reference for M3. Its shell is
  licensed differently from Phoenix (check each repository before reusing
  code).
- **webOS OSE** (webosose.org) is the base platform.
