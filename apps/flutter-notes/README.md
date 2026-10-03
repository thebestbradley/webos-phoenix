# Notes (Flutter), a 2.0 framework demo

The Notes demo in **Flutter** (3.47, Material 3), for phones and tablets,
built as a Flutter web app so it runs in Phoenix's web runtime today. It is
here to show how Flutter looks, works and feels as a framework for Phoenix
2.0 apps, beside the Enact demos and the Ionic one (`../ionic-notes`). All
of them use the same notes in db8.

- **Tablet** (900 px and wider): the folders, the notes and the open note
  side by side. From 768 px the folders stay beside the notes and a note
  takes their place.
- **Phone**: the folders are a drawer; a note takes the screen, and Back
  (its button, or the webOS back gesture, which reaches the app as Escape)
  returns to the list. Escape closes menus, dialogs, sheets, the drawer and
  Settings first.
- Notes are plain Markdown, edited as Markdown (a text field) with a
  Preview (flutter_markdown_plus) whose task boxes can be checked. The Aa
  sheet applies Apple Notes' styles as Markdown; Enter continues a list
  (however it arrives: key, on-screen keyboard or IME), Tab nests it,
  Ctrl+B/I/E style the selection.
- Rows swipe right to pin and left to delete (Undo in the snack bar),
  long press for the rest. Search with filter chips; sort and date sections
  in the ⋯ menu. Settings: light or dark, the Material 3 colour the scheme
  is built from, sort, text size, what new notes start with.

## How it fits Phoenix

- **Luna**: `lib/src/platform_web.dart` calls the web runtime's
  `PalmServiceBridge` from Dart (`dart:js_interop`), the same bus the web
  apps use.
- **The model** (`lib/src`) is a Dart port of `@phoenix/notes-core`: the
  same db8 kinds and calls, Markdown handling, editing commands (with the
  same tests, `test/`) and date sections. `test/parity_test.dart` reads
  notes-core's sources and checks the kinds, app ids and welcome note still
  match.
- **Offline**: CanvasKit (the renderer) and the fonts (Roboto, DejaVu Sans
  Mono; `fonts/`, licenses there and in `docs/LEGAL.md`) are bundled.
  Without them Flutter fetches both from Google's CDN.
- **Accessibility**: Flutter draws into a canvas; its semantics tree (a
  hidden DOM for screen readers) is switched on at start, and it is also
  what `tools/test-flutter-notes.cjs` drives.

## Building

Install Flutter 3.47 (macOS: `brew install --cask flutter`; Linux:
<https://docs.flutter.dev/get-started/install/linux>). `cmake --build`
builds the app when it finds `flutter`, and leaves it out otherwise. By
hand:

```sh
tool/build.sh          # flutter build web into dist/, see the script
flutter test           # unit and widget tests
dart analyze
node ../../tools/test-flutter-notes.cjs   # in headless Chromium, with the Ionic demo
```

`tool/build.sh` also removes the renderers a CanvasKit build never loads
(Skwasm, wimp, webparagraph) and debug symbols, which Flutter copies in
anyway: 19 MB instead of 42 MB.

## Findings for 2.0

- **Web build today, native later.** The web build is one route; LG's
  Flutter for webOS (`github.com/lg-flutter-webos`, webOS TV 26 and later)
  is a native embedder, which would run Flutter apps without a browser and
  with their own Luna bindings. It targets LG's TVs, so using it on Phoenix
  means building the embedder for OSE and our devices. The Dart side of
  this app (everything but `platform_web.dart`) would move over unchanged.
- **Size and start-up**: about 19 MB (CanvasKit is 5-7 MB of WebAssembly,
  the app 3 MB of script); it takes a moment longer to start than the web
  demos.
- **In phoenix-sim** it needs Qt 6.6 or later: Flutter loads its renderer
  and fonts with `fetch()`, which Chromium allows on the simulator's
  `phoenix://` scheme only with Qt's `FetchApiAllowed` flag (new in 6.6).
  Checked in phoenix-sim with Qt 6.9.3; with Qt 6.4 the app stays blank.
  The faster Skwasm renderer (`--wasm`) needs WasmGC, in Chromium 119 and
  later.
- **Language**: Flutter's engine stops at start if `navigator.language` is
  not a language tag (Chromium on a machine with no locale reports
  `en-US@posix`). A device with its language set is fine; the tests set
  one.
- **Task boxes**: flutter_markdown_plus draws a box only for a tight
  list's items; in a list with blank lines between its items the boxes are
  not drawn (the other demos draw them). `lib/src/markdown.dart` counts the
  boxes the same way, so checking them never hits the wrong one.
- **Look**: Material 3 through and through; a Phoenix look would be a
  Flutter theme (colours, shapes, type), which Flutter makes easy.
