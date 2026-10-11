# Aurora Glass

**The idea.** The wallpaper is always there: every app is a sheet of frosted glass laid
over it, and the system accent is sampled from the wallpaper, so the device feels like one
calm, lit space. Content sits on tint-only panels above that one blur, and only the bars
that content scrolls under (headers, the compose bar) and overlays blur again.

**From webOS:** cards with large rounded corners floating over the wallpaper; the app
menu tab at the top left, drawn as the curved-glass capsule of the webOS status bar (a
bright upper half, a darker lower half); the gesture-area light, glowing in the accent;
notifications as dark glass at the bottom of the screen; Synergy as a visible idea (one
conversation across SMS and Jabber, with account dots and colour-coded outgoing bubbles;
All Inboxes with account stripes). **From Onyx:** the joined segmented control as a
radio group, the transport picker in the compose bar, the uppercase group captions,
toolbars that float over content. The Onyx homage is light; *Onyx Reborn* is the strong one.

## Tokens

| Token | Dark | Light |
|---|---|---|
| text / 2 / 3 | `#F3F6FA` / `#C3CBD7` / `#A6B0BF` | `#0B1320` / `#313C4E` / `#475265` |
| sheet (L1) | `rgba(12,16,27,.63)`, blur 40, saturate 150%, brightness .8 | `rgba(247,249,252,.78)`, blur 40, saturate 140%, contrast .62, brightness 1.62 |
| panel (L2, tint only) | `rgba(4,7,16,.24)` (panels darken) | `rgba(255,255,255,.50)` (panels lighten) |
| control fill / pressed | `rgba(255,255,255,.10)` / `.16` | `rgba(255,255,255,.72)` / `.92` |
| reading pane | `rgba(10,13,22,.42)` | `rgba(255,255,255,.78)` |
| float (L3) | `rgba(20,25,39,.70)`, blur 22 | `rgba(250,251,253,.74)`, blur 22 |
| hairline / top edge | `rgba(255,255,255,.09)` / `.24` | `rgba(11,19,32,.08)` / `rgba(255,255,255,.95)` |
| accent (fill / on / ink) | `#46E8B2` / `#032419` / `#6CF2C4` | `#0B8063` / `#FFFFFF` / `#035C45` |
| accent 2 (gradients) | `#2CC7D9` | `#0F7491` |
| danger (text / fill) | `#FF7A88` / `#CF3440` | `#C4253A` / `#D0313F` |
| scrim (L4) | `rgba(4,7,15,.52)` | `rgba(10,18,30,.30)` |
| Synergy accounts | SMS `#46E8B2`, Jabber `#A994FF` | SMS `#0B8063`, Jabber `#6A4FD8` |
| outgoing bubbles | SMS `#127A66→#176C8E`, Jabber `#4D3FB4→#3456A8` (white text, both themes) | |
| calendars | Work `#39D3C2`, Personal `#B49BFF` (fills at 20%) | Work `#0C8A80`, Personal `#7B5CE0` (fills at 14%) |

Spectrum sampled from *northern-lights*: `#3EE6AE` `#2CC7D9` `#9A82FF` `#FF7096`. The
accent follows the wallpaper (Music follows the cover: `#FF8FB0` dark, `#B4245E` light):
the shell quantises the wallpaper (for example Material's Apache-2.0 color-utilities),
picks the most vivid swatch, then clamps its lightness: dark fills must keep 4.5:1 with
`#032419`, light fills 4.5:1 with white, ink 4.5:1 on the darkest glass.

**Type: Manrope** (SIL OFL 1.1), Open Sans as fallback (ships with Phoenix). Large title
30/36 800 (−1.5%); title 20/26 800; headline 16/22 700; body 15/22 500 (bubbles 15.5/22);
secondary 13.5/19 500; caption 12.5/16 600; overline 11.5/14 800, +0.09em, uppercase.

**Radii:** card 30 (phone) / 24 (tablet); pane 22; group 18; field 14; buttons and
controls fully round (44 → 22); icon tiles 9; avatars round. **Spacing:** 4-pt grid;
16 phone gutters, 10 between panes and around panels; rows 52 to 54 high.

**Levels:** L0 wallpaper (sharp) → L1 sheet (the one heavy blur) → L2 panels (tint and a
hairline, never a second blur) → L3 floats (blur 22, top-edge highlight, shadow
`0 18 40 −14 rgba(0,0,0,.6)`) → L4 overlays (scrim, then glass with blur 30). Opacity
rises with reading density: the nav pane sits on the sheet, lists on a panel, a message
on the reading pane. **Motion:** cards and sheets scale .94→1 with a fade, 220 ms,
`cubic-bezier(.2,.8,.2,1)`; throw-to-close 280 ms ease-out; toggles 160 ms. Never animate
a blur radius (animate the tint's opacity); honour reduced motion.

## Components
Primary buttons are accent pills with a soft top light and an accent glow; secondary are
glass; destructive are a red tint (a solid red only for "delete all"). Toggles are accent
gradients; checkboxes rounded squares; segmented controls are a sunken track with a lifted
glass thumb. Fields are sunken panels with an accent ring on focus. Lists are rows on the
sheet with inset hairlines; settings use panels with colour icon tiles. Dialogs are float
glass over a scrim; the app menu drops from the tab as float glass; notification banners
are always dark glass at the bottom, with a one-line "4 waiting" bar when minimised.

## Building it (Enact, Ionic, Flutter)
- **The sheet's blur belongs to the shell.** Apps cannot see the wallpaper behind their own
  surface, so luna-surfacemanager blurs the wallpaper once when it changes (Qt Quick
  MultiEffect, or a pre-blurred texture at ¼ resolution) and draws it under each card;
  app windows are translucent and paint only tints (`rgba` backgrounds). The same
  texture, transformed with the card, serves the card view. The accent and the blurred
  wallpaper's URL reach apps as tokens (`--phx-accent`, Flutter `ThemeData`, Ionic
  `--ion-color-primary`).
- **Floats** use live blur over the app's own content: CSS `backdrop-filter` in Enact and
  Ionic (Chromium in webOS OSE), `BackdropFilter` + `ClipRRect` in Flutter (share one
  backdrop between bars where the Flutter version allows). Keep each float small.
- **Panels** are plain translucent fills: nothing framework-specific.
- **Light glass over a dark wallpaper** needs the contrast/brightness tone-map above (CSS
  filter functions; in Flutter a `ColorFilter.matrix` composed into the blur).

## GPU cost and fallback
With the shell's cached blur, the sheet costs one texture draw; the live cost is only the
floats (≈ 20 % of a phone screen, blur at ½ or ¼ resolution) and the occasional overlay.
On a mid-range phone keep live blur radii ≤ 24 and at most two floats on screen; never
blur during card-view scaling (reuse the cached texture). **Fallback (Raspberry Pi, or
`prefers-reduced-transparency`):** no live blur anywhere; the shell's pre-blurred
wallpaper still shows under the sheet; floats become 94 % opaque tints; overlays use the
scrim only. The look survives, at near-zero GPU cost.

## Accessibility (WCAG 2.2 AA)
Measured on the renders: the darkest and brightest glass pixels beside text, worst case
across Messaging, Settings, Email, Calendar (`northern-lights`, its brightest aurora band
included). Dark: text 9.8:1, text-2 6.5, text-3 4.8, accent ink 7.7. Light: text 11.3,
text-2 6.8, text-3 4.8, accent ink 4.9. Fills: white on SMS bubbles 5.1 to 5.9, on Jabber
6.6 to 7.8; `#032419` on the dark accent 10.6; white on the light accent 4.9, on the
danger fills 5.0. Busier wallpapers need the shell to check the blurred wallpaper's
luminance and raise the sheet's opacity until text-3 keeps 4.5:1; a "reduce
transparency" setting switches to the fallback. Targets ≥ 44 px; focus is an accent ring
plus a 4 px soft halo.

**Assets:** glyphs drawn for these mock-ups (no third-party icons); wallpapers are
Phoenix's own (Apache-2.0); the "Night Transit" cover is invented and drawn in SVG.
