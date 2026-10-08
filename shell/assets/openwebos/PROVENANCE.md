# Provenance

Copied unmodified from `openwebos/luna-sysmgr` `images/` at commit
`1393f0af5dd8d9f0e9cc79627f4acb226f8c8d45` (Apache-2.0).
Removed: `hp-logo.png`, `hp-logo-bright.png` (trademarks) and `normal-usb.png`,
`fsck-usb.png` (pictures of the TouchPad hardware).
See `docs/LEGAL.md` and `NOTICE` at the repository root.

## HiDPI variants (`*@1.5x.png`, `*@2x.png`, `*@3x.png`)

Larger copies of the art above, which the shell draws on dense screens
(`docs/spec/hidpi-art.md`). The 1x files are unchanged. `tools/hidpi-art.json`
lists every one; `tools/hidpi-art.py` makes them and checks them (`--check`,
in CI).

Originals, copied unmodified (Apache-2.0):

| Variant | From |
| --- | --- |
| `spinner@1.5x.png` | `enyojs/enyo-1.0` `framework/source/palm/themes/Onyx/images-1.5/spinner.png` (commit `52886009e73b665a94a65c5a66b5f285d2cf321d`), the 1.5x of the identical Onyx `images/spinner.png` |
| `loading-glow@1.5x.png` | `openwebos/luna-sysmgr` `platform/topaz/images/loading-glow.png` (commit above) |
| `menu-dropdown-bg@1.5x.png` | `enyojs/enyo-1.0` `framework/source/palm/themes/Onyx/images-1.5/appmenu.png`, the 1.5x of Onyx `images/appmenu.png`, the same art as `menu-dropdown-bg.png` |

No other piece has a larger original in luna-sysmgr (`platform/*/images`),
luna-systemui or Enyo 1.0 (Onyx `images-1.5`), searched by size and by
picture.

Enlarged (modified versions of the Apache-2.0 art above, under the same
license): every other `@2x` / `@3x` file. Every picture above has both;
Open webOS ships them at 1x only. `tools/hidpi-art.json` says which way each
was made:

- `model`: icons, glyphs and pictures (status bar, system menu and lock
  screen icons and digits, launcher and quick launch buttons, the PIN pad's
  grid and delete key, keyboard glyphs, activity spinners and sprites,
  warning and notification pictures, the dock mode clock's hands and dots;
  `spinner@2x` / `@3x` from `spinner@1.5x.png`). Each was enlarged 4x by
  Real-ESRGAN (`RealESRGAN_x4plus.pth`, xinntao/Real-ESRGAN release v0.1.0,
  sha256 `4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1`,
  BSD-3-Clause; run with spandrel and PyTorch on the CPU): colour bled into
  the transparent pixels first, alpha enlarged by the same model, sprite
  sheets one cell at a time; three rounds of back-projection onto the 1x
  art; Lanczos down to 2x and 3x. The model is a tool only: neither it nor
  its code is in this repository.
- `smooth`: gradients, shadows, glows, masks, scrims, backgrounds, panels,
  buttons and key tiles (`card-shadow-tile`, `scrim`, `loading-bg`,
  `popup-bg`, `menu-*`, `pin/button-*`, `keyboard-*/key-*`,
  `launcher3/tab-*`, `dockmode/time/clock_bg`...; `menu-dropdown-bg@2x` /
  `@3x` and `loading-glow@2x` / `@3x` from their 1.5x originals): bicubic
  on premultiplied colour, then five rounds of back-projection onto the 1x
  art, no model.

Not used: LuneOS's larger versions of some of this art
(`webOS-ports/luna-next-cardshell`), whose origin is not recorded.

## Phoenix keyboard art

`keyboard-phone/key-charcoal.png` is a modified version of
`keyboard-phone/key-gray.png` above (Apache-2.0): its face and rim recoloured
to charcoal, the rest unchanged; `key-charcoal@2x.png` and `@3x` the same of
`key-gray@2x.png` and `@3x`. `tools/keyboard-charcoal.py` makes them and
checks them (`--check`, in CI).

The black tablet keyboard (Settings > Text Assist > Keyboard style) adds no
art: it draws the phone's `keyboard-phone/` images above (`key-white.png`,
`key-charcoal.png`, `keyboard-bg.png` and their @2x / @3x), 9-tiled into the
tablet's keys; the TouchPad style on a phone draws `keyboard-tablet/`'s in
the phone's keys.

## Phoenix system screens art

Drawn for Phoenix (Apache-2.0, like the rest of the repository) by
`tools/draw-system-art.py`, at 1x, 2x and 3x from the same shapes, in place
of the pictures removed above; `--check` (in CI) makes sure they are up to
date:

- `boot-logo.png`, `boot-logo-bright.png` (200 x 200): the boot animation's
  logo and its lit state, where luna-sysmgr drew `hp-logo.png` /
  `hp-logo-bright.png` (`BootupAnimation.cpp`, `ProgressAnimation.cpp`). A
  Phoenix mark, three flames rising from a dark disc; no HP or Palm logo.
- `msm-usb.png`, `msm-fsck-usb.png` (768 x 768): USB drive mode and the check
  of the drive after it was pulled out, where luna-sysmgr drew
  `normal-usb.png` / `fsck-usb.png` (`TopLevelWindowManager.cpp`,
  `ProgressAnimation.cpp`). A plain device with the USB symbol, not the
  TouchPad.
