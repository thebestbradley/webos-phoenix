# Ember

**The idea.** A calm, spatial webOS for 2026: generous space, hairlines, large light type, and depth
made by light (soft highlights, long shadows, a glow from below) instead of heavy blur. The phoenix
appears only as an ember, an orange-to-gold light kept for focus, the active item and the Assistant,
so the screen stays quiet and the one thing that matters glows.

**From Onyx (Enyo 2):** the **grabber** (two hairlines on a sliding panel's toolbar), **sliding
panels** that overlap the list (CollapsingArranger), **pill buttons** whose gradient becomes a 1 px
highlight of light, the RadioGroup/TabBar as a hairline capsule with a floating thumb, the
ToggleButton (its knob now carries an ember spark when on), uppercase groupbox headers (micro labels
with wide tracking). **From webOS:** the card as the unit (30 px corners on black), the app menu tab
at top left, the status bar, the **gesture light** (an ember line that breathes while you gesture),
notifications at the bottom, Just Type at the top of the card view, card stacks, the quick launch
dock, and Synergy: one person, several accounts, drawn as an **identity ring** (one arc per account).

## Tokens
| | Light ("porcelain") | Dark ("graphite") |
| --- | --- | --- |
| background | #f2f1ee, white light from the top left | #0b0b0d, ember glow from below (13%) |
| plane / plane-2 / solid | white 72% / 92% / #f8f7f5 | white 4% / 7.5% / #141416 |
| sunk / line / line-2 | ink 3.5% / ink 10% / ink 18% | white 3% / 8.5% / 16% |
| ink / ink-2 / ink-3 | #141416 / #4c4b51 / #6b6970 | #f3f2ef / #a9a7ae / #8a8890 |
| inverse (primary fill) | #161618 on #f7f6f3 | #f3f2ef on #121214 |
| ember text / focus | #b83c0a / #d9480f | #ff8f4d / #ff6a2a |
| SMS / Jabber / Work / Personal | #2f5bd0 #6a43d0 #855800 #1d7a60 | #8aa6ff #b79dff #e7b65c #6fd3b0 |
| danger / online | #c8321d / #2fa36b | #ff7a66 / #5fd394 |

**Ember:** `linear-gradient(120deg, #ff4f1a, #ff7a2a 45%, #ffb547)`, glow `0 0 10px rgb(255 110 40 / .6)`;
filled controls with a white glyph use the deeper `#d63c08 → #f0601a`. **Type:** Manrope (SIL OFL 1.1),
variable 200-800, Open Sans fallback; tabular figures. Display 44/50 w250 (-1.4); title XL 34/40 w300;
title L 26/32 w350; title 18/24 w600; body 15.5/23 w450; small 13.5/19 w500; micro 11/14 w700, +1.6
tracking, uppercase; numerals up to 56 w200. **Radii:** card 30, panel 26, plane 22, tile 16, pills and
rings full. **Hairline:** 0.5 CSS px (one device pixel and a quarter at 2.5x). **Spacing:** 8 pt base,
24-26 px phone margins, 28-44 tablet; rows 66-80. **Elevation by light:** light theme, a 1 px white
top highlight and a long warm shadow (`0 22 44 -28 rgb(60 35 10 / .3)`); dark theme, a 7% white rim
and a deep shadow; the active card throws ember light on the floor. **Translucency:** planes are plain
alpha (no blur); menus and notifications `veil` 80% / 60% + `blur(14px)`; card view glass 34-38% + `blur(12px)`.
**Motion:** one calm curve `cubic-bezier(.2,.8,.2,1)`: 240 ms fades and lifts, 380 ms panel slides,
420 ms card-view carousel (side cards turn 26° away and recede 90 px); ember glows fade in in 160 ms;
the gesture light breathes over 1.6 s. Reduce motion: no 3D, cross-fades only.

## Components
Pills (ink primary, hairline secondary, ghost, danger text and solid, focus = 1.5 px ember ring with a
3 px gap); ring buttons (hairline circles); segmented capsule; tabs with an ember underline on the
active one; toggle (ink track, ember spark); 22 px checkbox (7 radius) and radio; hairline slider with
an ember fill and a glowing head; underline text field (turns ember on focus, ember caret); search
capsule (Just Type); planes holding rows with inset hairlines; micro uppercase group headers; avatars
with the identity ring and presence; veiled app menu (square corner under the tab) and notification
banners; the grabber; the gesture light; the Assistant orb (a lit ember sphere); the spatial card view
(perspective carousel, stacks as fanned cards, a floor light under the focused card).

## Building it
- **Enact (recommended):** plain CSS custom properties as above; hairlines as `box-shadow: inset 0 0 0 .5px`
  (Chromium draws device pixels); the identity ring is a tiny SVG component fed by the accounts of the
  contacts Synergy linked into the person. The panels are Enact's `ui/ViewManager` with a custom
  `arranger` (overlap 22 px, shadow on the leading edge).
- **Ionic:** the same CSS; `ion-segment`, `ion-toggle::part(handle)` for the spark, `ion-item` lines set
  to `none` with the inset hairline as a pseudo-element.
- **Flutter:** `Border.all(width: 1 / devicePixelRatio)`; gradients via `ShaderMask`; veils via
  `BackdropFilter(ImageFilter.blur(sigmaX: 14))` only on menus and notifications; the cover glow is an
  `ImageFiltered` layer rendered once into a `RepaintBoundary`; the carousel is
  `Transform(Matrix4.identity()..setEntry(3, 2, .001)..rotateY(.45))`.
- **The shell (QML):** the card view and gesture light live in `shell/qml/Phoenix/Shell`; QML's
  `Rotation { axis.y: 1 }` already projects with perspective, and the floor light is a static gradient.

**GPU cost and fallback.** Cheap by design: planes are alpha only; live blur is limited to menus,
notifications and the card view's Just Type and dock (radius 12-14, small layers, only while shown).
Expensive bits and their fallbacks: the album cover's light (a 42 px blur of a 380 px layer) is baked
once per track (or a pre-blurred thumbnail); large soft shadows become 9-slice images on Flutter and QML;
on a Raspberry Pi the veils go to 94% opacity with no blur, the carousel goes flat (scale only), and
the floor light is a static gradient.

## Accessibility (WCAG 2.2 AA)
Text on the backgrounds: light ink 16.3:1, ink-2 7.6:1, ink-3 4.8:1 (5.1 on planes); dark ink 17.6:1,
ink-2 8.3:1, ink-3 5.6:1 (5.3 on planes); ember text 5.0:1 (light) and 8.7:1 (dark); account labels
4.6:1 or more; danger 4.7:1; white on solid danger 5.3:1. On translucency, measured at the worst point
of the blurred phoenix wallpaper: light veil ink 11:1 and ink-2 5.4:1; dark veil ink 10.4:1 and ink-2
4.9:1; card view Just Type 9.7:1, dock glyphs 15.6:1. Control boundaries use ink-3 (4.8:1 or more);
focus ring 3.8:1 (light) and 6.9:1 (dark); the send glyph on its ember fill 3.3:1 or more. The ember
is never the only signal: the active item also changes weight or fill, unread counts are ink badges.

**Licences.** Manrope: SIL OFL 1.1. Icons: Phosphor (light, thin and fill weights), MIT, only the glyphs
used, inlined (`tools/build_icons.py`). Wallpaper: Phoenix's own `phoenix.jpg` (Apache-2.0). Album art
and the orb drawn for these mocks.
