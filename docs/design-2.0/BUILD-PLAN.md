# Building Ember Glass: the Phoenix UI layer

The owner chose **Ember Glass** for Phoenix 2.0 (11 October 2026; OPEN-QUESTIONS
Q119). This is how it becomes a UI layer that apps in all three of Phoenix's
app frameworks (Enact, Ionic, Flutter) are built on. The layer lives in its
own repository, **`ember-glass-ui`** (github.com/thebestbradley/ember-glass-ui); the shell's part (the wallpaper under the
glass) lives here in webos-phoenix.

The look itself is specified in
[directions/ember-glass/SPEC.md](directions/ember-glass/SPEC.md) and drawn in
its mock-ups ([the renders](README.md)); its CSS
(`directions/ember-glass/assets/base.css`, `screens/*.html`) is the reference
the components are measured against.

## One source, three frameworks

Everything starts from **design tokens**: one JSON file in the W3C Design
Tokens format (`tokens/ember-glass.tokens.json`), read off the mock-ups:

- colour: the ink steps, the ember gradient's stops, surfaces, light and dark;
- glass: the four levels (L1 card, L2 plane, L3 float, L4 overlay) with each
  one's blur radius, tint (colour and alpha, light and dark) and top highlight;
- type (Manrope's scale), spacing, radii, shadows, motion (durations, easing);
- the gesture light's gradient and glow; the slider's sizes.

A small build script (Node, no dependencies) writes the tokens out for each
consumer, and CI fails when the generated files are out of date:

| Output | For |
| --- | --- |
| `tokens.css` (custom properties; `[data-theme]` and `prefers-color-scheme`) | the CSS core, Ionic, any web app |
| `tokens.less` | Enact (its themes are LESS) |
| `tokens.ts` | TypeScript code that needs a value (animations, canvas) |
| `tokens.dart` | Flutter (a `ThemeExtension`) |

## The packages

| Package | What it is | Built on |
| --- | --- | --- |
| `@ember-glass/css` | Framework-neutral CSS: the glass recipe and every component as plain classes (`eg-button`, `eg-toggle`, `eg-row`, `eg-toolbar`, `eg-column-toolbar`, `eg-slider-grab`, `eg-segmented`, `eg-field`, `eg-dialog`, `eg-banner`, `eg-menu`, `eg-gesture-light`, ...) | tokens.css |
| `@ember-glass/enact` | An Enact theme, as Sandstone and Agate are: a `ThemeDecorator` (fonts, tokens, the wallpaper layer, light and dark), components on `@enact/ui` (Button, Switch, Checkbox, Slider, Input, Item, Header, Popup, Notification), and **ColumnPanels**: the TouchPad's sliding columns, each ending in a glass toolbar with Enyo 2's slider at its bottom left (Enyo 2 `onyx.Grabber` in an `onyx.Toolbar`, `enyo-2/onyx/samples/ToolbarSample.js:7`; the TouchPad Email's `GrabButton`) | Enact 5 (`@enact/core`, `@enact/ui`, `@enact/spotlight`), React 19 |
| `@ember-glass/ionic` | An Ionic React theme: Ionic's `--ion-*` variables set from the tokens, `::part()` styles, and the components Ionic lacks (ColumnPanels with the slider, GlassSurface, GestureLight) | Ionic React 9, React 19 |
| `ember_glass` (Dart) | A Flutter package: `ThemeData` plus a `ThemeExtension` from tokens.dart; GlassSurface, PuiButton, PuiSwitch, PuiRow, ColumnPanels with the slider, GestureLight; golden tests | Flutter 3.47 (the version webos-phoenix's CI uses) |
| `gallery/` | Each framework's gallery: every component in light and dark, and the reference screens | the packages |

The versions follow what webos-phoenix's own Enact, Ionic and Flutter demos
already use (`apps/enact-notes-*`, `apps/ionic-notes`, `apps/flutter-notes`).

## Frameworks on the device: shared, versioned (decided 11 October 2026)

The owner: "agree with the shared." As webOS kept Mojo and Enyo once on
the device for every app (`/usr/palm/frameworks/<name>/<version>/`, each
app naming the version it wants), and as Flatpak shares versioned runtimes:

- **Installed once, side by side by major version:** Ember Glass UI's CSS,
  tokens, icons and fonts; a prebuilt framework bundle of React + Enact +
  `@ember-glass/enact` (Enact's own framework-bundle build, as LG's system
  apps share theirs) and one for Ionic React + `@ember-glass/ionic`; one
  Flutter engine per Flutter version (meta-flutter's shared engine), the
  largest saving (about 10 MB an app otherwise).
- **In each app:** only its own code; for Flutter apps, `ember_glass`'s
  widgets compile into the app (tree-shaken).
- **Declared:** an app names what it uses in `appinfo.json`
  (`"frameworks": {"ember-glass": "1", "enact": "5"}`); the OS keeps the
  older majors an installed app still names; the Marketplace installs a
  missing one as a dependency; a third-party app may still bundle its own.

## The default apps: phoenix-default-apps

The built-in apps are rebuilt for 2.0 in their own repository,
**`phoenix-default-apps`** (github.com/thebestbradley/phoenix-default-apps),
on Enact, with their UI through one facade so Ember Glass UI is applied
when its components are ready; each rebuilt app also gains what it lacks
against today's phones (iOS's apps the measure), in webOS's way. First:
Email, Calendar, Messaging, Memos and Notes; then every other app Phoenix
has. After the OS rebuild they are installed as the image's defaults.

**Settings, one app and many cards** (the owner, 11 October 2026): webOS
kept each preference as its own app and card (Wi-Fi, Screen & Lock,
Date & Time, ...). 2.0 keeps those launch icons and cards, and adds a
unified Settings app that holds every panel: one codebase, each panel also
a launch point of its own (`appinfo.json` launch points), so tapping
Wi-Fi opens a card with just that panel, and Settings opens them all.

## The glass, and what the shell gives an app

Ember Glass has four glass levels (SPEC.md, "Glass tokens"):

- **L1 (a card's background) belongs to the shell.** An app cannot blur what is
  behind its own window, so the shell blurs the wallpaper once when it changes
  and gives each app that blurred image and where the app's window sits on the
  screen. The app draws the image under its tint, offset by its position, so
  the blur lines up with the sharp wallpaper around the card. In the card view
  the same image moves with each card.
- **L2 is tint only.**
- **L3 and L4 blur live** (toolbars, the compose bar, menus, dialogs, banners):
  CSS `backdrop-filter` in Enact and Ionic (Chromium in OSE), `BackdropFilter`
  in a `ClipRRect` in Flutter. A live blur ignores an ancestor's rounded
  corners, so each bar carries its own radius.
- **Low end** (a Raspberry Pi, `prefers-reduced-transparency`, or no blurred
  wallpaper given): no live blur; L1 is the tint over a pre-blurred image or
  over nothing, and L3 and L4 become 94% tints. The look survives at almost no
  GPU cost.

**The contract with the shell** (to build in webos-phoenix; until then the
layer falls back to tint only):

| For | What the shell gives | How the layer uses it |
| --- | --- | --- |
| Web apps (Enact, Ionic) | The blurred wallpaper's address and the window's position and size, through the app's runtime (`PalmSystem`, with a change event); as CSS: `--eg-wallpaper-blurred`, `--eg-window-x`, `--eg-window-y`, `--eg-screen-w`, `--eg-screen-h` set on the root | `background: var(--eg-wallpaper-blurred)` sized to the screen and offset by the window's position, under the L1 tint |
| Flutter apps | The same through a platform channel (`phoenix_services`) | An `Image` positioned the same way under the tint |
| Low-end devices | `"blur": "none"`, telling the layer to drop live blur | The fallback above |

## The order of work

1. **Foundations:** the repository, the tokens and their build, `@ember-glass/css`
   with the glass recipe, CI.
2. **A vertical slice:** the Settings screen (phone, light and dark) in all three
   frameworks, compared with the Ember Glass mock-up (`screens/settings.html`):
   Playwright screenshots for the web ones, golden images for Flutter.
3. **The components**, one at a time across the three frameworks, each in the
   galleries, light and dark, with tests.
4. **ColumnPanels and the slider** (Email and Calendar on the tablet).
5. **The remaining reference screens** (Messaging, the conversation, Music,
   Email, Calendar).
6. **The shell's part** in webos-phoenix: the blurred wallpaper and the
   window's position for apps, and the card view moving the blur with each card.

## Open choices

- Ember Glass's own (Q119): a slider on the first tablet column too, the active
  column's slider lit or all at rest, and the shell raising the tint over a
  brighter wallpaper.
- The font: Manrope (SIL OFL) as the mock-ups use, or Open Sans (Apache-2.0),
  which Phoenix ships today. An OFL font can be bundled with the layer and
  the image; LEGAL.md would gain a line for it.
- Making `ember-glass-ui` public: it starts private.
