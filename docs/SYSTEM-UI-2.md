# Phoenix 2.0's system UI: the shell in Ember Glass

The plan for drawing webOS Phoenix's shell (the card view, the gesture area,
the launcher, notifications, the status bar, the system menu) in **Ember
Glass**, the 2.0 look the owner chose on 11 October 2026 (OPEN-QUESTIONS
Q119). It is a new look, not new behaviour: what the shell does, and every
gesture, stays luna-sysmgr's and luna-systemui's, as 1.0 reproduces them.

- **The look:** `docs/design-2.0/directions/ember-glass/SPEC.md`, its
  `assets/base.css` and `screens/*.html`, and the renders in
  `docs/design-2.0/img/ember-glass/` (the card view: `cards-light.jpg`,
  `cards-dark.jpg`).
- **The UI layer** (what apps are built on): the `ember-glass-ui`
  repository (`docs/design-2.0/BUILD-PLAN.md`); its side of the shell's
  contract is `ember-glass-ui/docs/SHELL-CONTRACT.md`, and its values are
  `tokens/ember-glass.tokens.json`.
- **This branch** (`tbb/system-ui-2`) moves to the 2.0 repository. Until
  then 1.0's look stays the default and every 1.0 test and screenshot is
  unchanged.

## How the look is built

**A switch, not a fork.** `Theme.look` is `"classic"` (1.0, the default)
or `"ember-glass"`; `Theme.emberGlass` says which. Each part of the shell
keeps its 1.0 drawing and adds its Ember Glass drawing beside it, chosen by
`Theme.emberGlass`; behaviour (states, gestures, timings) is shared code.
The look comes from:

| Where | How |
| --- | --- |
| The system preference `look` (`"classic"` or `"ember-glass"`) | Settings > Advanced > Look ("Phoenix 1.0", "Ember Glass (2.0 preview)"); the runtime's `tweaks` (`runtime/phoenix-runtime.js` `tweaks()`) carry it to the shell's `tweak("look")`, which follows at once (owner question 11). On a device the same preference (and `glassBlur`) comes through `Phoenix/Lsm/LsmStatus.js` `tweaks()`, and services/systemmanager's start-up file keeps both, so the shell starts in its look without a frame of 1.0 |
| The simulator, for one run | `phoenix-sim ... -- --look ember-glass` (after `--`: see "Later, with C++") |
| The default | `Shell.tweakDefaults.look`: `"classic"`. **In the 2.0 repository, flipping the default is this one value** |

**The values come from Ember Glass UI's tokens.** `tools/gen-ember-glass-qml.cjs`
reads `tokens/ember-glass.tokens.json` (a copy in `shell/design/`, its
source repository, commit and version recorded in the file it writes) and
writes `shell/qml/Phoenix/Shell/EmberGlass.qml`, a QML singleton: every
token as a property (colours as QML colours with their alpha, gradients as
lists of stops, dimensions in CSS px), the themed ones under
`EmberGlass.light` and `EmberGlass.dark`. `--check` fails when the file
differs from what the tokens give (CI runs it). The Phosphor glyphs the shell
draws come the same way, from `@phosphor-icons/core` (MIT), through
`tools/gen-ember-glass-icons.cjs` into `EmberGlassIcons.js`, drawn by
`EgIcon.qml` (`shell/design/PROVENANCE.md`). The few values the shell needs that
the tokens do not hold (the status bar's and gesture strip's scrims, the
card view's labels, the Just Type pill) are read off `base.css` and
`cards.html` and cited where used; they are proposed for the tokens
(owner question 9).

**Pixels.** The mock-ups' phone is CSS 446 x 994 at 2.5x, the Fairphone 6
(1116 x 2484) at Phoenix's density 2.5: one CSS px of the mock-ups is one
legacy pixel. So a token's px go through `Theme.px()` like every other
measurement, and `phoenix-sim --size 1116x2484 --scale 2.5 --phone` shows
the renders' exact frame.

**Light and dark.** The shell's own surfaces over the wallpaper (status
bar, gesture strip, card labels, Just Type, the dock) are drawn the same in
both, as in the renders; the glass of the shell's sheets (system menu,
dashboard, dialogs) follows the system's theme. 1.0 has no light theme for
the shell: `Theme.egTheme` is `"dark"` until a system preference for the
theme exists (owner question 8).

**Glass in the shell.** Which level each surface is (SPEC.md, "Glass
tokens"), and how the shell draws it in QML:

| Level | In the shell | QML |
| --- | --- | --- |
| L1 (the card) | Each app draws its own from what the shell gives it (the contract below); the shell draws it only for its own card, the loading card | `WallpaperBlur`'s picture under the shell's theme's tone map, positioned as the wallpaper lies under the window, then the tint and the highlight |
| L2 (planes) | Rows inside the system menu and the dashboard | a tint (`Rectangle`), no blur |
| L3 (floats) | Bars things scroll under: the dock, the Just Type pill | `BackdropBlur` at 22 px, the tint |
| L4 (overlays) | The system menu, the dashboard, banners, dialogs, the app menu tab's menu | `BackdropBlur` at 30 px, the tone map, the tint |

## Part by part

### 1. Wallpaper
- **Changes:** the wallpaper lies under the whole screen, the status bar and
  the gesture strip included (base.css `.device > .wall`, `inset: 0`); 1.0
  shows it only above the gesture area. Ember Glass's default wallpaper is
  the phoenix (`apps/settings/public/wallpapers/phoenix.jpg`, Apache-2.0) while
  the user has not chosen one (owner question 3).
- **Stays:** cropped about its centre (`Wallpaper.qml`, the TouchPad's
  square wallpapers).
- **QML:** `Shell.qml` (the `Wallpaper` reaches under the gesture strip),
  `Theme.qml` (`defaultWallpaperPath` by look), `sim.qml` (the shell shows
  its look's default when the system says none is chosen:
  `runtime/phoenix-runtime.js` systemStatus `wallpaperDefault`; the runtime
  gives Settings the same default, from the look the shell tells it).

### 2. The gesture area and its light
- **Changes:** Onyx Reborn's long bar, 118 x 4, radius 2, its ends fading,
  lit gold-white at the centre through gold and ember to nothing
  (`gesture-light.gradient`), its glow a drop shadow that follows the
  gradient's alpha (`gesture-light.glow`, 4 px, `rgb(255 110 40 / .7)`), so
  it fades with the ends; it breathes over 1.6 s (`motion.breathe`) while a
  finger is on the area. The strip under it is a scrim over the wallpaper,
  black 25 % to 55 % (base.css `.gesture`), 22 px tall (`size.gesture-strip`;
  1.0's 20).
- **Stays:** every gesture (`GestureArea.qml`, CoreNaviManager's), the bar lit
  while an app is maximized and dim in card view
  (CoreNaviManager::restoreLightbar; owner question 2), each gesture's own
  light (the waterdrop, the runs left and right; `light(kind)`), the glow
  while held (the meta key).
- **QML:** `GestureArea.qml` (Ember Glass's light beside 1.0's white bar,
  its gradient's stops made from the token, its glow drawn once with
  `Canvas`, whose shadow is CSS's drop-shadow), `Theme.qml`
  (`gestureAreaHeight`).
- **Tokens:** `gesture-light.*`, `motion.breathe`, `size.gesture-strip`.

### 3. The status bar
- **Changes:** a scrim over the wallpaper, black 50 % to 25 % (base.css
  `.statusbar`), 32 px (`size.statusbar`; 1.0's 28); the app's name in the
  app-menu tab (24 px capsule, white 7 %, a 0.38 white hairline, 12.5 px
  semibold, a caret: `.appmenu-tab`); the clock centred, 13.5 px medium; on
  the right the signal and Wi-Fi as Phosphor glyphs (MIT, as the mock-ups'
  `icons.js`) and a 22 x 11 battery cell with the charge (`.sb-batt`); on
  tablets, notification icons with the ember dot (`.sb-notes`: step 10, the
  tablet's group is still 1.0's).
- **Stays:** what it shows and when (the carrier or the app's name,
  StatusBarTitle; the clock; the lock screen's date; the tablet's notification
  group), its taps (the app menu, the system menu), the safe area around a
  camera cutout and rounded corners, full-screen apps hiding it.
- **QML:** `StatusBar.qml` (its Ember Glass drawing beside the art),
  `EgIcon.qml` (Phosphor path data through `QtQuick.Shapes`).
- **Tokens:** `size.statusbar`, `font.family.sans`; the scrim and the tab
  from base.css.

### 4. The card view
- **Changes** (`cards.html`, `cards-*.jpg`):
  - the cards are glass with 30 px corners (`radius.card`, in the window's
    pixels, so they scale with the card), a top highlight and a rim, and the
    glass shadow (`theme.*.shadow.card`: 0 30 60 -24, ember-brown in light,
    black in dark) in place of `card-shadow-tile.png`;
  - a maximized card keeps its corners and the wallpaper shows around it
    (`.card`: top 32, bottom 22, radius 30; owner question 6);
  - each card's glass is the blurred wallpaper as it lies under the window
    when it is maximized, scaled and moved with the card (the mock-ups'
    `html[data-embed] .device > .wall`): the app draws it from what the
    shell gives it (the contract below); an app that is not glass (all of
    today's but the test page, `tools/fixtures/glass-app`) is opaque as in 1.0;
  - the loading card (`CardLoading`) is the shell's own L1 glass: the blur,
    the tone map and the tint, with the app's icon;
  - over the stack in front, its card's title and, for a stack, the number
    of cards, "Messaging · 2 cards" (`.label`: 13 px semibold white, the
    count at 55 % white, 38 px over the card; owner question 7);
  - under the card in front, Ember's light on the floor and an ember rim
    (`.floor`, `.rim`);
  - the dimming of cards that lost focus stays (CardWindow.cpp:211-213).
- **Stays:** the layout (`CardLayout.js`, CardGroup's fans and stacks; the
  side cards are not turned in 3D: owner question 1), the scale, every
  gesture, maximize and minimize, closing, reordering, the modal card.
- **QML:** `Card.qml` (the corners, the shadow, the rim, what the window
  gets), `CardView.qml` (the label, the floor light and rim),
  `CardLoading.qml`, `WallpaperBlur.qml` and `WallpaperBlurWorker.js` (new).
- **Tokens:** `radius.card`, `theme.*.glass.l1.*`, `theme.*.glass.highlight`,
  `theme.*.glass.rim`, `theme.*.shadow.card`, `ember.*`.

### 5. Just Type, the search pill
- **Changes:** a 50 px capsule, `rgb(20 18 20 / .38)` over a 12 px blur, a
  0.3 white hairline and a 12 % top highlight, "Just type, or ask" at 15.5 px,
  the Phosphor magnifying glass, and the Assistant's ember orb at its right
  (`cards.html` `.jt`).
- **Stays:** where it is and when it shows (OverlayWindowManager's search
  pill states), what a tap and typing do.
- **QML:** `SearchPill.qml`; `JustType.qml`'s results sheet as L4.

### 6. The quick launch dock (card view)
- **Changes:** a 64 px capsule, 34 px in from each side, `rgb(20 18 20 / .34)`
  over a 12 px blur, hairline and highlight, the apps spread inside it; the
  launcher button Phosphor's four squares; the app in front marked by a 4 px
  ember dot (`cards.html` `.dock`). The mock-ups draw glyphs for the apps
  too; the apps keep their own icons (owner question 10). Phones; the
  tablet's dock is still 1.0's.
- **Stays:** its items, the launcher button, dragging icons in and out, the
  wave launcher.
- **QML:** `QuickLaunch.qml`.

### 7. The launcher
- **Changes:** the page over the blurred wallpaper (L1 tint, the tone map),
  the tabs as Ember's segmented capsule (`.seg`), labels in the ink steps;
  the app icons unchanged.
- **Stays:** pages and tabs, the grid (launcher3's metrics), editing,
  groups, the icon menu, Remove Application?.
- **QML:** `Launcher.qml`, `LauncherGroup.qml`, `IconMenu.qml`.

### 8. Notifications
- **Changes:** the banner as an L4 sheet (`.banner`: 24 px radius, the
  highlight, `lift-high`); the dashboard's rows as L2 planes in an L4
  sheet; on phones, the notification bar under the dock in card view
  (`cards.html` `.notes`: the first notification's text with the ember dot,
  the others' glyphs at the right); the tablet's drop-down as L4.
- **Stays:** the negative space (phones), the banner's slide and timing,
  the stacks of an app's notifications (Enyo 1.0's layers), swipes to
  dismiss, the drawer, the tablet's drop-down and its 5 1/2 rows.
- **QML:** `Notifications.qml`, `DashboardItem.qml`, `DashboardMenu.qml`,
  `DrawerHeader.qml`, `DrawerHandle.qml`.

### 9. The system menu
- **Changes:** an L4 sheet (`.menu`: radius 4 at the corner it opens from,
  20 elsewhere; the highlight; `lift-high`), 46 px rows with Phosphor
  glyphs, the selected row marked by the ember bar (`.menu .mi.sel`), the
  brightness slider as Ember's slider (`.slider`), toggles as Ember's
  (`.toggle`).
- **Stays:** every row and drawer, what each does, the close delays, the
  dock mode restrictions.
- **QML:** `SystemMenu.qml`.

### 10. Later: the lock screen, dock mode, alerts, the keyboard
Not drawn in the mock-ups yet. Alerts and dialogs are L4 sheets with Ember's
pills; the lock screen and the keyboard wait for their own mock-ups.

## The shell contract (BUILD-PLAN step 6)

As `ember-glass-ui/docs/SHELL-CONTRACT.md` specifies, in the Ember Glass
look only (in 1.0's look an app gets nothing and draws the tint-only
fallback).

**The blurred wallpaper, once.** `WallpaperBlur.qml` grabs the wallpaper
as the screen shows it (the `Wallpaper` item: cover, centred, under the
whole screen) at a quarter of the screen's CSS pixels, puts it inside a
60 px border of `#140604` (the mock-up's padding, so the blur darkens
towards the edges instead of clamping) and blurs it with a Gaussian of
standard deviation 40 CSS px (`glass.l1.blur`; 10 px at a quarter), with no
tone map. The blur is CSS's own: three box blurs each way of the sizes the
Filter Effects spec gives for the deviation (as Skia does for Chromium), in
script on a thread of its own (`WallpaperBlurWorker.js`, a `WorkerScript`),
on the pixels a `Canvas` reads: no shader to compile, the same without a
GPU, and the screen never waits for it (about a second on the development
machine; not measured on a device yet). Across a black and white edge its profile is the
Gaussian's within 4 levels (`tst_emberglass.qml`). It gives two PNGs: the
blur as it is (the apps'), and under the shell's own theme's tone map (CSS's
`saturate()`, `contrast()`, `brightness()`, for the loading card). It runs
again only when the wallpaper or the screen's size changes, a quarter of a
second after (the adaptive simulator resizes in a stream of sizes).

**What each web app gets**, through the web runtime:

| Data | Value |
| --- | --- |
| `wallpaperBlurred` | The PNG's address; `""` while there is none |
| `window` | `{x, y, width, height}` in CSS px: where the window lies on the screen when its card is maximized |
| `screen` | `{width, height}`: the whole screen in CSS px, the status bar and gesture strip included |
| `windowRadius` | 30 for a card's window, 0 for another (a dashboard, an alert) |
| `blur` | `"live"`, or `"none"` (Settings > Advanced > Live blur off: the system preference `glassBlur` `"none"`; or there is no GPU) |

- `runtime/phoenix-runtime.js` `__phoenixRuntime.glassChanged(data)`: sets
  `PalmSystem.glass` (the JSON, a string as `deviceInfo` and `launchParams`
  are), sets `--eg-wallpaper-blurred` (`url("...")`, or removes it),
  `--eg-window-x`, `--eg-window-y`, `--eg-screen-w`, `--eg-screen-h` and
  `--eg-window-radius` on `<html>`, `data-eg-blur="none"` or removes it, and
  fires `phoenixGlass` on `document` (`event.detail` is the data). A page
  loaded later gets the same at once.
- In the simulator the shell calls it in each page (`WebAppWindow.glass`,
  set by `Card`) when the page loads and whenever a value changes; on a
  device the shell sends it as a `glass` event of org.webosphoenix.shellhost
  (the runtime's `shellEvents`), which luna-surfacemanager's side does later.

**Where Phoenix differs from SHELL-CONTRACT.md, and why:**
- **The image's address in the simulator is a `data:image/png` URL**, not a
  `file://` one. The QML shell cannot make a folder to write a file into
  (that needs C++: "Later" below), and the simulator's data folder may not
  exist yet in a fresh home; a data URL needs no file and no clean-up. On a
  device the compositor is to write a file (proposed:
  `/var/run/phoenix/wallpaper-blurred.png`) and give its `file://` address,
  as the contract shows.
- **In the card view the window's place stays where the window is when
  maximized.** The contract says the place is "where the card is drawn, so
  the blur moves with the card". A card is the window scaled about its
  centre (luna-sysmgr's CardWindow); the page's CSS pixels do not shrink with
  it, so no offset in them could line the blur up with the sharp wallpaper
  around a scaled card. Keeping the maximized place makes the blur part of
  the card: it scales and moves with it, which is what the mock-ups draw
  (base.css `html[data-embed] .device > .wall`: "each card carries the
  wallpaper as it lies under the card full-screen") and costs no message per
  frame while the cards move. It lines up with the sharp wallpaper exactly
  when the card is maximized.
- **`PalmSystem.glass` is a JSON string**, as webOS's other PalmSystem data
  (`deviceInfo`, `launchParams`); the event's `detail` is the parsed object.
- **The shell does not draw L1 under an app's window** (SPEC.md's "Building
  it" has the shell draw it under each card): the contract has each app draw
  it, under its own theme's tone map, and a copy under an opaque window would
  be a full-screen draw for nothing. The shell draws L1 only where the card
  is its own, the loading card.

**Tests.**
- `shell/tests/tst_emberglass.qml`: the blur is CSS's (the Gaussian's
  profile, the padding, the tone map), the shell makes it in Ember Glass only
  and gives it to the card view, each card's `glass` (the window's place
  maximized and in the card view, the screen, the corners, live blur, none in
  1.0's look), the loading card's glass.
- `tools/test-glass.cjs` (Chromium): the runtime's side, down to a page
  drawing L1 as Ember Glass UI's `.eg-window` does putting each pixel of the
  picture where it lies on the screen; `tools/test-runtime-device.cjs`: the
  device's `glass` event.
- `tools/test-glass-sim.py` (the simulator): the test page drawing only the
  blur the shell gave it, maximized, against the sharp wallpaper blurred as
  the contract says: 0.9 levels of 255 apart on average in the middle of the
  screen, and 10 to 12 when moved by the status bar's height or 40 px
  sideways.

## The order of work

| # | Step | State |
| --- | --- | --- |
| 1 | This plan | done |
| 2 | The switch: `Theme.look`, the `look` preference, the simulator's `--look`; `EmberGlass.qml` from the tokens | done |
| 3 | The gesture light and the gesture strip | done |
| 4 | The wallpaper under the whole screen, the card view's cards (corners, shadow, rim, the loading card's glass), the stack's label, the floor light, the status bar (phones; the tablet's notification group is still 1.0's) | done |
| 5 | The shell contract: `WallpaperBlur`, the window's place for each web app, the runtime's side; tests (QML, the runtime in Chromium, the simulator lining the blur up) | done |
| 6 | Just Type's pill and the dock (phones; the tablet's dock is still 1.0's) | done |
| 7 | Notifications (the banner, the dashboard, the card view's notification bar, the tablet's drop-down) | |
| 8 | The system menu | |
| 9 | The launcher | |
| 10 | The tablet: the status bar's notification group, the drop-down | |
| 11 | Light and dark for the shell's sheets, from a theme preference | |
| 12 | The device: luna-surfacemanager's side of the contract (the file, the shellhost event), `LsmWindowSource` | needs C++ |

### Later, with C++ (not in this branch's first night)
- **`phoenix-sim --look NAME`.** The simulator's command line is
  QCommandLineParser in `shell/sim/main.cpp`, which refuses an option it
  does not know. Until it declares `--look` and passes it to QML (as
  `simLook`, like `simScene`), `sim.qml` reads it from the arguments after
  `--`: `phoenix-sim --phone -- --look ember-glass`. It already prefers
  `simLook` when there is one.
- **The blurred wallpaper as a file.** A small native helper
  (`Phoenix.Native`) that makes the folder and writes the PNG atomically, so
  the device and the simulator give a `file://` address as the contract
  shows.
- **The device's side.** luna-surfacemanager's `SurfaceHost` sends each
  page's window and the image through org.webosphoenix.shellhost
  (`services/shellhost`) as a `glass` event; the runtime already listens
  for it.
- **A device's glass setting.** `device.json` keys `look` and `glassBlur`
  (`DeviceConfig`), so a Raspberry Pi's image says `"glassBlur": "none"`.
- **Measuring the blurred wallpaper** to raise the L1 tint over a bright
  one until ink-3 keeps 4.5:1 (SPEC.md, "Accessibility"): the image's
  luminance, read once when it is made.

## GPU cost
- The wallpaper is blurred once, on the CPU, off the screen's thread; L1 is
  then one picture each app draws under its tint.
- A maximized card keeps its rounded corners: one layer (an offscreen pass)
  for the card in front, as 1.0's card view already has for every card.
- Live blur (`BackdropBlur`) only for L3 and L4 surfaces (today Just Type's
  bar and the dock), at most three on screen; without it (Live blur off, or
  no GPU: `Theme.egLiveBlur`) they are their 94% tints (`glass.fallback`).

## Screenshots

`tools/glass-screenshots.sh OUT_DIR` takes them on the Fairphone 6's screen
(the renders' frame) with the test page (`tools/fixtures/glass-app`, three
copies: dark, light, dark). Kept, as small JPEGs, in
`docs/design-2.0/img/system-ui-2/`, each beside its render:

| File | What |
| --- | --- |
| `cards-dark.jpg`, `cards-light.jpg` | The card view, render on the left: glass cards over the phoenix, the blur moving with each card, the stack's label, the floor light and rim, Just Type's bar, the dock, the status bar, the gesture light (dim, as in card view) |
| `app-dark.jpg`, `app-light.jpg` | A glass page maximized (the test page), beside Messaging's render: the rounded card over the wallpaper, the status bar's tab, the lit gesture light |
| `cards-classic.jpg` | The same card view in 1.0's look: unchanged; the test pages get nothing and draw the tint-only fallback |
| `statusbar.jpg`, `gesture-light.jpg` | The status bar and the gesture light, render above, Phoenix below |
| `glass-alignment.jpg` | The alignment check: the test page drawing only the blur the shell gave it, beside the sharp wallpaper |

**Still unlike the renders:** the card view's notification bar is 1.0's
(step 7), so the dock sits at 1.0's place, lower than drawn; the dock shows
the apps' own icons (owner question 10); the font is Open Sans where Manrope
is not installed (owner question 4); the side cards lie flat (owner question
1); the stack's label is the card's title (the renders: the app's name); the
gesture light is dim in the card view (owner question 2); in the card view
the status bar shows the carrier without the tab (1.0 does; the renders draw
a tab). The test pages are not the renders' apps: their content differs.

## Questions for the owner
1. **The card view's 3D deck.** `cards.html` turns the side cards 26° in
   perspective and pushes them back; luna-sysmgr's card view (CardGroup,
   1.0's `CardLayout.js`) lays them flat. Meanwhile: flat, as luna-sysmgr.
2. **The gesture light in the card view.** The renders show it lit;
   luna-sysmgr turned the light bar off in the card view
   (CoreNaviManager::restoreLightbar) and 1.0 dims it. Meanwhile: dim.
3. **2.0's default wallpaper.** The mock-ups are drawn over the phoenix.
   Meanwhile: in Ember Glass the default is the phoenix; Northern Lights
   stays 1.0's.
4. **The font** (Q119): Manrope (SIL OFL), as drawn, or Open Sans, which
   Phoenix ships. Meanwhile: Manrope when it is installed, else Open Sans
   (the tokens' family list).
5. **The status bar and gesture strip's heights**, 32 and 22 as drawn (1.0:
   28 and 20): 6 px less for the apps. Meanwhile: as drawn, in Ember Glass only.
6. **A maximized app as a rounded card** with the wallpaper around it, as
   drawn, or full-bleed as in 1.0. Meanwhile: as drawn.
7. **Labels over the card stack** ("Messaging · 2 cards"): luna-sysmgr had
   none. Meanwhile: shown in Ember Glass.
8. **A light theme for the shell's sheets**, and where the theme is chosen
   (Settings > Screen & Lock, or follow the time of day). Meanwhile: dark.
9. **Shell values in the tokens:** the status bar's and gesture strip's
   scrims, the card labels, the Just Type pill and the dock are not in
   `ember-glass.tokens.json`; add them there (a `shell` group)?
10. **The dock's icons:** the mock-ups draw Phosphor glyphs for the default
    apps; 1.0 shows each app's icon. Meanwhile: the apps' own icons.
11. **Where the look is chosen:** Settings > Advanced > Look while 2.0 is
    being built, and gone once 2.0 ships with Ember Glass only? Meanwhile:
    there, beside Live blur, and the simulator's option.
12. **The orb in Just Type's bar:** the mock-ups draw the Assistant's ember
    orb at its end. Meanwhile it is drawn and the whole bar still opens Just
    Type; should a tap on the orb open the Assistant instead, as a hold on
    the launcher button does?
13. **The status bar's tab in the card view:** the renders put the carrier
    ("Phoenix") in the app menu's tab with a caret; 1.0 (StatusBarTitle)
    draws the carrier plain, as nothing opens from it. Meanwhile: plain.
