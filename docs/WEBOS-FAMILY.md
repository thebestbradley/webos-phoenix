# The webOS family, and where Phoenix fits

Written 29 September 2026 for the owner's question: is Phoenix the same
thing as webOS Community Edition or LuneOS, and should we have started from
one of them? The detailed LuneOS comparison is in [LUNEOS.md](LUNEOS.md).

## The systems

| | Base | Interface | Runs on |
| --- | --- | --- | --- |
| **Palm/HP webOS 1.x-3.0.5** (2009-2011) | Palm's own Linux distribution, 2.6-series kernel, closed drivers | LunaSysMgr (Qt 4 and the 2011 WebKit); Mojo and Enyo 1 apps | Pre, Pre 2, Pre 3, Veer, TouchPad |
| **Open webOS** (HP, 2012) | Most of the 3.x user space released as open source (Apache-2.0) | The same 3.x code: luna-sysmgr, luna-systemui, core-apps, Enyo | Nothing ready for daily use |
| **webOS Community Edition 3.1** (webOS Archive, September 2026) | HP's own 3.0.5 TouchPad firmware, repacked and patched | The original, with the LunaCE launcher | HP TouchPad only (Wi-Fi and 4G builds) |
| **webOS OSE** (LG, 2018 on) | Modern Linux built with Yocto, Qt 6, Wayland, a Chromium-based web runtime; descends from Open webOS's services | TV and kiosk UI; no phone UI, no telephony | Raspberry Pi, an emulator image; portable |
| **LuneOS** (WebOS Ports, 2014 on) | Open webOS continued, since 2024 on OSE's components, with its own newer Chromium, Qt and Yocto | Its own card shell, a reimplementation in the webOS style (GPL-3.0) | About 30 device configurations, about 8 in the September 2026 test images: Pixels, BlackBerry KEY2, PinePhone family, the TouchPad and others |
| **webOS Phoenix** | webOS OSE | The original phone and tablet UI, ported rule by rule from luna-sysmgr's source (Apache-2.0), plus new apps | The simulator today; devices planned ([HARDWARE.md](HARDWARE.md)) |

The old hardware stack and today's are unrelated: a TouchPad's drivers live
in a 2011 kernel with Qualcomm's closed user space, and none of it carries
over to a current phone. OSE-based systems (LuneOS, Phoenix) get drivers from
mainline Linux or from Android's drivers through Halium.

## webOS Community Edition

[webOS CE 3.1.0](https://github.com/webOSArchive/webOS-Community-Edition/releases/tag/3.1.0-CE-Release)
(3 September 2026) is a Doctor image that rebuilds HP's webOS 3.0.5 for the
TouchPad with the community's work of the last 14 years:

- UberKernel 3.0.5-93 (Bluetooth gamepads and mice, USB OTG).
- OpenSSL 1.1.1w for the browser, the apps' WebKit, downloads and Mail, and
  Mozilla's current root certificates, so HTTPS works again.
- Mail for modern Exchange servers; Maps on OpenStreetMap tiles; Backup
  rewritten to local storage.
- Synergy IM on a modernised libpurple 2.14.
- A community App Catalog (6.1) with archived and new apps; Preware 1.9.19
  preinstalled with its feeds.
- LunaCE, a launcher with app groups, tabs and gestures.

Its notes list what it lacks: no over-the-air updates yet, no account
manager after setup, no rollback short of reflashing. It is the original
system on the original device, and cannot move to other hardware.

**Phoenix is not the same thing.** CE keeps existing TouchPads alive;
Phoenix brings the same experience to hardware sold today, on a base that
gets security updates and a current web engine. Starting from CE would have
meant starting from HP's closed TouchPad binaries, a 2011 browser engine and
one 32-bit device with 1 GB of RAM: a dead end for new hardware. What CE
builds on that was open (luna-sysmgr's behaviour, the art, the core apps,
Enyo, luna-systemui) Phoenix uses too.

**What Phoenix can take from CE:**

- Its community App Catalog back end and Preware feeds are what the store's
  "Classics" phase needs ([APP-STORE.md](APP-STORE.md), A2).
- Its libpurple work for Synergy IM, to compare with
  [SYNERGY-MODERN.md](SYNERGY-MODERN.md).
- LunaCE's launcher ideas (app groups, gestures) for the 2.0 revamp.
- Its users: the fans 1.x is for.

## LuneOS

LuneOS is the closest relative: the same OSE components underneath, and a
card shell on top. The difference:

- **LuneOS is a platform**: device ports, services, a newer web runtime.
  Its shell is its own design in the webOS style, GPL-3.0.
- **Phoenix is, so far, a shell and apps**: an exact port of the original
  UI with a simulator and tests, the original apps running on a
  compatibility layer, and new Apache-2.0 apps. LuneOS has none of that and
  is not building it.

Phoenix has not yet built any device platform, so no work duplicates
theirs. The plan in [LUNEOS.md](LUNEOS.md#9-recommendation) stands: build
Phoenix's device images on LuneOS's Yocto layers (no permission needed to
build with them), keep Phoenix's own shell, apps and distribution, and stay
an independent project, as the owner decided on 28 September 2026. Their
shell could not have been the starting point either way: it is not the
original UI, and as GPL-3.0 it cannot be copied into Apache-2.0 Phoenix.

**Hardware limits.** LuneOS runs where its device layers run: about eight
phones and tablets in current test images, more with older or less tested
configurations. Using their layers gives Phoenix that same list on day one;
reaching further is the device work in
[HARDWARE.md](HARDWARE.md#install-it-like-a-linux-distro).
