# Provenance of the app icons

Everything in `art/app-icons/` was drawn for Phoenix as SVG in October 2026
and is Apache-2.0 like the rest of the repository. No pixels were copied from
any other icon; where a design follows Palm art that Open webOS released, it
is a new drawing after it, which the Apache License allows as a derivative
work (attribution in `NOTICE`). The PNGs in the apps are rendered from these
sources by `tools/render-app-icons.cjs`.

## Platters

| File | After |
| --- | --- |
| `platters/disc.svg` | the disc of the core apps' icons, measured on `openwebos/core-apps` `com.palm.app.calculator/icon-256x256.png` and `com.palm.app.calendar/images/icon-256x256.png` (Apache-2.0): radius, opacity from top to bottom, rim, halo |
| `platters/diamond.svg` | the diamond of `com.palm.app.accounts/icon-256x256.png` (Apache-2.0): its outline, perspective, colours, bevel and edge |

## Objects drawn after Open webOS art

Open webOS released small pictures of some Palm icons that Palm never
released at full size: the launcher's search results (48 px) and the file
picker's empty folders (120-128 px). These objects follow them:

| Object | After (Apache-2.0, LG Electronics / HP) |
| --- | --- |
| `messaging.svg` | `openwebos/luna-applauncher` `images/messaging-sms.png` |
| `tasks.svg` | `openwebos/luna-applauncher` `images/tasks-list.png` |
| `maps.svg` | `openwebos/luna-applauncher` `images/search-icon-maps.png` |
| `phone.svg` | `openwebos/luna-applauncher` `images/icon-dial.png` (the handset and its sound) |
| `photos.svg` | `openwebos/luna-systemui` `app/FilePicker/images/empty-photo-library.png` |
| `music.svg` | `openwebos/luna-systemui` `app/FilePicker/images/empty-folder-audio.png` |
| `videos.svg` | `openwebos/luna-systemui` `app/FilePicker/images/empty-folder-videos.png` |
| `docview.svg` | `openwebos/luna-systemui` `app/FilePicker/images/empty-folder-other.png` (pages) |
| `updates.svg` | `openwebos/luna-systemui` `images/notification-large-update.png` (the gift box) |
| `dav.svg` | `openwebos/luna-systemui` `images/notification-large-sync.png` (the arrows) |
| `wifi.svg` | `openwebos/luna-systemui` `images/system-notification-wifi-icon.png` (the fan) |
| `enyo2demo.svg` | `enyojs/enyo-1.0` `framework/icon.png` (the puzzle pieces) |

## Objects new to Phoenix

Every other object: `camera`, `podcasts`, `voicememos`, `weather`, `pdfview`,
`passwords`, `authenticator`, `flashlight`, `scanner` (its code is a made-up
pattern), `files`, `marketplace` (a bag with a star where the App Catalog's
had HP's logo), the four `notes-*` notebooks, and the system objects
`settings`, `firstuse`, `help`, `sharesheet`, `screenshot`, `printmanager`, `notificationlab`,
`terminal`, `bluetooth`, `vpn`, `airplane`, `screen`, `sounds`, `datetime`,
`language`, `textassist`, `justtype` (a magnifying glass), `certificates`
(a certificate with a seal), `phoneprefs` (the `deviceinfo` phone with a
call forwarding badge), `location`, `emergency` (the six-armed star of the
Phone app's emergency button), `accessibility`, `deviceinfo`, `backup`,
`devmode`, `agenda` (a bedside agenda card), `exhibition` (a phone on a
Touchstone, the Time exhibition's glass clock on its screen), `clipboard`
(a hardboard clipboard with two clips stacked on it like cards;
`clipboardpane` is the same drawing, smaller, for Settings > Clipboard) and
`assistant` (a frosted speech balloon with a glowing orb in it, its light in
bands like a voice's sound waves; `assistantpane` is the same drawing,
smaller, for Settings > Assistant) and `advancedpane` (Settings > Advanced:
a brushed metal panel with three sliders) and `hardwarepane` (Settings > Hardware: a circuit board with a chip, standing on its gold edge connector).

## The originals' 512 px icons

`compat/rootfs/usr/palm/applications/<id>/icon-512x512.png` (Accounts,
Calculator, Calendar in `images/`, Clock, Contacts, Email, Memos, and Web,
`com.palm.app.browser`) are enlargements of each app's own
`icon-256x256.png` (`openwebos/core-apps`, `isis-project/isis-browser`;
Apache-2.0), made by `tools/upscale-app-icons.py` with Real-ESRGAN
(`RealESRGAN_x4plus`, BSD-3-Clause, used as a tool and not shipped). They are
modified versions of those icons under the same license.

The Accounts icon shows the Facebook, Google and Yahoo! logos, as released;
the logos remain their owners' trademarks (see `docs/LEGAL.md`).
