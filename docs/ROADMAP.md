# Roadmap

Goal: the full legacy webOS phone and tablet experience, pixel for pixel and
feature for feature, on webOS OSE. Once that works, modernize it.

The checklist of legacy features is in
[spec/feature-inventory.md](spec/feature-inventory.md), and the measurements
are in [spec/legacy-ui-spec.md](spec/legacy-ui-spec.md).

Seven plans go with this roadmap: [HARDWARE.md](HARDWARE.md) (which devices
to target and how their hardware is driven, for M1 and M3),
[APP-GAPS.md](APP-GAPS.md) (every app a modern phone ships and which ones
Phoenix still needs, for M4), [SYNERGY-MODERN.md](SYNERGY-MODERN.md)
(accounts, sync and messaging against today's providers, for M4),
[APP-STORE.md](APP-STORE.md) (installable web apps as webOS apps, legacy
`.ipk` apps and the catalog, for M4), [ANDROID.md](ANDROID.md) (Android apps
through Waydroid as webOS cards, for M5), [AI-AND-MCP.md](AI-AND-MCP.md) (an
MCP layer over every app and the OS, an on-device assistant, and
bring-your-own-LLM settings, for M5) and [TERMINAL.md](TERMINAL.md) (a
built-in terminal app and Developer Mode).

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
- [x] Just Type: the original luna-applauncher app (apps, contacts, content, web search, quick actions)
- [x] Browser: the original Isis browser, with native page views in the simulator
- [x] Desktop simulator for macOS/Linux, screenshot mode, behaviour tests, CI
- [x] `meta-phoenix` layer and OSE compositor adapter (untested on device)

## Source material still to mine

The spec so far comes from `openwebos/luna-sysmgr`, which is the webOS 3.x
(TouchPad-era) system manager with tablet mode on by default. Several
phone-era (2.x) details are therefore marked *(inferred)* in `Theme.qml`.
These Open webOS repositories are also public and should fill the gaps:

- [ ] `openwebos/luna-systemui`: system UI web components (status bar menus, dashboards, notifications)
- [x] `openwebos/luna-applauncher`: launcher and Just Type web app
- [x] `openwebos/core-apps`: the original Enyo core apps (useful for M4)
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
- [ ] Just Type on the device: show `com.palm.launcher`'s window over the cards
- [ ] Browser on the device: a native page view for enyo.WebView under WebAppMgr
      (OSE has no BrowserAdapter), e.g. a compositor-side view like the simulator's
- [ ] Portrait output and rotation
- [ ] Pixel comparison against reference screenshots of real devices

## M2: legacy UI parity

- [ ] Launch zoom from icon to card, loading card pulse
- [ ] Wave launcher (slow swipe up and hold)
- [x] Launcher editing: reorder, move between pages, delete, add to and remove from the dock
- [ ] Advanced gestures: long swipe to switch apps while maximized
- [x] App menu (tap the app name in the status bar)
- [ ] PIN and password lock (`images/pin/` art)
- [ ] Exhibition / dock mode (clock, slideshow while charging)
- [x] Phone and tablet virtual keyboards (`images/keyboard-*` art; in the simulator, OSE's keyboard on devices: GAPS V1)
- [ ] Just Type: search suggestions, remote (GAL) contacts, its preferences screen
- [ ] Remaining items in the feature inventory

## M3: phones and tablets

Device tiers, the driver plan and the phased timeline are in
[HARDWARE.md](HARDWARE.md).

- [ ] PinePhone / PinePhone Pro (mainline Linux, `meta-pine64`)
- [ ] Android phones through Halium, following LuneOS's `meta-smartphone` approach
- [ ] Telephony and SMS (oFono or ModemManager), cellular indicators
- [ ] Sensors: accelerometer, proximity, ambient light
- [ ] Power management: screen timeout, suspend, wake on notification

## M4: core apps

Rebuilt as web apps on OSE's runtime (Enact/React TypeScript), styled after the
originals: Phone, Messaging, Email, Calendar, Contacts (with Synergy-style
account merging), Web, Camera, Photos, Music, Maps, Memos, Tasks, Clock,
Calculator, Settings panes, and an app catalog. The full list of missing
apps, with priorities and a build order, is in [APP-GAPS.md](APP-GAPS.md);
the catalog's plan (PWAs, App Museum II, a signed static index written by a
PHP + MySQL service) is in [APP-STORE.md](APP-STORE.md).

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
- [x] Synergy, phase 1 (`apps/dav`, [SYNERGY.md](SYNERGY.md)): a CardDAV &
      CalDAV account for the original Accounts, Contacts and Calendar apps:
      sign-in with discovery, two-way sync of contacts and events (sync-collection
      or ctag / etag, If-Match, server wins conflicts), recurring events with
      edited occurrences, persons linked like the contacts linker does; a Node.js
      Luna service for the device, run by the simulator's runtime, tested against
      Radicale
- [ ] Synergy on a device: `com.palm.service.accounts` and the contacts
      linker on OSE (off `mojoservice`), a key store for credentials, the
      activity manager for periodic sync; then run `org.webosphoenix.service.dav`
- [ ] Synergy, next transports ([SYNERGY.md](SYNERGY.md) section 2): provider
      templates for iCloud / Fastmail / Nextcloud, an OAuth 2.0 helper (PKCE,
      loopback), Google People and Calendar, Microsoft Graph, XOAUTH2 in
      mojomail, Tasks over CalDAV VTODO, JMAP, Matrix for IM
- [ ] Modern Synergy ([SYNERGY-MODERN.md](SYNERGY-MODERN.md)): a shared sync
      layer extracted from `apps/dav`, messaging Synergy (one thread per
      person across SMS, Matrix, XMPP and user-run bridges), push through one
      UnifiedPush connection plus an optional PHP/MySQL relay for Graph and
      Google webhooks, and photos, files and social accounts
- [ ] Phone and Messaging on a device: a telephony service for OSE (port LuneOS's
      `webos-telephonyd` on oFono, plus call state), MMS, IM transports, active-call
      banner in the shell
- [x] Camera, Photos and Music (`apps/camera`, `apps/photos`, `apps/music`):
      viewfinder with photo/video capture, albums and a swipe viewer with share,
      delete and set as wallpaper, library and now playing; coded against OSE's
      media indexer, camera and audio services, simulated in the runtime, with
      generated demo photos and songs (`apps/media-samples`)
- [x] Files (`apps/files`): a file manager with Internalz Pro's feature set
      (browse, sort, hidden files, favourites, multi-select, copy / cut / paste,
      delete, rename, new folder / file, info, image viewer, text editor, "Open
      with", .ipk install), on the Phoenix service `org.webosphoenix.filemanager`
      (simulated in the runtime; a Node.js service for the device in
      `apps/files/service`)
- [x] Tasks (`apps/tasks`): lists, due dates and times, priorities, notes,
      Today / Upcoming / Overdue, hide completed; reminders scheduled with
      `com.palm.activitymanager` (simulated in the runtime, which now fires
      scheduled activities and `com.palm.power` timeouts) reach the shell as
      notifications; Just Type "New Task" and task search
- [ ] Tasks: CalDAV (VTODO) sync per account, Synergy-style, into account
      sub-kinds of `com.palm.task:1`; on a device, check that OSE's activity
      manager starts the app in the background for a reminder without
      raising its card

- [x] Voice Memos (`apps/voicememos`): record with a level meter, pause and
      resume, the memo list with playback and a scrubber, rename, share, delete,
      and transcription on the Phoenix service `org.webosphoenix.transcriber`
      (whisper.cpp on the device, `apps/voicememos/service`; the simulator knows
      only the demo memos' scripts), searchable in the app and in Just Type
- [x] Passwords (`apps/passwords`): KeePass KDBX 4 databases (kdbxweb, Argon2id
      in WebAssembly) that KeePassXC and KeePassDX open, groups, entries, search,
      generator, TOTP fields, copy with auto-clear, auto-lock (screen lock,
      card minimized, idle); Authenticator (`apps/authenticator`): TOTP/HOTP
      tested against the RFCs, `otpauth://` links and `{otpauth}` launches,
      Aegis/andOTP import, encrypted backups, secrets encrypted with a key from
      the device passcode. Threat model: [SECURITY-APPS.md](SECURITY-APPS.md)
- [ ] Passwords and Authenticator on a device: the Phoenix key store service
      (`org.webosphoenix.service.keystore`) to hold Authenticator's key behind
      the device passcode with a device-bound key and a retry limit; WebAppMgr
      telling pages when their card is minimized; WebDAV sync of the `.kdbx`
      file; key files; autofill with the keyboard
- [ ] Voice Memos on a device: build whisper.cpp and its model
      (`meta-phoenix/recipes-support/whisper-cpp` is a stub), measure base.en
      against tiny.en on the target, run the service under `run-js-service`, and
      the same media file service the Camera needs
- [ ] Files on a device: run the service under OSE's `run-js-service` and check
      its ACG files; route .ipk installs to OSE's `com.webos.appInstallService`
      (legacy `com.palm.appinstaller` is simulator only)
- [ ] Media on a device: configure the media indexer for `/media/internal`
      (`STORAGE_DEVS`), a Phoenix service to write and delete media files, and
      check capture through OSE's camera pipeline (`camera2` + uMediaServer
      `takeCameraSnapshot`) against the page's getUserMedia
- [ ] Settings on a device: check each OSE call on real hardware; a Phoenix
      service for the device passcode (OSE has no `setDevicePasscode`),
      brightness and screen timeout
- [ ] Lock screen asks for the PIN / password set in Screen & Lock
- [ ] Notification actions (e.g. Snooze / Done on a reminder) in the shell's
      notification model; tapping a notification already opens what it is about
- [ ] Localization: apps follow `localeInfo`

## M5: modernize

Once parity is reached: high-DPI artwork redraws, dark/light themes, modern
notification actions, Wayland app compatibility (Linux mobile apps),
Android apps through Waydroid (plan in [ANDROID.md](ANDROID.md); its spike
can start on the emulator image after M1), accessibility, and whatever else
the community agrees fits webOS.

- [ ] MCP hub `org.webosphoenix.mcp`: OS tools, per-app tools from
      `appinfo.json`, grants, confirmations and an audit log; stdio over
      SSH, then Streamable HTTP with QR pairing ([AI-AND-MCP.md](AI-AND-MCP.md) P1-P4)
- [ ] Assistant app and service on the hub; Settings > Assistant with
      Anthropic, OpenAI, Google and OpenAI-compatible providers, a key
      store, and llama.cpp on the device ([AI-AND-MCP.md](AI-AND-MCP.md) A1-A5)
- [ ] Terminal (`apps/terminal`, xterm.js on the PTY service
      `org.webosphoenix.pty`), Developer Mode with `sudo` and an SSH
      server ([TERMINAL.md](TERMINAL.md) T1-T5)

## Related projects

- **LuneOS** (webos-ports) has kept a community webOS running on phones since
  2014, with its own card shell (luna-next) and Halium device support. Its
  device and telephony work is the best reference for M3. Its shell is
  licensed differently from Phoenix (check each repository before reusing
  code). Full comparison and what to reuse: [LUNEOS.md](LUNEOS.md).
- **webOS OSE** (webosose.org) is the base platform.
