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

Three more ways, for the web pages' art below: `downscale` from a larger
drawing of the same picture elsewhere in the repository (`source`: an app's
256 px icon for its 48 px copies); `pixel`, each pixel a square, for a
pattern drawn a pixel at a time (Calendar's half-hour hatch), which
smoothing turns grey and the model loses; and `model` or `smooth` from a
larger drawing (`source`: Enyo's `images-1.5` art, the contacts framework's
`1.5/` art) where it is exactly 1.5 times the 1x art and within 5 of it.
Sprite sheets are enlarged and resized a cell at a time (`tiles`, or `split`
at their clear rows where the cells are not all the same size), so no cell
bleeds into the next; art that
is tiled is resampled as tiled (`wrap`). Byte-identical pictures share their
variants (`copy`). A JPEG's variants are JPEGs, an animated GIF's are
animated GIFs (each frame enlarged, the edge where it is half covered), and
an opaque palette PNG's (the browser's start page, a dithered grey
gradient) are palette PNGs.

To add art: add it to `tools/hidpi-art.json` (`original` with its source path
when Open webOS / Enyo has it larger, else `upscale` with the method that
suits it), run `tools/hidpi-art.py --missing --ref <checkouts> --model
RealESRGAN_x4plus.pth`, look at the results beside the 1x art (at 3x and
more: grain, halos, seams), draw it as above, and record it in
`shell/assets/openwebos/PROVENANCE.md` (the shell's) or `compat/README.md`
(the original apps').

## Web pages' art

The shell zooms a web view by `Theme.u`, which Chromium reports as the
page's device pixel ratio (on a Retina Mac the window's ratio is 2 as well),
so a page picks its own art: CSS from `-webkit-image-set()` (the prefixed
form, which the simulator's Chromium has), an `<img>` from `srcset`. Sizes,
background positions and `border-image` slices stay in the 1x art's pixels.

- **Phoenix apps** (`apps/shared/phoenix-ui/assets`: the Enyo Heritage art,
  the dial pad, Wi-Fi icons, the contacts avatar). Each has `@2x` and `@3x`
  beside it (and `@1.5x` where Enyo's Onyx theme has it: `appmenu`,
  `appmenu-highlight`, `menuitem-arrow`; the avatar's `@2x` is Enyo's own
  100 px drawing). The kit's stylesheets and the apps' own ask for them
  with `-webkit-image-set()`; `tools/hidpi-art.py --check` fails on a
  `url()` of such art outside one. Pictures the apps use from script come
  from `icons` / `phoneArt` with `srcSet(url)` for an `<img>` and
  `cssImage(url)` for a background (`art(x1, x2, x3)` registers an app's
  own picture: Messaging's presence dots). `PageHeader`'s icon, and the
  Settings list's, is a 64 px app icon with its 128 and 256 px sizes beside
  it (`tools/render-app-icons.cjs` draws Phoenix's; Voice Dial's, luna-sysmgr's
  64 px original, gets them from `tools/upscale-app-icons.py`), given as a
  `srcset` (`iconSrcSet`); a unit test checks that every icon an app gives
  `PageHeader` has them. The DAV and XMPP accounts' icons
  (`apps/dav/public/accounts`, `runtime/accounts`) and Notification Lab's
  divider have `@2x` and `@3x` beside them, which the accounts' pages get
  from `phoenix-runtime.js` (below).
- **The original apps, frameworks and system UI** in `third_party/`: the
  seven Open webOS core apps, the Isis browser, Just Type
  (`luna-applauncher`), luna-systemui (alerts, dashboards, banners, the file
  picker), Enyo 1.0 (its build: the Onyx theme, the dashboard window; the
  libraries the apps load: accounts, addressing, authlib, contactsui,
  networkalerts, printdialog, syncui, systemui), the contacts framework
  (`loadable-frameworks`), the account templates (`app-services`: the Palm
  profile and the mail accounts) and Onyx for Enyo 2. The submodules
  stay as they are. Each is a set in `tools/hidpi-art.json` with the device
  paths it is served at (`devices`, checked against `runtime/rootfs.json`);
  the variants are in the compat overlay at each, where a device installs
  them beside the originals.

  Which art needs variants was established by loading every page the
  system shows (each app, its other windows: Email's compose, viewer and
  account wizard, Calendar's reminder, Clock's alarm, the contacts picker,
  Enyo's dashboard window and network alerts; Just Type, the system UI)
  and taking every picture they load, every picture a stylesheet they
  load names (its `url()` resolved as the browser does) and every picture
  their scripts name. Pictures nothing reaches are listed as skipped with
  that reason, so a picture a page starts to use fails `--check` until it
  is covered. Some of those are named only by broken paths in the
  originals (authlib's `styles.css` names `lib/images/`), which no browser
  loads either.
  - **Stylesheets** (`rewrite-css`): the overlay has a copy of each
    stylesheet that names art with variants, every such `url()` an image set
    of them, written and checked by `tools/hidpi-art.py` (the copy says so
    at its top). A copy in place of the original, not a stylesheet loaded
    after it: the cascade stays exactly the original's. (Repeating the
    framework's rules in a stylesheet loaded last would undo the pages'
    own: Just Type restyles `.enyo-button` and `.enyo-radiobutton` with the
    same selectors.)
  - **Enyo's 1.5x art.** `enyo-build.css` switches to `images-1.5/` art in
    `@media (-webkit-min-device-pixel-ratio: 1.5)` blocks, with slices and
    sizes for that art, which is not always 1.5 times the 1x art (74x54 for
    50x36, its radio button bands 55 px for 37). Those rules stay as Enyo
    wrote them, so ratios from 1.5 to 2 draw what Enyo drew; after each such
    block the copy repeats, for `(-webkit-min-device-pixel-ratio: 2)`, the
    same selectors' 1x rules with image sets (and `background-size: auto`
    where the 1.5 rule set a size for its own art), so 2x and 3x screens get
    `@2x` and `@3x` drawn as the 1x art is. Where the 1.5x art is exactly 1.5
    times the 1x art and true to it (within 5), it is the source of the
    `@2x` and `@3x` (`source`).
  - **Pictures named from script** (an `<img>`'s `src`, an inline
    background: Enyo's `Image`, `IconButton` and `ToolButton`, the apps'
    templates): `phoenix-runtime.js` gives each `<img>` whose picture has
    variants a `srcset`, and each inline background or border image an image
    set, as the page sets them (a MutationObserver). `runtime/hidpi-art.json`
    (written and checked by `tools/hidpi-art.py`, loaded once a page names a
    picture) lists the art with variants by device directory. A page's own
    `srcset` or image set is left alone.
  - **Apps' icons in pages** (Just Type's results, Settings' Just Type and
    Exhibition panes): `runtime/hidpi-art.json` also lists every app's
    icons (appinfo.json's `icon` and its launch points') with the bigger
    sizes beside them as the shell finds them (`icon-256x256.png`, also in
    the compat overlay), each with its factor over the icon (4 for a 64 px
    icon's 256 px one), so the runtime gives those an image set or srcset
    too.
  - **Pictures the shell draws** for a page (dashboard and banner icons
    named by path, e.g. `notification-small-*.png`): the shell finds their
    variants the same way as its own: `HiDpi.addTwinDirectory` tells it, in
    the simulator, that the overlay's directory at a mount's or an app's
    device path is installed with the repository's (`Rootfs::twinDirectories`).
  - luna-systemui is served at two paths: its pages (`com.palm.systemui`)
    run from `/usr/palm/applications/com.palm.systemui/`, while Enyo's file
    picker and the sync dashboards name
    `/usr/lib/luna/system/luna-systemui/`; its variants and stylesheet copies
    are at both. So is Just Type: its page runs as `com.palm.launcher`, and
    its search providers name their icons under
    `/usr/lib/luna/system/luna-applauncher/images/`.

  `node tools/test-hidpi.cjs` (in CI) loads the original apps and their
  other windows, Just Type, the file picker, Enyo's dashboard window and
  the Enyo 2 demo in headless Chromium at ratios 2 and 3 and fails on any
  1x picture with variants they load, or on Enyo's 1.5x art. It also
  parses each stylesheet copy beside its original and fails on a rule the
  copy lost (a byte order mark left after the copy's header once made
  Chromium drop Calculator's first rule; `tools/hidpi-art.py` reads the
  originals without it).

Left at 1x, each with its reason in `tools/hidpi-art.json`: third parties'
logos (Amazon, Bing, CNN, Facebook, Google, IMDb, LinkedIn, Outlook,
Twitter, Wikipedia, Yahoo, HP's App Catalog bag, the Accounts icon with
Facebook's, Google's and Yahoo!'s logos, as released; trademarks are not
licensed by Apache-2.0, section 6), pictures of products (the HP TouchPad,
the Pre's battery door with the Palm logo), photographs and sample content
(the first-use dial pad's sky, the apps' mock data, Email's spawn test page,
a sample photo, Settings' wallpapers), the apps' icons themselves (the shell
draws their 256 and 512 px files; see below), Calendar's dated launcher
icons (the shell does not show `updateLaunchPointIcon`), Enyo's own 1.5x
art (drawn as Enyo wrote it at ratios from 1.5 to 2), transparent pixels,
and pictures no page reaches. Not loaded by anything: Enyo's Heritage theme
and its debug sources (`source/`), the Enyo 1.0 libraries no app loads
(captiveportal, palmstyle, telephony, wifi; the Phoenix apps have their own
copies of the telephony and Wi-Fi art), Enyo 1.0 at
`/usr/palm/frameworks/enyo/1.0/` (every page names `0.10`), Onyx's samples
and designer art and Enyo 2's Layout samples (not installed with the
library's pages).

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
