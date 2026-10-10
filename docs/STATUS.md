# Where the project stands

A snapshot for picking the work up again (10 October 2026). The detail is
in the documents linked from each item.

## Done in the simulator

- The shell: the luna-sysmgr port (status bar, system menu, dashboard,
  launcher, card view, lock screen, Just Type, rotation, virtual keyboard,
  system sounds), sharp art at every density ([spec/hidpi-art.md](spec/hidpi-art.md)).
- The original Open webOS apps, and new Phoenix apps: Settings, Phone,
  Messaging, Camera, Photos, Music, Files, Tasks, Voice Memos, Flashlight,
  QR Scanner, Weather, Maps, Passwords, Authenticator, Terminal, Videos,
  Podcasts, PDF View, Doc View, First Use, Help, Emergency Info, Location
  Services. See [APP-GAPS.md](APP-GAPS.md) and [APP-RUNTIME.md](APP-RUNTIME.md).
- The CardDAV and CalDAV Synergy account ([SYNERGY.md](SYNERGY.md)).
- The last 1.0 features of M6 ([M6-PLAN.md](M6-PLAN.md)): press and hold on
  launcher icons, the clipboard history, the Assistant, and the community
  features picked for 1.0. Also the keyboard's dictation, word suggestions,
  swipe typing, emoji and cursor control (GAPS V2-V6), hardware keyboard
  shortcuts and accessibility (V8) and its keyboard button, which keeps clear of
  notifications, moves to either edge and can be hidden, Edit in every app menu (E1), Developer
  Mode behind the Konami code, and the share sheet with Share in every app
  menu ([SHARE-AND-FILES.md](SHARE-AND-FILES.md)).
- The start-up animation: the phoenix's death and rebirth (the dead orb
  burns to ash, a gold bird-orb flies out of it and becomes the Assistant
  bird, which lands and waves; `BootStory.qml`), or the classic glowing
  logo (Settings > Advanced > Start-up animation). On a device written, not
  run: the device shell shows it from its first frame in the chosen style
  and ends it on bootd's `boot-done` ([OPEN-QUESTIONS.md](OPEN-QUESTIONS.md)
  Q10-Q14, Q19).
- Cards: stacks keep their order while a card maximizes and minimizes, and
  Back in an app another opened returns to the caller, the app staying open
  behind it (GAPS C12); the fan's own clock, the launching card coming back
  when a child closes, a maximized card's fly-off, the new card's prepare
  step, modal cards, dashboards swiped or dragged by their window (C1, C2,
  C4, C11, N5; 10 October 2026).
- 10 October 2026, also: the launcher hides the cards and has its top
  scroll fade (L1, L2); the dock-mode system menu, the ringer key, the kept
  rotation lock (M2, R1); the angry card's and launcher's sounds and Email's
  and the Clock's tones (C3, A1); several keyboards with the globe key, the
  text around the cursor, emoji for words, spoken punctuation,
  auto-capitalisation, hardware keyboard layouts and remapping, the PIN pad
  by keyboard (V1-V3, V6-V8); the original file picker for legacy apps, the
  picker's kinds, Share in Docs, Voice Memos and Maps, Open in Music (SF1,
  SF2, SF5); Open in New Card in Messaging and Email; the Assistant listening
  on after "Hey Phoenix" and Answer aloud when you type / when you speak;
  Synergy C0 (Connections in the Marketplace).
- In progress (10 October 2026): Synergy C1-C2 (the connector kit and the
  Fediverse account), and the device side of the gaps (the device window
  source, its system status, the WAV sounds, the lock service, the
  Assistant's and the clipboard's services on the bus).
- Plans: modern Synergy with cloud drives, the Fediverse, the messaging
  networks Phoenix can use and RCS ([SYNERGY-MODERN.md](SYNERGY-MODERN.md)); LuneOS
  ([LUNEOS.md](LUNEOS.md)); how Phoenix differs from webOS Community
  Edition, LuneOS and OSE ([WEBOS-FAMILY.md](WEBOS-FAMILY.md)); AI and MCP ([AI-AND-MCP.md](AI-AND-MCP.md)); the
  terminal ([TERMINAL.md](TERMINAL.md)); the app store
  ([APP-STORE.md](APP-STORE.md)); Android apps ([ANDROID.md](ANDROID.md));
  hardware ([HARDWARE.md](HARDWARE.md)); 2.0 docking and TV mode
  ([CONVERGENCE.md](CONVERGENCE.md)).

## Written for the device, not yet run

Nothing has run on a phone yet. The device side is written against OSE's
own sources and tested here with fakes ([HARDWARE.md](HARDWARE.md#written-for-the-device-not-yet-run)):
the device window source's launching app, Back (to the page, to the caller,
or minimizing the card) and the apps' orientation, full-screen and status
bar colour requests; Wi-Fi, Bluetooth, VPN and a modem's indicators, the
sound and rotation lock preferences and all of Settings > Advanced from
OSE's services; the orientation sensor (phoenix-devices, IIO); the device
lock and the shell's state for the apps (`services/systemmanager`); the
clipboard history on the bus (`services/clipboard`); the system sounds as
raw PCM for audiod, with looping ringtones; the start-up animation at boot.
Everything that only worked because the simulator is one process
([DEVICE-AUDIT.md](DEVICE-AUDIT.md), 105 items: 23 done by OSE, 54 written
for the device, 21 to do, 7 waiting on hardware or a decision) now has a
device path where one could be built without hardware: the pages' line to
the shell (`services/shellhost`: banners, sounds, the edit popup, scene
transitions, screen captures, Just Type, dictation, media keys), the runtime
replacing what WebAppMgr drops, the legacy application manager over SAM
(`services/appmanager`), com.palm.power and the battery (phoenix-devices),
DropShare's server, the accessories' services, OSE's toasts as banners and
Open webOS's app services under mojoservicelauncher.
What the first image must check is listed there; the owner's questions are
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) Q19-Q23, Q37-Q39, Q61 and Q62.

## Direction

1.x runs and works as fully as possible and stays very close to the
original webOS; it is for the fans and is never deprecated. 2.0 is the
modern revamp in style and features that brings webOS back
([ROADMAP.md](ROADMAP.md#two-lines-1x-and-20)). 2.0 only expands on what
1.x built; it reverts nothing unless the owner agrees.

1.0 ships with the app sources people need (web apps and the catalog, App
Museum II, Preware, Android apps) and installs like a Linux distro on as
much hardware as possible, so the community grows and manufacturers take
notice ([HARDWARE.md](HARDWARE.md#install-it-like-a-linux-distro)). Also
in 1.0: dictation, predictive text and swipe typing on the keyboard; a
Siri-like voice assistant without AI models. Done in the simulator: the
Edit menu and the long-press Cut / Copy / Paste popup (E1), cursor control
(V4), emoji (V6), and Text Assist: word suggestions, auto-correct, the
user's shortcuts, swipe typing and dictation (V2, V3) ([GAPS.md](spec/GAPS.md)); Backup and Restore
([APP-RUNTIME.md](APP-RUNTIME.md#backup)); the Marketplace with web apps,
App Museum II and Preware as sources and its PHP catalog service
([APP-RUNTIME.md](APP-RUNTIME.md#marketplace)); System Updates on RAUC
([APP-RUNTIME.md](APP-RUNTIME.md#system-updates)); Settings > Hardware, which
fills the gaps the image leaves (newer firmware, out-of-tree drivers) from a
signed driver catalog ([HARDWARE.md](HARDWARE.md#hardware-support-and-the-hardware-app)); downloads and installs as
ongoing activities in the notification area. The MCP layer and the AI
agent are 2.0 ([ROADMAP.md](ROADMAP.md#10-release)).

Naming ideas (PreOS with Phoenix UI, PixiOS with Bennu UI for a watch or
pendant, a bird-named XR variant) are collected in
[BRANDING.md](BRANDING.md). Not decided; trademark searches come first.

## Decisions for the owner

From the new apps:

1. Weather: Open-Meteo's free API is for non-commercial use; a commercial
   release needs its paid plan or our own Open-Meteo server.
2. Podcasts: Apple's iTunes Search (rate and artwork limits), or register a
   Podcast Index key for the project.
3. Maps: Photon as the default search; announce the app to the FOSSGIS
   Valhalla server before release; keep the 1.8 MB demo tiles in the repo.
4. Authenticator: require a PIN of 6 or more digits until the key store
   exists; lock on minimize at once or after 30 s.
5. Sounds: core-apps' `emailreceived.mp3` carries a third-party copyright
   tag and is not shipped; Phoenix's own synthesized one (CC0) takes its
   place through the compat overlay.
6. The Emergency Call button on the PIN pad is our design; the medical ID
   is a system preference.
7. phoenix-sim shows First Use on a developer's first run.

From the plans: which assistant providers first; our own Google and
Microsoft app registrations or bring-your-own; the store's name and PHP
hosting; approaching the App Museum maintainers; RCS (which carrier first,
a joint approach with other open mobile OSes); WhatsApp through the EU DMA
as a Phoenix messaging service; asking LuneOS to add licence files to the
layers that have none; which company holds a Widevine contract, and on which
reference device.

## Next work

The whole plan, milestone by milestone, with the decisions taken so far:
[ROADMAP.md](ROADMAP.md).

- **Check on a Retina Mac** that the status bar icons are the right size
  (fixed in `a8590c1`; CI now runs the HiDPI tests at a device pixel ratio
  of 2).
- **Device work** for the new apps: torchd and the nyx torch module, the
  PTY service build, Developer Mode, the emergency window and First Use at
  boot on the device window source, a per-app location permission service,
  the key store service, WAV copies of the system sounds, a TTS engine, the
  `com.palm.app.maps` alias in the app manager, Podcasts' ACG names.
- **Second wave of apps** ([APP-GAPS.md](APP-GAPS.md)):
  screen reader, magnification, health,
  cell broadcast, eSIM, printing, screen recording, fingerprint, notes
  sync, a now-playing dashboard, and the "not done" lists of each new app.
- **Browser**: add "Install Web App" for sites with a web
  app manifest (a coloured dot by the app menu, the item under
  Preferences; install as described in [APP-STORE.md](APP-STORE.md)); plan a
  Chromium-based Phoenix browser to replace the Isis browser in the 2.0 UI.
- **2.0: one device, every screen** ([CONVERGENCE.md](CONVERGENCE.md)):
  desktop mode when a monitor, keyboard or mouse is attached; TV mode (a
  streaming device for any TV) by cable or wirelessly.
- **Streaming apps and DRM** ([APP-STORE.md](APP-STORE.md#311-streaming-apps-and-drm)),
  a requirement for 2.0: Netflix, Disney+ and the like need Widevine L1,
  HDCP on the display output and deals with each service. LG's webOS Hub is
  TV-only and ships LG's own webOS, so it is not a route. The business talks
  are slow and should start well before 2.0.
- **Enyo 2 apps**: Enyo 2.5.2 with Onyx is in the simulator, and a temporary
  Enyo 2 Demo app (Downloads tab) shows the widgets. Next, test real Enyo 2
  apps (LuneOS's, the App Museum's) ([APP-RUNTIME.md](APP-RUNTIME.md#enyo-2-apps)).
- **Enact demos**: Notes (Limestone) and Notes (Agate), an Apple
  Notes-style app with standard Markdown in LG's Enact framework, both in
  Downloads and sharing their notes; findings for 2.0 in
  [APP-RUNTIME.md](APP-RUNTIME.md#enact-apps).
- **Ionic and Flutter demos**: Notes (Ionic) and Notes (Flutter), the same
  app for phones and tablets, in Downloads with the Enact demos and on the
  same notes ([APP-RUNTIME.md](APP-RUNTIME.md#ionic-and-flutter-apps)).
- **Synergy build**: C1-C2 in progress; then the accounts needing no
  registration (meeting Join buttons, Jitsi video calls, WebDAV, SFTP and
  S3 drives in Files) and C3 (the OAuth service, Microsoft, Google, Dropbox,
  Box, LinkedIn, Zoom, Telegram, Bluesky, the iCloud preset)
  ([SYNERGY-CONNECTORS.md](SYNERGY-CONNECTORS.md) 6-7). The developer apps to
  register under the Phoenix project account: OPEN-QUESTIONS Q17.
- **Open gaps**: one list by area and priority in
  [spec/GAPS.md](spec/GAPS.md#open-gaps-at-a-glance). In the simulator only
  small ones are left (a modal card and the keyboard, a dashboard's drag
  mode set late, firm press to select, word-by-word dictation); everything
  else waits on a device: written and tested here, to run on hardware (K1,
  G1, G2, R1, R2, S6, M2, S2, A1, E2, C8, C12), and the Phoenix keyboard as
  the device's input method (V5): the first image, and a device to run it
  on (OPEN-QUESTIONS Q2).
