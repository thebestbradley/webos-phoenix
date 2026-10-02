# Provenance

Copied unmodified from `openwebos/luna-sysmgr` `images/` at commit
`1393f0af5dd8d9f0e9cc79627f4acb226f8c8d45` (Apache-2.0).
Removed: `hp-logo.png`, `hp-logo-bright.png` (trademarks) and `normal-usb.png`,
`fsck-usb.png` (pictures of the TouchPad hardware).
See `docs/LEGAL.md` and `NOTICE` at the repository root.

## HiDPI variants (`*@1.5x.png`, `*@2x.png`, `*@3x.png`)

Larger copies of some of the art above, which the shell draws on dense screens
(`docs/spec/hidpi-art.md`). The 1x files are unchanged. `tools/hidpi-art.json`
lists every one; `tools/hidpi-art.py` makes them and checks them (`--check`,
in CI).

Originals, copied unmodified (Apache-2.0):

| Variant | From |
| --- | --- |
| `spinner@1.5x.png` | `enyojs/enyo-1.0` `framework/source/palm/themes/Onyx/images-1.5/spinner.png` (commit `52886009e73b665a94a65c5a66b5f285d2cf321d`), the 1.5x of the identical Onyx `images/spinner.png` |
| `loading-glow@1.5x.png` | `openwebos/luna-sysmgr` `platform/topaz/images/loading-glow.png` (commit above) |
| `menu-dropdown-bg@1.5x.png` | `enyojs/enyo-1.0` `framework/source/palm/themes/Onyx/images-1.5/appmenu.png`, the 1.5x of Onyx `images/appmenu.png`, the same art as `menu-dropdown-bg.png` |

Upscaled (modified versions of the Apache-2.0 art above, under the same
license): every other `@2x` / `@3x` file (status bar and system menu icons,
lock screen digits and padlock / incoming call, `menu-arrow-*`, `search-pill`,
`launcher3/` buttons, touch feedback and search field, `pin/icon-delete`,
`keyboard-*/icon-*`, and `spinner@2x` / `@3x` from `spinner@1.5x.png`).
Open webOS ships them at 1x only. Each was enlarged 4x by Real-ESRGAN
(`RealESRGAN_x4plus.pth`, xinntao/Real-ESRGAN release v0.1.0, sha256
`4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1`,
BSD-3-Clause; run with spandrel and PyTorch on the CPU): colour bled into the
transparent pixels first, alpha enlarged by the same model, sprite sheets
(`quicklaunch-button-launcher`, `edit-button-delete`) one cell at a time;
three rounds of back-projection onto the 1x art; Lanczos down to 2x and 3x.
The model is a tool only: neither it nor its code is in this repository.

Not used: LuneOS's larger versions of some of this art
(`webOS-ports/luna-next-cardshell`), whose origin is not recorded.

## Phoenix keyboard art

`keyboard-phone/key-charcoal.png` is a modified version of
`keyboard-phone/key-gray.png` above (Apache-2.0): its face and rim recoloured
to charcoal, the rest unchanged. `tools/keyboard-charcoal.py` makes it and
checks it (`--check`, in CI).
