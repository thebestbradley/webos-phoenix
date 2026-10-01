# The gesture bar: adaptive and animated

A plan, not built yet. Phoenix's gesture area (`shell/qml/Phoenix/Shell/GestureArea.qml`)
does what the Pre's did: swipe up for card view, down to go back into the
card, left for back, right for forward, a tap to toggle, and (Phoenix) a
hold and slide to move the cursor while the keyboard is up. Today it shows a
thin bar that brightens for 600 ms after any gesture. This plan:

1. brings back the original light bar's animations (1.x);
2. uses the dead space at the ends for buttons that change with the app
   (1.x, off by default; on in 2.0);
3. gives 2.0 a modern bar whose glow, thickness and motion say what the
   gesture did and teach what it can do.

The swipe gestures do not change in either line: the buttons only take taps
at the ends, and any drag that starts on a button is still a gesture.

## 1. What the original did

The Pre 2, Pre 3 and Veer had no centre button; their gesture area had a
row of LEDs, the light bar. `CoreNaviManager` (`luna-sysmgr`
`Src/base/CoreNaviManager.cpp:253-330`, `CoreNaviLeds.cpp`) animated it
for each gesture:

| Gesture | Light bar | Timing |
| --- | --- | --- |
| Up (launcher, quick launch) | "Waterdrop": the centre lights and the light spreads to the ends | 200 ms in, 400 ms out (centre); 300 / 400 ms (sides) |
| Down | The waterdrop in reverse: the ends light and it gathers to the centre | the same |
| Back / previous | A full swipe to the left | `m_animationSpeed` |
| Next / menu | A full swipe to the right | the same |
| Hold | "Seesaw": the light rocks left and right while held | 500 ms |
| A card is maximized | The bar stays lit (dim in the "subtle" setting) | |
| Card view, screen off | The bar is off | |

Brightness followed the ambient light sensor, and the light came back on
1.3 s after a gesture when a card was still maximized.

## 2. 1.x: the light bar, faithfully

On screen, the bar is an LED strip drawn in the gesture area: a row of
soft dots under a diffuser, as the Pre 3's looked. It plays exactly the
table above (waterdrop, reverse waterdrop, full swipes, seesaw), with the
original timings, and is lit while a card is maximized and off in card
view. Settings > Screen & Lock gets the original's "Light bar" switch and
"Subtle" option. Reduce Motion replaces the animations with a single
brighten.

Devices that have a real gesture area with LEDs (the Pre 2, Pre 3 and Veer,
if Phoenix ever runs on them; see [HARDWARE.md](HARDWARE.md)) drive the
LEDs with the same effects through nyx's LED controller, as webOS did.

## 3. Dynamic buttons at the ends

The gesture area is a full-width strip, and swipes start in its middle.
Each end gets room for one button (about 44 points, the strip's height),
shown only when it has something to do:

| Where | When | Button |
| --- | --- | --- |
| Left | The keyboard is up | Hide the keyboard |
| Left | A web app or Android app can go back | Back (the same as a left swipe, for people who do not know the swipe) |
| Right | The keyboard is up | Text Assist: dictate |
| Right | Media is playing in another card | Play / pause (a hold opens the now-playing dashboard) |
| Right | A call is active and its card is not in front | Return to the call |
| Either | The screen is rotated and rotation lock is on | Rotate (as Android's rotation suggestion) |
| Either | An app asks (a later API, as `org.webosphoenix.gesturebar setButton {icon, label}`) | The app's own action; one per app, only while its card is in front |

Rules:

- **A button never takes a swipe.** A press that moves more than the
  gesture threshold (`Theme.px(30)`) is a gesture, wherever it started.
- **At most one button at each end**, chosen by the order above.
- **Buttons appear and leave with a short fade and slide** from the end
  (150 ms), never jumping the bar.
- **1.x: off by default** (Settings > Screen & Lock > Gesture area
  buttons), because the original had none. **2.0: on.**
- **Accessibility:** each button has a label for the screen reader, and the
  switch control can reach them.

## 4. 2.0: an animated bar

The bar is a pill in the middle of the area. It says what happened, and
teaches.

| What | The bar |
| --- | --- |
| At rest, card maximized | A thin pill, softly lit, in the app's accent colour taken from its icon |
| At rest, card view | Dimmer and shorter |
| Finger down | It thickens under the finger and glows (a press) |
| Dragging | It follows the finger a little (stretches toward it, up to a third of its length), so the user sees the gesture being read |
| Swipe up | A glow rises out of the bar as the card shrinks; the bar shrinks to card view's |
| Swipe down | The glow falls into the bar as the card grows |
| Back / forward | A light runs along the bar in the swipe's direction (the original's full swipe) and the pill nudges that way |
| A swipe that does nothing (no back) | The pill shakes once, gently |
| Hold for cursor control | The bar becomes a track with a dot that moves with the cursor |
| Hold for the assistant (see [AI-AND-MCP.md](AI-AND-MCP.md)) | A slow breathing glow while it listens; it ripples with the voice |
| A notification arrives | A short pulse in the notification's colour (the original's blink, moved to the bar) |
| Charging, screen off but always-on display | A slow fill along the bar with the charge level |

Teaching:

- **First Use** has a short lesson with the bar: it shows each gesture as
  a light moving along the bar, and the user repeats it.
- **The first ten times** a user taps the gesture area to go back (a tap
  toggles card view), the bar shows the left-running light to suggest the
  swipe.
- **After an update** that adds a gesture, the bar plays that gesture's
  light once.

Motion follows `Theme.motion()` (so Reduce Motion turns it into fades), and
nothing animates while the screen is off unless the always-on display is
on.

## 5. Work

| Step | What | Line | Effort |
| --- | --- | --- | --- |
| GB1 | Light bar: the original's effects and timings, lit when maximized, off in card view; Settings switch and Subtle; tests | 1.x | S (1 week) |
| GB2 | End buttons: keyboard hide, Back for sites and Android, play/pause, return to call; the never-takes-a-swipe rule; Settings switch (off) | 1.x | M (2 weeks) |
| GB3 | `setButton` API for apps; screen-reader labels | 1.x / 2.0 | S |
| GB4 | 2.0 bar: thickness and follow on press and drag, the gesture glows, the no-op shake, accent colour | 2.0 | M (2 to 3 weeks) |
| GB5 | Teaching: First Use lesson, hints, new-gesture replays | 2.0 | S |
| GB6 | Real LEDs on devices that have them (nyx LED controller) | 1.x, device | S, when such a device runs Phoenix |

## Open questions for you

1. Which end buttons matter most to you? The table's order is a guess.
2. Should apps get `setButton` in 1.x, or only in 2.0?
3. In 2.0, the accent colour from the app, or one colour for the system?
