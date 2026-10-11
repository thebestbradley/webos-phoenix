# Onyx Reborn

**The idea.** Enyo 2's Onyx, redrawn for 2026: charcoal chrome (toolbars, popups, menus,
the app menu tab) around calm light content, with Onyx's pill buttons, groupboxes, onyx
blue and sliding panels kept, and its glossy gradients reduced to a whisper. A TouchPad
owner recognises it at a glance; anyone else sees a crisp, dense, very legible UI.

**From Onyx** (`third_party/enyo-2/onyx/css`): the charcoal `onyx-toolbar` with its
top-lit gradient (`gradient.png` ran 0 → 22 % black; here ≈ 6 %) and a 1 px highlight;
`onyx-button` as pills, light grey by default (`#E1E1E1` → `#F3F4F6/#E1E4E8`), blue,
affirmative green and negative red; `onyx-radiobutton` groups (blue active segment);
`onyx-groupbox` with its charcoal uppercase header, kept as a cap on each box;
`onyx-toggle-button` with its ON / OFF label; the blue `onyx-checkbox`; the slider knob
with a blue halo when pressed; `onyx-tooltip` (blue, with a tail); `onyx-picker` lists
(selected row tinted, `#C4E3FE` → `#DCEBF9`); striped progress bars; SwipeableItem's
revealed Delete; the **grabber** in panel toolbars; **Panels / CollapsingArranger**: the
message panel slides over the list with a soft shadow; `onyx-popup` always dark.
**From webOS:** black around a rounded card; the app menu tab hanging from the top edge,
rounded below; the gesture-area light (onyx sky); the dashboard notification strip at the
bottom; Synergy (account dots, "Reply via" chips, All Inboxes with account dots); the
card view over *Silk*, the TouchPad-style swoosh wallpaper; the now-playing reflection.

## Tokens

| Token | Light | Dark |
|---|---|---|
| background / surface / surface-2 | `#ECEEF1` / `#FFFFFF` / `#F5F6F8` | `#121417` / `#1C1F23` / `#22262B` |
| lines | `#DADDE2`, `#C9CED5` | `#2C3036`, `#393E45` |
| text / 2 / 3 | `#1C1F23` / `#4A5058` / `#5F666F` | `#ECEFF2` / `#AEB5BE` / `#8F97A1` |
| toolbar (gradient) | `#3A3E44 → #2B2E33`, edge `rgba(255,255,255,.08)`, line `#1B1D20` | `#2C3035 → #222529`, line `#08090A` |
| toolbar text / 2 | `#F4F5F7` / `#B4BAC2` | same |
| toolbar button | `#50555C → #42464C` | same |
| popup / menu / notification | `rgba(44,47,52,.94)` (blur 20 optional) | same |
| onyx blue (fill) | `#1979C5 → #116DB4` (base `#1477C2`) | same |
| blue ink / selection | `#0F6BB0` / `#DCEBF9` | `#5CB6F7` / `#173A58` |
| onyx sky (glow, focus) | `#35A8EE` | same |
| affirmative / negative | `#2E7D4F → #256A42` / `#D23A33 → #B92A24` | same |
| accounts | SMS `#1477C2`, Jabber `#2E7D4F` | dots `#4AA6EE`, `#4CC07A` |
| calendars (bar / fill / ink) | Work `#1477C2` `#DCEBF9` `#0D5A96`; Personal `#C2591A` `#FBE6D8` `#8A3C0E` | Work fill `#15324C` ink `#9CCEF7`; Personal `#3F2616` `#F6C3A0` |

**Type: Inter** (SIL OFL 1.1; Onyx used Helvetica Neue), Open Sans as fallback. Title
22/28 700 (−1.8 %); toolbar title 18 650; items and body 16/22 500 (bubbles 15.5/22);
secondary 13.5; caption 12.5; caps 11.5 700 +0.08em uppercase (groupbox caps; tags 10.5).

**Radii:** card 22 (phone) / 18 (tablet); groupbox 12; field 10 (21 in toolbars); pills
(40 → 20, 34 → 17); avatars rounded squares 12 (webOS's photo frames); icon tiles 8;
popups 18; panels square, the slid-over panel 10 at its top left. **Spacing:** 4-pt grid;
toolbars 56 to 66 high with 12 padding; items 52 to 54; groupboxes 12 apart, 14 inside.

**Depth:** no blur needed. Toolbars `0 4 10 −4 rgba(0,0,0,.35)` and a 1 px line;
groupboxes a 1 px line and `0 2 8 −2 rgba(20,24,30,.08)`; the slid-over panel
`−10 0 28 −10 rgba(10,14,20,.28)`; popups `0 24 50 −16 rgba(0,0,0,.6)`. Glass is
optional and only in chrome (the quick-launch shelf, popups, `toolbar.glass`).
**Motion:** panels slide 300 ms `cubic-bezier(.25,.8,.25,1)` and follow the grabber 1:1,
then settle with the throw's velocity; popups fade and scale .96 → 1 in 160 ms; toggles
150 ms; reduced motion turns slides into cross-fades.

## Building it (Enact, Ionic, Flutter)
- **Chrome** is gradients, 1 px highlights and shadows: plain CSS in Enact and Ionic
  (tokens as `--phx-*`), `BoxDecoration` (gradient, `boxShadow`, a top `Border`) in Flutter.
- **Panels:** Enact's `Panels`/`ViewManager` with a custom arranger (CSS transforms, drag
  from the grabber); Ionic `ion-split-pane` plus a `createGesture` drag for the slide-over;
  Flutter a `Stack` of panels with `AnimatedPositioned` and a `GestureDetector`
  (`LayoutBuilder` collapses to one panel on phones).
- **Toggle with ON / OFF, groupbox caps, pickers, swipeable items:** small custom
  components in all three (Ionic's `ion-toggle` has no text labels; Flutter's `Switch`
  neither). The reflection: `-webkit-box-reflect` (Chromium), a flipped image under a
  `ShaderMask` in Flutter; leave it out elsewhere.

## GPU cost and fallback
The cheapest direction: flat fills, small gradients and soft shadows, all cacheable; no
live blur in apps. The optional glass (quick-launch shelf, popups) is one blur at a time,
small, and its fallback is the same charcoal at 96 % opacity, which loses nothing
essential. It runs as designed on a Raspberry Pi.

## Accessibility (WCAG 2.2 AA, all solid colours)
Light: text on background 14.2:1, text-2 on surface 8.1, text-3 on background 5.0 (5.8 on
white), blue ink 5.6 (4.6 on the selection tint); toolbar text 12.5, toolbar secondary
7.0; white on the blue fill 4.6 to 5.6, on green 5.1, on red 4.8; calendar inks 5.9 and
6.4. Dark: text 14.3, text-2 8.0, text-3 5.2 to 6.3, blue ink 7.5 (5.3 on selection);
calendar inks 7.9 and 8.8. ON / OFF labels 5.9 to 6.8. State is never colour alone
(toggle labels, check marks, the selected row's left bar). Targets ≥ 40 px (toolbar) and
≥ 52 px rows; focus is a blue ring plus a 4 px onyx-sky halo.

**Assets:** glyphs drawn for these mock-ups (no third-party icons, no Onyx images reused;
the grabber, checkbox and knob are redrawn in CSS); wallpapers are Phoenix's own
(Apache-2.0); the "Night Transit" cover is invented and drawn in SVG.
