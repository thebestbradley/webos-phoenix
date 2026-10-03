# HiDPI art

The shell lays out in legacy pixels and multiplies by `Theme.u`, the
screen's density (1.0 on a Pre or TouchPad, 1.5 on a Pre 3, 2–3 on a
modern phone; `phoenix-sim --scale`). The Open webOS art is drawn for 1.0,
so on a dense screen the shell draws larger art when there is some. Qt's own
`@2x` lookup follows the window's devicePixelRatio, which stays 1 here, so
`Phoenix.Native.HiDpi` (`shell/native/hidpi.cpp`) does the choosing.

## Shell art (`shell/assets/openwebos`)

Every picture in `shell/assets/openwebos` has `name@2x.png` and `name@3x.png`
beside `name.png`: the same picture with 2 or 3 times the pixels. A few
also have `name@1.5x.png`, an original Open webOS or Enyo shipped at 1.5x.
`Phoenix.Native.HiDpi` would also take `@4x`.

- `Theme.asset(path)` gives the smallest variant at least `Theme.u`, else the
  largest there is, else the 1x file. At `Theme.u === 1` it is always the 1x
  file, so 1.0 draws exactly what it always did.
- Size an image from its art with `Theme.artWidth(source)` and
  `Theme.artHeight(source)`, which read the file's own size and divide by its
  variant factor, or give it a fixed size in legacy pixels (`Theme.px`).
  Never from `sourceSize` or the implicit size: on a screen whose device
  pixel ratio is above 1 (a Retina Mac, a HiDPI laptop), Qt loads
  `name@2x.png` in place of `name.png` by itself, so `sourceSize` is the @2x
  file's while the URL still says 1x, and the image comes out twice as big;
  and Qt reads a `@2x` / `@3x` file as having that pixel ratio but a
  `@1.5x` one as 1x.
- Draw a 9-patch with `ArtBorderImage`, not `BorderImage`, its borders in
  the 1x art's pixels through `Theme.artBorder(v, source)`. A BorderImage
  draws its borders as many of its own pixels as they are long, which are
  the 1x art's pixels whatever the file (Qt scales a @2x / @3x file's
  borders itself, `artBorder` a @1.5x file's), not the shell's: at
  `Theme.u` 2 a plain BorderImage's corners would be half their size.
  `ArtBorderImage` lays the BorderImage out `Theme.artDrawScale(source)`
  times smaller and scales it up, so its corners are the art's times
  `Theme.u`; at 1.0 it is a plain BorderImage. (The card's shadow does the
  same by hand.)
- Tile with `ArtTiledImage` (`fillMode: Image.Tile`, `TileHorizontally`,
  `TileVertically`), not `Image`, for the same reason: an Image tiles in its
  own pixels. Each tile comes out the 1x art's size times `Theme.u`, from
  the variant's pixels.
- Art drawn in other pixels (the keyboards: the phone's art is 1.5 legacy
  pixels a pixel) asks `Theme.variant(url, scale)` for its own scale, and
  the keyboard draws it in the art's pixels, scaled as a whole. Clip
  rectangles (`sourceClipRect`) are in the file's own pixels, so the
  keyboard multiplies them by `Theme.artScale(file)`. There is no @1.5x
  keyboard art, which Qt would read as 1x.

`tst_hidpi.qml` checks that every picture the shell's QML names resolves to
an `@2x` file at density 2 and a `@3x` file at 3, and that 9-patches and
tiles come out the size the 1x art does at 1.0 times the density.

### Where the variants come from

In this order:

1. **Larger originals.** Open webOS and Enyo ship a few pieces at 1.5x:
   `spinner@1.5x.png` (Enyo Onyx `images-1.5/spinner.png`), `loading-glow@1.5x.png`
   (luna-sysmgr `platform/topaz/images`), `menu-dropdown-bg@1.5x.png` (Onyx
   `images-1.5/appmenu.png`, the same art). Their @2x and @3x are made from
   them, not from the 1x art. No other larger original exists in
   luna-sysmgr, luna-systemui or Enyo 1.0.
2. **Enlarged**, one of two ways (`method` in `tools/hidpi-art.json`),
   each true to the 1x art: the variant scaled back down to 1x (box filter)
   gives the 1x art again (back-projection), and `--check` makes sure it
   does.
   - `model`: icons, glyphs and pictures (status bar and system menu icons,
     lock screen digits, padlock and incoming call, launcher buttons, the
     PIN pad's grid and delete key, keyboard glyphs, activity spinners,
     warning icons, the dock mode clock's hands). Real-ESRGAN
     (`RealESRGAN_x4plus`) enlarges them 4x, sprite sheets one cell at a
     time; then back-projection and Lanczos to `@2x` and `@3x`. It draws
     sharp edges and lines, but on a smooth gradient it adds grain.
   - `smooth`: gradients, shadows, glows, ripples, masks, scrims, fades,
     dividers and backgrounds (`card-shadow-tile`, `scrim`, `loading-bg`,
     `launcher-bg`, `quicklaunch-bg`, `tab-*`, `menu-dropdown-scrollfade-*`,
     `keyboard-bg`...), and the panels, buttons and key tiles drawn as a
     gradient in an outline (`popup-bg`, `menu-dropdown-bg`, the PIN pad's
     buttons, both keyboards' keys and popups, the slider track, the screen
     corners). Bicubic on premultiplied colour straight to each size, then
     five rounds of back-projection, which keeps the outlines as sharp as
     the 1x art says they are: nothing made up, no grain, no halo. (Taking
     the outline from the model instead was tried: it turned the faint
     1 px rims of these panels into hard lines with a dark halo inside.)
     Art the shell tiles (`launcher-bg`, `quicklaunch-bg`, the tablet's
     status bar) is enlarged as tiled (`wrap`), so the tiles still meet
     without a seam. 9-patch borders keep their place, as every variant
     is an exact multiple of the 1x art.

`keyboard-phone/key-charcoal.png` is not enlarged: `tools/keyboard-charcoal.py`
makes it and its variants from `key-gray.png`'s, the same recolouring at each
size, and checks them (`--check`).

`tools/hidpi-art.json` lists every picture and how its variants are made;
`tools/hidpi-art.py` makes them and, with `--check` (in CI), checks that
every picture in the directory has its variants, each the right size and
true to its 1x art. The 1x files are never changed.

To add art: add it to `tools/hidpi-art.json` (`original` with its source path
when Open webOS / Enyo has it larger, else `upscale` with the method that
suits it), run `tools/hidpi-art.py --missing --ref <checkouts> --model
RealESRGAN_x4plus.pth`, look at the results beside the 1x art (at 3x and
more: grain, halos, seams), draw it as above, and record it in
`shell/assets/openwebos/PROVENANCE.md`.

## Web pages' art

The shell zooms a web view by `Theme.u`, which Chromium reports as the
page's device pixel ratio, so a page picks its own art: CSS from
`-webkit-image-set()` (the prefixed form, which the simulator's Chromium
has), an `<img>` from `srcset`. Sizes, background positions and
`border-image` slices stay in the 1x art's pixels.

- **Phoenix apps** (`apps/shared/phoenix-ui/assets`: the Enyo Heritage art,
  the dial pad, Wi-Fi icons, the contacts avatar). Each has `@2x` and `@3x`
  beside it (and `@1.5x` where Enyo's Onyx theme has it: `appmenu`,
  `appmenu-highlight`, `menuitem-arrow`; the avatar's `@2x` is Enyo's own
  100 px drawing). The kit's stylesheets and the apps' own ask for them
  with `-webkit-image-set()`; `tools/hidpi-art.py --check` fails on a
  `url()` of such art outside one. Pictures the apps use from script come
  from `icons` / `phoneArt` with `srcSet(url)` for an `<img>` and
  `cssImage(url)` for a background.
- **luna-systemui** (its alerts, dashboards and banners). The submodule
  stays as it is: the variants of `images/` are in the compat overlay at the
  same device path (`compat/rootfs/usr/lib/luna/system/luna-systemui/images`),
  where a device installs them beside the originals.
  `stylesheets/phoenix-hidpi.css` there (written by `tools/hidpi-art.py`)
  repeats the original stylesheets' image rules with image sets, and each
  alert page's `depends.js` overlay loads it last. The notification and
  banner icons the system UI names by path (`notification-small-*.png`) are
  drawn by the shell, which finds their variants the same way:
  `HiDpi.addTwinDirectory` tells it, in the simulator, that the overlay's
  directory is installed with the submodule's. Third parties' logos
  (`notification-large-facebook.png` and the like, the App Catalog bag, the
  Palm battery door) and a sample photo stay 1x: trademarks are not
  licensed by Apache-2.0 (section 6).

## App icons

`appinfo.json`'s `icon` is 64 px. Apps ship bigger ones beside it: Open
webOS core apps and Isis name `icon-256x256.png` as `splashicon` (luna-sysmgr
drew it on the loading card), and every Phoenix app does the same. Phoenix's
icons are drawn from SVG by `tools/render-app-icons.cjs` at 64, 128, 256 and
512 px (`icon.png`, `icon-128x128.png`, `icon-256x256.png`,
`icon-512x512.png`); the originals get a 512 px one from
`tools/upscale-app-icons.py` in the compat overlay. See
[app-icons.md](app-icons.md).

`Theme.appIcon(icon, pixels, large)` keeps `icon` while it has at least
`pixels`, else takes the smallest bigger one: `large` (the `splashicon` or
OSE `largeIcon`, `largeIcon` in the app list) and files beside the icon named
`icon-<N>x<N>.png`, `icon-<N>.png` or `icon@<k>x.png`. `AppIcon` and the
loading card use it, and decode any file bigger than the drawn size at that
size (`sourceSize`), so it is scaled down smoothly rather than shrunk by the
scene graph. The drawn size is in the window's pixels: the item's size times
its `pixelRatio` (`Screen.devicePixelRatio`). On a Retina Mac Qt draws
phoenix-sim's window at 2 pixels per point with u 1, so the 64 point launcher
icon covers 128 pixels and comes from the 128 or 256 px file; Qt's own `@2x`
lookup does not find an app's `icon-256x256.png`, and Qt takes a PNG's
`sourceSize` as the file's pixels, not points. At 1.0 the launcher and dock
draw `icon.png` as before;
notifications (22 px), dashboards (32 px) and the drag proxy decode it at their
size; the loading card, which draws the icon half as big again, scales the
256 px icon down instead of the 64 px one up. At 2.0 the launcher draws the
128 px icon, at 3.0 the 256 px one, and the loading card at 3.0 (288 px) the
512 px one.

The originals' 512 px icons live in `compat/rootfs`, not beside their icons
(the submodules are not changed). A device installs them beside the icon; the
simulator, which reads the icon from the app's own folder, gives the biggest
icon the overlay adds as the app's `largeIcon` (`shell/sim/rootfs.cpp`).

Not covered: the original Open webOS apps' own pictures (`third_party/core-apps`,
Enyo 1.0's Heritage theme in those apps, luna-systemui's file picker in
`app/FilePicker`) are the page's to choose; Enyo's Onyx theme picks its
`images-1.5` art by the page's devicePixelRatio.
