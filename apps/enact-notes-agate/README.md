# Notes (Agate), an Enact demo (temporary)

The Limestone demo's notes app (`../enact-notes-limestone/README.md`) in
Enact's **Agate** theme: LG's touch-first theme for car dashboards, with
seven skins (Gallium, Carbon, Cobalt, Copper, Electro, Silicon, Titanium),
day and night variants and your own accent and highlight colours. The two
demos share their notes, so a note written in one is in the other.

It shows Agate's own ways of doing things: the folders are the tab rail of
TabbedPanels (with a Settings tab), Edit and Preview are a TabGroup, the
note's actions are a full-screen PopupMenu of LabeledIconButtons, its info
slides out in a Drawer, the Aa styles are a ContextualPopup of grid
buttons, a checklist's progress is a ProgressBar, and Settings uses a
Dropdown, ColorPickers, an ArcSlider and a SliderButton.

## Enact components used

ThemeDecorator, TabbedPanels, Panel, Heading, BodyText, Item, Icon, Button,
LabeledIconButton, ToggleButton, TabGroup, ContextualPopupDecorator,
PopupMenu, Popup, Drawer, Input, Scroller, VirtualList, ProgressBar,
Spinner, RadioItem, CheckboxItem, SwitchItem, Dropdown, SliderButton,
ArcSlider, ColorPicker; `@enact/ui` Layout and resolution;
`@enact/webos` LS2Request, under the Phoenix service plugin
(`@phoenix/enact`: the db8 calls, Back, the app menu, received shares and
Just Type's New Note action; [docs/APP-SDK.md](../../docs/APP-SDK.md)).
Custom styles follow the skin through Agate's `.applySkins` LESS mixin. The
Phoenix skin is Agate's Carbon in the Phoenix palette, with Phoenix's fonts
(`phoenixAgate`, `setPhoenixFonts`).

## Building

As for the Limestone demo (an npm project of its own; notes-core built
first):

Needs Node.js 20.12+, 22 or 24+ (Enact's CLI refuses odd releases such
as 23).

```sh
cd apps && npm ci && npm run build
cd enact-notes-agate && npm ci && npm run build   # writes dist/
```

## Notes

- Agate's text fields lock the pointer while editing, as Limestone's do
  (see that README); Enter ends editing.
- Agate's IconList names a `trash` icon its font has no glyph for (3.3.0),
  so Recently Deleted uses `uninstall`. Its HTML template's viewport tag is
  missing a comma, which Chromium reports as a warning.
