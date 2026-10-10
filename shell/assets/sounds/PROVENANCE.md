# Provenance

## `openwebos/`: Open webOS system sounds (Apache-2.0)

Copied unmodified from the `sounds/` directory of Open webOS luna-sysmgr
(<https://github.com/openwebos/luna-sysmgr>, `master` at 1393f0a). The files
were added in HP's first public commit, cd579bc "Release luna-sysmgr 2.0.4
to the public" (Roger Stringer, Palm, 2012-07-25), and no later commit
touches them. From that commit on, the repository's README says all content
"except otherwise noted" is Copyright Hewlett-Packard (later LG Electronics)
and licensed under the Apache License 2.0; nothing in the repository notes
otherwise for the sounds. On the device they live in `/usr/palm/sounds`
(LunaSysMgr `Settings::lunaSystemSoundsPath`), where `runtime/rootfs.json`
mounts this folder.

| File | Length | Metadata | Played by (original) |
|---|---|---|---|
| `alert.wav` | 3.0 s | Pro Tools BWF, 2009-04-07, region "Banner_01" | default alert tone (`defaultPreferences.txt`, `BannerMessageHandler.cpp:73`) |
| `notification.wav` | 1.0 s | Pro Tools BWF, 2009-04-07, region "Pop_Up_12" | default notification tone |
| `phone.wav` | 5.6 s | none | ringtone of last resort (`Settings.cpp:105`, `AlertWindow.cpp:223-225`) |
| `ringtone.mp3` | 13.1 s | LAME, no tags | the ringtone luna-sysservice's examples add (`RingtonePrefsHandler.cpp:153`) |
| `boot.mp3` | 4.1 s | LAME 3.98, no tags | end of boot (`WindowServer.cpp:1246`) |
| `shutdown.mp3` | 4.1 s | LAME 3.98, no tags | power off (no caller in the released sources; LuneOS plays it) |
| `charging.mp3` | 3.1 s | LAME 3.98, no tags | "Charging Battery" banner (luna-systemui `PowerdService.js:138`) |
| `battery_full.mp3` | 3.1 s | LAME 3.98, no tags | battery reaches 100 % (`StatusBarBattery.cpp:218`) |
| `battery_low.mp3` | 0.7 s | LAME 3.98, no tags | meant for the Low Battery alert, but luna-systemui passes it as the window's params rather than its attributes (`PowerdService.js:78`), so LunaSysMgr played the notification tone; nothing else plays it |
| `error.mp3` | 1.1 s | LAME 3.98, no tags | no caller in the released sources |
| `panel.mp3` | 0.4 s | LAME 3.98, no tags | no caller in the released sources |
| `tap_to_share.mp3` | 0.7 s | LAME 3.98, no tags | no caller in the released sources (Touch to Share's service was not released); Phoenix plays it as an app's data is sent (`SoundPolicy.js` "taptoshare") |

The files carry no copyright or author tags of their own (the WAVs' only
metadata is Pro Tools' broadcast-wave chunk; the MP3s have no ID3 tags).
Residual risk: we cannot tell whether HP held the rights to relicense
sounds it may have commissioned; there is no evidence either way. See
`docs/LEGAL.md`.

SHA-256:

```
f9f350e3a514196d43be34b12f097ed57ae338a75d31dd87f2116360d5c0234a  alert.wav
d311c67ba372325c4cd0db244da0ca9f8c390d56df7cc0b5f4c697ba0b235fa0  battery_full.mp3
cd4576f03cf7d79f45c2e7c89cd8cf462658d3e9922fd195685da043e440dabf  battery_low.mp3
11694b74c34609a964be110233dabeaf5d17e81a74e96ce896c43adae10613b6  boot.mp3
b142bbc56c4646abf64376b28d2fae498982ec0c5e9a3539ccf1da014dda91dc  charging.mp3
9b5b04bf8f5a525dcf198bd2ac16768eba5ff4815c2bfa559ed73b3e60406f4f  error.mp3
fa900c20320ec7b5d6a3fd10f29e20807afcd8051eb907be5f1fc4f0f1f58695  notification.wav
06c359b2da0f5683b9d8c6242691077cb72e5b5bf1df5ea5468d9f94eba6eae7  panel.mp3
fd650ad4747e172bf10af12d48391bfbe3351e7b2fcb1dc8b20f6d373174a681  phone.wav
6dadba7752ebed803301b836159f21873164d10c8c3e081d0d7347f8306ea7a9  ringtone.mp3
630e4a47e3d461cc2c516289035a663248a1af3eb72690d38ac15ec332b988ff  shutdown.mp3
3c1317ecb2ba52758b8198f52f1ededacab301538dc112592fbd69abdbe9c0b7  tap_to_share.mp3
```

## `phoenix/feedback/`: Phoenix feedback sounds (CC0 1.0)

LunaSysMgr asked audiod for feedback sounds by name
(`SoundPlayerPool::playFeedback`): the virtual keyboard's `key`, `space`,
`backspace` and `return` (`SysmgrIMEDataInterface.cpp:199-205`),
`appclose` when a card is thrown away (`CardWindowManager.cpp:2893`) and
`shutter` for a screen capture (`WindowServer.cpp:1552`,
`Settings.cpp:107`).
audiod's sound set was not in the open-source release, so these are
mimics made for Phoenix: short clicks (a damped sine at 2.3, 1.5, 1.1 and
0.8 kHz over a burst of filtered noise) and a soft whoosh (noise through a
sweeping low-pass filter); the shutter is two clicks 70 ms apart. They are synthesized by
`tools/make-feedback-sounds.py` (NumPy, seeded noise; nothing sampled or
downloaded), 44.1 kHz mono 16-bit WAV, and dedicated to the public domain
(CC0 1.0). `python3 tools/make-feedback-sounds.py --check` confirms the
files match the script. On the device they live in
`/usr/share/phoenix/sounds/feedback`. `listen.wav`, the assistant's chime
when it hears "Hey Phoenix" (webOS had none), is made the same way: two
soft bell notes up (E6, A6).

Made the same way (CC0 1.0, nothing sampled or downloaded), for the other
names LunaSysMgr asked audiod for:

| File | What it is | Played by (original) |
|---|---|---|
| `carddrag.wav` | a rubber band's creak: a buzzy tone rising 140 to 330 Hz, 0.4 s | the angry card stretched past 15 % of the screen, upside down (`CardWindowManager.cpp:1280-1283, 1523-1527`) |
| `birdappclose.wav` | a whistle sliding up from 600 Hz to 2 kHz over a rush of air, 0.6 s | the angry card let go, upside down, instead of `appclose` (`:2890-2893`) |
| `LauncherOpenApp.wav`, `LauncherCloseApp.wav` | a short breath of filtered noise, brightening / darkening, 0.18 / 0.16 s | the launcher shown / hidden (`SystemUiController.cpp:760-768`) |

## `phoenix/ringtones/` and the compat overlay: Phoenix tones (CC0 1.0)

Two tones the original apps name by path, whose files were never released
or cannot be shipped, are synthesized by the same script (bell-like notes:
a few sine partials with a fast attack and an exponential decay) and
encoded as MP3 (LAME through ffmpeg, 128 kbit/s, no tags). CC0 1.0.

| File | What it is | Played by |
|---|---|---|
| `phoenix/ringtones/Flurry.mp3` (`/media/internal/ringtones/Flurry.mp3`) | a flurry of marimba-like notes, a pentatonic run down and up in C, four bars, 6.4 s | the Clock's default alarm (`com.palm.app.clock` `utility/alarm.js:368`, `alarmdbmanager.js:100`); the Pre's own `Flurry.mp3` was never open-sourced |
| `compat/rootfs/usr/palm/applications/com.palm.app.email/sounds/emailreceived.mp3` | three quick bell notes up (G5, C6, E6) and a held G6, 1.2 s | Email's new-mail sound (`source/DashboardManager.js:419`), in place of the original (see below) |

`python3 tools/make-feedback-sounds.py --check` decodes them and compares
them with what the script renders.

## Not shipped

- The original `com.palm.app.email/sounds/emailreceived.mp3` (Open webOS
  core-apps, in the `third_party/core-apps` submodule): its ID3 tags name a
  copyright holder ("@ Peter Steinbach", WCOP frame) and an album ("Top 500
  Rock and Roll Songs"), which contradicts the repository's blanket LG /
  Apache-2.0 statement. The compat overlay puts Phoenix's own (above) at
  its path, and overlays win over the submodule in the simulator, the dev
  server and `tools/install-rootfs.py`, so the original is never served or
  installed.
- The Pre's ringtones (`Pre.mp3`, the original `Flurry.mp3`, ...) and
  audiod's feedback set: never open-sourced.
