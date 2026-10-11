# Ember Glass

**The idea.** Ember, made of glass: the same layout, type, spacing, hairlines, icons and ember accent,
but every surface is frosted glass over the phoenix wallpaper, as in Aurora Glass, so the phoenix glows
through the app instead of only in the card view. Two owner-requested details join it: Enyo 2's
slider at the bottom left of every tablet column, and Onyx Reborn's longer, fading gesture bar lit in
Ember's gold-to-ember.

**What changed from Ember (nothing else did).**
1. **Glass.** The wallpaper is always behind the card (Ember: black). Card, panes, list planes,
   toolbars, the compose bar, the message pane, sheets, dialogs, the app menu and notifications are glass
   in four levels (below), each with a 1 px top highlight. Dark planes now darken the glass (as Aurora's
   panels do) instead of lightening it, so text keeps AA over the phoenix's glow.
2. **The slider in every tablet column** (Email: folders, list, message; Calendar: side, week), in a
   bottom toolbar per column. Ember's top-edge grabber on the message pane moved there; the message's
   Reply / Reply all / Forward now sit beside it, as in the TouchPad's Email.
3. **The gesture light** is 118 x 4 (Ember 58 x 3) with fading ends.
4. **Small adjustments the glass forced:** ink-3 one step stronger (light #605e65, Ember #6b6970; dark
   #9a98a0, Ember #8a8890), so it keeps Ember's 4.8:1 on glass; a scrim under the status bar (black 50 to
   25%) and the gesture strip (25 to 55%); Calendar hour rows 40 px (44), so the day ends above the new
   toolbar; the mini month's out-of-month dates drop Ember's 60% fade (2.4:1 on glass); Settings says
   "Phoenix · under glass".

## Glass tokens
| Level | Light ("porcelain") | Dark ("graphite") | Blur |
| --- | --- | --- | --- |
| L1 card (cached) | #f7f5f1 78% over the wallpaper tone-mapped: saturate 1.3, contrast .42, brightness 2.2 | #0c0b0d 68%, saturate 1.5, brightness .8 | 40 |
| L2 planes (tint only) | white 56% (Ember 72%); plane-2 88% | #060507 26% (darkens); plane-2 white 8.5% | none |
| L3 floats | #faf9f7 66%; reading pane white 80% | #141316 62%; reading pane #100f12 70% | 22, saturate 1.6 |
| L4 overlays (menus, banners, dialogs) | #faf9f7 80%, backdrop tone-mapped (contrast .5, brightness 1.9) | #0c0c0e 60%, saturate 1.4 | 30 |
| Top highlight / rim | white 95% / ink 12% | white 17% / white 12% | |

Ember's light (white from the top left; dark: the 13% ember glow from below) still lies on the L1 tint.
The light theme's tone map is what keeps light glass over a dark wallpaper porcelain (#ede4e0 to
#efecea measured) instead of grey.

## The slider (Enyo 2's grabber, in Ember's hand)
**Source.** Enyo 2 puts `onyx.Grabber` first in an `onyx.Toolbar` (`third_party/enyo-2/onyx/samples/
ToolbarSample.js:7`; the control is `onyx/source/Grabber.js`, an image `grabbutton.png`, 23 x 27,
`onyx/css/Grabber.less:2`, `onyx-variables.less:129`) to drag a panel of `layout/panels` (`Panels.js:85`
`draggable: true`; the sliding layout is `CollapsingArranger`, `PanelsSlidingSample.js:10`). The TouchPad's
Email did exactly this at the bottom left of each sliding pane: a `GrabButton` (`slidingHandler: true`)
first in the pane's bottom toolbar, then a 40 px spacer (`core-apps/com.palm.app.email/mail/source/
Mail.js:105`, `MessagePane.js:92`; `enyo-1.0/.../controls/button/GrabButton.js`). The original left the
first pane without one (`Accounts.js:41`); here every column has one, as asked, and the first collapses
the folders to give the list and message the width. **Look.** No art copied: three 1.5 px hairline bars,
18 px tall, 4.5 px apart, in ink-2, in a 44 px round hit area, then a 0.5 px divider. **Active** (the
column you are in, Panels' index): the bars take the ember gradient and a 6 px glow. **Pressed or
dragging:** an ember-soft fill, a 1 px ember ring and a 16 px glow. **Toolbar:** 60 px, L3 glass, a top
hairline and highlight, the column's own corners (26). **Motion:** Ember's 380 ms panel slide on
`cubic-bezier(.2,.8,.2,1)`; drag follows the finger; a tap toggles the column.

## The gesture light
118 x 4, radius 2, on phone and tablet (Onyx Reborn, `onyx.css:105`):
`linear-gradient(90deg, rgb(201 50 12 / 0) 0%, rgb(214 60 8 / .28) 13%, rgb(240 80 20 / .75) 25%, #ff7a2a 35%,
#ffb547 44%, #fff3dc 50%, ...mirrored)`: gold-white at the centre, through gold and ember to nothing at
both ends. The glow is `filter: drop-shadow(0 0 4px rgb(255 110 40 / .7))`, which follows the gradient's
alpha, so the glow fades with the ends (a box-shadow would glow the whole rectangle). It still breathes
over 1.6 s while you gesture. Flutter: a `ShaderMask` gradient plus a blurred copy; QML: a
`LinearGradient` and a `MultiEffect` shadow, or one pre-rendered image.

## Building it
- **L1 belongs to the shell.** luna-surfacemanager blurs the wallpaper once when it changes (QML
  `MultiEffect`, or a ¼-resolution pre-blurred texture) and draws it under each card, aligned with the
  sharp wallpaper; apps paint only the tint (CSS `rgba`, Flutter `ColoredBox`). The card view moves the
  same texture with each card. The mock-ups draw L1 the same way (a blurred copy under the tint).
- **L3 and L4 blur live:** CSS `backdrop-filter` in Enact and Ionic (Chromium in webOS OSE),
  `BackdropFilter(ImageFilter.blur(sigmaX: 22, sigmaY: 22))` in a `ClipRRect` in Flutter. A live blur is
  not clipped by an ancestor's rounded corners, so a column toolbar carries the column's radius itself.
- **The slider:** a plain control in Enact (`ui/Touchable` + the `ViewManager` arranger Ember already
  specifies), Ionic (`ion-split-pane`/a gesture), Flutter (`GestureDetector` driving the panel offset).

**GPU cost and fallback.** L1 costs one texture draw per card (no per-frame blur). Live blur is limited
to L3 and L4: each column toolbar (60 px high), the compose bar, menus, banners and dialogs, at radius 22
to 30; keep it at ½ resolution on a mid-range phone, at most three live layers on screen, and never
animate a radius (fade the tint). The message pane is the large one (about 660 x 720 on the tablet): it
blurs live only while it slides or overlaps; at rest it is its tint over L1. **Raspberry Pi and low end
(and `prefers-reduced-transparency`):** no live blur at all. L1 is a pre-blurred wallpaper image made when
the wallpaper is set, under the same tints; L3 and L4 become 94% tints of their colours (#f7f6f3,
#141316) with the top highlight kept; the gesture light is one pre-rendered image. The look survives at
near-zero GPU cost.

## Accessibility (WCAG 2.2 AA)
Measured on the renders with `tools/glass-contrast.cjs`: every visible text run against the pixels
actually behind it (glass, blur and wallpaper), worst 2nd percentile. All 832 runs on the 16 screens pass
AA. Worst case per token, light / dark: ink 10.3 / 7.0:1 (both on calendar event tints), ink-2 5.0 / 5.7,
ink-3 4.6 / 4.9 (Email's selected row; "Ada is online on Jabber" over the phoenix's glow), SMS 4.7 / 7.5,
Jabber 5.0 / 6.7, ember text 5.2 / 7.9, danger 5.2 / 7.3, white on solid danger 5.3; the status bar 6.3
over the wallpaper; card view Just Type 9.7. A brighter or busier wallpaper needs the shell to measure the
blurred wallpaper and raise the L1 tint until ink-3 keeps 4.5:1 (the tool makes the same check). Control
boundaries use ink-3 (4.6:1 or more); the focus ring is 3.4:1 (light) and 6.8:1 (dark) on the glass. The
ember is never the only signal: the active column is also the one in front, unread counts are ink badges.

**Licences.** Manrope: SIL OFL 1.1. Icons: Phosphor (MIT), only the glyphs used. Wallpaper: Phoenix's own
`phoenix.jpg` (Apache-2.0). Album art, the orb and the slider drawn for these mocks; no Palm, HP or Onyx
art is copied. **Rendering note:** `render.cjs` composites on Chromium's GPU path (SwiftShader), because
its software compositor drops a large backdrop blur at 2x and 2.5x.
