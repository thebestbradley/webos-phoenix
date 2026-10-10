# Licensing and assets

Not legal advice. This page records what we reuse and why we believe it is
allowed, so contributors can keep it that way.

## Our code

Everything in this repository is Apache-2.0 (see `LICENSE`), the same license
as webOS OSE and Open webOS.

## The wake word (not in the repository)

`tools/get-wakeword.py` downloads, SHA-256 checked: Vosk's library (libvosk
from the `vosk` wheel on PyPI, Apache-2.0; Kaldi, OpenFST and OpenBLAS
inside are Apache-2.0 / BSD) and `vosk-model-small-en-us-0.15` (Apache-2.0,
Alpha Cephei, <https://alphacephei.com/vosk/models>; checked again 8
October 2026). `webos-phoenix-image` ships both (meta-phoenix's `libvosk`,
the same prebuilt library, and `vosk-model-small-en-us`), with OE's
Apache-2.0 and BSD-3-Clause texts, as neither download carries a licence
file. openWakeWord's pre-trained models (CC BY-NC-SA 4.0) are not used.
The test recordings in `services/wakeword/tests/data` are made by
espeak-ng (`tools/gen-voice-fixtures.sh`; espeak-ng runs as a program, its
GPL does not cover the speech it outputs). The voices and LibriSpeech used
to measure accuracy (AI-AND-MCP.md) were not committed.

## Open webOS artwork (`shell/assets/openwebos/`)

Copied from `openwebos/luna-sysmgr/images`
(<https://github.com/openwebos/luna-sysmgr>), which HP and later LG released as
part of Open webOS under Apache-2.0 (see the license headers throughout that
repository). Attribution is in `NOTICE`.

Excluded on purpose:

- `hp-logo*.png`. Trademarks are not licensed by Apache-2.0 (section 6).
- `normal-usb.png` and `fsck-usb.png`, which picture the TouchPad hardware.
- Palm and HP app icons, wallpapers and ringtones. They were not in the
  open-source release, so we do not ship them.

HiDPI variants (`name@2x.png`, `name@3x.png`) of this art, of the Enyo art
in `apps/shared/phoenix-ui/assets` and in Messaging (`apps/messaging/src/images`),
and of the pictures of the original apps, frameworks and system UI in
`third_party/` (core-apps, the Isis browser, luna-applauncher,
luna-systemui, Enyo 1.0, Onyx for Enyo 2, the contacts framework, the Palm
profile and mail account templates; those in `compat/rootfs/`, at each
picture's device path) are made from larger originals in the same
Apache-2.0 repositories where they exist (Enyo's 1.5x art, an app's 256 px
icon), else from the 1x art; either way they are modified versions under
the same license, made by `tools/hidpi-art.py` (Real-ESRGAN, BSD-3-Clause,
as a tool only, or plain resampling). So are Voice Dial's 128 and 256 px
icons (`apps/voicedial/public`, from luna-sysmgr's 64 px one, by
`tools/upscale-app-icons.py`). `tools/hidpi-art.json` says which way each
picture was made; `shell/assets/openwebos/PROVENANCE.md`,
`compat/README.md` and `docs/spec/hidpi-art.md` describe how. Third
parties' logos (Amazon, Bing, CNN, Facebook, Google, IMDb, LinkedIn,
Outlook, Twitter, Wikipedia, Yahoo, HP's App Catalog bag, the Accounts
icon's Facebook, Google and Yahoo! logos), the pictures of the HP TouchPad
and of the Pre's battery door with the Palm logo are not enlarged:
trademarks are not licensed by Apache-2.0 (section 6). The stylesheet
copies in `compat/rootfs/` that ask for the variants are the original
Apache-2.0 stylesheets with their `url()`s changed (modified versions under
the same license).

## The start-up animation

The start-up story (`shell/qml/Phoenix/Shell/BootStory.qml`,
`BootFlame.qml`) is original Phoenix art, Apache-2.0: the orb with its dead
and screaming face, the gold glow, the fire, the ash, the smoke and the
bird-shaped orb are drawn in QML (Qt Quick Shapes and plain items); its
flames are the Assistant bird's crest (`art/assistant-bird/bird.json`, also
original, see `art/assistant-bird/PROVENANCE.md`) and the bird is the
Assistant's own. No picture, sound or shape in it comes from Palm or HP;
it echoes the classic boot logo's round orb and glow (Phoenix's own
`boot-logo.png`, not HP's) only in shape. The Classic setting shows that
logo as before.

## Open webOS system sounds (`shell/assets/sounds/openwebos/`)

The twelve files of luna-sysmgr's `sounds/` directory (`alert.wav`,
`notification.wav`, `phone.wav`, `ringtone.mp3`, `boot.mp3`, `shutdown.mp3`,
`charging.mp3`, `battery_full.mp3`, `battery_low.mp3`, `error.mp3`,
`panel.mp3`, `tap_to_share.mp3`), copied unmodified and installed where the
original apps look for them (`/usr/palm/sounds`).

Provenance, checked in September 2026 against the full history of
<https://github.com/openwebos/luna-sysmgr>: the files arrived in HP's first
public commit (cd579bc, "Release luna-sysmgr 2.0.4 to the public", Palm,
2012-07-25) and were never changed. From that commit on the README states
that all content "except otherwise noted" is Copyright HP (later LG
Electronics) and Apache-2.0. Nothing in the repository notes otherwise for
the sounds, and the files themselves carry no author or copyright tags (the
WAVs hold only Pro Tools session data from April 2009, e.g. a region named
"Banner_01"; the MP3s have no ID3 tags). LuneOS ships the same set as
Apache-2.0 (`luneos-system-sounds`). So they are shipped as published:
Apache-2.0, attribution in `NOTICE`. Residual risk: we cannot know whether
HP held the rights to relicense sounds it may have commissioned from a
third party; there is no evidence either way. If a rights holder objects,
the files can be dropped and the shell falls back to silence.

Not shipped: `com.palm.app.email/sounds/emailreceived.mp3` from
`openwebos/core-apps`. That repository's README puts all its content under
LG / Apache-2.0 (the Email app's own `NOTICE` lists its third-party images,
not this sound), but the file's ID3 tags contradict it: a copyright frame
(WCOP) reading "@ Peter Steinbach", an album "Top 500 Rock and Roll Songs"
and "Sound Grinder" as the encoder, which suggests a sound library. It stays
in the submodule (we do not modify submodules), but the compat overlay puts
Phoenix's own new-mail sound at its path
(`compat/rootfs/usr/palm/applications/com.palm.app.email/sounds/emailreceived.mp3`,
synthesized, CC0 1.0), and overlays win, so neither the simulator, the dev
server nor `tools/install-rootfs.py` serves or installs the original.

The Pre's own ringtones (`Pre.mp3`, the Clock's `Flurry.mp3`) and audiod's
feedback sounds (keyboard clicks, `appclose`, `shutter`, the angry card's
`carddrag` / `birdappclose`, the launcher's) were not released.
Phoenix synthesizes its own feedback sounds and a `Flurry.mp3` for the
Clock's default alarm (`shell/assets/sounds/phoenix/`,
`tools/make-feedback-sounds.py`, CC0 1.0; see its `PROVENANCE.md`); nothing
was sampled or downloaded.

HiDPI variants (`name@1.5x.png`, `name@2x.png`, `name@3x.png`) sit beside
some of these images. Three are Open webOS / Enyo originals at 1.5x; the rest
are enlargements of the Apache-2.0 art made with Real-ESRGAN (BSD-3-Clause,
used as a tool, not shipped), so they are modified versions under the same
license. `shell/assets/openwebos/PROVENANCE.md` records which is which and how
they were made. LuneOS's larger copies of some of this art were not used:
their origin is not recorded.

The virtual keyboards draw `keyboard-phone/` and `keyboard-tablet/` from
these images. Their code is a port of `openwebos/keyboard-efigs`
(<https://github.com/openwebos/keyboard-efigs>, Apache-2.0, LG Electronics;
attribution in `NOTICE`). Not used: the emoticon pictures the plugin loaded
from `/usr/palm/emoticons/`, which were not in the open-source release (the
emoticon keys show their text), and the XT9 prediction engine behind its
candidate bar, which is licensed separately.

## Fonts (`shell/assets/fonts/`)

Palm's Prelude is not redistributable. In its place Phoenix ships Open Sans
1.11 (Regular, Bold, Light, Semibold, Italic, Bold Italic), Apache-2.0,
copied unmodified from the `fonts-open-sans` package (see its
`PROVENANCE.md`). The shell and the apps use Prelude when it is installed.

Colour emoji come from **Noto Color Emoji** 2.047 (Emoji 15.1), SIL Open
Font License 1.1, copied unmodified from Ubuntu's `fonts-noto-color-emoji`
(`shell/assets/fonts/noto-color-emoji/`, with `OFL.txt` and
`PROVENANCE.md`). The OFL allows bundling it with software; it may not be
sold on its own, and a modified version must not use the name Noto. We do
not modify it. On a device it is installed once in `/usr/share/fonts`.

The keyboard's emoji list (`shell/qml/Phoenix/Shell/EmojiData.js`) is
generated by `tools/gen-emoji-data.py` from Unicode's `emoji-test.txt` 15.1
(the emoji, their CLDR names and groups), under the Unicode License v3,
which allows copying and modifying the data files with its notice kept.
The generated file names its source. The emoji suggested for words in the
candidate bar (`shell/qml/Phoenix/Shell/EmojiWords.js`) are generated by
`tools/gen-emoji-words.py` from CLDR 44.1's English emoji annotations
(`cldr-json`, `annotations` and `annotationsDerived`), under the same
Unicode License v3; the file names its source too. The keyboard's emoticon
keys draw this font's faces, since the original's emoticon pictures
(`/usr/palm/emoticons`) were not in the open-source images.

The Flutter demo (`apps/flutter-notes/fonts/`) bundles its own, since
Flutter's web build draws text with fonts it loads itself: Roboto (Regular,
Italic, Medium, Bold), Apache-2.0, copied from the Flutter SDK's
`bin/cache/artifacts/material_fonts`, and DejaVu Sans Mono (Regular, Bold),
under the Bitstream Vera license, from Debian's `fonts-dejavu-core`. Each
folder keeps its license text.

## Original apps and frameworks (`third_party/`)

Git submodules of the Open webOS repositories (`openwebos/core-apps`,
`app-services`, `foundation-frameworks`, `loadable-frameworks`, `mojoloader`,
`underscore`, `luna-applauncher`, `luna-systemui`), HP's Isis browser
(`isis-project/isis-browser`) and `enyojs/enyo-1.0`, all Apache-2.0 and
unmodified. Their app icons (Email, Calendar, Memos, ...) are
part of that release and are shown in the launcher; on dense screens the
shell draws the 256 px `icon-256x256.png` each app ships as its
`splashicon`, and above that a 512 px enlargement of it that
`tools/upscale-app-icons.py` makes with Real-ESRGAN into `compat/rootfs/`
(a modified version under the same license; `art/app-icons/PROVENANCE.md`).
The Accounts icon, as released, shows the Facebook, Google and Yahoo! logos,
which remain their owners' trademarks. Fixes go in
`compat/rootfs/`, not in the submodules.

Open webOS also released small pictures of some Palm icons that were never
released at full size: luna-applauncher's search results (Messaging, Tasks,
Maps, the dial handset; 48 px) and luna-systemui's file picker (Photos, Music,
Videos, documents; 120-128 px), its update gift box and sync arrows. Phoenix
does not ship them as icons; its own icons for those apps are new SVG drawings
after them (Apache-2.0 allows derivative works), listed in
`art/app-icons/PROVENANCE.md`.

The simulated `com.palm.universalsearch` (in `runtime/phoenix-runtime.js`)
carries the default web search engines from `openwebos/luna-universalsearchmgr`
(`files/UniversalSearchList.json`, Apache-2.0), with their addresses moved to
https; their icons are luna-applauncher's.

The apps' user-visible strings mention "HP webOS", "HP TouchPad" and "Palm
Profile". `tools/debrand-overlays.py` writes overlay copies of the few
source files involved (Accounts, Calendar, Contacts, Email and Enyo's
accounts library) with those strings replaced by neutral ones, and CI checks
the overlays are current. The simulated profile account template and sample
data use "Phoenix Account".

## Phoenix apps (`apps/`)

- `apps/shared/phoenix-ui/assets/enyo/`: images copied unmodified from Enyo
  1.0 (Heritage theme, Wi-Fi and palmstyle libraries), Apache-2.0, recorded in
  its `PROVENANCE.md`. No logos.
- Launcher icons of every Phoenix app and launch point (Settings' panes
  among them) are SVG drawings in `art/app-icons`, rendered by
  `tools/render-app-icons.cjs` at 64, 128, 256 and 512 px
  ([spec/app-icons.md](spec/app-icons.md)); where they follow Open webOS art
  it is recorded in `art/app-icons/PROVENANCE.md`. The icons they replaced
  are kept in `art/icons-previous` (not installed). The wallpapers are
  generated by `apps/settings/tools/make-wallpapers.py` (CC0). Palm's
  preference-app icons, wallpapers and ringtones were not open-sourced.
- `apps/shared/phoenix-ui/assets/openwebos/fullscreen-play-button.png`
  is a copy of the Open webOS artwork above.
- Demo media (`apps/media-samples/media`: seven photos, six songs, three album
  covers) is generated by `apps/media-samples/tools/make-samples.cjs`: the
  pictures are drawn with canvas (landscapes, no people, no real photos) and
  the songs are chiptunes synthesized by the script and encoded as Ogg Opus.
  Dedicated to the public domain (CC0 1.0). Artist and album names are
  invented.
- Files (`apps/files`, and its service `apps/files/service`) is a clean-room
  design inspired by **Internalz Pro**, the most popular Preware file manager
  for legacy webOS. Internalz Pro is closed source: only its feature set
  (what a user could see it do) was used as a guide. No code, artwork, text
  or layouts were taken from it. Nor was any code taken from
  `webOS-ports/org.webosports.app.filemanager` (its service is GPL-2.0). The
  launcher icon is drawn in `art/app-icons`, the list icons
  and glyphs are simple SVG drawn for Phoenix, and the rest is the Enyo 1.0
  art above.
- Tasks (`apps/tasks`) is a new app after the idea of the webOS 1.x Tasks
  app, which Palm never open-sourced; nothing was taken from it. Its db8
  kinds are defined by Phoenix. The launcher icon is drawn in
  `art/app-icons` after the Open webOS launcher's small Tasks picture; the
  rest is the Enyo 1.0 art above.

- Voice Memos (`apps/voicememos`) is a new app in the style of the webOS 2.x
  Voice Memos (which was never open-sourced; no code or artwork from it). The
  launcher icon is drawn in `art/app-icons` (original). The two
  demo memos (`apps/voicememos/public/samples`) are synthetic speech made by
  `apps/voicememos/tools/make-samples.cjs` with eSpeak NG from scripts we
  wrote; dedicated to the public domain (CC0 1.0). eSpeak NG itself
  (GPL-3.0) is only a tool used to make them and is not shipped.

- Maps (`apps/maps`) is a new app; the webOS Maps apps (Google Maps, Bing
  Maps) were never open-sourced and nothing was taken from them. Its map
  style (`apps/maps/src/lib/style.ts`), glyphs for the menus are
  original; the launcher icon (`art/app-icons`) is drawn after the Open webOS
  launcher's small Maps picture. It bundles
  MapLibre GL JS (BSD-3-Clause), Leaflet (BSD-2-Clause), PMTiles,
  @mapbox/vector-tile and pbf (BSD-3-Clause). Map data: see
  [Map data](#map-data-openstreetmap).
- Passwords (`apps/passwords`) and Authenticator (`apps/authenticator`) are
  new apps (legacy webOS had neither). Their launcher icons are drawn in
  `art/app-icons` (original). The TOTP/HOTP code in
  `apps/shared/secrets` is original, written from RFC 4226 and RFC 6238.
  Passwords bundles **kdbxweb** 2.1.1 (MIT, Antelle), **fflate** 0.7.5 (MIT,
  Arjun Barrett; used by kdbxweb) and **hash-wasm** 4.12.0 (MIT, Dani Biró;
  Argon2 compiled to WebAssembly); their licence texts ship with the app in
  `apps/passwords/public/THIRD-PARTY-LICENSES.txt`. kdbxweb's dependency
  **@xmldom/xmldom** (MIT) is used only by the unit tests under Node.js and is
  left out of the app build. `apps/passwords/src/fixtures/pykeepass-kdbx4.kdbx`
  is test data written with pykeepass (GPL-3.0, a tool only; not shipped, not
  a dependency) from values we made up.

- CardDAV & CalDAV (`apps/dav`) is original code. Its vCard and iCalendar
  mapping follows the field names and formats of the Open webOS contacts and
  calendar frameworks (`third_party/loadable-frameworks`, Apache-2.0), read
  for reference; no code was copied from them or from other sync projects.
  Its account icons are drawn by Phoenix (`apps/dav/public/accounts/.../images`,
  `apps/dav/icon.png`; CC0).
- **Radicale** (GPL-3.0) is used only to test the DAV sync: tests and CI
  install it with pip and run it as a separate program. It is not part of
  Phoenix, not linked with it, and not distributed with it.
- npm dependencies (React, Vite, ...) are MIT-licensed; the Settings app lists
  the ones it bundles under Device Info > Open source licenses. The Terminal
  bundles **xterm.js** (MIT) and ships its notice as
  `apps/terminal/public/THIRD-PARTY-LICENSES.txt`.
- The Terminal (`apps/terminal`, `services/pty`) is original code. The
  homebrew webOS terminals of the Preware catalog (WebOS Internals'
  Terminal, GPL-2.0; wTerm, GPL-3.0) were studied for their user experience
  only; none of their code is in Phoenix. The PTY service's tests use a
  stand-in for luna-service2's header written from its public API
  (`services/pty/tests/ls2stub`), not luna-service2's code.

## QR Scanner, Weather and Flashlight

- **zxing-wasm** (<https://github.com/Sec-ant/zxing-wasm>, MIT) is bundled
  into QR Scanner: its JavaScript and the reader build of **zxing-cpp**
  (<https://github.com/zxing-cpp/zxing-cpp>, Apache-2.0) compiled to
  WebAssembly. Only the reader ships; the writer (which contains zint,
  BSD-3-Clause) is used by the tests alone. The notices are in
  `apps/scanner/public/THIRD-PARTY-NOTICES.txt`, installed with the app.
- DropShare (`apps/dropshare`) bundles zxing-wasm's **writer** build to
  draw its QR codes: zxing-cpp (Apache-2.0) and **zint** (libzint,
  BSD-3-Clause) compiled to WebAssembly. Its notices are in
  `apps/dropshare/public/THIRD-PARTY-NOTICES.txt`, installed with the app.
  The pages DropShare serves to other devices (`public/web/`) and its icon
  are Phoenix's own.
- **Open-Meteo** forecast data is CC BY 4.0; Weather credits "Weather data
  by Open-Meteo.com" with a link, as the licence asks. Open-Meteo's terms
  (<https://open-meteo.com/en/terms>) allow the free API for
  **non-commercial use only** (fewer than 10,000 calls a day). A company
  shipping Phoenix commercially needs an Open-Meteo API subscription or its
  own Open-Meteo server (AGPL-3.0, run as a separate service, not linked
  with Phoenix); the forecast server is a Weather preference. The recorded
  replies in `apps/weather/fixtures` (used by the tests) are Open-Meteo data
  under CC BY 4.0, credited in each file.
- **torchd** (`org.webosports.service.torch`) and LuneOS's nyx `led_torch`
  module are Apache-2.0 (SPDX headers). Phoenix only calls torchd's API; the
  simulator reimplements it, and the `meta-phoenix` stub would build it from
  source. LuneOS's Torch app (GPL-3.0) was read for the API only; none of
  its code or art is used.

## Backup

- The backup participant protocol (`preBackup` / `postRestore`, the
  registrations in `/etc/palm/backup`) follows Open webOS and OSE sources
  (luna-sysservice, luna-sysmgr, db8; Apache-2.0). `compat/rootfs/etc/palm/backup/com.webos.service.systemservice.backupRegistration.json`
  is luna-sysservice's file, unchanged, and `compat/rootfs/etc/palm/sysservice-backupkeys.json`
  is its key list with Phoenix's keys added. The coordinator, the file
  format and the WebDAV client are original. The tests use WsgiDAV
  (MIT) as a WebDAV server; it is not shipped.

## Marketplace

- The Marketplace's app, its service (`apps/marketplace`) and the catalog
  service (`server/marketplace`, PHP) are original code. The App Catalog's
  layout is reproduced from screenshots, not its code or art; the icon (a
  bag, as the App Catalog's was, without HP's logo) is drawn in `art/app-icons`.
- The OSE installer API (`com.webos.appInstallService`) and the `.ipk`
  format (ar + tar, opkg control fields) follow OSE sources and opkg's
  documentation; the Ed25519, MD5 and SHA code is written from RFC 8032,
  RFC 1321 and FIPS 180-4.
- **Curated web apps** (`server/marketplace/catalog/curated-*.json`): the
  sites' names, descriptions and icons come from each site's own web app
  manifest, which a site publishes so it can be installed; the app opens the
  site itself. Phoenix lists them without asking first and removes a site
  that opts out (the opt-out list in the catalog service, decision of
  1 October 2026). Names and logos remain their owners' trademarks.
- **App Museum II** (webOS Archive): the Marketplace reads its public API
  and downloads packages from its servers, as the App Museum app does. The
  owner is telling the webOS Archive; if they say no, the source is
  removed. It is off until the user switches it on. Each app's own license
  is the developer's.
- **Preware feeds**: read like Preware does; off until switched on.
  Packages keep their own licenses.

## Text Assist (the keyboard)

- The word lists (`shell/qml/Phoenix/Shell/WordsEnUS.js`, `WordsDe.js`,
  `WordsFr.js`: 60,000 words each with their frequencies, and the
  contraction shortcuts) are generated by `tools/gen-textassist-data.py`
  from AOSP LatinIME's `dictionaries/en_US_wordlist.combined.gz`,
  `de_wordlist.combined.gz` and `fr_wordlist.combined.gz` (version 54,
  Apache-2.0, The Android Open Source Project; each checked by its SHA-256),
  credited in NOTICE. Words LatinIME flags as offensive,
  babytalk or non-words are never suggested.
- The prediction, correction and swipe matching (`TextAssist.js`), the
  candidate bar and dictation are original code. Swipe matching follows the
  published SHARK2 method (Kristensson and Zhai, 2004); no code from it.
  keyboard-efigs's XT9 engine was licensed and never released, and nothing
  of it is used.
- Dictation runs whisper.cpp (MIT) through the transcriber service Voice
  Memos uses (see Speech recognition below).

## System updates

- `com.palm.update`'s API (GetStatus and its statuses, InstallLater,
  InstallNow, AlertDisplayed) is read from luna-systemui's sources
  (`data/SysUpdateService.js`, `app/SysUpdateAlerts`; Apache-2.0), which
  call it. Palm's update daemon itself was not released; the service is
  original code.
- RAUC (LGPL-2.1) is a separate program on the device; the service calls its
  command line and does not link it.

## Firmware and drivers

The owner's decision of October 2026: as much hardware as possible works
out of the box, as on Ubuntu and Debian. The rules that follow from it:

1. **Open source drivers are in the system image.** The Linux kernel's
   drivers (GPL-2.0) are built as modules and shipped with the kernel,
   whose source has to be offered with the image as the GPL requires (OE's
   archiver class can collect it).
2. **Firmware whose licence allows redistribution is in the image too**,
   open source or not (most of `linux-firmware`: Realtek, Intel, Qualcomm,
   MediaTek, Broadcom/Cypress, AMD, NVIDIA, Marvell), as OE packages it from
   the upstream `linux-firmware` repository: **unmodified, with its licence
   files** (each firmware package depends on its `linux-firmware-*-license`
   package, installed with it in `/lib/firmware`). Machine firmware from
   `meta-raspberrypi` likewise. A build may compress the files losslessly
   (`PHOENIX_FIRMWARE_COMPRESS`, off by default), as Fedora and Arch ship
   them; the kernel gets the same bytes back, and the licence files stay as
   they are. The image build checks every firmware
   package's licence against an allow-list of licences that permit
   redistribution and fails otherwise (`phoenix-firmware-policy.bbclass`,
   `PHOENIX_FIRMWARE_LICENSES`); adding a licence to it needs a note here.
3. **The licences can be read on the device**: Settings > Device Info > Open
   source licenses lists each firmware package with its licence and shows
   the licence files (`/usr/share/phoenix/firmware/licences.json`, written
   when the image is built).
4. **The Hardware app fills the gaps** (firmware not in the image, newer
   firmware, out-of-tree drivers, optional extras), only with what may be
   redistributed: the catalog tool refuses an entry whose licence does not
   say so (`redistributable: true`) or whose non-free licence text is
   missing, and the device ignores such entries too. What is not open
   source is installed only **after the user accepts its licence**, shown in
   full with its name and source first.
5. **Newer firmware is passed on unmodified as well**, installed beside the
   image's (`/lib/firmware/updates`).
6. **What may not be redistributed is not shipped, hosted or fetched by
   Phoenix.** For such hardware, firmware is taken from the user's own
   device (an Android vendor partition, at install time), never shipped
   (HARDWARE.md, "Reverse engineering").
7. **Out-of-tree drivers** (`meta-phoenix` `rtl8812au`, `rtl8814au`) are
   GPL-2.0, built from their upstream sources, and offered separately, not
   in the image. A service in the catalog is reviewed by a person first
   (DRIVERS.md).
8. **Other driver catalogs** (Developer Mode only) are their makers'
   responsibility; Phoenix shows them as not its own.

`meta-raspberrypi`'s BCM43456 firmware (`Synaptics-rpidistro`) allows
redistribution under a licence Synaptics can withdraw (the
`synaptics-killswitch` licence flag, which OSE's `webos.conf` accepts); it is
on the allow-list until the owner decides otherwise.

The driver catalog is signed with its own Ed25519 key, held offline by the
owner and pinned in the image (the Marketplace's code; see Marketplace
above). The opt-in hardware report sends only device IDs (HARDWARE.md, "The
anonymous hardware report") and the catalog service keeps them with the day
only.

The service, the Hardware pane, the catalog tool and the packaging are
original code. The sample catalog's packages (`server/drivers/sample`) hold
placeholder text, not firmware, and its licence texts are summaries that
point to the real ones. The Hardware icon (a circuit board) is a new
drawing (`art/app-icons/objects/hardwarepane.svg`). Device names and IDs in
the simulator's hardware are the vendors' public PCI and USB IDs; `1209:0001`
is pid.codes' test ID.

## VPN

- **luneos-vpn-adapter** (<https://github.com/webOS-ports/luneos-vpn-adapter>,
  Apache-2.0, Copyright (c) 2026 Herman van Hazendonk) is the VPN service
  Phoenix uses on a device (`com.webos.service.vpn` over ConnMan's
  `connman-vpnd`). Settings > VPN codes against its API; the simulator
  reimplements that API in `runtime/phoenix-runtime.js` and copies, verbatim,
  its provider table (`src/vpn_providers.c`) and form field descriptors
  (`files/formfields/*.json`) from commit 40bdda2, credited in NOTICE.
- The status bar's VPN icon (`vpn-status-icon.png`) is Open webOS art like
  the rest of `shell/assets/openwebos/statusBar`; its @2x and @3x copies are
  upscaled by `tools/hidpi-art.py`.

## Certificate Manager

- `runtime/certs/*.pem` are six public root CA certificates (ISRG Root X1
  and X2, DigiCert Global Root G2, GTS Root R1, Amazon Root CA 1, USERTrust
  RSA Certification Authority) as their authorities publish them and as the
  Mozilla CA list (Debian's `ca-certificates`) ships them: public keys and
  names, the simulator's stand-in for a device's system store.
- `apps/media-samples/media/documents/phoenix-lab-root-ca.crt` is a
  fictional CA made for Phoenix with openssl (its key was thrown away),
  CC0 like the other demo documents.

## The browser's content blocker and search icon

- `runtime/content-blocker/hosts.txt`, the content blocker's list (Browser
  > Preferences > Block Ads & Trackers), was written for Phoenix from the
  names of well-known advertising and tracking services, Apache-2.0 like
  our code. No list was copied: the popular community lists (EasyList,
  AdGuard's, Disconnect's) are GPL or CC BY-SA, which Phoenix does not ship.
- `runtime/search-icons/search-icon-web.svg`, Just Type's and the
  browser's icon for DuckDuckGo, Bing, Startpage and a custom engine, was
  drawn for Phoenix (Apache-2.0). Those engines' own logos are their
  trademarks and are not shipped.

## Map data (OpenStreetMap)

Maps shows, searches and routes on **OpenStreetMap** data, © OpenStreetMap
contributors, available under the **Open Database License (ODbL) 1.0**
(<https://www.openstreetmap.org/copyright>). The vector tiles follow the
**OpenMapTiles** schema (© OpenMapTiles, CC-BY 4.0,
<https://openmaptiles.org/>).

- The demo region shipped with the app (`apps/maps/public/regions/sample`,
  downtown San Jose, 15 tiles) was downloaded from **OpenFreeMap**
  (<https://openfreemap.org/>) by `apps/maps/tools/fetch-sample-region.cjs`.
  It is a Produced Work of the OpenStreetMap database; the ODbL asks that
  it keep the attribution above, which the app shows and this file records.
  Tests (`tools/test-maps.cjs`, `apps/maps/src/lib/offline.test.ts`) use
  the same tiles.
- `tools/fixtures/maps` holds replies recorded from Photon, Valhalla's
  FOSSGIS server and Overpass on 9 October 2026 for
  `tools/test-assistant-maps.cjs`: OpenStreetMap data (© OpenStreetMap
  contributors, ODbL), a test fixture, not shipped in the image.
- The label glyphs (`apps/maps/public/fonts`) are **Noto Sans**, SIL Open
  Font License 1.1, rendered to MapLibre's glyph format by OpenFreeMap.
- Attribution on screen: the map always shows "© OpenStreetMap
  contributors · © OpenMapTiles" (plus the tile provider), never hidden
  behind a button, as the OSM Foundation's attribution guidelines and the
  providers' terms ask; About Maps lists every source and service.
- Online services by default: tiles from OpenFreeMap (MIT-licensed
  software, free public instance, no key, commercial use allowed); search
  from Photon by komoot (fair use); directions from Valhalla on the FOSSGIS
  server (fair use, the app identifies itself with `X-Client-Id`). All are
  configurable. Their data is OpenStreetMap's, under the ODbL. Maps never
  uses tile.openstreetmap.org, whose tile usage policy does not allow apps'
  heavy use or offline downloads. See [MAPS.md](MAPS.md).
- A user's saved offline areas are copies of provider tiles on the device
  for their own use; a user who shares such a copy must keep the ODbL
  attribution.

## Speech recognition (whisper.cpp)

Voice Memos' transcription service (`apps/voicememos/service`) runs
**whisper.cpp** (<https://github.com/ggml-org/whisper.cpp>) as a separate
program, `whisper-cli`; no whisper.cpp code is in this repository.
whisper.cpp and ggml are MIT-licensed. The `meta-phoenix` recipe
(`recipes-support/whisper-cpp`) builds it from source and ships its
`LICENSE` with the package, as the MIT license asks; on Linux
`scripts/linux-setup.sh` builds the same commit for the simulator.

The models are OpenAI's **Whisper** weights, released under the MIT license
(<https://github.com/openai/whisper>, including the model card), converted to
ggml's format by the whisper.cpp authors and published at
<https://huggingface.co/ggerganov/whisper.cpp>. The default,
`ggml-base.en.bin`, is not in this repository (`tools/get-whisper-model.py`
fetches it for the simulator). `webos-phoenix-image` includes it
(`whisper-cpp-model-base-en`) with OpenAI's MIT notice beside it
(`/usr/share/whisper/LICENSE.openai-whisper`, from openai/whisper). Other models (for instance
fine-tuned ones found elsewhere) may have other licenses: check before
shipping one.

`ffmpeg`, which the service uses to convert audio that is not WAV, is LGPL
or GPL depending on how it is built and is only called as a program. The app
records WAV, so it is optional.

## The Assistant's language models and speech

The Assistant (`apps/assistant`) runs **llama.cpp**
(<https://github.com/ggml-org/llama.cpp>, MIT) as a separate program,
`llama-server`; no llama.cpp code is in this repository. The `meta-phoenix`
recipe (`recipes-support/llama-cpp`, release b11239) builds it from source
without OpenSSL or the downloaded web UI, and ships llama.cpp's `LICENSE`;
`scripts/linux-setup.sh` builds the same release for the simulator,
Homebrew's `llama.cpp` on a Mac.

One model is built in: **Qwen3 0.6B**, **Apache-2.0**, the Qwen team's
own GGUF (Qwen/Qwen3-0.6B-GGUF, Q8_0, its `LICENSE` and model card,
checked 9 October 2026, pinned revision). Not in the repository:
`tools/get-base-model.py` fetches it for the simulator, SHA-256 checked;
the image ships it (meta-phoenix's `qwen3-0.6b-gguf`) with Qwen's
`LICENSE` beside it (`/usr/share/phoenix/models`). The other on-device
models are downloaded by the user, never shipped: Qwen3 1.7B, 4B, 8B, 14B
and 30B-A3B, the Qwen team's own GGUFs, each **Apache-2.0** (its
repository's `LICENSE` and model card: Qwen/Qwen3-1.7B-GGUF,
Qwen/Qwen3-4B-GGUF, Qwen/Qwen3-8B-GGUF, Qwen/Qwen3-14B-GGUF,
Qwen/Qwen3-30B-A3B-GGUF; checked 9 October 2026). Left out on purpose: Llama 3.2 (Llama 3.2 Community License, not
permissive) and Qwen2.5 3B (Qwen Research License). An image that ships a
model must carry its licence.

The voice is **Kitten TTS** (9 October 2026), all of it permissive and
none of it GPL:

- `phoenix-tts` (`services/tts`) is Phoenix's own code, Apache-2.0. It
  includes ONNX Runtime's C API header (`services/tts/vendor/onnxruntime/
  onnxruntime_c_api.h`, v1.16.3, unchanged, **MIT**, Microsoft; its
  LICENSE beside it) and follows KittenML's Python code (Apache-2.0) for
  the symbol table, the trimming and the inputs, written anew in C++.
- The model, **KittenML's kitten-tts-nano-0.2**: its weights
  (`kitten_tts_nano_v0_2.onnx`), its eight voices (`voices.npz`) and
  config are **Apache-2.0** per the Hugging Face model card (`license:
  apache-2.0`, checked 9 October 2026); the code repository,
  github.com/KittenML/KittenTTS, is Apache-2.0 too (its LICENSE). The
  model repository has no LICENSE file, so the image carries OE's
  Apache-2.0 text. Not in this repository: `tools/get-kitten.py` fetches
  it, SHA-256 checked, at a pinned revision; meta-phoenix's
  `kitten-tts-nano` ships it.
- **ONNX Runtime** (Microsoft, **MIT**; its ThirdPartyNotices.txt lists
  what is built in, all permissive), loaded at run time, never linked:
  Microsoft's own Linux build, fetched by `tools/get-kitten.py` and
  shipped by meta-phoenix's prebuilt `onnxruntime` with its notices;
  Homebrew's `onnxruntime` on a Mac.
- **The CMU Pronouncing Dictionary** (Carnegie Mellon University,
  **BSD-2-Clause**, its LICENSE shipped beside it), which `phoenix-tts`
  turns into phonemes with rules of our own.

Kitten was trained on phonemes from **espeak-ng (GPL-3.0)**, and KittenML's
own code calls espeak-ng's library through the GPL-3.0 `phonemizer`
package. Linking either into `phoenix-tts` would make it GPL-3.0, so it
does not: by default it makes the phonemes itself from the CMU dictionary
(no espeak-ng code or data; espeak-ng's output was only compared against,
to measure: docs/AI-AND-MCP.md, Speech), and with `--phonemizer espeak`
it runs the espeak-ng program as a separate program, text in and IPA out,
which is aggregation, not a derived work. The image does not ship
espeak-ng unless the image maker adds it (below).

When Kitten cannot speak, the programs before it do:

a speech program, run as a separate program and
only called, never linked; Phoenix's code stays Apache-2.0. On the device
image it is **Flite** (CMU, BSD-3-Clause, meta-multimedia's `flite`), so the
image stays permissive. In the simulator it is **espeak-ng** (GPL-3.0) on
Linux, which `scripts/linux-setup.sh` installs from Ubuntu, or `say` on a
Mac. espeak-ng may go into an image only as its own package with its
licence and source offer (`PHOENIX_TTS` in local.conf; meta-oe has the
older eSpeak 1.48, also GPL-3.0); note that GPL-3.0 also asks whoever
ships it on a device with a locked bootloader to give users a way to
install a changed version (its "Installation Information"), so it is the
image maker's decision. Piper does not avoid this: its phonemizer is
espeak-ng's library, also in the original MIT `rhasspy/piper`. Other
engines can be configured (`--speech-command`).

Cloud providers (Anthropic, OpenAI, Google, OpenAI-compatible servers) are
used only with the user's own key, under the provider's terms; nothing of
theirs is in the repository.

## Fonts

Legacy webOS used **Prelude**, which was made for Palm and is not openly
licensed. Phoenix asks for "Prelude" first, so a user who owns it can install
it, and otherwise falls back to open fonts. Choosing or commissioning an
open-licensed look-alike is an open task.

## Name and trademarks

"webOS" is a trademark of LG Electronics. "Palm", "Pre", "TouchPad" and
related marks belong to their owners. We use them only to describe
compatibility and history. If the project is published or distributed widely,
consider a name that doesn't include "webOS" (for example "Phoenix, a shell
for webOS OSE"). Naming ideas and the risks found so far (Pre and Pixi are Palm
product names) are in [BRANDING.md](BRANDING.md).

## Code from other projects

- webOS OSE / Open webOS (Apache-2.0): fine to reuse with attribution.
- LuneOS repositories use several licenses, including GPL-3.0 for some
  components. Don't copy their code into the Apache-2.0 parts of this
  repository. Reading them for reference is fine.
- Closed-source homebrew (Preware apps such as Internalz Pro): reimplement the
  behaviour from its visible features only, without its code or artwork, and
  record it here (see Files above).
