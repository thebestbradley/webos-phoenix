# Provenance

`enyo/` is copied unmodified from the Enyo 1.0 framework
(`third_party/enyo-1.0`, `enyojs/enyo-1.0` at commit
`52886009e73b665a94a65c5a66b5f285d2cf321d`, Apache-2.0):

- `enyo/*.png` from `framework/source/palm/themes/Heritage/images/` (the
  webOS 1.x/2.x "Heritage" look), except `bg_rowgroup.png` from
  `framework/lib/palmstyle/images/`
- `enyo/wifi/*.png` from `framework/lib/wifi/images/` (Palm's Wi-Fi list UI)
- `enyo/telephony/*.png` from `framework/lib/telephony/dialpad/images/` (the
  webOS dial pad: key grid, dial button, voicemail key, backspace, popup)

`contacts/` is copied unmodified from `openwebos/loadable-frameworks` at commit
`c1b13a97828ca3f76f6e5742a7f25551d4b33efe` (`contacts/images/`, Apache-2.0):
the generic avatar and the favourites star.

`openwebos/screen-lock-incoming-call-*.png` are copies of
`shell/assets/openwebos/` (from `openwebos/luna-sysmgr` `images/`, Apache-2.0).

`openwebos/fullscreen-play-button.png` is copied unmodified from
`shell/assets/openwebos` (`openwebos/luna-sysmgr` `images/`, Apache-2.0).

`enyo/appmenu.png`, `enyo/appmenu-divider.png` and
`enyo/appmenu-highlight.png` are copied unmodified from Enyo 1.0's Onyx
theme (`framework/source/palm/themes/Onyx/images/`, Apache-2.0), for the
app menu (`AppMenu.css`, `AppMenuItem.css`).

No Palm or HP logos are included. See `docs/LEGAL.md` and `NOTICE` at the
repository root.

## HiDPI variants (`*@1.5x.png`, `*@2x.png`, `*@3x.png`)

Larger copies of the art above, which Chromium picks on dense screens
through the stylesheets' `-webkit-image-set()` and `srcSet()`
(`docs/spec/hidpi-art.md`). The 1x files are unchanged.
`tools/hidpi-art.json` (`sets`, `phoenix-ui`) lists every one;
`tools/hidpi-art.py` makes them and checks them (`--check`, in CI).

- Copied unmodified (Apache-2.0) from Enyo 1.0 (commit above), the same
  pictures drawn larger: `enyo/appmenu@1.5x.png`,
  `enyo/appmenu-highlight@1.5x.png` and `enyo/menuitem-arrow@1.5x.png` from
  the Onyx theme's `images-1.5/` (whose `images/` files are identical to
  ours); `contacts/generic-avatar-50x50@2x.png` from
  `framework/lib/contactsui/images/bg_icon_favorite_img.png`, the same
  avatar at 100 px.
- Copies of `shell/assets/openwebos`'s variants (see its `PROVENANCE.md`):
  `enyo/spinner@*` (`activity-indicator-32x32`), `enyo/appmenu-divider@*`
  (`menu-divider`), `openwebos/*@*`.
- Every other `@2x` / `@3x` file is a modified version of the art above
  (Apache-2.0), enlarged as the shell's art is: icons and glyphs by
  Real-ESRGAN with back-projection (`model`), buttons, panels, fields and
  gradients by bicubic resampling with back-projection (`smooth`); the
  avatar's `@3x` and the 1.5x originals' `@2x` / `@3x` from those
  originals.
