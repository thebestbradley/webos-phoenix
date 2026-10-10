# compat

`rootfs/` is laid out like a webOS device filesystem and is layered over
everything else in `runtime/rootfs.json`: a file at
`compat/rootfs/usr/palm/applications/com.palm.app.contacts/app/Ringtones.js`
replaces (or supplies) that path for the simulator and the browser dev
server. Use it for fixes and missing files in the original Open webOS apps,
so the `third_party/` submodules stay unmodified. Say at the top of each file
what it fixes and why.

To add a stylesheet or script to an Enyo 1.0 app or library, overlay its
`depends.js` with the original list plus the new file (`phoenix-compat.css`,
`phoenix-phone.js`, ...), and change nothing else in it. Phone layouts are
`@media (max-width: 480px)` rules in those stylesheets. Fixes for the Enyo
libraries shared by several apps go under
`usr/palm/frameworks/enyo/0.10/framework/lib/`. Problems common to all
Enyo apps in current Chromium are fixed in `runtime/phoenix-runtime.js`
instead.

JSON files cannot say why they are here, so they are listed here:

- `rootfs/usr/palm/frameworks/tellurium/tellurium_config.json`: empty.
  Enyo 1.0 asks for it at start-up (`source/palm/tellurium/startup.js`)
  and loads Tellurium, HP's test automation nub, only when it has
  something in it. Retail devices never had the file (Tellurium came with
  test builds), and the request failed quietly there; Chromium throws on a
  synchronous request for a missing file, and every Enyo 1.0 app logged
  "enyo.xhr.request() exception". Empty, it reads as on a retail device:
  no Tellurium.

- `rootfs/etc/palm/backup/com.webos.service.systemservice.backupRegistration.json`:
  luna-sysservice's backup registration (`files/conf/`, Apache-2.0),
  unchanged. On a device luna-sysservice installs it; the simulator's
  backup service reads it from here (apps/settings/service).
- `rootfs/etc/palm/sysservice-backupkeys.json`: the system preferences
  luna-sysservice backs up. Its own list (`files/conf/`) has the first six
  keys; Phoenix adds the time format, the tones, the screen and lock
  settings, accessibility and the emergency information. The wallpaper is
  left out: it is usually a picture on the USB drive, which a backup does
  not hold.

Sounds cannot say why they are here either:

- `rootfs/usr/palm/applications/com.palm.app.email/sounds/emailreceived.mp3`:
  Email's new-mail sound (`source/DashboardManager.js:419`), Phoenix's own,
  synthesized by `tools/make-feedback-sounds.py` (CC0 1.0). The original's
  ID3 tags name another copyright holder, so it is not shipped
  (`docs/LEGAL.md`, `shell/assets/sounds/PROVENANCE.md`); this one takes its
  place.

Pictures cannot say why they are here either:

- `*@2x.*`, `*@3x.*` under `rootfs/usr/palm/applications/<id>/`,
  `rootfs/usr/palm/frameworks/` (Enyo 1.0, Onyx for Enyo 2, the contacts
  framework), `rootfs/usr/palm/public/accounts/` and
  `rootfs/usr/lib/luna/system/` (luna-systemui, luna-applauncher): HiDPI
  variants of the original apps', frameworks' and system UI's pictures, at
  the device path each picture is served at, beside which a device installs
  them. They are made from larger originals in the same Apache-2.0
  repositories where one exists (Enyo's `images-1.5` art, the contacts
  framework's `1.5/` art, an app's 256 px icon for its smaller copies),
  else from the 1x art: modified versions under the same license, made by
  `tools/hidpi-art.py`
  (Real-ESRGAN `RealESRGAN_x4plus`, BSD-3-Clause, used as a tool and not
  shipped, or plain resampling); `tools/hidpi-art.json` says which for each
  picture. luna-systemui's are at both its paths: its system UI pages run
  from `/usr/palm/applications/com.palm.systemui/`, its file picker and
  some dashboards name `/usr/lib/luna/system/luna-systemui/`. So are
  luna-applauncher's: Just Type runs as `com.palm.launcher`, and its search
  providers name their icons under `/usr/lib/luna/system/luna-applauncher/`.
- The stylesheets beside them (`enyo-build.css`, the apps' and libraries'
  `*.css`) are copies of the originals that ask for those variants with
  image sets, which `tools/hidpi-art.py` writes (each says so at its top)
  and checks (`--check`). See `docs/spec/hidpi-art.md`.
