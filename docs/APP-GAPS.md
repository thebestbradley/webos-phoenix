# App gaps

Every app a modern phone ships, what legacy webOS had, and what Phoenix has
or still needs. Facts are as of September 2026. For the hardware and
services underneath, see [HARDWARE.md](HARDWARE.md); for how apps run, see
[APP-RUNTIME.md](APP-RUNTIME.md).

**Status:**

- **Open webOS**: the original app runs from `third_party/core-apps`
  (Accounts, Calculator, Calendar, Clock, Contacts, Email, Memos) or
  `third_party/isis` (the Isis browser)
- **Phoenix**: a new app in `apps/` (Settings, Phone, Messaging, Camera,
  Photos, Music, Files, Flashlight, QR Scanner, Weather, Maps, Videos,
  Podcasts, PDF View, Doc View, First Use, Help, Tasks, Voice Memos,
  Passwords, Authenticator, and the Notification Lab, a developer's tool)
- **In progress**: none at the moment (each Phoenix app's row says what it
  still needs, mostly on a device)
- **Missing**

**Priority:** **P0** a phone is not usable as a daily phone without it;
**P1** expected on any modern phone; **P2** nice to have or for later.

"Web app" means a React + TypeScript app in `apps/` like the others, using
`@phoenix/ui` and `@phoenix/luna`. Unless noted, every new app is a web app.

## Communication and personal data

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| Phone | Phoenix | Phone (dial pad, call log, voicemail, conference) | P0 | Done in the simulator. The lock-screen answer is done. Needs the device telephony service (webos-telephonyd on oFono) and the active-call banner. See [HARDWARE.md](HARDWARE.md#hardware-abstraction-plan) |
| Messaging | Phoenix | Messaging (SMS, MMS, IM through Synergy) | P0 | Done in the simulator for SMS, MMS (attach from the picture picker, pictures in the balloon, simulated receive) and IM (a Jabber (XMPP) account on a simulated server: buddies, presence, chat). Needs real MMS (oFono has MMS through `mmsd`), a real XMPP transport, cell broadcast alerts |
| Contacts | Open webOS | Contacts with Synergy linking | P0 | Works. Needs CardDAV sync (below), vCard import/export, contact photos |
| Email | Open webOS | Email (IMAP, POP, Exchange EAS) | P0 | Works with simulated transports. Needs real IMAP/SMTP transports in the email service (`third_party/app-services`); OAuth2 for Gmail and Outlook is the hard part |
| Calendar | Open webOS | Calendar with Synergy | P0 | Works. Needs CalDAV sync and reminders that fire (activity manager) |
| Accounts | Open webOS | Accounts (Palm Profile, Synergy) | P0 | Works but cannot sign in to anything. Needs account templates for CalDAV/CardDAV, IMAP and Nextcloud |
| **Cloud sync** (contacts, calendar, files) | Missing | Palm Profile plus Synergy connectors (Google, Exchange, Facebook, Yahoo, LinkedIn); servers shut down | P0 | Standards, not vendors: CalDAV/CardDAV (Nextcloud, Fastmail, iCloud, Google), IMAP/SMTP, WebDAV for files. Built fresh in `apps/dav` (Apache-2.0): LuneOS's [C+Dav Synergy connector](https://github.com/webOS-ports/org.webosports.service.contacts.carddav) is GPL-3.0, so it is a reference only, not a starting point (see [LUNEOS.md](LUNEOS.md)). No UI of its own; it plugs into Accounts |
| Memos | Open webOS | Memos (sticky notes) | P1 | Works locally |
| **Notes sync** | Missing | Memos synced only through some account types | P1 | A Synergy-style connector syncing Memos to the [Nextcloud Notes API](https://github.com/nextcloud/notes/blob/main/docs/api/README.md) or to Markdown files over WebDAV. Service only |
| Tasks | Phoenix | Tasks (webOS 1.x/2.x, Exchange sync) | P1 | Done in the simulator, with reminders on the activity manager. Later: CalDAV `VTODO` sync |
| Voice Memos | Phoenix | Not built in (homebrew) | P2 | Done in the simulator, with transcription. Recording through `MediaRecorder`; on-device speech-to-text (for example whisper.cpp) as an optional service |
| **Emergency / medical ID** | Phoenix | None (emergency calls from the lock screen only) | P1 | Done in the simulator: Settings > Emergency Info (medical ID, emergency contacts from Contacts, "Show when locked"), kept as the system preference `emergencyInfo` rather than in db8 so the locked shell can read it; the PIN pad's **Emergency Call** opens Phone's restricted mode (emergency numbers and the owner's contacts only, Medical ID) as the shell's emergency window over the lock screen (after luna-sysmgr's EmergencyWindowManager). To do: the emergency window on a device (compositor adapter), emergency calls in airplane mode, the position for the emergency services (AML). See [APP-RUNTIME.md](APP-RUNTIME.md#emergency-information) |

## Clock, calculator and small utilities

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| Calculator | Open webOS | Calculator | P1 | Have. Works on phone and tablet |
| **Clock and alarms** | Open webOS, **alarms ring** | Clock with alarms, timer, stopwatch; alarm popup | P0 | Done in the simulator: the Clock's alarm activities fire through the runtime's activity manager, the Clock is relaunched in place and rings as a popup alert (`tools/test-alarm.cjs`). On a device the activities must still map to OSE's `com.webos.service.activitymanager` / `com.webos.service.alarm` and wake the device from suspend |
| Flashlight | Phoenix | None built in (homebrew apps) | P1 | **Done in the simulator** (`apps/flashlight`, `tools/test-flashlight.cjs`): the flash LED with a brightness slider, or a white screen on devices without one; it goes off when the card closes. It uses LuneOS's torch service unchanged, `org.webosports.service.torch` (torchd on nyx's `led_torch` module, the kernel LED class; see [HARDWARE.md](HARDWARE.md#hardware-abstraction-plan)), simulated in the runtime. **Left:** build torchd and LuneOS's nyx torch module into the image (`meta-phoenix/recipes-bsp/torchd`, a stub) and try it on a phone. No system menu toggle: the original webOS system menu had none, so it was not added |
| QR / barcode scanner | Phoenix | None built in | P1 | **Done in the simulator** (`apps/scanner`, `tools/test-scanner.cjs`): the camera through `getUserMedia` as in Camera, decoding with [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (MIT; zxing-cpp, Apache-2.0, as WebAssembly, bundled, never from a CDN). Acts on web addresses (browser), Wi-Fi codes (Settings > Wi-Fi join, filled in), vCard and MeCard (new contact in Contacts), `otpauth://` (hands `{otpauth}` to `org.webosphoenix.authenticator` when installed; the key is never shown or kept), `tel:`, `mailto:`, `sms:`, product codes and text (copy); a history on the device. Other apps can scan through it (`{returnTo}` launch param). **Left:** a device test with a real camera; Camera does not reuse it yet (it would share `apps/scanner/src/lib`) |
| Weather | Phoenix | None built in (third-party apps from the App Catalog) | P1 | **Done in the simulator** (`apps/weather`, `tools/test-weather.cjs`): [Open-Meteo](https://open-meteo.com/) (no API key; CC BY 4.0 data, credited in the app), now, 24 hours and 7 days, saved places and Current Location from `com.webos.service.location` (simulated), units from the system region, an offline cache, no dashboard or notifications. Sends only coordinates rounded to ~1 km (and typed city names to search); see [APP-RUNTIME.md](APP-RUNTIME.md#weather). **Left:** Open-Meteo's free API is for non-commercial use only, so a commercial image needs a paid plan or its own server (the server is a preference); a dashboard/lock-screen widget if wanted later |

## Media

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| Camera | Phoenix | Camera | P0 | Done in the simulator. Device capture depends on the camera work in [HARDWARE.md](HARDWARE.md) |
| Photos | Phoenix | Photos & Videos | P0 | Done |
| Music | Phoenix | Music (plus Amazon MP3 store) | P1 | Done. Needs playlists and a now-playing dashboard |
| Video player | Phoenix (Videos) | Photos & Videos, a video player, YouTube app | P1 | Done in the simulator (`apps/videos`, `tools/test-videos.cjs`): library from the media indexer with stills, full-screen player free to turn, resume position, WebVTT/SRT subtitles beside the file (language menu), fit/fill, audio focus with Music and Podcasts; registered for video/* so Files, Email and the browser hand videos over. Photos still plays videos in place and has "Play in Videos". Codec coverage on a device depends on the image's GStreamer plugins (check H.264/HEVC licensing per image); the demo clips are WebM (VP9/Opus) |
| Podcasts | Phoenix (Podcasts) | None built in; drPodder was the favourite third-party app | P1 | Done in the simulator (`apps/podcasts`, `tools/test-podcasts.cjs`): subscribe by RSS/Atom address, directory search (Apple's keyless iTunes Search API by default, within [its terms](https://performance-partners.apple.com/search-api): names only, cached; the [Podcast Index](https://podcastindex-org.github.io/docs-api/) when the user enters their own key and secret, since it needs one and Phoenix ships none), downloads to `/media/internal/podcasts` through `com.webos.service.downloadmanager`, speed, sleep timer, resume, background playback, OPML import/export, refresh every 6 hours through the activity manager with a notification. Still missing: a now-playing dashboard in the shell (it has none for Music either; both post `nowPlaying`), gpodder.net / Nextcloud sync, automatic downloads. In phoenix-sim only feeds that send CORS headers can be fetched (the dev server proxies the rest) |
| **Screen recording** | Missing | Screenshots only (`com.palm.systemmanager/takeScreenShot`) | P2 | Screenshots first (shell, from the compositor). Recording needs compositor frames encoded to a file: probably luna-surfacemanager's output capture fed into GStreamer (*unverified*). A system menu toggle, not an app |
| **Streaming services** | Not possible today | Netflix never shipped for webOS phones; Amazon MP3, Pandora and others did | P2 | See [Streaming](#streaming-services-honestly) |

## Navigation and location

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| Maps and navigation | Phoenix | Google Maps (1.x), Bing Maps (2.x and later); turn-by-turn only from carrier apps (Sprint Navigation, VZ Navigator) | P1 | Done in the simulator (`apps/maps`, `tools/test-maps.cjs`): [MapLibre GL JS](https://maplibre.org/) vector map (canvas renderer when there is no WebGL 2) on [OpenFreeMap](https://openfreemap.org/) tiles, search with Photon or Nominatim, directions for driving, walking and cycling with Valhalla or OSRM, turn-by-turn with spoken directions (OSE `com.webos.service.tts`), saved places in db8, sharing, `geo:`/`maploc:`/`mapto:` links and Contacts'/Calendar's addresses, offline areas and PMTiles files with offline search and routing. Every server is configurable; see [MAPS.md](MAPS.md). Needs on a device: GPS from GeoClue behind `com.webos.service.location`, a TTS engine (OSE's needs Google Cloud credentials), and a check that WAM gives WebGL 2 |
| Location settings | Missing | Location Services pane | P1 | Settings pane over `com.webos.service.location` (`getState`/`setState`). Done in the simulator: Settings > Location Services, per-app permissions and the luna-systemui alert; see [APP-RUNTIME.md](APP-RUNTIME.md#location). On a device a per-app permission service is still needed (OSE has none) |

## Documents and files

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| Files | Phoenix | None (Internalz Pro from Preware) | P1 | Done |
| PDF viewer | Phoenix (PDF View) | PDF View (Adobe Reader) | P1 | Done in the simulator (`apps/pdfview`, `tools/test-docs.cjs`) on [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0; the 4.10 legacy build, since 5 and 6 need a newer Chromium than Qt WebEngine 6.4's 102): recent documents and the PDFs on the device, continuous pages, pinch / buttons / Ctrl+wheel zoom, search with marks, page thumbnails, password prompt, page kept per file. Registered for `application/pdf` (appinfo.json `mimeTypes`), so Files, Email (`getResourceInfo`) and the browser (`open {target}`) open it. Not yet: annotations, forms, printing |
| Document viewer | Phoenix (Doc View) | Doc View (Documents To Go), later QuickOffice | P2 | Done read-only in the simulator (`apps/docview`, `tools/test-docs.cjs`): Word through mammoth.js (BSD-2-Clause), Excel and PowerPoint read by Phoenix's own OOXML code (no permissive reader small enough: SheetJS's npm release is stale, ExcelJS is large): cell values as last calculated, merged cells, number and date formats; slides' text boxes, pictures and simple tables. Markdown (marked + DOMPurify) and text. Not done: charts, themes and master art in slides, formula recalculation, legacy .doc/.xls/.ppt and OpenDocument, editing |
| E-book reader | Phoenix (in Doc View) | Kindle app (TouchPad) | P2 | EPUB 2/3 in Doc View, which is one app with the document viewer because the job is the same (reflowed text, a place kept, text size, night mode) and webOS had no e-reader of its own. Phoenix's own EPUB reader (fflate + DOMPurify, sandboxed frame): foliate-js (MIT) is not published by its author (the npm copy is a third party's), epub.js (BSD-2-Clause) is unmaintained. Pages in CSS columns (two on a tablet), table of contents, text size and font, night mode, reading position. Not yet: bookmarks, highlights, search in books, fixed-layout EPUB, DRM |
| Browser | Open webOS (Isis) | Web | P0 | Works in the simulator. On OSE it needs a page view for `enyo.WebView` (M1). A modern Chromium-based browser shell is an M5 question |

## Store, setup, backup and updates

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| **App catalog / store** | **Done in the simulator** (Marketplace, `apps/marketplace`; catalog service `server/marketplace`) | HP App Catalog; homebrew through Preware (WebOS Internals) | P0 | The Marketplace: (1) the **Phoenix catalog**, signed (Ed25519) and checked on the device, with web apps (132 curated popular sites' PWAs in 23 categories, from social, mail and office suites to streaming, games and sports; Phoenix picks and sites may opt out) and developers' `.ipk` web apps; (2) the webOS Archive's **App Museum II** and (3) **Preware feeds** as add-on catalogs of Classics, off until switched on, each package checked (no scripts, services or native code; Mojo apps refused, saying why). Installs go through OSE's `com.webos.appInstallService` (web apps packaged as `.ipk` on the device); daily update checks; Installed with Update All. The catalog service is PHP + MySQL/SQLite (accounts, submissions, review queue, ratings, reports, opt-outs, signed publishing), run on this computer for now. See [APP-STORE.md](APP-STORE.md), [APP-RUNTIME.md](APP-RUNTIME.md#marketplace). Still to do: the server online with its key in the device's sources, developer signatures, OSE's installer and the PWA runtime on a device, the Android catalog |
| First use / setup | Phoenix | First Use app (language, Wi-Fi, Palm Profile, backup restore) | P0 | `apps/firstuse`: language, Wi-Fi, date and time, accounts (Synergy), passcode, privacy (location), a cards and gestures tutorial, Help; restore from a backup (USB drive or WebDAV), every step skippable, run again from Settings > Device Info. The shell runs it at first start in LunaSysMgr's minimal-UI way until the system preference `firstUseComplete` is set. To do: reading `firstUseComplete` at boot on a device. See [APP-RUNTIME.md](APP-RUNTIME.md#first-use) |
| System updates | **Done in the simulator** (`services/updates`, Settings > Updates) | System Updates app, over the air | P0 | `com.palm.update`, Palm's update API (luna-systemui's "Update Available", download and countdown alerts use it) on RAUC: daily check of a feed (`server/updates`), download and write to the other slot in the background (an ongoing activity in the notification area), install = switch slots and restart, now or at the next charge; RAUC's signature check, compatible and newer-build checks; "Updated" or "went back" after the restart. See [APP-RUNTIME.md](APP-RUNTIME.md#system-updates). Still to do: the A/B image and RAUC per device (see [HARDWARE.md](HARDWARE.md#ota-with-ab-updates)) |
| **Backup and restore** | **Done in the simulator** (Settings > Backup, First Use's Restore step) | Backup app: daily automatic backup to the Palm Profile (contacts, calendar, accounts, app list and launcher layout), restored at first use; HP shut the servers down | P1 | `org.webosphoenix.service.backup` (`apps/settings/service`) coordinates the legacy participants that OSE still ships (`preBackup` / `postRestore`): db8's local data, the system preferences and the launcher layout go into one file encrypted with the user's passphrase (AES-256-GCM, PBKDF2), on the USB drive or a WebDAV server (Nextcloud, ownCloud, a NAS); every day or now; restore from Settings or First Use; luna-systemui's "Backup Failure" dashboard when backups keep failing ([APP-RUNTIME.md](APP-RUNTIME.md#backup); `tools/test-backup.cjs`). Still to do: the shell's participant on a device, the core kinds marked for backup in meta-phoenix, and the installed apps list once the Marketplace installs apps |
| Help and tips | Phoenix | Help app | P2 | `apps/help`: topics in Markdown (`apps/help/topics`) on the gestures, cards, launcher, notifications, Just Type and each app; searchable; Just Type finds them (db8 `org.webosphoenix.helptopic:1`). See [APP-RUNTIME.md](APP-RUNTIME.md#help) |

## Security and privacy

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| Lock screen PIN / password | **Done** (the lock screen asks for the PIN or password) | PIN and password lock | P0 | The lock screen asks through the ported UnlockPanel and checks with `com.palm.systemmanager` `matchDevicePasscode` (GAPS K1). On a device a passcode service is still needed (OSE has none) |
| **Password manager** | **Phoenix** (Passwords, `apps/passwords`) | None built in (third-party SplashID and others) | P1 | Done in the simulator: KeePass KDBX 4 databases through [kdbxweb](https://github.com/keeweb/kdbxweb) (MIT) with Argon2id from hash-wasm (MIT, WebAssembly) in `/media/internal/passwords`, so KeePassXC and KeePassDX open the same file (checked both ways); groups, entries, search, the generator, TOTP codes from KeePassXC/KeePassDX `otp` fields, copy with auto-clear, auto-lock on screen lock, card minimize and idle, merge when the file changed elsewhere, Files "Open with" (`tools/test-passwords.cjs`; threat model in [SECURITY-APPS.md](SECURITY-APPS.md)). Still to do: WebDAV sync of the file (Files has no WebDAV yet), key files and YubiKey, attachments, running on a device. Bitwarden/Vaultwarden as a second option. System-wide autofill needs a hook in the web runtime and keyboard: designed in SECURITY-APPS.md, to build together with the IME work |
| **Authenticator (TOTP)** | **Phoenix** (Authenticator, `apps/authenticator`) | None built in | P1 | Done in the simulator: RFC 6238 TOTP / RFC 4226 HOTP (tested against the RFC vectors), codes with a countdown ring, tap to copy (auto-clear), `otpauth://` links typed in or passed by the QR scanner as launch params `{otpauth}` (confirmed before adding), setup keys, import of Aegis and andOTP plain exports (with a warning) and of its own encrypted backups, encrypted export; secrets encrypted at rest with a key protected by the device passcode, auto-lock (`tools/test-authenticator.cjs`; [SECURITY-APPS.md](SECURITY-APPS.md)). Still to do: the Phoenix key store service to hold the key on a device (today the app wraps it with a PBKDF2 key from the passcode, weak for short PINs), encrypted Aegis vaults, Steam codes, running on a device. It does not share storage with Passwords: KeePass entries carry their own TOTP |
| **VPN** | **Done in the simulator** (Settings > VPN) | VPN settings pane (`com.palm.app.vpn`), the system menu's VPN drawer, the status bar's VPN icon | P1 | Settings > VPN codes against LuneOS's `luneos-vpn-adapter` (`com.webos.service.vpn` over ConnMan's `connman-vpnd`; legacy `com.palm.vpn` method names and error codes), which the simulator reimplements: WireGuard, OpenVPN, OpenConnect, Cisco IPsec (vpnc), L2TP/IPsec and PPTP (marked not secure) profiles with the adapter's own form fields; import of a WireGuard `.conf` (split into its fields) and an OpenVPN `.ovpn` (stored and used as `OpenVPN.ConfigFile`, as the adapter does not import files yet); connect, disconnect, edit, delete; the sign-in prompt when a profile needs a user name and password (connect answers -7, the page answers the prompt); the tunnel's address and traffic. The system menu's drawer connects and disconnects (a profile that signs in opens Settings > VPN), the status bar shows the VPN icon while one is connected, and airplane mode drops it (`tools/test-settings.cjs`, `tst_systemmenu.qml`, `tst_shell.qml`). Still to do: building the adapter and `connman-vpnd` with its plugins into the image, and mobile data as a VPN carrier |
| Fingerprint unlock | Missing | None | P2 | fprintd or the Android HAL on Halium (see [HARDWARE.md](HARDWARE.md)) |

## Accessibility

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| **Screen reader** | Missing | None | P1 (design now, build after M3) | The hardest item on this page. It must cover the QML shell and web apps. Qt Quick exposes an accessibility tree (AT-SPI on Linux) and Chromium exposes one for web pages, but no Linux screen reader is designed for touch (Orca is desktop-first), and whether OSE's Chromium build exposes AT-SPI under Wayland is *unverified*. Likely a Phoenix reader with TalkBack-style gestures in the shell, speaking through `com.webos.service.tts`. Meanwhile, keep every Phoenix app's markup accessible (labels, roles, focus order) so the work is not redone |
| **Magnification** | Missing | None | P1 | Compositor zoom in the shell (a scaled view of the output with a pan gesture); cheap in QML. Also system text size and bold text settings |
| Other settings | Partly | None | P1 | Settings > Accessibility: reduce motion (the shell's card, launcher and lock screen animations) and high contrast (Phoenix apps) work; mono audio and captions are stored (system preference `accessibility`) but nothing uses them yet |

## Input

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| Virtual keyboard | OSE's TV keyboard | Hardware slider keyboards on phones; virtual keyboard on the TouchPad and Pre 3 | P0 | webOS-style phone and tablet layouts on OSE's Maliit-based IME (M2) |
| Word prediction and correction | **Done in the simulator** (the keyboard's candidate bar; Settings > Text Assist) | Text Assist (auto-correct, custom words) | P1 | Suggestions, auto-correct with undo, swipe typing and dictation on AOSP LatinIME's word list and the words the user types, learned on the device. See [GAPS.md](spec/GAPS.md) V2, V3. Still to do: other languages |
| **Swipe typing** | Missing | None | P1 (1.0, owner 29 September 2026; with prediction, dictation and emoji: [spec/GAPS.md](spec/GAPS.md) V2-V6) | No mature open-source Maliit swipe engine exists. [FlorisBoard](https://github.com/florisboard/florisboard)'s glide typing (Apache-2.0, Kotlin) is a candidate to port; check that its licence and dictionaries fit |

## Health and other

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| **Health / steps** | Missing | None | P2 | Needs a step counter: available from the Android sensor HAL through sensorfw on Halium devices; on mainline, iio-sensor-proxy has no raw acceleration or step data, so it needs a small IIO accelerometer service. Local-only storage in db8 |
| Cell broadcast / emergency alerts | Missing | Carrier dependent | P1 | Legally required in some countries. ModemManager and oFono both support cell broadcast; show them as full-screen alerts in the shell |
| eSIM management | Missing | None | P2 | `lpac` (LuneOS already packages it) behind a Settings pane |
| Voice assistant | Phoenix | Voice Dial | P2 | Voice Dial done (apps/voicedial, com.palm.sysapp.voicedial: say a name or number, confirm by voice or tap, Phone calls), on-device speech recognition only (whisper.cpp through the keyboard's dictation); the assistant and its MCP layer are planned in [AI-AND-MCP.md](AI-AND-MCP.md) |
| Print | **Done in the simulator** (Save as PDF; `apps/printmanager`) | Print Manager (HP printers) | P2 | Print in Web, Email and Photos, the original Enyo print dialog, the Print Manager, `com.palm.printmgr` simulated with a "Save as PDF" printer (Chromium renders the page); see [APP-RUNTIME.md](APP-RUNTIME.md#printing). Still to do on a device: real printers with CUPS and IPP Everywhere behind the same service (OSE has no print service) |

## Streaming services, honestly

- **Netflix, Disney+, Prime Video, Spotify's web player and most paid
  video need Widevine DRM** in the browser engine. OSE's web runtime is
  Chromium 120, built without a Widevine CDM, and Phoenix cannot legally
  ship one: the CDM is a proprietary Google binary distributed only under
  licence.
- Other projects work around this by having the **user** fetch the CDM
  themselves: Ubuntu Touch 24.04-2.0 (July 2026) includes a Widevine
  installer that extracts it from ChromeOS images, and says plainly it is
  not endorsed by Google ([release notes](https://ubports.com/blog/ubports-news-1/ubuntu-touch-24-04-2-0-and-24-04-1-4-release-4007)).
  Asahi Linux's [widevine-installer](https://github.com/AsahiLinux/widevine-installer)
  does the same for ARM64 desktops, and [Google has shipped Chrome for ARM64
  Linux with Widevine](https://www.omgubuntu.co.uk/2026/07/chrome-arm64-linux-available) since July 2026. The CDM also has to support the
  CDM interface of the Chromium version that loads it. A user-run installer is possible for
  Phoenix, but it is legally grey and would need a Chromium built with
  Widevine support enabled.
- Even then it is **Widevine L3** (software-only). Services cap L3 on
  Linux at low resolution (Netflix commonly at 720p), some block browsers
  they do not recognise, and none will certify a community OS for L1
  hardware DRM.
- **LG's Content Store is not an option.** It is LG's store for LG webOS
  TVs: proprietary, tied to LG's devices, accounts and signing, and its
  apps rely on TV hardware DRM and partner agreements. webOS OSE has no
  access to it and neither will Phoenix.
- **What does work:** DRM-free and open services in the browser or as PWAs
  (YouTube in the browser, Internet Archive, PeerTube, radio, podcasts,
  Bandcamp, Jellyfin/Plex/Navidrome for your own media), and music services
  with web players that do not require Widevine (*varies by service*).
  Android apps through Waydroid are a possible M5 topic, but Widevine and
  Play Integrity checks usually still block the big streaming apps there.

## Recommended build order

1. **Make the apps we have real** (with M1–M3): alarms that ring (activity
   manager), CalDAV/CardDAV/IMAP sync and account templates, First Use
   (done in the simulator),
   System Updates, and the app catalog with PWA install and App Museum
   `.ipk` install (the Marketplace is done in the simulator). Without these
   nobody can use the phone day to day.
2. **Small, high-value apps** (M4, can start now in the simulator):
   all done in the simulator (Emergency/medical ID, PDF viewer, Video
   player, Tasks, Voice Memos, Flashlight, QR Scanner, Weather).
3. **Bigger everyday apps**: Podcasts, Notes sync
   (Backup, VPN, Maps, Authenticator and Password manager are done in the
   simulator; next for the last two: the key store service and WebDAV file
   sync).
4. **Platform features**: magnification and accessibility settings, word
   prediction, cell broadcast alerts, screen recording.
5. **Long projects**: screen reader (designed early, built after M3), swipe
   typing, document viewer, health/steps, e-book reader, eSIM, print.
