# Roadmap

Goal: the full legacy webOS phone and tablet experience, pixel for pixel and
feature for feature, on webOS OSE. Once that works, modernize it.

Last brought up to date on 29 September 2026. Where the work stands today
and what comes next is in [STATUS.md](STATUS.md); this page is the whole
plan, milestone by milestone.

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
| Assistant | On by default, with settings to turn it off; 1.0 is a voice assistant without models, the AI agent and MCP are 2.0; a paid Phoenix AI service and iCloud-style Phoenix cloud services are possible later | [AI-AND-MCP.md](AI-AND-MCP.md) |
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
- [ ] **ARM64 virtual machine image** (`qemuarm64`-style, UEFI) for UTM on
      Apple silicon Macs: runs OSE and Phoenix at near-native speed through
      Apple's virtualization, the real OS rather than the simulator. On an
      iPad, UTM can only emulate (no hypervisor access), which is far too
      slow for OSE and Chromium, and touch reaches the guest as a pointer

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
- [ ] `device.json` read on the device (hardware home button, and later other features)
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
- [x] Sharp art at every pixel density ([spec/hidpi-art.md](spec/hidpi-art.md))
- [ ] Phone in landscape: the launcher keeps 3 columns, the lock screen banner
      covers the date, the PIN pad covers the clock, the system menu is taller
      than the screen
- [ ] Check Just Type in tablet portrait (an overlap was seen once, perhaps mid-rotation)
- [ ] Advanced gestures: long swipe to switch apps while maximized (G5)
- [ ] Exhibition / dock mode (clock, slideshow while charging) (R5)
- [ ] Just Type: search suggestions, remote (GAL) contacts, its preferences screen
- [ ] The remaining P2 rows in GAPS.md
- ~~Wave launcher~~: not in the open sources (GAPS Q3)

## M3: phones and tablets

Device tiers, the driver plan and the phased timeline are in
[HARDWARE.md](HARDWARE.md).

- [ ] First devices on LuneOS's layers: Pixel 3a (Halium and mainline), OnePlus 6, PinePhone Pro, FuriLabs FLX1s
- [ ] A keyboard phone: Zinwa Q25 (unlocked, LuneOS config `q25`)
- [ ] Telephony and SMS (oFono, LuneOS's `webos-telephonyd`), cellular indicators
- [ ] Sensors: accelerometer, proximity, ambient light
- [ ] Power management: screen timeout, suspend, wake on notification
- [ ] Porting guide, device table and hardware report

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

- [ ] Browser: Share > Add to Launcher that saves a launcher icon you can
      change, as webOS did (today the runtime's `addLaunchPoint` is a stub)
- [ ] Browser: "Install Web App" under Preferences, with a coloured dot by the
      app menu when the page has a web app manifest ([APP-STORE.md](APP-STORE.md) section 1)
- [ ] Modern Synergy, in the order of [SYNERGY-MODERN.md](SYNERGY-MODERN.md#5-roadmap):
      provider presets, the shared sync layer, OAuth with Microsoft and
      Google, mail, messaging Synergy (SMS, Matrix, XMPP, bridges), RCS,
      cloud drives, the Fediverse and Bluesky, push
- [ ] Synergy on a device: the accounts service and contacts linker on OSE,
      the key store, the activity manager for periodic sync
- [ ] Phone and Messaging on a device: telephony service, MMS, IM transports,
      active-call banner
- [ ] Device side of the new apps (torch, PTY service, key store, location
      permissions, WAV sounds, TTS, media indexer, camera capture): the list
      is in [STATUS.md](STATUS.md#next-work)
- [ ] Lock screen asks for the PIN / password set in Screen & Lock
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
- [ ] Developer Mode with `sudo` and an SSH server ([TERMINAL.md](TERMINAL.md) T4-T5).
      Done in the simulator: Settings > Developer Mode behind the device PIN
      or password, and the Marketplace installs packages with install
      scripts and services only in it ([APP-RUNTIME.md](APP-RUNTIME.md#developer-mode))
- [ ] Screenshots as the original took them, with a notification that
      opens a preview to crop, mark up, share or delete
      ([SCREENSHOTS.md](SCREENSHOTS.md) SC1-SC2). Done in the simulator;
      to do: the compositor's capture on a device, secure cards
- [ ] The light bar's animations, and buttons at the ends of the gesture
      area ([GESTURE-BAR.md](GESTURE-BAR.md) GB1-GB3)
- [ ] Community features for 1.x, from the top 20 in
      [COMMUNITY-FEATURES.md](COMMUNITY-FEATURES.md) (launcher groups and
      tab management, the power menu, battery percentage, game controllers
      and USB OTG, and more), each added here as it is picked

## 1.0 release

1.0 ships when a fan can install Phoenix on hardware they own and use it
every day. The app sources come towards the end of 1.0 (owner, 29 September
2026).

- [ ] Web apps and the Phoenix Catalog: curated PWAs shown as apps ([APP-STORE.md](APP-STORE.md) A0-A4).
      Done in the simulator: the Marketplace (A0) and the catalog service on
      this computer (A3); to do: the server online, A1 on a device, A4
- [ ] Classic apps from App Museum II ([APP-STORE.md](APP-STORE.md) A2), with webOS Archive.
      Done in the simulator (an add-on catalog, off by default); the owner is
      asking the webOS Archive
- [ ] Enyo 2 apps: test LuneOS's `org.webosports.app.*` apps and the App
      Museum's Enyo 2 titles in the simulator, then on a device. Enyo 2.5.2,
      Onyx, Layout and `webOS.js` are mounted at `/usr/palm/frameworks/enyo2/`,
      and the temporary `apps/enyo2demo` samples them
      ([APP-RUNTIME.md](APP-RUNTIME.md#enyo-2-apps)). Remove the demo when
      real apps are tested
- [ ] Preware feeds, installed through the catalog (done in the simulator:
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
- [ ] Keyboard: dictation (V2, done in the simulator), predictive text and
      swipe typing (V3, done in the simulator; Settings > Text Assist),
      emoji (V6, done in the simulator), cursor control by holding the space bar or the gesture
      bar (V4, done in the simulator), the keyboards as the device's input method (V5), and
      keyboards chosen in Settings as on iOS: webOS Classic, webOS OSE's and
      a new Phoenix keyboard (V7)
- [ ] Hardware keyboards, especially on tablets: the TouchPad keyboard's
      keys, shortcuts, full keyboard navigation of the shell, keyboard
      accessibility (sticky, slow and bounce keys, Full Keyboard Access) and
      Settings > Hardware Keyboard (V8)
- [x] Editing: the Edit submenu (Select All, Cut, Copy, Paste) in every
      app menu, and the same on a long press in a text field (E1)
- [ ] One share sheet and one file picker for every app: the original's
      file picker back for legacy apps, a save picker (Save to Files in a
      chosen folder), and a share sheet apps join through `appinfo.json`
      ([SHARE-AND-FILES.md](SHARE-AND-FILES.md))
- [ ] The Phoenix Assistant, a voice assistant like Siri: push-to-talk,
      on-device speech recognition, commands for the phone's own features
      and spoken answers, in the classic style
      ([AI-AND-MCP.md](AI-AND-MCP.md#10-and-20))
- [ ] OTA updates with A/B slots ([HARDWARE.md](HARDWARE.md#ota-with-ab-updates)).
      Done in the simulator: `com.palm.update` (Palm's API, so luna-systemui's
      update alerts work) on RAUC, Settings > Updates, the feed publisher
      `server/updates` ([APP-RUNTIME.md](APP-RUNTIME.md#system-updates)); to do:
      the A/B image, RAUC's bootloader setup and signing keys per device

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
