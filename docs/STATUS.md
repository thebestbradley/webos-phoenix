# Where the project stands

A snapshot for picking the work up again (29 September 2026). The detail is
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
- Plans: modern Synergy with cloud drives, the Fediverse, the messaging
  networks Phoenix can use and RCS ([SYNERGY-MODERN.md](SYNERGY-MODERN.md)); LuneOS
  ([LUNEOS.md](LUNEOS.md)); AI and MCP ([AI-AND-MCP.md](AI-AND-MCP.md)); the
  terminal ([TERMINAL.md](TERMINAL.md)); the app store
  ([APP-STORE.md](APP-STORE.md)); Android apps ([ANDROID.md](ANDROID.md));
  hardware ([HARDWARE.md](HARDWARE.md)); 2.0 docking and TV mode
  ([CONVERGENCE.md](CONVERGENCE.md)).

Nothing has run on a phone yet.

## Direction

1.x runs and works as fully as possible and stays very close to the
original webOS; it is for the fans and is never deprecated. 2.0 is the
modern revamp in style and features that brings webOS back
([ROADMAP.md](ROADMAP.md#two-lines-1x-and-20)). 2.0 only expands on what
1.x built; it reverts nothing unless the owner agrees.

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
   tag and is not shipped.
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

- **Check on a Retina Mac** that the status bar icons are the right size
  (fixed in `a8590c1`; CI now runs the HiDPI tests at a device pixel ratio
  of 2).
- **Terminal test flake**: `test-terminal.cjs` "paste: from the app menu"
  lost keystrokes once in three runs; find the cause.
- **Device work** for the new apps: torchd and the nyx torch module, the
  PTY service build, Developer Mode, the emergency window and First Use at
  boot on the device window source, a per-app location permission service,
  the key store service, WAV copies of the system sounds, a TTS engine, the
  `com.palm.app.maps` alias in the app manager, Podcasts' ACG names.
- **Second wave of apps** ([APP-GAPS.md](APP-GAPS.md)): backup, VPN,
  screen reader, magnification, word prediction and swipe typing, health,
  cell broadcast, eSIM, printing, screen recording, fingerprint, notes
  sync, a now-playing dashboard, and the "not done" lists of each new app.
- **Browser**: fix Share > Add to Launcher (the runtime's `addLaunchPoint`
  is a stub, and the dialog has no icon because the old browser's native
  snapshot plugin is missing); add "Install Web App" for sites with a web
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
- **Synergy build**, in the order of [SYNERGY-MODERN.md](SYNERGY-MODERN.md#5-roadmap).
- **Shell gaps**: the P2 rows left in [spec/GAPS.md](spec/GAPS.md) (C5, C7,
  C9-C11, L8, N7, N8, R3-R5, K7, G4, G5, G8, A2, S2) and the rest of A1.
