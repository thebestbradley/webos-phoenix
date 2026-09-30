# Notes (Ionic), a 2.0 framework demo

The Notes demo in **Ionic Framework 9** (its React components), for phones
and tablets. It is here to show how Ionic looks, works and feels as a
framework for Phoenix 2.0 apps, beside the Enact demos
(`../enact-notes-limestone`, `../enact-notes-agate`) and the Flutter one
(`../flutter-notes`). All of them use the same notes in db8.

- **Tablet** (900 px and wider): the folders, the notes and the open note
  side by side (Ionic's split pane). From 768 px the folders stay beside
  the notes and a note opens as a page of its own.
- **Phone**: the folders are a side menu; a note opens as a page, pushed
  with the mode's transition, and Back returns to the list. So does the
  webOS back gesture (Escape), which the app hands to Ionic's hardware back
  button: it closes the side menu, then goes back a page.
- Notes are plain Markdown (CommonMark with GitHub's extensions), edited as
  Markdown with a Preview whose task boxes can be checked. The Aa panel
  (a popover on a tablet, a bottom sheet on a phone) applies Apple Notes'
  styles as Markdown; Enter continues a list, Tab nests it.
- Rows slide right to pin and left to move or delete; a deleted note can
  come back from the toast's Undo or from Recently Deleted (30 days).
  Search with filter chips; sort and date sections in View Options.
- Settings: Ionic's **iOS** or **Material Design** mode (the app restarts
  to switch), light or dark, sort, text size, what new notes start with.

The model is `@phoenix/notes-core`, the same code as the Enact demos (the
db8 store, Markdown, editing commands, the app state as a React hook, the
editor and preview). Luna calls go through `@phoenix/luna`.

## Ionic components used

IonApp, IonSplitPane, IonMenu, IonMenuToggle, IonMenuButton,
IonRouterOutlet and IonReactHashRouter (react-router 6), IonPage,
IonHeader (with the iOS large title), IonToolbar, IonTitle, IonButtons,
IonButton, IonBackButton, IonContent, IonFooter, IonList, IonListHeader,
IonItem, IonItemGroup, IonItemDivider, IonItemSliding, IonItemOptions,
IonLabel, IonNote, IonIcon (ionicons), IonSearchbar, IonChip, IonSegment,
IonProgressBar, IonSkeletonText, IonFab, IonModal (card and sheet),
IonPopover, IonRadioGroup, IonRadio, IonToggle, IonSelect, IonRange, and
the alert, action sheet and toast controllers.

## Building

It is a workspace of `apps/`, so `npm ci && npm run build` in `apps/` (or
`cmake --build`) builds it into `dist/`. `npm run dev` here serves it with
Vite. notes-core is taken from its sources (`tsconfig.json` paths and the
Vite alias), as the other workspaces do.

```sh
node tools/test-ionic-notes.cjs     # from the repository root
```

drives it in headless Chromium at tablet and phone size.

## Findings for 2.0

- **It works as it is.** Ionic's components are web components with React
  wrappers; nothing had to be patched. The build targets Chromium 100 (Qt
  6.4's WebEngine is 102); tested so far in current headless Chromium, not
  yet in phoenix-sim's WebEngine.
- **Size**: `@ionic/react` does not mark itself free of side effects, so
  every component ships: about 1.5 MB of script (350 kB gzipped), loaded
  from the device.
- **Back**: Ionic's hardware back button is on by default only in
  Capacitor apps; turned on here, it gives webOS's back gesture the right
  order (overlay, menu, page) with a few lines (`src/main.tsx`).
- **Mode is fixed at start**: switching iOS and Material Design needs a
  restart. A Phoenix look would be a third set of CSS variables over one of
  the two modes, not a mode of its own.
- **Routing**: Ionic 9's router takes react-router 6 (not 7); the hash
  router suits apps loaded from a file.
