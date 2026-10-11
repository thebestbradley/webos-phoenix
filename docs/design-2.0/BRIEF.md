# Phoenix 2.0 UI layer: design exploration brief (shared by both design agents)

## The project
webOS Phoenix brings the webOS 1.x-3.x experience (cards, gestures, Just Type,
notifications, Synergy) to modern phones and tablets on webOS OSE. After the
first device image, the project forks into a 2.0 repository and rebuilds every
built-in app on a new **Phoenix UI layer** implemented three times: on
**Enact** (the recommended base), **Ionic** and **Flutter**. This exploration
picks its look. The owner will choose among the directions, or mix them.

## What the owner asked for (11 October 2026, their words summarised)
- Unified, modern, clean; futuristic is welcome, clutter is not.
- Homage to the **Enyo 2 (Onyx)** style, and some **webOS flair**.
- Likes **transparency, background blur, glass**, and **Material** design,
  but is open to exploring.
- Renders of a few built-in apps, several versions to choose from.

## Read first (read-only: never modify the repository /home/user/webos-phoenix)
- Onyx, Enyo 2's widget set: `third_party/enyo-2/onyx/css/*.less` (and
  `third_party/enyo-2/onyx/images`): toolbars, buttons, groupbox, pickers,
  the onyx blue. `apps/enyo2-demo*` or the Enyo 2 demo app if present.
- Phoenix today: `apps/shared/phoenix-ui/src` (components), `docs/APP-SDK.md`
  section 8 (the design layer's tokens), `apps/settings`, `apps/messaging`,
  `apps/email` or the original Email (`third_party/` Enyo 1.0 apps) to know
  what each app has to show.
- webOS flair to draw on: cards with rounded corners, the app menu tab at
  the top left, the status bar, the gesture area, notifications at the
  bottom, Just Type, Synergy's merged accounts (a person's contacts from
  several accounts, one inbox), the webOS curved-glass status bar.
  Screenshots of the current simulator are in `docs/screenshots`.
- Wallpapers (use them behind glass): `apps/settings/public/wallpapers/*.jpg`
  (northern-lights, phoenix, lily-pads, river-stones, ...).
- Fonts: Open Sans ships with Phoenix (`shell/assets/fonts/`). You may use
  other fonts only under the SIL OFL or Apache-2.0 and must name them and
  their licence in your spec; keep any font files out of the repository.
- Licensing: no Palm, HP, LG, Apple or Google logos or art. Icons: draw your
  own simple SVG glyphs, or use an Apache/MIT/ISC icon set (name it).

## What every direction renders (same content, so the owner can compare)
Use realistic sample content (names, messages, dates), not lorem ipsum.
1. **Messaging, phone**: a conversation list, and an open conversation
   with bubbles from two Synergy accounts (e.g. SMS and Jabber) and the
   compose bar.
2. **Email, tablet (landscape)**: the panes: accounts/folders, the message
   list, the open message.
3. **Calendar, tablet**: a week or day view with events from two calendars.
4. **Settings, phone**: the main list (Wi-Fi, Bluetooth, Wallpaper, ...)
   with toggles.
5. **Music or Photos, phone**: now playing, or an album grid.
6. **Component sheet**: buttons (primary, secondary, destructive), toggle,
   checkbox, slider, text field, list rows, header/toolbar, tabs or
   segmented control, a dialog/popup, a banner notification, the app menu.
Each screen in **light and dark**. Show the webOS frame where it matters
(status bar, app menu tab, card corners, gesture area) at least once per
direction; one render of the **card view** (several app cards side by side
over the wallpaper) per direction is a plus.

## Sizes
- Phone: the Fairphone 6 panel, 1116x2484 px: render at CSS 446x994 with
  deviceScaleFactor 2.5.
- Tablet: CSS 1280x800 with deviceScaleFactor 2 (2560x1600 px).

## How to make the renders
Write each screen as HTML + CSS (no build step; inline SVG for icons;
`backdrop-filter` for glass), then render PNGs with Playwright's Chromium:
`NODE_PATH="$(npm root -g)" node render.cjs` (Playwright is installed
globally; the browser is at /opt/pw-browsers; do NOT run `playwright
install`). Look at every PNG yourself (Read the image) and fix what looks
wrong: overflow, clipped text, poor contrast, misaligned grids. Keep it
achievable: everything must be buildable in Enact (CSS), Ionic (CSS) and
Flutter (BackdropFilter, ...); note any effect that would be expensive on a
mid-range phone GPU (blur radius, layers) and give a cheaper fallback (e.g.
for the Raspberry Pi: no live blur, a pre-blurred wallpaper).

## What to write for each direction
In `<your folder>/<direction-slug>/`:
- `index.html` sources per screen, `render.cjs`, and `renders/*.png`
  (name: `<screen>-<light|dark>.png`).
- `SPEC.md` (one page): the idea in two sentences, what it takes from Onyx
  and from webOS, tokens (colour palette with hex, type scale, radii,
  spacing, elevation/blur levels, motion), the components' look, how each
  of Enact / Ionic / Flutter would implement the hard parts, the GPU cost
  and fallback, accessibility (contrast ratios of text on glass: WCAG AA).
- A `contact-sheet.png`: every screen of the direction, small, on one image.

## Rules
- Never modify /home/user/webos-phoenix (read only). No git commits.
- Disk is tight (about 2.5 GB free): keep PNGs reasonable (optimise with
  the PNG encoder; no videos); delete scratch files you made.
- Never name an AI model in any file.
- Report: per direction, two sentences on the idea, the render paths, and
  your own honest view of its strengths and weaknesses.
