# Building Phoenix apps: the Phoenix service plugin

This is the guide for developers who write apps for webOS Phoenix. Phoenix
2.0's recommended app stack is **a layer on top of frameworks you already
know, not a new framework** (the owner's direction, 10 October 2026):

- **Enact** (LG's Apache-2.0 successor of Enyo, on React) is the
  recommended base, with the Phoenix design layer on it;
- **React**, **Ionic** (with or without Capacitor), **plain web pages and
  PWAs**, and **Flutter** are supported too.

Whatever the framework, an app reaches the system through **the Phoenix
service plugin**: one API, the same names everywhere, over the same Luna
service bus that webOS apps have always used. "Hybrid" in Phoenix's plans
means a *design* that blends the Enyo-era webOS look with Flutter's and
Ionic's polish, not a framework.

How the web runtime itself works (PalmSystem, the simulated services, the
apps already in Phoenix) is in [APP-RUNTIME.md](APP-RUNTIME.md); this page
is about the public API. Writing a Synergy connector (an account type) is
in [SYNERGY-SDK.md](SYNERGY-SDK.md).

**Status (October 2026).** Version 0.1.0 of every package, built and tested
in this repository; not yet published to npm or pub.dev. The four Notes
demos (`apps/enact-notes-agate`, `apps/enact-notes-limestone`,
`apps/ionic-notes`, `apps/flutter-notes`) are built on it.

## Contents

1. [The packages](#1-the-packages)
2. [Getting started](#2-getting-started), per framework
3. [How calls work](#3-how-calls-work): promises, subscriptions, errors, capabilities
4. [The API](#4-the-api), area by area, with examples
5. [The bindings](#5-the-bindings): React hooks, the Capacitor plugin, Enact, Dart
6. [Packaging an app](#6-packaging-an-app): appinfo.json
7. [Testing](#7-testing): unit tests, the browser, the simulator
8. [The design layer](#8-the-design-layer)
9. [Licences, versions, publishing](#9-licences-versions-publishing)

## 1. The packages

| Package | Where | For | What |
| --- | --- | --- | --- |
| `@phoenix/sdk` | `apps/shared/sdk` | every web app | The API itself: framework-neutral TypeScript, ES module plus types. `@phoenix/sdk/testing` has a fake bus |
| `phoenix-sdk.js` | `apps/shared/sdk/dist/phoenix-sdk.js` | pages with no bundler, PWAs | The same API as one script: the global `Phoenix` |
| `@phoenix/react` | `apps/shared/react` | React, Ionic React | Hooks: `useBack`, `useAppMenu`, `useLaunchParams`, `useShareReceiver`, `useWatch`, ... |
| `@phoenix/capacitor` | `apps/shared/capacitor` | Ionic and Capacitor apps | A Capacitor plugin (`registerPlugin("Phoenix")`) whose web implementation is the SDK |
| `@phoenix/enact` | `apps/shared/enact` | Enact apps (recommended) | The SDK over Enact's own `LS2Request`, the React hooks, `PhoenixDecorator`, the design layer for Enact |
| `phoenix_services` | `apps/shared/phoenix_services` | Flutter (web) and Dart | The same API in Dart: Futures and Streams, `dart:js_interop` to `PalmServiceBridge`, a stub elsewhere |

`@phoenix/sdk` is built from `@phoenix/luna`, the client Phoenix's own apps
use: its bridge (`call`, `subscribe`) and its service wrappers (share sheet,
pickers, contacts, files, location, ...) are the SDK's core, bundled into
the published files. `@phoenix/luna` itself stays internal to this
repository and can change; the SDK is the curated, versioned, documented
surface.

## 2. Getting started

Each framework's demo is the worked example: the same Notes app, sharing
its notes in db8 with the others.

### Enact (recommended): `apps/enact-notes-agate`, `apps/enact-notes-limestone`

```sh
npm install @phoenix/sdk @phoenix/react @phoenix/enact
```

```tsx
import ThemeDecorator from '@enact/agate/ThemeDecorator';
import {PhoenixDecorator, useAppMenu, useBack, useShareReceiver, useStageReady} from '@phoenix/enact';
import {share} from '@phoenix/sdk';

const App = () => {
	useBack(() => closeNote(), noteOpen);                     // the back gesture, while a note is open
	useAppMenu({                                              // Edit and Share come first
		items: [{label: 'New Note', onSelect: newNote}],
		share: () => (note ? {title: note.title, text: note.body} : null)
	});
	useShareReceiver((s) => newNote(s.text ?? s.url ?? ''));  // appinfo.json shareTargets
	useStageReady(loaded);
	return ...;
};

// Enact's LS2Request under the SDK, the Phoenix tokens and fonts.
export default PhoenixDecorator(ThemeDecorator(App));
```

`PhoenixDecorator` makes Enact's `@enact/webos/LS2Request` the SDK's
transport, so Enact's own requests and the SDK's go the same way
(LS2Request finds OSE's `WebOSServiceBridge` or `PalmServiceBridge`
itself). Everything `@phoenix/react` has is re-exported. An Enact app's
packages must sit in its own `node_modules` (Enact's CLI resolves nothing
else), so in this repository the demos take the plugin as built packages
(`file:../shared/...` with `install-links`, as notes-core).

### React: any React app

```sh
npm install @phoenix/sdk @phoenix/react
```

```tsx
import { AppMenu, useBack, useLaunchParams } from "@phoenix/react";

function App() {
    const { noteId } = useLaunchParams<{ noteId?: string }>();
    useBack(() => (editing ? (stopEditing(), true) : false));
    return <><AppMenu items={[{ label: "Preferences", onSelect: openPrefs }]} />...</>;
}
```

### Ionic and Capacitor: `apps/ionic-notes`

```sh
npm install @phoenix/sdk @phoenix/react @phoenix/capacitor @capacitor/core
```

```ts
import { Phoenix } from "@phoenix/capacitor";

await Phoenix.share({ title: note.title, text: note.body });
Phoenix.addListener("share", (s) => createNote(s.text ?? ""));
void Phoenix.stageReady();
```

The plugin is registered the Capacitor way (`registerPlugin("Phoenix", {web})`);
Phoenix runs web apps, so its implementation is the web one, over the SDK.
Ionic React apps can use the hooks of `@phoenix/react` beside it (the demo
does, for the app menu and Just Type). Ionic's own back button: the demo
hands the webOS back gesture to it with `app.onBack` (see `src/main.tsx`).

### Plain web and PWAs: no bundler

```html
<script src="phoenix-sdk.js"></script>
<script>
  Phoenix.applyTheme();                                  // the design layer's stylesheet
  Phoenix.appMenu.attach({ items: [{ label: "About", onSelect: showAbout }] });
  Phoenix.app.onBack(() => closeDialog());
  Phoenix.app.stageReady();
  if (Phoenix.has("share")) shareButton.hidden = false;
</script>
```

`phoenix-sdk.js` (about 45 kB, 15 kB gzipped) is
`apps/shared/sdk/dist/phoenix-sdk.js`, or `@phoenix/sdk/phoenix-sdk.js`
from the package. Copy it next to the app's `index.html`, or load the
system's copy, as Enyo apps load their framework from the device:
`<script src="/usr/palm/frameworks/phoenix-sdk/phoenix-sdk.js"></script>`
(`runtime/rootfs.json`: the simulator serves it there, and
`tools/install-rootfs.py` installs it there with the built web apps). The
app's own copy pins the version; the system's follows Phoenix's updates. A PWA that also
runs in ordinary browsers keeps working there: see [capabilities](#capabilities-and-degrading).

### Flutter: `apps/flutter-notes`

```yaml
dependencies:
  phoenix_services: ^0.1.0      # in this repository: path: ../shared/phoenix_services
```

```dart
import 'package:phoenix_services/phoenix_services.dart';

final phoenix = Phoenix.system();
phoenix.app.stageReady();
phoenix.share.receives.listen((s) => model.newNote(s.text ?? s.url ?? ''));
phoenix.appMenu.toggles.listen((_) => showAppMenu());
await phoenix.share.open(ShareContent(title: note.title, text: note.body));
```

Flutter apps run on Phoenix as Flutter web builds (see APP-RUNTIME.md,
Ionic and Flutter apps); `phoenix_services` reaches the bus through
`dart:js_interop` and `PalmServiceBridge`. Off the web (the Dart VM, a
native build) `Phoenix.system()` has no bus and `has()` says so; LG's
native Flutter embedder for webOS would be another transport later.

## 3. How calls work

### Promises, and any Luna method

Every call returns a promise. The named APIs below cover what apps need;
any Luna method is still a call away:

```ts
import { request, subscribeTo } from "@phoenix/sdk";

const os = await request("luna://com.webos.service.systemservice/osInfo/query", { parameters: ["webos_name"] });
```

### Subscriptions: Watches

A subscription (a Luna `subscribe: true` call, a db8 watch, a position) is a
**Watch**: give it a callback, or loop over it with `for await`; `cancel()`
ends it.

```ts
const w = location.watch((fix) => showOnMap(fix), (e) => showError(e));
// later
w.cancel();

for await (const fix of location.watch()) {
    if (closeEnough(fix)) break;          // leaving the loop cancels it
}
```

An error reply goes to the error callback and the subscription stays open
(Luna services may answer again); in a `for await` loop it ends the loop
with a throw. `w.latest` is the last value. In Dart a subscription is a
`Stream`; cancelling the listen cancels it.

### Errors: PhoenixError

A failed call rejects with a `PhoenixError` (Dart: `LunaException`): the
service's `errorCode` and `errorText`, the `uri`, the whole `reply`, and a
`code` that says what kind of failure it is:

| `code` | When |
| --- | --- |
| `unavailable` | No bus (a plain browser), or a service this device does not have (a Phoenix service on plain webOS OSE) |
| `permission-denied` | The service refused this app (its permissions), or the user said no (location) |
| `timeout` | No reply within `timeoutMs` |
| `not-found` | No such thing (an id, a file, an app) |
| `failed` | Anything else: `errorCode` and `errorText` say what |

```ts
try {
    const fix = await location.current();
} catch (e) {
    if (e instanceof PhoenixError && e.code === "permission-denied") askToAllowInSettings();
    else throw e;
}
```

### Capabilities and degrading

`has(capability)` says, synchronously, what this device offers, so one app
runs on Phoenix, on plain webOS OSE and in a desktop browser:

```ts
import { has, capabilities } from "@phoenix/sdk";

if (has("share")) menu.push({ label: "Share", onSelect: shareIt });
console.table(capabilities());
```

| Capability | Here when |
| --- | --- |
| `bus` | A Luna bus: `PalmServiceBridge` (or OSE's `WebOSServiceBridge`), or a transport you set |
| `webos` | PalmSystem (the webOS web runtime) |
| `phoenix` | Phoenix's runtime and services |
| `share`, `pickers`, `appMenu`, `ongoing`, `assistant`, `justType`, `clipboardHistory`, `print`, `notifications`, `files`, `contacts`, `calendar`, `messaging`, `email`, `accounts` | Phoenix |
| `media`, `mediaKeys`, `location`, `device`, `settings`, `activities` | a bus (OSE services) |
| `banner` | PalmSystem, a bus, or the browser's `Notification` when allowed |
| `dashboard`, `orientation`, `fullScreen`, `keepAlive`, `screenOn` | PalmSystem |

`has()` reads what the page can see. A service can still be refused at call
time (`permission-denied`), and `await available("com.webos.service.location")`
asks the bus whether a service is registered now (`com.palm.bus`
`signal/registerServerStatus`).

**Without Phoenix the SDK degrades and says so once** (a console warning per
missing service): requests fail with `unavailable`; `share.open` uses the
browser's `navigator.share`, else copies the text to the clipboard;
`pickers.open` uses a file input (the files come as `blob:` URLs with the
`File`); `pickers.save` downloads the file; `notifications.banner` uses the
browser's `Notification` when allowed, else the console; `app.setFullScreen`
uses the Fullscreen API; `print.page` uses `window.print()`. The app menu
and the back gesture work anywhere (the menu opens on whatever calls
`menu.open()` too).

### Transports

```ts
import { setTransport, type Transport } from "@phoenix/sdk";

const mine: Transport = {
    name: "mine",
    send(uri, params, onReply) { /* one reply, or many while params.subscribe */ return () => { /* cancel */ }; },
};
setTransport(mine);      // null goes back to PalmServiceBridge (or none)
```

`@phoenix/enact` sets one over Enact's `LS2Request`; tests set a fake bus.
A transport carries the SDK's own calls and the `@phoenix/luna` wrappers it
uses alike.

## 4. The API

Every name below is exported by `@phoenix/sdk` (and is on the global
`Phoenix` of `phoenix-sdk.js`). The Dart names follow in
[5.4](#54-dart-phoenix_services). Each section names the service it
calls; the services themselves are in APP-RUNTIME.md.

### App lifecycle: `app`

```ts
app.id                                  // "com.example.notes" (appinfo.json's id)
app.launchParams<T>()                   // what the app was (last) launched with: {} when nothing
app.onLaunch((p) => route(p))           // now, and at every relaunch; returns an unsubscribe
app.onRelaunch((p) => route(p))         // relaunches only (OSE's webOSRelaunch event)
app.onBack(() => closePane())           // the back gesture: return true when taken
app.onActiveChange((active) => ...)     // the card came to the front or left it
app.active                              // whether the card is in front
app.stageReady()                        // the first frame is drawn (PalmSystem.stageReady)
app.activate()                          // bring the card to the front
app.keepAlive(true)                     // stay loaded when the last card closes (headless work)
app.setOrientation("landscape")         // "free" | "up" | "down" | "left" | "right" | "landscape" | "portrait"
app.setFullScreen(true)                 // the maximized card takes the whole screen
app.keepScreenOn(true)                  // while the card is in front (a video, a recipe)
app.setStatusBarColor(0x223344)         // the tablet's status bar while maximized
app.locale, app.timeFormat, app.deviceInfo, app.onPhoenix
await app.launch("com.palm.app.email", { summary: "Hi" })   // applicationManager/launch
await app.open("https://example.com")   // applicationManager/open: the app for the URL or file
await appInfo("com.palm.app.email")     // getAppInfo: installed? its appinfo
```

**Back.** The shell gives the back gesture to the page as an Escape key (the
webOS Back key, 461, on a device). `app.onBack` handlers run innermost
(last added) first; the first that returns `true` takes it. When none does,
the system minimizes the card to card view, as webOS did at an app's top
level, so an app only takes Back while something is open to close.

### The app menu: `appMenu`

Tapping the app's name at the top left of the status bar opens the app
menu, as in every webOS app. Every app menu starts with **Edit** (Select All,
Cut, Copy, Paste) and **Share**, then the app's own items.

```ts
const menu = appMenu.attach({
    items: [{ label: "New Note", onSelect: newNote }, { label: "Preferences", onSelect: openPrefs }],
    share: () => (note ? { title: note.title, text: note.body } : null),   // null: Share dimmed
    // edit: false leaves Edit out; share: false leaves Share out; onShare: your own Share
});
menu.open(); menu.close(); menu.update({...}); menu.destroy();
```

`attach` draws the menu in the page with the design layer's look. An app
that draws its own (Flutter does) uses the parts: `appMenu.onToggle(cb)`
(the status bar's tap: Phoenix's `phoenixAppMenu` event, or LunaSysMgr's
`{"palm-command": "open-app-menu"}` relaunch), `appMenu.editState()`
(what Edit can do now), `appMenu.edit("copy")` and
`appMenu.shareContent(share)` (the app's content, else the page's
selection).

### Share: `share`

```ts
const r = await share.open({ title: "Recipe", text: "Flour, eggs", url: "https://...", files: [{ path, mimeType }] });
// r.action: "app" (r.appId) | "photos" | "files" (r.path) | "copy" | "cancel"
await share.targets(["image/png"])                   // the apps that take it, as the sheet lists them
share.received()                                     // what the app was launched with to receive, or null
share.onReceive((s) => createNote(s.title, s.text))  // at launch and each relaunch that brings a share
```

The sheet is the system's (`org.webosphoenix.share/open`): the same in every
app, with the apps that take the content and Save to Photos, Save to Files,
Copy. To be one of those apps, say what you take in `appinfo.json`
([6](#6-packaging-an-app)); the app is then launched (or relaunched) with
`{share: {title, text, url, files}}`.

### Pickers: `pickers`

```ts
const files = await pickers.open({ kinds: ["document"], extensions: ["pdf"], multiple: true });  // null: cancelled
const pic = await pickers.picture({ cropWidth: 256, cropHeight: 256 });     // pic.croppedPath: the crop
const path = await pickers.save({ name: "notes.txt", data: btoa(text), mimeType: "text/plain" });
```

Kinds: `image` (pictures by album), `video`, `audio`, `document`, `file` (any
file, by folder); with several, the user picks the kind first.
`org.webosphoenix.filepicker/pick` and `/save`.

### Telling the user: `notifications`, `ongoing`, `activities`

```ts
const id = await notifications.banner("Saved", { params: { noteId }, soundClass: "notifications" });
notifications.removeBanner(id);

await notifications.post({
    title: "Upload finished", body: "12 photos", params: { album }, tag: "upload",
    actions: { uri: "luna://com.example.app.service/notify", items: [{ id: "open", label: "Open" }] },
});
notifications.remove("upload");                 // the row of that tag

const win = notifications.dashboard("dashboard.html", { height: 104, persistent: true });
notifications.sound("alerts");

await ongoing.set({ id: "sync", title: "Syncing", body: "3 of 12", progress: 25 });
await ongoing.clear("sync");

await activities.schedule({ name: "com.example.app.sync", every: "1h", params: { sync: true } });
await activities.schedule({ name: "com.example.app.remind", at: new Date(Date.now() + 3600_000) });
await activities.cancel("com.example.app.sync");
```

A **banner** crosses the bottom of the screen (PalmSystem.addBannerMessage;
on plain OSE `com.webos.notification/createToast`). A **notification** is a
row in the notification area that opens the app with `params` when tapped;
a `tag` replaces the app's earlier row of that tag, and `actions` are
buttons that call the app's own service with `{action: id}` without
opening it. A **dashboard** is a small window of the app's own in the
notification area (a player's controls). An **ongoing activity** is a row
with progress that cannot be swiped away (`org.webosphoenix.ongoing`). An
**activity** launches the app later, running or not
(`com.palm.activitymanager`), with `params` and `{$activity}`.

### Just Type and the Assistant: `justType`, `assistant`

Both are declared in `appinfo.json` ([6](#6-packaging-an-app)) and reach
the app as a launch param, so they work whether the app was running:

```ts
justType.onAction("newNote", (text) => createNote(text));     // "New Note" with the words typed
justType.onResult("noteId", (id) => openNote(id));            // a content result tapped
assistant.onCommand("newNote", (text) => createNote(text));   // "new note buy milk"
await assistant.commands();                                   // the app's commands, as the Assistant has them
```

### Synergy: `contacts`, `calendar`, `accounts`, `email`, `messaging`

```ts
const people = await contacts.list();          // [{id, name, phoneNumbers, emails, photo, favorite}]
await contacts.search("mary");                 // by name, number or email
contacts.watch((people) => render(people));    // kept up to date
await contacts.get(id); await contacts.show(id);

await calendar.calendars();
await calendar.events({ from: monday, to: sunday });     // [{id, subject, start, end, allDay, location}]
await calendar.newEvent({ subject: "Dentist", start: when, location: "Main St" });  // Calendar, filled in
await calendar.showEvent(id);

await accounts.list("CONTACTS");               // the user's accounts that offer it ("MAIL", "CALENDAR", ...)
await accounts.manage();                       // Accounts, to add one

await email.compose({ to: ["a@example.com"], subject: "Notes", body: text, attachments: [{ path }] });
await messaging.compose({ to: "4085550101", text: "On my way" });
```

Contacts are the linked people of every account (db8 `com.palm.person:1`);
calendar events are `com.palm.calendarevent:1` (repeating events by their
first occurrence). Reading another app's db8 kinds needs the permission to:
on a device a third-party app may get `permission-denied`. Compose opens
the system's app with the draft for the user to send: Email with the SDK
email API's launch params (as Mojo's), Messaging with `{to, messageText}`
(an `sms:` link without Phoenix's Messaging).

### Device: `files`, `media`, `playback`, `location`, `device`, `clipboard`, `print`

```ts
await files.list("/media/internal/Documents");     // [{name, path, type, size, modified, ...}]
await files.readText(path); await files.writeText(path, text);
await files.mkdir(p); await files.copy(a, b); await files.move(a, b); await files.remove(p);
await files.url(path);                             // a URL an <img> or fetch() can load
await files.open(path);                            // in the app for its type

await media.images(); media.watchAudio((songs) => ...);    // the media indexer

const focus = playback.requestFocus(() => pause());        // the media audio focus; cancel() to give it back
playback.nowPlaying({ title, artist, playing: true });     // the shell's now playing, the Assistant's "what's playing"
const keys = playback.mediaKeys({ active: () => true, playing: () => playing, play, pause, next, prev });

const fix = await location.current();              // {latitude, longitude, horizAccuracy, ...}
location.watch((fix) => ...);
await location.reverse(fix.latitude, fix.longitude);

await device.info();                               // model, platform version, screen, osInfo
device.preferences(["locale", "timeFormat"], (p) => ...);
await device.vibrate("notification");

await clipboard.copy(text);                        // and into the clipboard history
await clipboard.copy(code, { sensitive: true });   // masked in the history, expires
await clipboard.readText(); await clipboard.history();

await print.page();                                // this page, as the user sees it
await print.images([path1, path2]);                // pictures, one a page
await print.printers();
```

The first location request of an app asks the user; a refusal is
`permission-denied`, Location Services off is `unavailable`. Printing goes
to `com.palm.printmgr` (in the simulator, Save as PDF).

## 5. The bindings

### 5.1 React: `@phoenix/react`

| Hook | Does |
| --- | --- |
| `useLaunchParams<T>()` | The launch params, updated on each relaunch |
| `useRelaunch(cb)` | cb at each relaunch |
| `useBack(handler, active?)` | The back gesture while `active`; components mounted later (inner panes) get it first |
| `useAppMenu(options)`, `<AppMenu ... />` | The app menu (`appMenu.attach`), with the options of the latest render |
| `useWatch(open, deps)` | `{value, error}` of a subscription: `useWatch((v, e) => location.watch(v, e), [])` |
| `usePromise(run, deps)` | `{value, error, loading}` of a call |
| `useShareReceiver(cb)` | Shares to the app |
| `useJustTypeAction(param, cb)`, `useAssistantCommand(param, cb)` | Just Type's action, an Assistant command |
| `useActive()` | Whether the card is in front |
| `useStageReady(ready?)` | stageReady once, after the first frame |
| `usePhoenixTheme()` | The design layer's stylesheet |
| `useRefresh()`, `<Refreshed>` | Settings > Apps > Opening a running app: Refresh |

### 5.2 Capacitor: `@phoenix/capacitor`

| Method | SDK call |
| --- | --- |
| `getInfo()` | `{appId, onPhoenix, capabilities, launchParams, locale}` |
| `has({capability})` | `has()` |
| `stageReady()`, `keepAlive({enabled})`, `setOrientation({orientation})`, `setFullScreen({enabled})`, `keepScreenOn({enabled})`, `launch({appId, params})`, `open({target})` | `app.*` |
| `share(content)`, `pickFiles(options)` (`{files, canceled}`), `saveFile(options)` (`{path, canceled}`) | `share.open`, `pickers.*` |
| `showBanner({message, ...})`, `postNotification(...)`, `removeNotification({tag})`, `setOngoing(...)`, `clearOngoing({id})`, `scheduleActivity(...)`, `cancelActivity({name})` | `notifications`, `ongoing`, `activities` |
| `listContacts({search})`, `calendarEvents({from, to})`, `listAccounts({capability})`, `composeEmail(...)`, `composeMessage(...)` | Synergy |
| `getCurrentPosition()`, `copyText({text, sensitive})`, `request({uri, params})` | device, any Luna method |

Events (`addListener`): `appMenu`, `relaunch`, `share` (a launch's share
waits for the first listener), `activeChange`, `backButton` (while a
listener is added the app takes every back, Capacitor's App plugin's rule;
use `app.onBack` from the SDK to decide case by case). Failures reject with
the SDK's `PhoenixError`.

### 5.3 Enact: `@phoenix/enact`

`PhoenixDecorator(App, {fonts?})`, `ls2Transport(LS2Request?)`,
`installEnactTransport()`, `setPhoenixFonts(on)`, `phoenixAgate` (Agate's
skin and colours in the Phoenix palette), `PhoenixHeader`, `tokens`, and
everything of `@phoenix/react`. See [8](#8-the-design-layer).

### 5.4 Dart: `phoenix_services`

`Phoenix.system()` (the page's; tests make `Phoenix(transport:, host:)`),
`has(Capability.share)`, `request(uri, params)`, `subscribe(uri, params)`
(a `Stream`), and the same areas: `app` (`id`, `launchParams`, `launches`,
`relaunches`, `onBack`, `activeChanges`, `stageReady`, `keepAlive`,
`setOrientation`, `setFullScreen`, `keepScreenOn`, `launch`, `open`),
`appMenu` (`toggles`, `editState`, `edit`), `share` (`open`, `received`,
`receives`), `pickers` (`open`, `save`), `notifications` (`banner`,
`removeBanner`, `post`, `remove`, `dashboard`), `ongoing`, `activities`,
`justType` (`actions`, `results`), `assistant` (`commands`, `registered`),
`contacts`, `calendar`, `accounts`, `email`, `messaging`, `files`,
`location` (`current`, `watch`), `device`, `clipboard`. Errors are
`LunaException` with `code` (`PhoenixErrorCode`). In a Flutter app the back
gesture also arrives as the Escape key, which Flutter's `Shortcuts` see:
use one or the other (flutter-notes uses Flutter's).
`package:phoenix_services/testing.dart` has `FakeBus` and `StubHost`.

## 6. Packaging an app

An app is a folder with `appinfo.json` and its built files; the launcher,
the share sheet, Just Type and the Assistant read `appinfo.json`:

```json
{
    "id": "com.example.notes",
    "version": "1.0.0",
    "vendor": "Example",
    "type": "web",
    "main": "index.html",
    "title": "Notes",
    "icon": "icon.png",
    "requestedWindowOrientation": "free",
    "phoenix": {
        "shareTargets": [{ "types": ["text/plain", "text/uri-list"], "label": "Notes" }]
    },
    "universalSearch": {
        "action": { "displayName": "New Note", "url": "com.example.notes", "launchParam": "newNote" },
        "dbsearch": {
            "displayName": "Notes", "url": "com.example.notes", "launchParam": "noteId",
            "launchParamDbField": "_id", "displayFields": ["title"],
            "dbQuery": { "from": "com.example.note:1", "where": [{ "prop": "title", "op": "?", "val": "" }] }
        }
    },
    "assistant": {
        "commands": [{ "id": "newNote", "displayName": "New note", "launchParam": "newNote",
                       "phrases": { "en": ["new note {text}", "note {text}"] }, "risk": "change" }]
    }
}
```

- `phoenix.shareTargets`: the MIME types the app takes from the share
  sheet (`image/*`, `text/plain`, `text/uri-list` for links, `*/*`); the
  app is launched with `{share: {...}}` (`share.onReceive`).
- `universalSearch`: Just Type's action (launched with `{newNote: words}`)
  and content search (`{noteId: _id}`), as luna-universalsearchmgr read them.
- `assistant.commands`: the Assistant's phrases; `send` and `delete` risks
  are read back to the user first.
- `requestedWindowOrientation`, and `app.setOrientation()` at run time.

Build the app (Enact: `enact pack`; Vite; `flutter build web`, with
`--no-web-resources-cdn` so nothing is fetched from Google's CDN) and put
`appinfo.json` and the icons next to its `index.html`. In this repository,
apps under `apps/` are found by the simulator by their `appinfo.json`; on a
device an app installs as an ipk (Developer Mode, Settings > Developer, or
Files opening the ipk; see APP-RUNTIME.md, Installing apps).

## 7. Testing

**Unit tests** with the fake bus (no browser, no device):

```ts
import { installFakeBus } from "@phoenix/sdk/testing";

const bus = installFakeBus();                        // also claims has("bus") and has("phoenix")
bus.handle("luna://org.webosphoenix.share/open", () => ({ action: "cancel" }));
await share.open({ text: "hi" });
expect(bus.callsTo("luna://org.webosphoenix.share/open")[0].params).toEqual({ text: "hi" });
bus.emit("luna://com.webos.service.location/getLocationUpdates", { latitude: 1, longitude: 2 });
bus.uninstall();
```

Unanswered methods fail as a missing service does (`unavailable`). Dart:
`FakeBus` and `StubHost` (`host.relaunch({...})`, `host.tapAppName()`,
`host.back()`).

**In a browser.** `tools/serve-rootfs.py` serves the virtual filesystem
with the Phoenix runtime and its simulated services, so an app runs in any
Chromium: `python3 tools/serve-rootfs.py --port 8600`, then
`http://127.0.0.1:8600/usr/palm/applications/<id>/index.html`.
`__phoenixRuntime.openAppMenu()`, `__phoenixRuntime.relaunch({share: {...}})`
and `__phoenixRuntime.back()` play the shell's part. The demos' tests do
just that: `tools/test-enact-notes.cjs`, `tools/test-ionic-notes.cjs`,
`tools/test-flutter-notes.cjs`, and `tools/test-app-sdk.cjs` for
`phoenix-sdk.js` in a page of its own.

**In the simulator**, the real shell, cards and gestures:

```sh
./phoenix run phone --launch com.example.notes --screenshot out.png --delay 8000
```

Tap the app's name in the status bar for the app menu; swipe back for Back;
share from another app's menu to reach yours.

## 8. The design layer

The Phoenix look as tokens, for any framework: the classic webOS (Enyo 1.0
Heritage) palette, Prelude falling back to Open Sans (Apache-2.0, shipped
with Phoenix), the app menu's dark glass with round lower corners.

```ts
import { tokens, cssVariables, themeCss, applyTheme } from "@phoenix/sdk";

tokens.color.background   // "#e4e4e2"
tokens.font.family        // Prelude, "Prelude Medium", ..., "Open Sans", ...
tokens.radius.menu        // 12
applyTheme();             // the stylesheet: --phx-* variables, .phx-app, .phx-header,
                          // .phx-group, .phx-row, .phx-button (.affirmative, .negative), the app menu
```

| Token | Value | From |
| --- | --- | --- |
| `--phx-color-background` | `#e4e4e2` | Heritage `theme.css` body |
| `--phx-color-text`, `-text-dim` | `#282828`, `#7a7a78` | |
| `--phx-color-label`, `-accent` | `#1f75bf` | `PickerButton.css` labels |
| `--phx-color-divider` | `#2d6c94` | `Divider.css` captions |
| `--phx-color-menu`, `-menu-text` | dark glass, white | the app menu |
| `--phx-font-family` | Prelude, then Open Sans | |
| `--phx-radius-menu`, `-button`, `-group` | 12, 26, 10 px | |

**Enact.** `PhoenixDecorator` puts the variables in the page and, unless
`{fonts: false}`, Phoenix's fonts over the theme's (not on icons).
`phoenixAgate` is Agate's light Carbon skin in the Phoenix palette: the
Agate demo offers it as its "Phoenix" skin, with the fonts
(`setPhoenixFonts`). Limestone keeps its own fonts, sized for a TV.
`PhoenixHeader` is a page header in the classic look.

**Ionic** apps can map the tokens onto Ionic's (`--ion-color-primary:
var(--phx-color-accent)`, `--ion-font-family: var(--phx-font-family)`),
**Flutter** apps onto a `ThemeData`. Phoenix's own apps use
`@phoenix/ui`, which draws the Enyo artwork itself; the tokens are its
values without the artwork, so the plugin carries no Palm/HP art.

## 9. Licences, versions, publishing

- Everything here is **Apache-2.0**. Dependencies: none for
  `@phoenix/sdk`; React (MIT) for the React and Enact bindings;
  `@capacitor/core` (MIT, with tslib, 0BSD) for the Capacitor plugin;
  `@enact/webos` (Apache-2.0) for the Enact binding; `package:web`
  (BSD-3-Clause) for the Dart package.
- **Versions** follow semver; `VERSION` in `@phoenix/sdk`. Before 1.0 a
  minor version may change the API; the method names follow the services'.
- **Building**: `npm run build` in `apps/` builds the packages (the SDK's
  ES modules, `phoenix-sdk.js` and declarations; the bindings' `dist/`).
  Publishing to npm (`npm publish -w @phoenix/sdk` ...) and pub.dev is for
  the owner to decide ([OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) Q62): the npm
  scope `@phoenix` would need to be ours.
- **Tests**: `npx vitest run shared/sdk shared/react shared/capacitor
  shared/enact` in `apps/`; `dart test` in `apps/shared/phoenix_services`;
  `node tools/test-app-sdk.cjs` and the demos' browser tests.
