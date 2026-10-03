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

Pictures cannot say why they are here either:

- `rootfs/usr/lib/luna/system/luna-systemui/images/*@2x.png`, `*@3x.png`:
  HiDPI variants of luna-systemui's own `images/` (Apache-2.0), beside which
  a device installs them; `stylesheets/phoenix-hidpi.css` asks for them.
  `tools/hidpi-art.py` writes both and checks them (`--check`); see
  `docs/spec/hidpi-art.md`.
