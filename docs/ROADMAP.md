# Roadmap

Goal: the full legacy webOS phone and tablet experience, pixel for pixel and
feature for feature, on webOS OSE. Once that works, modernize it.

Last brought up to date on 10 October 2026. Where the work stands today
and what comes next is in [STATUS.md](STATUS.md); this page is the whole
plan, milestone by milestone. Every gap still open, by area and priority:
[spec/GAPS.md](spec/GAPS.md#open-gaps-at-a-glance).

**Where we are** (10 October 2026; ✅ done, ⬜ left, counted from the checklists below; a 🟡 on an open item means it is done in the simulator and waits on a device or a decision):

| Milestone | ✅ Done | ⬜ Left |
| --- | --- | --- |
| M0: shell in a simulator (done) | 13 | 0 |
| Source material still to mine | 3 | 1 |
| Build infrastructure | 1 | 2 |
| Development devices | 0 | 3 |
| M1: running on webOS OSE | 0 | 10 |
| M2: legacy UI parity | 18 | 2 |
| M3: phones and tablets | 0 | 8 |
| M4: core apps and services | 12 | 10 |
| M5: modernize, within 1.x | 2 | 3 |
| M6: the last 1.0 features | 13 | 1 |
| 1.0 release | 7 | 11 |
| 2.0: modern webOS | 0 | 18 |

## Two lines: 1.x and 2.0

Owner's direction (29 September 2026):

- **1.x is for the fans, and is never deprecated.** Get it running and
  working as fully as possible, and keep it very close to the original
  webOS in look, feel and behaviour. It gains only what a classic webOS
  device needs to be usable today, in the classic style: modern accounts in
  Synergy, web apps and the catalog, security fixes, drivers for current
  hardware, sharper redraws of the original art, and accessibility. A new
  feature belongs in 1.x only if it looks and behaves as if Palm had shipped
  it.
- **2.0 is the modern revamp that brings webOS back.** New visual style,
  new features, docking to monitors and TVs
  ([CONVERGENCE.md](CONVERGENCE.md)), the big streaming services, a
  Chromium-based browser. It keeps the webOS ideas (cards, Just Type,
  Synergy, the dashboard) and is free to redesign everything else.
- **2.0 builds on 1.x and never reverts it.** It only expands on what 1.x
  built, so that it stays true to webOS. Removing or replacing a 1.x
  feature or behaviour in 2.0 needs the owner's agreement first.

The two share the platform (OSE, the services, the apps' data), so work
below the UI serves both. M0 to M5 and the 1.0 release are 1.x; 2.0 and the
later product lines are at the end. Naming ideas for all of them (PreOS,
Phoenix UI, PixiOS with Bennu UI, an XR bird) are in [BRANDING.md](BRANDING.md).

## The plans

| Plan | What it covers | Milestones |
| --- | --- | --- |
| [spec/feature-inventory.md](spec/feature-inventory.md), [spec/legacy-ui-spec.md](spec/legacy-ui-spec.md) | Every legacy feature, and the original's measurements | M0, M2 |
| [spec/GAPS.md](spec/GAPS.md) | The shell checked against luna-sysmgr, row by row, plus the keyboard, editing and hardware keyboard rows for 1.0 | M2, 1.0 |
| [HARDWARE.md](HARDWARE.md) | Device tiers (mainline, Halium, x86, keyboard phones, Linux phones, small tablets for local AI), drivers, installing like a Linux distro, OTA, Phoenix Ready | M1, M3, 1.0 |
| [APP-GAPS.md](APP-GAPS.md), [APP-RUNTIME.md](APP-RUNTIME.md) | Every app a modern phone ships, which ones Phoenix has, and how the apps run | M4 |
| [SYNERGY.md](SYNERGY.md), [SYNERGY-MODERN.md](SYNERGY-MODERN.md) | Accounts and sync: DAV, Google, Microsoft, mail, messaging networks, RCS, the Fediverse, cloud drives | M4 |
| [APP-STORE.md](APP-STORE.md) | Web apps as webOS apps, the Phoenix Catalog, App Museum II and Preware, streaming apps and DRM | 1.0, 2.0 |
| [ANDROID.md](ANDROID.md) | Android apps through Waydroid, as webOS cards | 1.0 |
| [AI-AND-MCP.md](AI-AND-MCP.md) | The voice assistant (1.0), the MCP layer and the AI agent (2.0) | 1.0, 2.0 |
| [TERMINAL.md](TERMINAL.md) | The Terminal app and Developer Mode | M5 |
| [SCREENSHOTS.md](SCREENSHOTS.md) | Screenshots as the original took them (1.x), and preview, markup, recording, text and AI look-up (2.0) | 1.0, 2.0 |
| [GESTURE-BAR.md](GESTURE-BAR.md) | The original's light bar animations (1.x), buttons at the ends of the gesture area, and the animated 2.0 bar | 1.0, 2.0 |
| [COMMUNITY-FEATURES.md](COMMUNITY-FEATURES.md) | What the community added after HP (webOS CE 3.1.0, LunaCE, Preware patches, webOS Archive), ranked, with 1.x and 2.0 targets | 1.0, 2.0 |
| [SECURITY-APPS.md](SECURITY-APPS.md) | Passwords and Authenticator threat model | M4 |
| [CONVERGENCE.md](CONVERGENCE.md) | 2.0: desktop mode, TV mode, wireless display | 2.0 |
| [LUNEOS.md](LUNEOS.md), [WEBOS-FAMILY.md](WEBOS-FAMILY.md) | LuneOS, webOS Community Edition, OSE and Phoenix compared; which LuneOS layers to build on | M1, M3 |
| [LEGAL.md](LEGAL.md), [BRANDING.md](BRANDING.md) | Licences, artwork and sounds, names and trademarks | all |
| [PLATFORM.md](PLATFORM.md), [PLATFORM-BUILD-PROMPT.md](PLATFORM-BUILD-PROMPT.md) | The servers: website, account, developer portal, the signed feeds (catalog, updates, drivers), downloads, cloud services; the prompt for building them in Laravel | 1.0 |
| [DEV-EXTENSION-PROMPT.md](DEV-EXTENSION-PROMPT.md) | The brief for a later VS Code and Cursor extension for developers (its own repository) | later |

## Decisions so far

Taken by the owner on 28 and 29 September 2026; each plan records the
detail. Open questions are listed in [STATUS.md](STATUS.md#decisions-for-the-owner).

| Area | Decision | Where |
| --- | --- | --- |
| Direction | 1.x classic and never deprecated; 2.0 modern and additive only | above |
| LuneOS | Stay independent; build device images on LuneOS's Yocto layers without a partnership; outreach on hold | [LUNEOS.md](LUNEOS.md#the-owners-position-28-september-2026) |
| Devices | Install like a Linux distro, on as much hardware as possible, so makers build for it again; keyboard phones (Zinwa Q25 first) and Linux phones (FuriLabs, Volla, PinePhone Pro, Fairphone) as targets | [HARDWARE.md](HARDWARE.md) |
| Gesture bar | On every device unless the maker ships a hardware home button (`device.json`) | [HARDWARE.md](HARDWARE.md#device-configuration) |
| Screens | Landscape on phones and tablets; the shell resizes to any window or screen | [spec/GAPS.md](spec/GAPS.md) R1 |
| App sources | Curated PWA catalog shown as apps, an Android catalog, App Museum II and Preware as add-on catalogs; all towards the end of 1.0 | [APP-STORE.md](APP-STORE.md) |
| Browser | Fix Share > Add to Launcher; "Install Web App" with a coloured dot when a page has a manifest (1.x); a Chromium-based browser for 2.0 | M4, 2.0 below |
| Synergy | Add cloud drives, the Fediverse and Bluesky; RCS is required; WhatsApp through the EU DMA to be explored | [SYNERGY-MODERN.md](SYNERGY-MODERN.md) |
| Assistant | On by default, with settings to turn it off. 1.0 (revised 7 October 2026): commands first, an optional on-device model, then a cloud model (Anthropic, OpenAI, Google, any OpenAI-compatible URL) or a web search; cloud models act only with permission; an Assistant app with threads. The MCP agent is 2.0 | [M6-PLAN.md](M6-PLAN.md), [AI-AND-MCP.md](AI-AND-MCP.md) |
| Clipboard | A history like Paste on macOS in the webOS style: a keyboard strip, a Clipboard app, sensitive clips masked and encrypted | [M6-PLAN.md](M6-PLAN.md) |
| Community features | Phoenix's own customizations come first; the owner is asked about clashes | [M6-PLAN.md](M6-PLAN.md) |
| Keyboard | Dictation, prediction, swipe, emoji and cursor control in 1.0, shared by the webOS Classic keyboard (original look) and a new Phoenix keyboard; keyboards chosen in Settings as on iOS | [spec/GAPS.md](spec/GAPS.md) V2-V8 |
| Terminal | A real Linux shell: bash by default, zsh available | [TERMINAL.md](TERMINAL.md) |
| Sounds | Ship the original sounds where their provenance is clean; CC0 mimics for the rest | [LEGAL.md](LEGAL.md) |
| Streaming | Netflix, Disney+ and the like are a requirement for 2.0; LG's webOS Hub is not a route | [APP-STORE.md](APP-STORE.md#311-streaming-apps-and-drm) |
| Naming | Ideas only, nothing chosen until trademark searches are done | [BRANDING.md](BRANDING.md) |

## M0: shell in a simulator (done)

- [x] Legacy measurements, timings and artwork extracted from Open webOS `luna-sysmgr`
- [x] Card view: swipe, flick to close (any card, several fingers at once), tap to maximize, shuffle after close
- [x] Card stacks: fanned open stack, collapsed neighbours, child windows join their app's stack
- [x] Card reorder: press and hold, shuffle within a stack, move out of / into stacks via the edge zones
- [x] Status bar with original indicator art, system menu (luna-sysmgr's `SystemMenu` ported)
- [x] Quick launch bar and tabbed launcher (Apps / Downloads / Settings)
- [x] Notification banner, notification bar and dashboard; system alerts from the original luna-systemui
- [x] Lock screen with bitmap clock and padlock drag, PIN / password panel
- [x] Gesture area: up, back, tap
- [x] Just Type: the original luna-applauncher app (apps, contacts, content, web search, quick actions)
- [x] Browser: the original Isis browser, with native page views in the simulator
- [x] Desktop simulator for macOS/Linux, screenshot mode, behaviour tests, CI
- [x] `meta-phoenix` layer and OSE compositor adapter (untested on device)

## Source material still to mine

The spec comes from `openwebos/luna-sysmgr`, the webOS 3.x (TouchPad-era)
system manager with tablet mode on by default. Several phone-era (2.x)
details are therefore marked *(inferred)* in `Theme.qml`.

- [x] `openwebos/luna-systemui`: system alerts, battery and charging banners, dashboards
- [x] `openwebos/luna-applauncher`: launcher and Just Type web app
- [x] `openwebos/core-apps`: the original Enyo core apps
- [ ] Reference photos/screenshots of real Pre / Pre 2 / Pre 3 / Veer / TouchPad for pixel comparison

## Build infrastructure

- [x] Linux build container, and `scripts/mac-build.sh` for Apple's `container` on macOS
- [ ] Native ARM64 build host (Apple silicon without Rosetta, ARM Linux servers). OSE's
      build currently needs an x86-64 host: `gcc-multilib`/`g++-multilib` for 32-bit
      `pseudo` and Chromium's V8 snapshot tool. Target devices can already be ARM64.
- [ ] Shared sstate/download cache so rebuilds and CI don't start from scratch

## Development devices

Ways to try Phoenix on a touch screen before a phone runs it (owner,
29 September 2026). Sidecar from a Mac works today but turns touches into a
mouse pointer, shows the Mac's menu bar and only reaches as far as the Mac.

- [ ] **iPad, in the browser**: the QML shell built with Qt for WebAssembly,
      app cards as iframes over the shell's canvas (CSS transforms follow
      the card layout), the few native pieces (KeyInjector, DeviceConfig,
      the PTY service) replaced with web versions, served as static files
      and added to the Home Screen so it runs full screen with real
      multi-touch, no Mac needed. Doubles as the public browser demo
      ([HARDWARE.md](HARDWARE.md#community-and-adoption)). Safari is the
      engine, so Chromium-only behaviour needs checking
- [ ] **iPad, as a native app**: Qt 6 for iOS, signed with the owner's
      developer account and shared through TestFlight. Qt WebEngine does not
      exist on iOS, so cards use WKWebView (Qt WebView): the live page while
      maximized, a snapshot while the card is scaled, stacked or thrown
- [ ] 🟡 **ARM64 virtual machine image**: `phoenix-vm-arm64` (OE's
      `qemuarm64`, QEMU's kernel boot rather than UEFI, virtio GPU, multitouch,
      network, sound and disk) with the phones' package set and every first
      target's configuration, chosen at boot (`phoenix.device=`);
      `scripts/vm.sh <device>` starts it with QEMU (HVF on Apple silicon, KVM
      or TCG on Linux) at the device's CPU count, memory and resolution, and
      prints UTM's settings ([HARDWARE.md](HARDWARE.md#device-vms),
      [BUILDING-MAC.md](BUILDING-MAC.md#run-it-in-a-vm)). Parses and resolves
      (`scripts/parse-check.sh`, 11 October 2026; in CI's matrix); not built or
      booted yet: the owner's first boot, on the Mac. The real OS rather than the simulator, at near-native speed.
      On an iPad, UTM can only emulate (no hypervisor access), which is far too
      slow for OSE and Chromium, and touch reaches the guest as a pointer
- [x] **Device profiles in the simulator**: `phoenix-sim --device <id>`
      (View > Device) is each first target as its image configures it: exact
      pixels, density, layout, buttons, rounded corners and camera cutout
      (the status bar makes room for the cutout; HARDWARE.md, "Device
      profiles")

## M1: running on webOS OSE

Targets: `qemux86-64` (emulator) and Raspberry Pi 4 with the official
7" touchscreen, both supported by OSE today. Device images for phones
build on LuneOS's layers ([LUNEOS.md](LUNEOS.md#9-recommendation)).

- [ ] Build `webos-phoenix-image` and boot it in QEMU; fix adapter issues
- [ ] Positive space: apps sized to the area between status bar and gesture area
- [ ] Back gesture delivered to apps (`KeyInjector` written; run on hardware)
- [ ] Status bar fed by OSE Luna services (battery, Wi-Fi, Bluetooth, time)
- [ ] Notifications from OSE's notification service into banner and dashboard
- [ ] Just Type on the device: show `com.palm.launcher`'s window over the cards
- [ ] Browser on the device: a native page view for enyo.WebView under WebAppMgr
      (OSE has no BrowserAdapter), e.g. a compositor-side view like the simulator's
- [ ] Rotation on the device: the orientation sensor and apps' orientation requests
- [ ] `device.json` read on the device (hardware home button, form factor, density; installed per
      machine by `phoenix-device-config`)
- [ ] Pixel comparison against reference screenshots of real devices

## M2: legacy UI parity

Row by row in [spec/GAPS.md](spec/GAPS.md); P0 and P1 rows are done in the
simulator, the P2 rows are listed there.

- [x] Launch: new cards rise from below, the loading card after 750 ms, and a
      card opened from an app zooms the current one out and joins its stack
- [x] Launcher editing: reorder, move between pages, delete, add to and remove from the dock
- [x] App menu (tap the app name in the status bar)
- [x] PIN and password panel on the lock screen (the lock policy itself is M4)
- [x] Rotation with the original's rules, full-screen apps
- [x] Phone and tablet virtual keyboards (in the simulator; on devices see 1.0 below)
- [x] Gesture bar on every device, turned off only by a hardware home button
- [x] The shell resizes to any window or screen, from Pre size to large tablets
- [x] Trackpad and mouse-wheel gestures in card view (swipe through cards, throw them away)
- [x] The same two-finger swipe elsewhere: launcher pages and keyboard clips snap
      to one as cards do, notifications are swiped away, the launcher's icons
      and the notification lists scroll (`TrackpadSwipe.qml`; `tst_trackpad.qml`,
      `tst_tablettrackpad.qml`)
- [x] Sharp art at every pixel density ([spec/hidpi-art.md](spec/hidpi-art.md))
- [x] Phone in landscape: the launcher has as many columns as fit (4 on a
      Pre's side, 5 on a Pre 3's), the lock screen's banner and dashboard keep
      between the date and the padlock, the PIN pad lays itself out side by
      side with the clock stepping back behind it, and the system menu
      scrolls within the screen (`tst_rotation.qml`, `tst_landscape.qml`)
- [x] Check Just Type in tablet portrait: no overlap at start-up or after
      turning either way (the card thumbnails show dimmed through its
      translucent backdrop, as in landscape)
- [x] Advanced gestures: long swipe to switch apps while maximized (G5)
- [x] Exhibition / dock mode (clock, slideshow while charging) (R5; in the simulator)
- [x] Card stacks keep their order while a card maximizes and minimizes, and
      Back in an app another opened returns to the caller, the app staying
      open behind it (C12); Back that an app does not take minimizes its
      card (G2); the fan's own 200 ms clock, re-maximizing the launching
      card when a child closes, a maximized card's fly-off (C12, C4; 10
      October 2026). To do: the device side
- [ ] Just Type: search suggestions and remote (GAL) contacts in the results
      (its preferences screen is done: Settings > Just Type)
- [x] The launcher's cards hidden once it is up and its top scroll fade
      (L1, L2), the tablet status bar's arrow (S8), modal cards (C11),
      dashboards swiped, kept or dragged by their window (N5), the new card's
      prepare step and loading screen (C1, C2), the dock-mode system menu and
      the ringer key (M2), the kept rotation lock and the Home button's
      angle (R1), the angry card's and the launcher's sounds, Email's and the
      Clock's tones (C3, A1) (in the simulator, 10 October 2026)
- [ ] The rows still open in GAPS.md ("Open gaps at a glance"): in the
      simulator only small ones (a modal card and the keyboard, a dashboard's
      drag mode set late, firm press to select); the rest is the device side
- [x] Wave launcher: not in the open sources (GAPS Q3); drawn after
      descriptions as an option (M6 F4)

## M3: phones and tablets

Device tiers, the driver plan and the phased timeline are in
[HARDWARE.md](HARDWARE.md).

- [ ] 🟡 First targets (owner, 11 October 2026; [HARDWARE.md](HARDWARE.md#first-targets)):
      Fairphone 6/6+ (phone), AYN Odin 2 Portal (tablet), PinePhone Pro and
      PineTab2 (the original PinePhone dropped, 11 October 2026), on mainline
      kernels: machines, pinned kernels, boot images and device configuration in
      meta-phoenix, parsed in CI; not built, waiting on hardware and a newer Mesa ([OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) Q79-Q86)
- [ ] Later devices on LuneOS's layers: Pixel 3a (Halium and mainline), OnePlus 6, FuriLabs FLX1s
- [ ] A keyboard phone: Zinwa Q25 (unlocked, LuneOS config `q25`)
- [ ] Telephony and SMS (oFono, LuneOS's `webos-telephonyd`), cellular indicators
- [ ] Sensors: accelerometer, proximity, ambient light
- [ ] Power management: screen timeout, suspend, wake on notification
- [ ] 🟡 Porting guide, device table and hardware report (the opt-in report of
      unsupported hardware is done in the simulator, with the Hardware app)
- [ ] 🟡 Hardware support like a distro: open source drivers and redistributable
      firmware in the image, the gaps (newer firmware, out-of-tree drivers,
      optional extras) from Settings > Hardware and a signed driver catalog
      ([HARDWARE.md](HARDWARE.md#hardware-support-and-the-hardware-app)).
      Done in the simulator; on a device with M1

## M4: core apps and services

Rebuilt as web apps on OSE's runtime (React TypeScript), styled after the
originals. The full list, with priorities, is in [APP-GAPS.md](APP-GAPS.md).

Done in the simulator:

- [x] App scaffolding: `apps/` npm workspace (React + TypeScript + Vite),
      `@phoenix/ui` (the Enyo 1.0 look) and `@phoenix/luna` (typed Luna client)
- [x] Settings, Phone, Messaging, Camera, Photos, Music, Videos, Podcasts
- [x] Files (Internalz Pro's feature set), Tasks, Voice Memos with transcription
- [x] Weather, Maps (vector maps, search, directions, turn by turn), Location Services
- [x] Passwords (KeePass) and Authenticator ([SECURITY-APPS.md](SECURITY-APPS.md))
- [x] Flashlight, QR Scanner, PDF View, Doc View, Help, Emergency Info, First Use
- [x] Terminal (see M5)
- [x] Synergy phase 1: the CardDAV and CalDAV account for the original
      Accounts, Contacts and Calendar apps ([SYNERGY.md](SYNERGY.md))

Still to do:

- [x] Browser: Share > Add to Launcher that saves a launcher icon you can
      change, as webOS did: a picture of the page as its icon, the title
      editable in the dialog, on the launcher's Favorites page
      ([APP-RUNTIME.md](APP-RUNTIME.md#the-browser-and-enyowebview))
- [ ] Browser: "Install Web App" under Preferences, with a coloured dot by the
      app menu when the page has a web app manifest ([APP-STORE.md](APP-STORE.md) section 1)
- [x] Synergy C0 (10 October 2026): "Find More..." opens the Marketplace's
      Connections (accounts by what they bring, a page per type with where
      the data goes, Set up), account types found in installed apps, the
      catalog's account feed ([SYNERGY-CONNECTORS.md](SYNERGY-CONNECTORS.md))
- [ ] Synergy C1 and C2, in progress: the connector kit, the developer
      guide and conformance suite; the Fediverse account (the flagship).
      Then C3 (the OAuth service; Microsoft, Google, Dropbox, Box, LinkedIn,
      Zoom, Telegram, Bluesky; iCloud, Fastmail and Nextcloud presets),
      before it the accounts needing no registration (meeting Join
      buttons, Jitsi video calls, WebDAV, SFTP and S3 drives in Files),
      C4-C6 (connectors in the catalog, a trust tier, push)
      ([SYNERGY-CONNECTORS.md](SYNERGY-CONNECTORS.md) 6-7)
- [ ] Modern Synergy, in the order of [SYNERGY-MODERN.md](SYNERGY-MODERN.md#5-roadmap):
      provider presets, the shared sync layer, OAuth with Microsoft and
      Google, mail, messaging Synergy (SMS, Matrix, XMPP, bridges), RCS,
      cloud drives, the Fediverse and Bluesky, push
- [ ] Synergy on a device: the accounts service and contacts linker on OSE,
      the key store, the activity manager for periodic sync
- [ ] 🟡 Phone and Messaging on a device: telephony service, MMS, IM transports
      (the active-call banner is done in the simulator, GAPS N7)
- [ ] Device side of the new apps (torch, PTY service, key store, location
      permissions, WAV sounds, TTS, media indexer, camera capture): the list
      is in [STATUS.md](STATUS.md#next-work)
- [x] Lock screen asks for the PIN / password set in Screen & Lock (in the simulator; the device's lock service is GAPS K1)
- [ ] Notification actions (e.g. Snooze / Done on a reminder)
- [x] Ongoing activities: downloads and installs (system updates,
      Marketplace installs) as items with their progress in the
      notification area, until they end (`org.webosphoenix.ongoing`;
      [APP-RUNTIME.md](APP-RUNTIME.md#ongoing-activities))
- [ ] Live Activities (owner, 1 October 2026): ongoing activities get their
      own place on the left of the notification area, the notification
      icons stay on the right, and tapping an activity's icon opens its
      pane. Builds on the ongoing activities above; only the shell's
      drawing of them changes. Which line (1.x or 2.0) is still to decide
- [ ] Second wave of apps: screen reader, magnification, health,
      cell broadcast, eSIM, printing, screen recording, fingerprint, notes
      sync, a now-playing dashboard ([APP-GAPS.md](APP-GAPS.md))
- [ ] Localization: apps follow `localeInfo`

## M5: modernize, within 1.x

Within the 1.x rule (classic look, as if Palm had shipped it): high-DPI
redraws of the original artwork, notification actions in the dashboard's
style, Wayland app compatibility (Linux mobile apps), accessibility, and
whatever else the community agrees fits webOS. New visual styles such as
dark and light themes go to 2.0.

- [x] Terminal (`apps/terminal`, xterm.js on the PTY service
      `org.webosphoenix.pty`; bash by default, zsh available)
      ([TERMINAL.md](TERMINAL.md) T1-T2; T3 written, not yet built for a device)
- [ ] 🟡 Developer Mode with `sudo` and an SSH server ([TERMINAL.md](TERMINAL.md) T4-T5).
      Done in the simulator: Settings > Developer Mode behind the device PIN
      or password, and the Marketplace installs packages with install
      scripts and services only in it ([APP-RUNTIME.md](APP-RUNTIME.md#developer-mode));
      hidden until Just Type's Konami code reveals it, as on webOS, and the
      developer apps (Notification Lab, the framework demos, Terminal) show
      only while it is on
- [ ] 🟡 Screenshots as the original took them, with a notification that
      opens a preview to crop, mark up, share or delete
      ([SCREENSHOTS.md](SCREENSHOTS.md) SC1-SC2). Done in the simulator;
      to do: the compositor's capture on a device, secure cards
- [ ] 🟡 The light bar's animations, and buttons at the ends of the gesture
      area ([GESTURE-BAR.md](GESTURE-BAR.md) GB1-GB3). The animations are
      done in the simulator (GAPS G8); to do: the light bar's Settings switch,
      the end buttons and `setButton` (open questions in GESTURE-BAR.md)
- [ ] A Home app on Home Assistant (the owner, 10 October 2026: "to swing
      back to"): rather than writing Phoenix's own smart-home app, use Home
      Assistant's open source web frontend (Apache-2.0, served by the user's
      own Home Assistant server) as the Home app's page: a card that opens
      the user's dashboards, with Phoenix's parts around it: the server found
      on the network (mDNS) and signed in once (OAuth with the server, as
      Home Assistant's companion apps do), its notifications through the
      Home Assistant connector (SYNERGY-CONNECTORS.md, potentials), quick
      toggles in the system menu and the dashboard, "turn off the lights"
      through Just Type and the Assistant, and the device's battery,
      location and sensors reported to it as the companion apps do. It needs
      no Linux/Wayland app layer: the frontend is a web page, which the app
      runtime already shows (the Wayland layer would be needed only for a
      native Linux app). Home Assistant has no official Linux app to port;
      its companion apps are Android and iOS only
- [x] Community features for 1.x, as picked by the owner on 7 October 2026
      ([M6-PLAN.md](M6-PLAN.md) F4; in the simulator, see M6)

## M6: the last 1.0 features

Agreed with the owner on 7 October 2026; [M6-PLAN.md](M6-PLAN.md) has the detail.

- [ ] F0: fixes (settings lost on save and the card corners: done; the Messaging reply bar waits on the owner, OPEN-QUESTIONS Q7)
- [x] F1: press and hold on launcher icons (peek and menu; in the simulator)
- [x] F2: clipboard manager (keyboard strip, Clipboard app, Settings > Clipboard; in the simulator)
- [x] F3: the Assistant 1.0 (commands, optional on-device model, cloud models with permission, Assistant app; in the simulator)
- [x] F4: community features picked for 1.0 (in the simulator; the hardware-dependent ones finish on devices in the image work)
  - [x] Launcher: app groups (folders), tabs renamed, added and removed, grid density (in the simulator)
  - [x] Cards: infinite cycling, tap a side card to maximize it, the wave launcher (in the simulator)
  - [x] System: the power menu (hold Power), a Flashlight row in the system menu, battery percentage (in the simulator)
  - [x] Notifications: repeat until seen, private lock screen previews, the cycling email dashboard, per-contact tones (in the simulator)
  - [x] Settings > Advanced (animation speed, tap ripple, gesture sensitivity, haptics and the options above) (in the simulator)
  - [x] Keyboard: a number row, off by default (in the simulator)
  - [x] Browser: private browsing, find on page, a content blocker, mobile or desktop sites, more search engines and a custom one, a system proxy (in the simulator)
  - [x] Sharing and sync: DropShare, subscribed .ics calendars, game controllers, a USB (OTG) page, tethering on phones (in the simulator)
  - [x] Health: temperature warnings, a battery usage pane (in the simulator)

## 1.0 release

1.0 ships when a fan can install Phoenix on hardware they own and use it
every day. The app sources come towards the end of 1.0 (owner, 29 September
2026).

- [ ] 🟡 Web apps and the Phoenix Catalog: curated PWAs shown as apps ([APP-STORE.md](APP-STORE.md) A0-A4).
      Done in the simulator: the Marketplace (A0) and the catalog service on
      this computer (A3); to do: the server online, A1 on a device, A4
- [ ] 🟡 Classic apps from App Museum II ([APP-STORE.md](APP-STORE.md) A2), with webOS Archive.
      Done in the simulator (an add-on catalog, off by default); the owner is
      asking the webOS Archive
- [ ] Enyo 2 apps: test LuneOS's `org.webosports.app.*` apps and the App
      Museum's Enyo 2 titles in the simulator, then on a device. Enyo 2.5.2,
      Onyx, Layout and `webOS.js` are mounted at `/usr/palm/frameworks/enyo2/`,
      and the temporary `apps/enyo2demo` samples them
      ([APP-RUNTIME.md](APP-RUNTIME.md#enyo-2-apps)). Remove the demo when
      real apps are tested
- [ ] 🟡 Preware feeds, installed through the catalog (done in the simulator:
      the PreCentral homebrew feed as an add-on catalog)
- [ ] Native webOS apps (PDK games and hybrid apps such as Quickoffice)
      through a compatibility layer: a 32-bit ARM user space, qemu where
      the CPU cannot run it, a rewritten `libpdl` and the plugin bridge
      ([PDK.md](PDK.md)). Quickoffice first; today it installs and lists
      documents, and opening one needs its plugin
- [ ] Android apps through Waydroid ([ANDROID.md](ANDROID.md))
- [ ] Install like a Linux distro: generic images, live boot, the installer,
      the hardware report and device table, the light profile
      ([HARDWARE.md](HARDWARE.md#install-it-like-a-linux-distro))
- [ ] As many devices as possible at Supported or Community level
      ([HARDWARE.md](HARDWARE.md#device-tiers))
- [ ] 🟡 Keyboard: dictation (V2, done in the simulator), predictive text and
      swipe typing (V3, done in the simulator; Settings > Text Assist),
      emoji (V6, done in the simulator), cursor control by holding the space bar or the gesture
      bar (V4, done in the simulator), the keyboards as the device's input method (V5), and
      keyboards chosen in Settings as on iOS: webOS Classic, webOS OSE's and
      a new Phoenix keyboard (V7; done in the simulator, 10 October 2026:
      several side by side, the globe key, the Phoenix keyboard; OSE's needs
      the device). Also the text around the cursor, emoji for words, spoken
      punctuation, the text while speaking, auto-capitalisation (V1-V3, V6)
- [ ] 🟡 Hardware keyboards, especially on tablets: the TouchPad keyboard's
      keys, shortcuts, full keyboard navigation of the shell, keyboard
      accessibility (sticky, slow and bounce keys, Full Keyboard Access) and
      Settings > Hardware Keyboard (V8). Done in the simulator: the keys,
      both shortcut schemes, sticky, slow and bounce keys, the hardware
      keyboard keeping the virtual one down, focus navigation of the shell,
      the web apps' menus, popup alerts and the PIN pad, Settings > Text
      Assist > Hardware Keyboard (layout, repeat, modifier remapping, the
      shortcuts), the keyboard key, and the show-keyboard button, which keeps
      clear of notifications, moves to either edge and can be hidden; to do:
      on a device
- [x] Editing: the Edit submenu (Select All, Cut, Copy, Paste) in every
      app menu, and the same on a long press in a text field (E1)
- [x] One share sheet and one file picker for every app: the original's
      file picker back for legacy apps, a save picker (Save to Files in a
      chosen folder), and a share sheet apps join through `appinfo.json`
      ([SHARE-AND-FILES.md](SHARE-AND-FILES.md), GAPS E5). Done in the
      simulator: the share sheet, the save picker, the picture picker, Share
      in Screenshot, Files, Photos and the browser, and Share after Edit in
      every app menu; the original file picker for legacy apps (SF1), the
      picker's kinds, several files and a crop size (SF2), Share in Docs,
      Voice Memos and Maps, Music taking audio from the sheet (10 October
      2026). The 2.0 sheet (SF6) is 2.0
- [x] The Assistant, like Siri: on-device speech recognition and
      commands, an optional on-device model, cloud models with permission,
      an Assistant app with threads, spoken answers, "Hey Phoenix" (in the simulator)
      ([M6-PLAN.md](M6-PLAN.md) F3, [AI-AND-MCP.md](AI-AND-MCP.md#10-and-20))
- [x] The start-up animation: the phoenix burns to ash and is born again as
      the Assistant bird, or the classic glowing logo (Settings > Advanced;
      in the simulator, 10 October 2026; on a device with M1)
- [x] Open in New Card in Messaging and Email (Email's own, hidden in the
      release), as the Assistant app has it (in the simulator, 10 October 2026)
- [x] Clipboard manager ([M6-PLAN.md](M6-PLAN.md) F2; in the simulator)
- [x] Press and hold on launcher icons ([M6-PLAN.md](M6-PLAN.md) F1; in the simulator)
- [ ] 🟡 OTA updates with A/B slots ([HARDWARE.md](HARDWARE.md#ota-with-ab-updates)).
      Done in the simulator: `com.palm.update` (Palm's API, so luna-systemui's
      update alerts work) on RAUC, Settings > Updates, the feed publisher
      `server/updates`, and the feed built into Phoenix's own catalog server
      (`server/marketplace`: `/updates/`, published with its admin API; the
      device's default feed) ([APP-RUNTIME.md](APP-RUNTIME.md#system-updates)); to do:
      the A/B image, RAUC's bootloader setup and signing keys per device,
      and hosting the catalog server (its public address in
      `/etc/palm/updates.json` and the Marketplace's sources)

## 2.0: modern webOS

The modern revamp in style and features (see "Two lines" above). 1.x stays
supported alongside it.

- [ ] A new visual style and themes (dark and light), designed from the
      webOS ideas rather than the 2011 art
- [ ] Chromium-based browser replacing Isis (tabs as cards, PWA install,
      Widevine for the streaming services)
- [ ] MCP hub `org.webosphoenix.mcp`: OS tools, per-app tools from
      `appinfo.json`, grants, confirmations and an audit log; stdio over
      SSH, then Streamable HTTP with QR pairing ([AI-AND-MCP.md](AI-AND-MCP.md) P1-P4)
- [ ] The assistant grown into an AI agent on the hub; Settings > Assistant
      with Anthropic, OpenAI, Google and OpenAI-compatible providers, a key
      store, and llama.cpp on the device ([AI-AND-MCP.md](AI-AND-MCP.md) A1-A5)
- [ ] Phoenix services (possible): a paid Phoenix AI service and
      iCloud-style Phoenix cloud services, as providers next to the others
- [ ] Streaming apps: Widevine L1, HDCP and certification by the services
      ([APP-STORE.md](APP-STORE.md#311-streaming-apps-and-drm))
- [ ] Consider Enact, LG's React framework that replaced Enyo, for 2.0
      apps and for running webOS TV and OSE apps (Enyo is no longer
      developed; the last release, 2.7.0, was in April 2016). The
      temporary Enact Notes demos (Limestone and Agate) show how it looks
      and works on a tablet, and what a touch UI would need: text fields
      that do not lock the pointer, sizes for a hand-held screen, Chromium
      119+ for Limestone ([APP-RUNTIME.md](APP-RUNTIME.md#enact-apps))
- [ ] Choose the 2.0 app frameworks. Notes demos in Ionic 9 (React) and
      Flutter 3.47 (web build) run beside the Enact ones on the same notes,
      on phones and tablets ([APP-RUNTIME.md](APP-RUNTIME.md#ionic-and-flutter-apps));
      next, native Flutter through LG's webOS embedder
- [x] The 2.0 app stack (the owner, 10 October 2026): a layer on existing
      frameworks, not a new framework. Enact is the recommended base with
      the Phoenix design layer; Ionic, plain web and PWAs, and Flutter are
      supported. The Phoenix service plugin is built: `@phoenix/sdk` with
      bindings for Enact, React, Capacitor and Dart, and `phoenix-sdk.js`
      for pages without a bundler; the four Notes demos use it
      ([APP-SDK.md](APP-SDK.md)). Next: publishing it (OPEN-QUESTIONS.md
      Q62), a full Enact theme (Q63)
- [ ] Later, when there are people for it: a developer extension for VS
      Code and Cursor, in its own repository (the owner, 11 October 2026):
      installs and updates the simulator, new projects in each supported
      framework, run on the device profiles, connector tests, the catalog's
      checks, publishing. The brief for the agent that builds it:
      [DEV-EXTENSION-PROMPT.md](DEV-EXTENSION-PROMPT.md)
- [ ] Screenshots on a par with iOS and Android: preview, markup, full
      page, recording, text in screenshots, Ask and circle to look up
      ([SCREENSHOTS.md](SCREENSHOTS.md) SC3-SC8)
- [ ] The animated gesture bar: thickness, glow and motion for each
      gesture, and teaching ([GESTURE-BAR.md](GESTURE-BAR.md) GB4-GB5)
- [ ] Community features for 2.0 from [COMMUNITY-FEATURES.md](COMMUNITY-FEATURES.md)
      (automation profiles, second screen, performance panel, card gestures)
- [ ] One device, every screen (below)

### One device, every screen

Plan in [CONVERGENCE.md](CONVERGENCE.md). A phone or tablet docks to a
monitor, keyboard or mouse (desktop mode, like DeX) and to a TV by cable or
wirelessly (TV mode, a streaming device for any TV).

- [ ] C0 modes in the simulator (second display, keyboard and mouse)
- [ ] C1 desktop mode
- [ ] C2 TV mode, with the phone as the remote
- [ ] C3 on a device: display output, EDID, HDCP, two outputs
- [ ] C4 Miracast and Google Cast sending
- [ ] C5 Widevine L1 and certification by the streaming services

## Later product lines (ideas)

From [BRANDING.md](BRANDING.md); not planned in detail yet.

- A watch or pendant: a small-screen variant, lighter and faster (working
  name PixiOS running Bennu UI)
- A VR / XR variant, with a bird-named interface (Simurgh is the favourite)

## Related projects

- **LuneOS** (webOS Ports) has kept a community webOS running on phones
  since 2014, now on OSE's components with its own card shell. Phoenix
  builds its device images on LuneOS's layers but stays independent
  ([LUNEOS.md](LUNEOS.md)).
- **webOS Community Edition** (webOS Archive) keeps HP's TouchPad software
  alive; its App Catalog back end and Preware feeds matter for the 1.0
  catalog ([WEBOS-FAMILY.md](WEBOS-FAMILY.md)).
- **webOS OSE** (webosose.org) is the base platform.
