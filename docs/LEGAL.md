# Licensing and assets

Not legal advice. This page records what we reuse and why we believe it is
allowed, so contributors can keep it that way.

## Our code

Everything in this repository is Apache-2.0 (see `LICENSE`), the same license
as webOS OSE and Open webOS.

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
in the submodule (we do not modify submodules) but `runtime/rootfs.json`
excludes it, so neither the simulator nor `tools/install-rootfs.py` serves
or installs it; Email's new-mail sound falls back to the alert tone.

The Pre's own ringtones (`Pre.mp3`, the Clock's `Flurry.mp3`) and audiod's
feedback sounds (keyboard clicks, `appclose`, `shutter`) were not released.
Phoenix synthesizes its own feedback sounds (`shell/assets/sounds/phoenix/`,
`tools/make-feedback-sounds.py`, CC0 1.0; see its `PROVENANCE.md`); nothing
was downloaded.

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

## Original apps and frameworks (`third_party/`)

Git submodules of the Open webOS repositories (`openwebos/core-apps`,
`app-services`, `foundation-frameworks`, `loadable-frameworks`, `mojoloader`,
`underscore`, `luna-applauncher`, `luna-systemui`), HP's Isis browser
(`isis-project/isis-browser`) and `enyojs/enyo-1.0`, all Apache-2.0 and
unmodified. Their app icons (Email, Calendar, Memos, ...) are
part of that release and are shown in the launcher; on dense screens the
shell draws the 256 px `icon-256x256.png` each app ships as its
`splashicon`. Fixes go in
`compat/rootfs/`, not in the submodules.

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
- Settings launcher icons (`apps/settings/public/icons`) are drawn by
  `apps/settings/tools/render-icons.cjs`, and the wallpapers are generated by
  `apps/settings/tools/make-wallpapers.py` (CC0). Palm's preference-app icons,
  wallpapers and ringtones were not open-sourced.
- Camera, Photos and Music icons are drawn by `apps/photos/tools/render-icons.cjs`
  (original). Every Phoenix app's render script writes its icon at 64 px
  (`icon.png`) and 256 px (`icon-256x256.png`, its `splashicon`) from the same
  SVG. `apps/shared/phoenix-ui/assets/openwebos/fullscreen-play-button.png`
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
  launcher icon is drawn by `apps/files/tools/render-icon.cjs`, the list icons
  and glyphs are simple SVG drawn for Phoenix, and the rest is the Enyo 1.0
  art above.
- Tasks (`apps/tasks`) is a new app after the idea of the webOS 1.x Tasks
  app, which Palm never open-sourced; nothing was taken from it. Its db8
  kinds are defined by Phoenix. The launcher icon is drawn by
  `apps/tasks/tools/render-icon.cjs` (original); the rest is the Enyo 1.0
  art above.

- Voice Memos (`apps/voicememos`) is a new app in the style of the webOS 2.x
  Voice Memos (which was never open-sourced; no code or artwork from it). The
  launcher icon is drawn by `apps/voicememos/tools/render-icon.cjs`. The two
  demo memos (`apps/voicememos/public/samples`) are synthetic speech made by
  `apps/voicememos/tools/make-samples.cjs` with eSpeak NG from scripts we
  wrote; dedicated to the public domain (CC0 1.0). eSpeak NG itself
  (GPL-3.0) is only a tool used to make them and is not shipped.

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
  the ones it bundles under Device Info > Open source licenses.

## Speech recognition (whisper.cpp)

Voice Memos' transcription service (`apps/voicememos/service`) runs
**whisper.cpp** (<https://github.com/ggml-org/whisper.cpp>) as a separate
program, `whisper-cli`; no whisper.cpp code is in this repository.
whisper.cpp and ggml are MIT-licensed. The `meta-phoenix` recipe stub
(`recipes-support/whisper-cpp`) would build it from source and ship its
`LICENSE` with the package, as the MIT license asks.

The models are OpenAI's **Whisper** weights, released under the MIT license
(<https://github.com/openai/whisper>, including the model card), converted to
ggml's format by the whisper.cpp authors and published at
<https://huggingface.co/ggerganov/whisper.cpp>. The default,
`ggml-base.en.bin`, is not in this repository; an image that includes it
should carry OpenAI's MIT notice with it. Other models (for instance
fine-tuned ones found elsewhere) may have other licenses: check before
shipping one.

`ffmpeg`, which the service uses to convert audio that is not WAV, is LGPL
or GPL depending on how it is built and is only called as a program. The app
records WAV, so it is optional.

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
for webOS OSE").

## Code from other projects

- webOS OSE / Open webOS (Apache-2.0): fine to reuse with attribution.
- LuneOS repositories use several licenses, including GPL-3.0 for some
  components. Don't copy their code into the Apache-2.0 parts of this
  repository. Reading them for reference is fine.
- Closed-source homebrew (Preware apps such as Internalz Pro): reimplement the
  behaviour from its visible features only, without its code or artwork, and
  record it here (see Files above).
