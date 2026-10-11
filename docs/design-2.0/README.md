# Phoenix 2.0: the UI layer's design directions

After the first device image, Phoenix forks into a 2.0 repository and
rebuilds every built-in app on a new **Phoenix UI layer**, implemented on
Enact (the recommended base), Ionic and Flutter (ROADMAP.md). This folder
holds the exploration of its look, made on 11 October 2026 from the
owner's brief: unified, modern and clean; an homage to Enyo 2's Onyx with
some webOS flair; transparency, blur and glass, and Material, welcome.

These are mock-ups drawn in HTML and CSS, not the shipping apps. Every
direction draws the same screens with the same content, on a Fairphone 6
sized phone (1116 × 2484) and a 1280 × 800 tablet, in light and dark.

**The owner chose Ember Glass** (11 October 2026; OPEN-QUESTIONS Q119).
[BUILD-PLAN.md](BUILD-PLAN.md) says how it becomes the UI layer for Enact,
Ionic and Flutter, in its own repository, `ember-glass-ui`;
[../SYSTEM-UI-2.md](../SYSTEM-UI-2.md) how the shell is drawn in it, with
screenshots beside the renders in `img/system-ui-2/`.

## Look at them

- [gallery.html](gallery.html): one screen across all five directions,
  each direction's case (idea, heritage, strengths, weaknesses, graphics
  cost), and every screen at once. Open it in a browser from this folder.
- `img/<direction>/`: the renders (JPEG) and each direction's contact sheet.
- [BRIEF.md](BRIEF.md): the brief the designers worked from.

| Direction | In a line | Spec | Every screen |
| --- | --- | --- | --- |
| Aurora Glass | Frosted glass over the wallpaper, the accent sampled from it | [SPEC](directions/aurora-glass/SPEC.md) | [sheet](img/aurora-glass/contact-sheet.jpg) |
| Onyx Reborn | Enyo 2's Onyx redrawn: charcoal chrome, pills, groupboxes, sliding panels | [SPEC](directions/onyx-reborn/SPEC.md) | [sheet](img/onyx-reborn/contact-sheet.jpg) |
| Phoenix Material | Material 3's colour from the wallpaper, on solid surfaces; glass only in webOS's frame | [SPEC](directions/phoenix-material/SPEC.md) | [sheet](img/phoenix-material/contact-sheet.jpg) |
| Ember | Calm and spatial: hairlines, light type, depth from light; the phoenix as an ember accent | [SPEC](directions/ember/SPEC.md) | [sheet](img/ember/contact-sheet.jpg) |
| Ember Glass | Ember made of glass over the phoenix wallpaper, Enyo 2's slider at the bottom left of every tablet column, Onyx Reborn's long fading gesture light lit gold to ember (the owner's request) | [SPEC](directions/ember-glass/SPEC.md) | [sheet](img/ember-glass/contact-sheet.jpg) |

Screens in each: Messaging (list and conversation, two Synergy accounts),
Settings, Music, the card view (phone); Email and Calendar (tablet); a
component sheet.

## Open choices

- Ember Glass: a slider on the first column too (the original Email had none on its accounts pane; the owner
  asked for every column), the active column's slider lit or every slider
  at rest, and a tint the shell raises automatically over a brighter
  wallpaper than the phoenix.
- Ember Glass departs from Ember where glass needed it for WCAG AA: the
  dimmest text one step stronger, darker dark panels, Calendar's hour rows
  4 px shorter.

## Make the renders again

`directions/<slug>/` holds each direction's pages (`screens/*.html`), its
styles and scripts, `render.cjs` (Playwright's Chromium) and the contrast
tools the designers used (`tools/`, and `tools/agent-a/` for Aurora Glass
and Onyx Reborn). The repository leaves out the wallpapers (copies of
`apps/settings/public/wallpapers`) and the fonts (Manrope, Inter and
Figtree, all SIL OFL, from Google Fonts; LEGAL.md keeps font files out of
the tree). Put them back and render:

```sh
sh docs/design-2.0/restore-assets.sh
NODE_PATH="$(npm root -g)" node docs/design-2.0/directions/ember-glass/render.cjs
```

The full-size PNGs (phone 1116 × 2484, tablet 2560 × 1600) come out in
`directions/<slug>/renders/`; the JPEGs here are the gallery's copies
(760 px wide for phones, 1600 px for tablets, quality 82).

## Where it came from

Drawn for Phoenix in this exploration: icons are the designers' own SVG
glyphs, the wallpapers are Phoenix's own (`apps/settings/public/wallpapers`,
PROVENANCE.md there), the sample people and messages are made up. No Palm,
HP, LG, Apple or Google art. Onyx's look is referred to, not copied: Onyx
Reborn and Ember Glass's slider are redrawn, citing the Enyo 2 sources
they follow (`third_party/enyo-2/onyx`, `third_party/enyo-2/layout`).
