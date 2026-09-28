# HiDPI art

The shell lays out in legacy pixels and multiplies by `Theme.u`, the
screen's density (1.0 on a Pre or TouchPad, 1.5 on a Pre 3, 2–3 on a
modern phone; `phoenix-sim --scale`). The Open webOS art is drawn for 1.0,
so on a dense screen the shell draws larger art when there is some. Qt's own
`@2x` lookup follows the window's devicePixelRatio, which stays 1 here, so
`Phoenix.Native.HiDpi` (`shell/native/hidpi.cpp`) does the choosing.

## Shell art (`shell/assets/openwebos`)

Beside `name.png` may be `name@1.5x.png`, `name@2x.png`, `name@3x.png` or
`name@4x.png`: the same picture with 1.5, 2, 3 or 4 times the pixels.

- `Theme.asset(path)` gives the smallest variant at least `Theme.u`, else the
  largest there is, else the 1x file. At `Theme.u === 1` it is always the 1x
  file, so 1.0 draws exactly what it always did.
- A variant's `sourceSize` is k times the art's. Size an image from its art
  with `Theme.artPx(sourceSize.width, source)`, never
  `Theme.px(sourceSize.width)`.
- Give BorderImage borders in the 1x art's pixels through
  `Theme.artBorder(v, source)`. Qt already reads a file named `@<digit>x` as
  having that pixel ratio and scales its borders itself, so this multiplies
  only for `@1.5x` (`HiDpi.borderScale`).
- Art drawn in other pixels (the keyboards, 1.5 legacy pixels each on phones)
  asks `Theme.variant(url, scale)` for its own scale.
- Tiled images (`fillMode: Image.Tile*`, BorderImage `Repeat`) tile at the
  variant's size; none of the tiled art has variants yet.

### Where the variants come from

In this order:

1. **Larger originals.** Open webOS and Enyo ship a few pieces at 1.5x:
   `spinner@1.5x.png` (Enyo Onyx `images-1.5/spinner.png`), `loading-glow@1.5x.png`
   (luna-sysmgr `platform/topaz/images`), `menu-dropdown-bg@1.5x.png` (Onyx
   `images-1.5/appmenu.png`, the same art).
2. **Upscaled** where Open webOS has only 1x: status bar and system menu
   icons, lock screen clock digits and padlock, launcher and quick launch
   buttons, the search pill, the PIN delete key and the keyboard glyphs.
   Real-ESRGAN (`RealESRGAN_x4plus`) enlarges them 4x, back-projection keeps
   them true to the 1x art, and Lanczos takes them to `@2x` and `@3x`.

`tools/hidpi-art.json` lists every variant and how it is made;
`tools/hidpi-art.py` makes them and, with `--check` (in CI), checks each one
exists, has the right size and scales back down to its 1x art. The 1x files
are never changed.

To add variants: add the art to `tools/hidpi-art.json` (`original` with its
source path when Open webOS / Enyo has it larger, else `upscale`), run
`tools/hidpi-art.py --ref <checkouts> --model RealESRGAN_x4plus.pth`, look at
the results beside the 1x art, check that every place that draws it sizes it
with `artPx` / `artBorder` (or a fixed size), and record it in
`shell/assets/openwebos/PROVENANCE.md`.

Left at 1x on purpose: backgrounds, gradients, shadows, masks and scrims (they
scale without looking pixelated), the keyboards' key tiles (the phone's are
already 1.5x art), and the PIN pad's gradient buttons (Real-ESRGAN added grain
to them).

## App icons

`appinfo.json`'s `icon` is 64 px. Apps ship bigger ones: Open webOS core apps
and Isis name `icon-256x256.png` as `splashicon` (luna-sysmgr drew it on the
loading card), and every Phoenix app does the same (its `tools/render-icon*.cjs`
draws the SVG at 64 and 256 px).

`Theme.appIcon(icon, pixels, large)` keeps `icon` while it has at least
`pixels`, else takes the smallest bigger one: `large` (the `splashicon` or
OSE `largeIcon`, `largeIcon` in the app list) and files beside the icon named
`icon-<N>x<N>.png`, `icon-<N>.png` or `icon@<k>x.png`. `AppIcon` and the
loading card use it, and decode the bigger icon at the drawn size
(`sourceSize`) so it is scaled down smoothly. At 1.0 the launcher, dock and
notifications draw `icon.png` as before; the loading card, which draws the
icon half as big again, now scales the 256 px icon down instead of the 64 px
one up.

Not covered: pictures inside web apps (Just Type's results, the apps' own art)
are the page's to choose; Enyo picks its `images-1.5` art by the page's
devicePixelRatio.
