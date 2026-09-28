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
  Photos, Music, Files)
- **In progress**: Tasks (with reminders), Voice Memos (with transcription)
- **Missing**

**Priority:** **P0** a phone is not usable as a daily phone without it;
**P1** expected on any modern phone; **P2** nice to have or for later.

"Web app" means a React + TypeScript app in `apps/` like the others, using
`@phoenix/ui` and `@phoenix/luna`. Unless noted, every new app is a web app.

## Communication and personal data

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| Phone | Phoenix | Phone (dial pad, call log, voicemail, conference) | P0 | Done in the simulator. Needs the device telephony service (webos-telephonyd on oFono), lock-screen answer, active-call banner. See [HARDWARE.md](HARDWARE.md#hardware-abstraction-plan) |
| Messaging | Phoenix | Messaging (SMS, MMS, IM through Synergy) | P0 | Done for SMS in the simulator. Needs MMS (oFono has MMS through `mmsd`), cell broadcast alerts |
| Contacts | Open webOS | Contacts with Synergy linking | P0 | Works. Needs CardDAV sync (below), vCard import/export, contact photos |
| Email | Open webOS | Email (IMAP, POP, Exchange EAS) | P0 | Works with simulated transports. Needs real IMAP/SMTP transports in the email service (`third_party/app-services`); OAuth2 for Gmail and Outlook is the hard part |
| Calendar | Open webOS | Calendar with Synergy | P0 | Works. Needs CalDAV sync and reminders that fire (activity manager) |
| Accounts | Open webOS | Accounts (Palm Profile, Synergy) | P0 | Works but cannot sign in to anything. Needs account templates for CalDAV/CardDAV, IMAP and Nextcloud |
| **Cloud sync** (contacts, calendar, files) | Missing | Palm Profile plus Synergy connectors (Google, Exchange, Facebook, Yahoo, LinkedIn); servers shut down | P0 | Standards, not vendors: CalDAV/CardDAV (Nextcloud, Fastmail, iCloud, Google), IMAP/SMTP, WebDAV for files. Built fresh in `apps/dav` (Apache-2.0): LuneOS's [C+Dav Synergy connector](https://github.com/webOS-ports/org.webosports.service.contacts.carddav) is GPL-3.0, so it is a reference only, not a starting point (see [LUNEOS.md](LUNEOS.md)). No UI of its own; it plugs into Accounts |
| Memos | Open webOS | Memos (sticky notes) | P1 | Works locally |
| **Notes sync** | Missing | Memos synced only through some account types | P1 | A Synergy-style connector syncing Memos to the [Nextcloud Notes API](https://github.com/nextcloud/notes/blob/main/docs/api/README.md) or to Markdown files over WebDAV. Service only |
| Tasks | In progress | Tasks (webOS 1.x/2.x, Exchange sync) | P1 | With reminders on the activity manager; later CalDAV `VTODO` sync |
| Voice Memos | In progress | Not built in (homebrew) | P2 | With transcription. Recording through `MediaRecorder`; on-device speech-to-text (for example whisper.cpp) as an optional service |
| **Emergency / medical ID** | Missing | None (emergency calls from the lock screen only) | P1 | Medical info, emergency contacts and "call emergency" reachable from the lock screen without unlocking. Shell feature plus a small Settings pane; data in db8 |

## Clock, calculator and small utilities

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| Calculator | Open webOS | Calculator | P1 | Have. Works on phone and tablet |
| **Clock and alarms** | Open webOS, **alarms ring** | Clock with alarms, timer, stopwatch; alarm popup | P0 | Done in the simulator: the Clock's alarm activities fire through the runtime's activity manager, the Clock is relaunched in place and rings as a popup alert (`tools/test-alarm.cjs`). On a device the activities must still map to OSE's `com.webos.service.activitymanager` / `com.webos.service.alarm` and wake the device from suspend |
| **Flashlight** | Missing | None built in (homebrew apps) | P1 | A system menu toggle plus a tiny app, on a torch service over the kernel LED class (LuneOS has a nyx `led_torch` module) |
| **QR / barcode scanner** | Missing | None built in | P1 | Also needed for Wi-Fi QR codes, TOTP setup and pairing. Camera through `getUserMedia`, decoding with [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) compiled to WebAssembly (`zxing-wasm`). Chromium's `BarcodeDetector` is not available on Linux, so do not rely on it. Build it as a component Camera can reuse |
| Weather | Missing | None built in (third-party apps from the App Catalog) | P1 | [Open-Meteo](https://open-meteo.com/) (free, no API key, CC BY 4.0 data) with location from `com.webos.service.location`. A dashboard/lock-screen widget later. Web app, no service |

## Media

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| Camera | Phoenix | Camera | P0 | Done in the simulator. Device capture depends on the camera work in [HARDWARE.md](HARDWARE.md) |
| Photos | Phoenix | Photos & Videos | P0 | Done |
| Music | Phoenix | Music (plus Amazon MP3 store) | P1 | Done. Needs playlists and a now-playing dashboard |
| **Video player** | Partly (Photos plays videos) | Photos & Videos, a video player, YouTube app | P1 | A dedicated Videos app for files from the media indexer (`getVideoList`), with resume position, subtitles (WebVTT/SRT) and a seek bar. HTML5 `<video>` plays through uMediaServer on OSE; codec coverage depends on the GStreamer plugins in the image (check H.264/HEVC licensing per image). Web app |
| **Podcasts** | Missing | None built in; drPodder was the favourite third-party app | P1 | Web app over RSS, with search through the [Podcast Index](https://podcastindex.org/) API and optional sync with gpodder.net or Nextcloud's gPodder Sync. Downloads through OSE's `com.webos.service.downloadmanager`; background playback and a dashboard like Music. [AntennaPod](https://antennapod.org/) is a good feature reference |
| **Screen recording** | Missing | Screenshots only (`com.palm.systemmanager/takeScreenShot`) | P2 | Screenshots first (shell, from the compositor). Recording needs compositor frames encoded to a file: probably luna-surfacemanager's output capture fed into GStreamer (*unverified*). A system menu toggle, not an app |
| **Streaming services** | Not possible today | Netflix never shipped for webOS phones; Amazon MP3, Pandora and others did | P2 | See [Streaming](#streaming-services-honestly) |

## Navigation and location

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| **Maps and navigation** | Missing | Google Maps (1.x), Bing Maps (2.x and later); turn-by-turn only from carrier apps (Sprint Navigation, VZ Navigator) | P1 | Web app on OpenStreetMap: [MapLibre GL JS](https://maplibre.org/) for vector maps; tiles from [OpenFreeMap](https://openfreemap.org/) or a self-hosted [Protomaps](https://protomaps.com/) PMTiles file (one file, also usable offline); search with Nominatim or Photon; routing with [Valhalla](https://github.com/valhalla/valhalla) or GraphHopper. Offline maps and routing later through [OSM Scout Server](https://rinigus.github.io/osmscout-server/), which Sailfish and Ubuntu Touch users already run. Needs GPS from GeoClue and turn-by-turn voice through OSE's `com.webos.service.tts` |
| Location settings | Missing | Location Services pane | P1 | Settings pane over `com.webos.service.location` (`setState`) |

## Documents and files

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| Files | Phoenix | None (Internalz Pro from Preware) | P1 | Done |
| **PDF viewer** | Missing | PDF View (Adobe Reader) | P1 | Web app on [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0). Registered as the handler for `application/pdf` so Files, Email and the browser open it |
| **Document viewer** | Missing | Doc View (Documents To Go), later QuickOffice | P2 | Read-only first: [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) for Word, SheetJS for spreadsheets, or convert to PDF with LibreOffice headless as a service (large, so optional). Editing is out of scope for now |
| E-book reader | Missing | Kindle app (TouchPad) | P2 | EPUB with [foliate-js](https://github.com/johnfactotum/foliate-js) |
| Browser | Open webOS (Isis) | Web | P0 | Works in the simulator. On OSE it needs a page view for `enyo.WebView` (M1). A modern Chromium-based browser shell is an M5 question |

## Store, setup, backup and updates

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| **App catalog / store** | Missing | HP App Catalog; homebrew through Preware (WebOS Internals) | P0 | One catalog app with three sources: (1) **Phoenix feed** of native and web apps as signed `.ipk`, installed through OSE's `com.webos.appInstallService`; (2) the **webOS Archive [App Museum II](https://appcatalog.webosarchive.org/)** for legacy Mojo and Enyo apps, which run to the extent our runtime supports them (show a compatibility badge, collected from users); (3) **PWAs**: OSE has installed PWAs since 2.26 (`appinstalld2`), so a curated list of good PWAs plus "Install" from the browser. Talk to the webOS Archive maintainers before pointing at their feed. Preware's feed format is a good model for (1). Plan: [APP-STORE.md](APP-STORE.md) |
| First use / setup | Missing | First Use app (language, Wi-Fi, Palm Profile, backup restore) | P0 | Language, Wi-Fi, accounts, PIN, restore from backup, and a short gesture tutorial (the legacy one was loved). Web app |
| System updates | Stub in Settings | System Updates app, over the air | P0 | Settings > Updates on RAUC through a Luna service (see [HARDWARE.md](HARDWARE.md#ota-with-ab-updates)) |
| **Backup and restore** | Missing | Backup app: daily automatic backup to the Palm Profile (contacts, calendar, accounts, app list and launcher layout), restored at first use; HP shut the servers down | P1 | Export db8 kinds (contacts, calendar, messages, memos, tasks, call log), settings, launcher layout and the installed app list to one encrypted archive; store it on WebDAV/Nextcloud, a USB drive or a computer. Restore from First Use. A service plus a Settings pane |
| Help and tips | Missing | Help app | P2 | Short web pages shipped with the image |

## Security and privacy

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| Lock screen PIN / password | **Done** (the lock screen asks for the PIN or password) | PIN and password lock | P0 | The lock screen asks through the ported UnlockPanel and checks with `com.palm.systemmanager` `matchDevicePasscode` (GAPS K1). On a device a passcode service is still needed (OSE has none) |
| **Password manager** | Missing | None built in (third-party SplashID and others) | P1 | Offline-first KeePass (`.kdbx`) vault using [kdbxweb](https://github.com/keeweb/kdbxweb) (MIT), with the file synced through WebDAV; Bitwarden/Vaultwarden support as a second option. System-wide autofill needs a hook in the web runtime and keyboard: design it together with the IME work |
| **Authenticator (TOTP)** | Missing | None built in | P1 | RFC 6238 TOTP/HOTP, `otpauth://` QR import through the shared scanner, import from Aegis and andOTP exports, encrypted with the device PIN. Small web app; could share storage with the password manager |
| **VPN** | Missing | VPN settings pane (`com.palm.app.vpn`) | P1 | Settings pane for WireGuard and OpenVPN over ConnMan's `connman-vpnd`; needs VPN methods in `webos-connman-adapter` or a Phoenix service |
| Fingerprint unlock | Missing | None | P2 | fprintd or the Android HAL on Halium (see [HARDWARE.md](HARDWARE.md)) |

## Accessibility

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| **Screen reader** | Missing | None | P1 (design now, build after M3) | The hardest item on this page. It must cover the QML shell and web apps. Qt Quick exposes an accessibility tree (AT-SPI on Linux) and Chromium exposes one for web pages, but no Linux screen reader is designed for touch (Orca is desktop-first), and whether OSE's Chromium build exposes AT-SPI under Wayland is *unverified*. Likely a Phoenix reader with TalkBack-style gestures in the shell, speaking through `com.webos.service.tts`. Meanwhile, keep every Phoenix app's markup accessible (labels, roles, focus order) so the work is not redone |
| **Magnification** | Missing | None | P1 | Compositor zoom in the shell (a scaled view of the output with a pan gesture); cheap in QML. Also system text size and bold text settings |
| Other settings | Missing | None | P1 | High contrast, reduce motion (the card animations), mono audio, captions preference |

## Input

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| Virtual keyboard | OSE's TV keyboard | Hardware slider keyboards on phones; virtual keyboard on the TouchPad and Pre 3 | P0 | webOS-style phone and tablet layouts on OSE's Maliit-based IME (M2) |
| Word prediction and correction | Missing | Text Assist (auto-correct, custom words) | P1 | [Presage](https://presage.sourceforge.io/) or a small n-gram model per language; Text Assist settings pane |
| **Swipe typing** | Missing | None | P2 | No mature open-source Maliit swipe engine exists. [FlorisBoard](https://github.com/florisboard/florisboard)'s glide typing (Apache-2.0, Kotlin) is a candidate to port; check that its licence and dictionaries fit |

## Health and other

| App | Status | Legacy webOS | Priority | Approach |
| --- | --- | --- | --- | --- |
| **Health / steps** | Missing | None | P2 | Needs a step counter: available from the Android sensor HAL through sensorfw on Halium devices; on mainline, iio-sensor-proxy has no raw acceleration or step data, so it needs a small IIO accelerometer service. Local-only storage in db8 |
| Cell broadcast / emergency alerts | Missing | Carrier dependent | P1 | Legally required in some countries. ModemManager and oFono both support cell broadcast; show them as full-screen alerts in the shell |
| eSIM management | Missing | None | P2 | `lpac` (LuneOS already packages it) behind a Settings pane |
| Voice assistant | Missing | Voice Dial | P2 | Voice dial first, on-device speech recognition only; the assistant and its MCP layer are planned in [AI-AND-MCP.md](AI-AND-MCP.md) |
| Print | Missing | Print Manager (HP printers) | P2 | CUPS with IPP Everywhere; OSE has no print service |

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
   manager), CalDAV/CardDAV/IMAP sync and account templates, First Use,
   System Updates, and the app catalog with PWA install and App Museum
   `.ipk` install. Without these nobody can use the phone day to day.
2. **Small, high-value apps** (M4, can start now in the simulator):
   Flashlight, QR scanner (shared component), Emergency/medical ID,
   Weather, PDF viewer, Video player, finishing Tasks and Voice Memos.
3. **Bigger everyday apps**: Maps and navigation, Podcasts, Authenticator,
   Password manager, Backup and restore, Notes sync, VPN pane.
4. **Platform features**: magnification and accessibility settings, word
   prediction, cell broadcast alerts, screen recording.
5. **Long projects**: screen reader (designed early, built after M3), swipe
   typing, document viewer, health/steps, e-book reader, eSIM, print.
