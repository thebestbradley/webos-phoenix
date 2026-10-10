# Notes (Limestone), an Enact demo (temporary)

A notes app in the style of Apple Notes on an iPad, written in LG's Enact
framework with its **Limestone** theme, the look of current webOS TVs. It
is here to show how Enact looks, works and feels; the Agate demo
(`../enact-notes-agate`) is the same app in Enact's touch theme, and both
use the same notes.

- Folders (All Notes, Notes, your folders, Recently Deleted), notes in date
  sections (Pinned, Today, Yesterday, Previous 7 Days, ...), the open note.
  On a tablet the folders are a button away (top left of the list).
- Notes are plain Markdown: CommonMark with GitHub's tables, task lists,
  strikethrough and autolinks. Nothing of our own is added to the syntax.
  The note opens as Markdown; Preview renders it, and its task boxes can be
  checked. The Aa menu applies Apple Notes' styles as Markdown (Title,
  Heading, Body, lists, Monostyled, bold, ...). Enter continues a list; Tab
  nests it.
- Search across all notes, with filters for notes with checklists, tables,
  links or code. Pin, move, delete (kept 30 days in Recently Deleted),
  recover. Settings: skin (dark or light), text size, sort order, date
  sections, what new notes start with; About lists the Enact components
  used.

The shared parts (db8 store, Markdown, editing commands, date sections, the
app state as a React hook, the editor and preview) are in
`../shared/notes-core`; each app styles the editor and preview for its
theme.

## Enact components used

ThemeDecorator, Panel, Header, Item, Heading, BodyText, Icon, Button,
TooltipDecorator, ContextualMenuDecorator, InputField, InputPopup, Chips,
Scroller, VirtualList, Popup, Alert, RadioItem, CheckboxItem, SwitchItem,
Dropdown, Slider, Spinner, PopupTabLayout; from `@enact/ui`, Layout and
resolution; from `@enact/webos`, LS2Request, under the Phoenix service
plugin (`@phoenix/enact`: the db8 calls, Back, the app menu, received
shares and Just Type's New Note action; [docs/APP-SDK.md](../../docs/APP-SDK.md));
Spotlight for focus. Enact has no multi-line text field, so the editor is a textarea
styled from Limestone's colour tokens.

## Building

Enact's CLI (`enact pack`) expects an app's packages in the app's own
`node_modules`, so this is an npm project of its own, not a workspace of
`apps/`. notes-core is built first and copied in (`install-links`):

Needs Node.js 20.12+, 22 or 24+ (Enact's CLI refuses odd releases such
as 23).

```sh
cd apps && npm ci && npm run build        # builds shared/notes-core/lib too
cd enact-notes-limestone && npm ci && npm run build   # writes dist/
```

CMake (`PHOENIX_BUILD_APPS`) and CI do the same. After changing notes-core,
run `npm ci` here again. `npm run typecheck` checks the TypeScript;
`src/enact.ts` corrects the few mistakes in Enact's generated type
definitions.

## What we learned about Enact here

- **Limestone is made for a TV.** Type and controls are sized for a room
  away; on a 1024-pixel tablet three columns do not fit, so the folders
  become a button. Focus moves with a remote (Spotlight); on a touch screen
  it is turned off at start (`noAutoFocus`).
- **Text fields lock the pointer while editing** (Limestone and Agate): the
  first tap outside a field only ends the editing, a second tap acts. This
  suits a remote and an on-screen keyboard, not a touch screen. Enter ends
  editing too.
- **Back steps up a level**: in the settings popup, Back first returns from
  a panel to the tabs, then closes.
- **Limestone needs a recent Chromium**: its CSS uses relative colours
  (`color(from ...)`, Chromium 119+). With Qt 6.4's WebEngine (Chromium 102,
  Ubuntu 24.04) some backgrounds are missing, e.g. the search field; Qt
  6.8+ and current webOS are fine. Agate has no such needs.
- `tools/test-enact-notes.cjs` drives both demos.
