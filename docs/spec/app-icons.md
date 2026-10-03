# App icons

Launcher icons follow the Open webOS core apps: the app's object, drawn as a
lit, glossy thing, rests on a **platter**. User apps lie on the **glass
disc** (Calculator, Calendar, Email, Memos, ...); system apps stand on the
**grey diamond** (Accounts). Phoenix draws its own apps' icons the same way
so the launcher reads as one set.

## The originals

Shown as released (Apache-2.0): Calculator, Calendar, Clock, Contacts,
Email, Memos and Accounts (`openwebos/core-apps`) and Web
(`isis-project/isis-browser`). They ship 64 px (`icon.png`) and 256 px
(`icon-256x256.png`, their `splashicon`). For dense screens
`tools/upscale-app-icons.py` makes a 512 px `icon-512x512.png` from the
256 px one (Real-ESRGAN, back-projected so it scales down to the original
exactly; sharper than Lanczos on outlines and fine lines, with no artefacts
on gradients) into the compat overlay,
`compat/rootfs/usr/palm/applications/<id>/`, as the submodules are never
changed. On a device the overlay lands beside the icon; the simulator passes
it as the app's large icon (`shell/sim/rootfs.cpp`). No 128 px file: the
256 px one decoded at 128 is as good.

## Classification

User app (disc): something a person opens to do or see something.
System app (diamond): it sets up or looks after the device, or is part of the
system rather than an app one goes to (as Palm put its preference apps,
Accounts among them, on the diamond).

| Disc (user apps) | Diamond (system apps) |
| --- | --- |
| Phone, Messaging, Camera, Photos, Music, Videos, Podcasts, Maps, Weather, Tasks, Voice Memos, Agenda | Settings and its 17 launch points (Wi-Fi, Bluetooth, VPN, Airplane Mode, Screen & Lock, Exhibition, Sounds & Ringtones, Date & Time, Language & Region, Text Assist, Location Services, Emergency Info, Accessibility, Device Info, Backup, Updates, Developer Mode) |
| Doc View, PDF View, Files, Passwords, Authenticator, Flashlight, QR Scanner | Accounts (original), First Use, Help |
| Marketplace | Share (the share sheet and save picker), Screenshot |
| The Notes demos (Enact Agate, Enact Limestone, Flutter, Ionic), Enyo 2 Demo | Notification Lab, Terminal (developer tools) |
| Calculator, Calendar, Clock, Contacts, Email, Memos, Web (originals) | CardDAV & CalDAV (a sync service; hidden, its icon shows in notifications) |

Decisions:

- **Files** is a user app: people open it to find their documents, like
  Photos. The system's own file dialogs (the save picker) belong to Share.
- **Marketplace** is a user app, as Palm's App Catalog was (a shopping bag on
  the disc); the bag here carries a star instead of HP's logo.
- **Help** and **Updates** are system apps, as on webOS (Updates is a Settings
  launch point).
- **Terminal** and **Notification Lab** are developer tools, so system apps.
- **The framework demos** are the same Notes app built with Enact, Flutter
  and Ionic, and an Enyo 2 sample. They check that apps of other frameworks
  run; their pages keep their frameworks' look, but nothing asks their icons
  to, so they are user apps on the disc like any other: a notebook whose
  cover colour and letter tell them apart, and Enyo's puzzle pieces.

## Style

All sizes are in the 256-unit square the sources are drawn in (4 units are
1 px of the 64 px icon).

- **Light** from above, a little to the left: faces lighter at the top,
  a white gloss over the upper part of glossy things, outlines a darker shade
  of the object's colour, 2–3 units (thinner lines vanish at 64 px).
- **Disc** (`art/app-icons/platters/disc.svg`): centred, radius 112.5. White,
  42 % opaque at the top, about 39 % to a third of the way down, 15 % at the
  middle, 6 % at the bottom; a brighter rim on the lower sides; a soft black
  halo about 13 units wide outside it. Measured on the originals.
- **Object on the disc**: about as big as the disc, 180–230 units across, so
  it overhangs it here and there (the originals' Calculator, Email, Memos);
  its centre near the disc's. It casts a soft shadow on the disc, 5 units
  down (`c-drop`, added by the renderer). Seen from the front, or a little
  from above where a thickness helps (a pad's pages, a case's edge).
- **Diamond** (`art/app-icons/platters/diamond.svg`): a slab of dark slate
  glass seen from the front and above. Top face: back (128, 34), right
  (242, 124), front (128, 226), left (14, 124): the near half taller than the
  far one. Lighter at the back, a sheen over the far half, a pale bevel on
  the two near edges, 8 units of near-black edge below them, a soft shadow.
- **Object on the diamond**: stands upright, its foot at y = 172–178 near
  the slab's middle, up to about 140 units wide and 150 tall. It has a
  thickness seen from above (its top edge), a dark contact shadow where it
  touches the glass and a faint reflection in it; the renderer adds both from
  `base` (where the foot meets the glass) and `foot` (half its width there)
  in `icons.json`.
- **Colour**: each app keeps the colour people know it by (Phone silver,
  Messaging teal and cream, Music and Videos the originals' smoky teal glass).
  Text only where it is the object's point (PDF), drawn as strokes, not with
  a font, so it renders the same everywhere.
- **Where Palm's art exists, follow it.** Open webOS released small
  versions of some icons Palm never released at full size; the objects
  are drawn after them (see `art/app-icons/PROVENANCE.md`).

## Files

```
art/app-icons/
  platters/disc.svg, platters/diamond.svg   the shared platters
  common.svg                                shared filters and gradients (url(#c-...))
  objects/<name>.svg                        each app's object, 256 units square
  icons.json                                name -> platter, outputs, base/foot
  rendered.json                             hashes for --check (written by the renderer)
  PROVENANCE.md
art/icons-previous/<appId>/                 the icons before October 2026, not installed
```

An object file is a plain SVG (`viewBox="0 0 256 256"`) holding only the
object. Its ids are its own (the renderer prefixes them); it may use the
shared definitions in `common.svg` (`c-lift`, the small shadow of a part lying
on another; `c-chrome`, `c-paper`, `c-gloss`).

## Rendering

```
node tools/render-app-icons.cjs              # all of them
node tools/render-app-icons.cjs phone wifi   # some
node tools/render-app-icons.cjs --svg DIR    # also write the composed SVGs
node tools/render-app-icons.cjs --check      # CI: fail if a PNG is out of date
```

For each icon and each `out` path it writes `icon.png` (64 px, the
appinfo.json `icon`), `icon-128x128.png`, `icon-256x256.png` (the
`splashicon`) and `icon-512x512.png`. Each size is drawn four times as big in
Chromium (Playwright, the same one the app tests use) and halved twice, so
blurs and thin lines look the same at every size. `--check` needs no browser:
it compares the hash of each icon's composed SVG and of each PNG with
`rendered.json`, so it fails when a source changed without a redraw or a PNG
was edited by hand.

`python3 tools/upscale-app-icons.py --model RealESRGAN_x4plus.pth` remakes
the originals' 512 px icons; `--check` checks each is there, 512 px, and
scales down to its original.

## Adding an icon

1. Decide disc or diamond (above).
2. Draw `art/app-icons/objects/<name>.svg`; look at a neighbour of the same
   kind for scale. For a diamond object, keep its foot at y ≈ 176.
3. Add it to `icons.json`: `platter`, `out` (e.g. `apps/<app>/public/icon`
   or a launch point's `apps/<app>/public/icons/<name>`), and for the diamond
   `base` and `foot`.
4. `node tools/render-app-icons.cjs <name>`; look at it at 64 px beside the
   others on the launcher background (Calculator and Accounts are the
   references) and at 2x.
5. In `appinfo.json`: `"icon": "icon.png"`, `"splashicon": "icon-256x256.png"`,
   `"largeIcon": "icon-128x128.png"`, `"extraLargeIcon": "icon-512x512.png"`.
   The shell finds the sizes beside the icon by their names
   (`Theme.appIcon`, [hidpi-art.md](hidpi-art.md)); naming them makes
   packagers that copy only what `appinfo.json` names (Enact's) ship them.
   A launch point names only its 64 px `icons/<name>.png`.
6. Record where the object comes from in `art/app-icons/PROVENANCE.md`.

Never use Palm or HP icons that were not in an open-source release (Phone,
Photos & Videos, App Catalog, the preference apps at full size, ...), nor
logos; see [LEGAL.md](../LEGAL.md).
