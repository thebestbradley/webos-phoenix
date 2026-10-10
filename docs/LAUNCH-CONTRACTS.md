# Launch contracts: one app opening another

A button in one app that opens another app and fills it in (Contacts'
message button beside a number, a number tapped to call it, an address
opening Maps, Just Type's "Call") is a launch through the application
manager: `com.palm.applicationManager/launch {id, params}`, or `open {id,
params}` / `open {target}` (a `tel:`, `sms:`, `mailto:` link, a web address,
a file). It works only when two things agree:

1. **The id.** The original apps launch the apps of webOS by their ids
   (`com.palm.app.messaging`, `com.palm.app.phone`, `com.palm.app.maps`...).
   Where Phoenix replaces one, the runtime maps the id to Phoenix's app
   (`APP_ALIASES` in `runtime/phoenix-runtime.js`); a few launches go
   somewhere else for some params (`APP_ROUTES`: the phone app's
   `{preferences: true}` is Settings' Phone page).
2. **The params.** The app opened must read what the caller sends. Each
   Phoenix app that replaces an original reads the original's params as well
   as its own, in one place: its `src/launchParams.ts` (a normalizer, with
   unit tests), which lists the keys it reads; the app's `appinfo.json`
   lists the same keys in `"phoenix": {"launchParams": [...]}`.

`tools/check-launch-contracts.cjs` (CI) finds every launch and open with a
literal app id or target scheme in the original apps (`third_party/`), the
compat overlays, Phoenix's apps, the shell and the runtime, and Just Type's
actions in the apps' `appinfo.json` (`universalSearch`), resolves the id as
the runtime does, and fails when the app it reaches does not list a key it is
sent, or when no app answers. `tools/test-launch-contracts.cjs` taps the real
buttons in headless Chromium and checks what the app opened shows.

## What was wrong (10 October 2026)

The original Contacts' message button (`PseudoDetailsInApp.js:352-363`)
opens `com.palm.app.messaging` with `{compose: {personId, phoneNumbers:
[<the number's db8 object>]}}`, and the number itself (`:367-369`, via
`openPhoneApp`, `:342-351`) opens `com.palm.app.phone` with `{address,
transport: "com.palm.telephony"}`. Neither did anything: the runtime knew
those ids only in the shell's lists of boot and kept-alive apps
(`SimWindowSource._palmIds`), not in `APP_ALIASES`, so the launch named an
app that does not exist and the shell dropped it; and had it arrived,
Messaging read only `{to, name, messageText, threadId, share, attachment}`
and Phone only `{number, dial, target}`. The same held for every original
caller of Messaging and Phone (Just Type's contact actions, the contacts
framework's details dialogs, the browser's Share Link, luna-systemui's
"Phone Preferences"), for First Use and Date & Time from luna-systemui's
alerts, and for Music given an audio file (Files' Open, Email's
attachments). Calendar's "Add to Contacts" on an attendee
(`opencontact://`) had no handler, and Just Type's "Add Reminder" on a
contact (`{launchType: "reminder", personId}`) was not read by the TouchPad
Contacts app.

Before: 244 launches, 212 ✅, 2 ⚠, 30 ❌. After: 246 launches, 236 ✅,
3 ⚠, 7 ❌, each of the ten with its reason (5 to apps Phoenix does not
have; the table below).

## The contracts

Where each comes from: the code of the original app where it is in
`third_party/`, else its callers in the released sources, else the webOS
SDK's documentation of the application manager (said so).

### Messaging (`com.palm.app.messaging` → `org.webosphoenix.messaging`)

The original Messaging app is not in the open-source release; its contract
is its callers'. `apps/messaging/src/launchParams.ts`.

| Params | Caller | Phoenix |
|---|---|---|
| `{compose: {personId, phoneNumbers: [{value, type, ...}]}}` | Contacts' message button (`core-apps/com.palm.app.contacts/app/PseudoDetailsInApp.js:352-363`; `enyo-1.0/framework/lib/contactsui/UI/PseudoDetails.js:464`, `DetailsInDialog.js:309`); Just Type's message button on a contact's number (`luna-applauncher/data/AppLauncher.js:48-53`) | The conversation with that number if there is one (compared as the phone app compared caller ID, the last 7 digits), else a new message to it with the person's name; ready to type |
| `{compose: {personId, ims: [{value, type}]}}` | Contacts' IM address and Skype "Chat" (`PseudoDetailsInApp.js:316-326`, `:404-414`); Just Type (`AppLauncher.js:40-46`) | The conversation with that buddy, else a new message to them from the account they are a buddy of |
| `{personId, address, serviceName, type}` | Just Type's chat with an IM buddy (`AppLauncher.js:40-44`) | The same |
| `{compose: {messageText}}` | the browser's Share Link > Message (`isis-browser/source/ShareLinkDialog.js:169-176`) | A new message with that text |
| `compose.attachment` / `compose.attachments: [{fullPath \| path}]` | the webOS SDK (Messaging: "attachment") | The first picture attached |
| `{composeAddress}`, `{composeRecipients: [{address, serviceName}]}`, `{messageText}` | the webOS 1.x/2.x SDK's documented launch of Messaging; no caller in the released sources | A new message to the first address |
| `{threadId}`, `{to, name}`, `{messageText}`, `{attachment}`, `{share}`, `{target: "sms:…?body=…" \| "smsto:N:TEXT" \| "im:…"}` | Phoenix: notifications, the Assistant, Maps, Photos, the share sheet, links (`@phoenix/luna` `links.ts`) | as before |

Numbers, web addresses and e-mail addresses in a message are links, as
Messaging's were on webOS (the system text indexer,
`PalmSystem.runTextIndexer`; `@phoenix/luna` `linkedText`): a number opens
Phone with it on the dial pad.

### Phone (`com.palm.app.phone` → `org.webosphoenix.phone`)

The original phone app is not in the open-source release either.
`apps/phone/src/launchParams.ts`.

| Params | Caller | Phoenix |
|---|---|---|
| `{address, transport: "com.palm.telephony", video?}` | a number tapped in Contacts (`PseudoDetailsInApp.js:342-351`, `:367-369`; the contacts framework's `PseudoDetails.js:451`, `DetailsInDialog.js:296`) | **Calls it at once** (below) |
| `{address, personId, label, service: "phone", transport}` | Just Type's "Call" on a contact's number (`AppLauncher.js:55-67`) | Calls it at once |
| `{action: "voicemail"}` | Just Type's "1" (`AppLauncher.js:56-57`) | Calls voicemail |
| `{address, transport: "com.palm.skype" \| "com.palm.skype.call", video}` | Contacts' Skype menu (`PseudoDetailsInApp.js:327-332`), Just Type (`AppLauncher.js:70-89`) | No Skype in Phoenix: a dialable address on the dial pad, else nothing |
| `{preferences: true}` (`launchType: "startNetworkSearch"`) | luna-systemui's "Phone Preferences" (`TelephonyAlerts.js:59-67`), Enyo's network alerts (`networkalerts/source/NetworkAlertsContent.js:278`) | Settings' Phone page (the runtime's `APP_ROUTES`); no network search to start |
| `{number}` | the webOS SDK's documented launch ("the number on the dial pad") | On the dial pad |
| `{number, dial: true}`, `{target: "tel:…"}`, `{emergency: true}` | Phoenix: Voice Dial, the Assistant, links, the lock screen | as before |

**Calling at once.** Contacts gives each number two controls: the row (the
number) and the message icon beside it (`phoneActionIconClick`). The row is
the call, as on webOS phones, where tapping a contact's number placed the
call; Just Type's "Call" is a call by its name. So `{address, transport:
"com.palm.telephony"}` places the call and shows it. The original phone
app's handling of these params is not in the released sources, so this is
read from its callers; Q70 asks the owner to confirm.

### Music (`com.palm.app.musicplayer`, `com.palm.app.streamingmusicplayer` → `org.webosphoenix.music`)

`apps/music/src/launchParams.ts`. Email opened an attachment with the app
the system named for its type, with `{target: uri, mimeType, fileName}`
(`core-apps/com.palm.app.email/controls/AttachmentsDrawer.js:279-316`; the
streaming player for audio); Files' Open gives `{target: path}`. Music plays
it at once. Its own `{play}` (the Assistant) and `{share}` (the share sheet)
as before.

### Maps (`com.palm.app.maps` → `org.webosphoenix.maps`)

Already read the originals' params (`apps/maps/src/lib/launch.ts`):
`{address}` from Contacts (`PseudoDetailsInApp.js:432-437`) and Calendar
(`app/shared/LunaAppManager.js:173-190`, from an event's location,
`edit/DetailView.js:310-327`), `{route: {endAddress}}` (Calendar's
Directions), `{target: "maploc:…" | "mapto:…" | "geo:…"}`, `{query}` (Just
Type's "Search Maps").

### Photos, Videos, Camera

`com.palm.app.photos` → Photos (`{target}` and the file picker's
`{imageList}`, as before), `com.palm.app.videoplayer` → Videos (`{target}`),
`com.palm.app.camera` → Camera (no params). No original caller sends them
other params.

### The original apps Phoenix runs (contracts in `tools/launch-contracts.json`)

- **Contacts** (`core-apps/com.palm.app.contacts/app/ContactsApp.js:93-125`):
  `{launchType: "editContact" | "newContact" | "pseudo-card" |
  "addToExisting" | "showPerson", id, contact, person, skipPrompt}`,
  `{target: <vCard file>}`. The compat overlay
  `app/phoenix-launch.js` adds Just Type's `{launchType: "reminder",
  personId}` (the person is shown), `{personId}` alone, and Calendar's
  `{target: "opencontact://{launchType: "addToContacts", name, points}"}`
  (a new contact with that name and address; `^opencontact:` is Contacts' in
  `command-resource-handlers.json`).
- **Email** (`core-apps/com.palm.app.email/nowindow/source/Launch.js:201-252`,
  `compose/source/Composition.js:373-498`): `{target | uri: "mailto:…" |
  "file:…"}`, `{newEmail: {...}}`, and the older `{account, summary, text,
  recipients: [{value, contactDisplay, role, type}], attachments}`.
- **Calendar** (`app/App.js:332-365`, `app/AppView.js:279-320`):
  `{showEventDetail}`, `{newEvent}`, `{quickLaunchText}`,
  `{showDetailFromReminder}`, the reminder service's `{alarm…}`.
- **Memos** (compat `app/views/GridView.js:131-140`): `{text}`, `{memoId}`.
- **Clock** (`launch/clockapp.js:139-215`): `{action, key, setTime}`.
- **Accounts**: `{launchType: "changelogin", accountId}`; Phoenix's
  `{templateId}`.
- **Browser** (`isis-browser/source/BrowserApp.js:152-153`): `{target}` or
  `{url}` (Contacts sends `url`, `PseudoDetailsInApp.js:438-444`).
- **Help** (`com.palm.app.help` → Phoenix's Help): `{target:
  "http://help.palm.com/<area>/…"}` becomes `{topic}` in the runtime.

### Settings pages (aliases)

`com.palm.app.backup`, `.updates` (`{installNow}`), `.textassist`,
`.searchpreferences`, `.certificate`, `.exhibitionpreferences`,
`.devmodeswitcher` and now `.dateandtime` open Settings with `{page}`;
`com.palm.app.firstuse` opens First Use.

## Adding a contract

- **A Phoenix app another app opens**: read the params in its
  `src/launchParams.ts` (a `parseLaunch(params)` that turns any caller's
  params into one intent, unit-tested, with `LAUNCH_PARAMS`), and list the
  same keys in its `appinfo.json`, `"phoenix": {"launchParams": [...]}`.
  Its unit test checks that the two lists agree.
- **An original id Phoenix replaces**: add it to `APP_ALIASES` (or
  `APP_ROUTES` for an id that goes elsewhere for some params) in
  `runtime/phoenix-runtime.js`, and make the app read the original's
  params, citing the caller (file and line).
- **An original app as the target**: its keys in `tools/launch-contracts.json`
  `"originals"`, with the file that reads them; translate what it does not
  read in a compat overlay (`compat/rootfs/...`), as Contacts'
  `phoenix-launch.js` does.
- **A launch that stays broken on purpose**: `"absent"` (no such app in
  Phoenix) or `"exceptions"` (a key the app does not need), each with why.

Then `node tools/check-launch-contracts.cjs` (and `--write-doc` to refresh
the table below), and a tap in `tools/test-launch-contracts.cjs` if a button
opens it.

The checker sees literal ids and literal param keys (or a variable given an
object literal in the same function); launches with ids computed at run
time (Files' "Open with", Email's attachments by type, Just Type's search
results) are covered by the tests instead.

## Inventory

Every launch the checker finds, the known ⚠ and ❌ first. "Phoenix app" is
where the runtime sends the original id ("same": no alias).

<!-- launch-table: node tools/check-launch-contracts.cjs --write-doc -->
| Caller | How | Target (original id) | Phoenix app | Params sent | Status |
|---|---|---|---|---|---|
| `third_party/core-apps/com.palm.app.calendar/app/shared/LunaAppManager.js:274` | launch | `com.palm.app.calendar` | same | `reminders` | ❌ known: com.palm.app.calendar does not read reminders (third_party/core-apps/com.palm.app.calendar/app/App.js:332-365): the original Calendar never read it either: its missed reminders view was a TODO (LunaAppManager.js:270-276, App.js:378) |
| `third_party/isis/isis-browser/source/ShareLinkDialog.js:182` | launch | `com.palm.app.enyo-facebook` | same | `type`, `statusText` | ❌ known: HP's Facebook app (the browser's Share Link > Facebook): not in the open-source release; Phoenix shares through the share sheet. |
| `third_party/isis/isis-browser/source/ShareLinkDialog.js:186` | launch | `com.palm.app.enyo-findapps` | `org.webosphoenix.marketplace` | `target` | ❌ known: org.webosphoenix.marketplace does not read target (apps/marketplace/public/appinfo.json): the App Catalog page of HP's Facebook app, which Phoenix does not have ("absent"); the Marketplace opens |
| `third_party/luna-systemui/app/AppManagerAlerts/AppManagerAlerts.js:128` | launch | `com.palm.app.swmanager` | same | none | ❌ known: The Software Manager (luna-systemui AppManagerAlerts.js opens it from its app install alerts): not in the open-source release, and Phoenix has none; the Marketplace lists the installed apps. |
| `third_party/luna-systemui/app/AppManagerAlerts/AppManagerAlerts.js:205` | launch | `com.palm.app.swmanager` | same | none | ❌ known: The Software Manager (luna-systemui AppManagerAlerts.js opens it from its app install alerts): not in the open-source release, and Phoenix has none; the Marketplace lists the installed apps. |
| `third_party/luna-systemui/app/SystemManagerAlerts/SystemManagerAlerts.js:221` | launch | `com.palm.app.dataimport` | same | none | ❌ known: The data import app (luna-systemui SystemManagerAlerts.js opens it after a data transfer): not in the open-source release, and Phoenix has none. |
| `third_party/luna-systemui/app/SystemManagerAlerts/SystemManagerAlerts.js:298` | launch | `com.palm.app.dataimport` | same | `errorCode`, `doneTransfer` | ❌ known: The data import app (luna-systemui SystemManagerAlerts.js opens it after a data transfer): not in the open-source release, and Phoenix has none. |
| `third_party/enyo-1.0/framework/lib/networkalerts/source/NetworkAlertsContent.js:278` | launch | `com.palm.app.phone` | `org.webosphoenix.phone` | `preferences`, `launchType` | ⚠ known: org.webosphoenix.phone does not read launchType (apps/phone/public/appinfo.json): {preferences: true} opens Settings' Phone page (APP_ROUTES); a network search is not something the simulated modem has |
| `third_party/luna-systemui/app/SystemManagerAlerts/SystemManagerAlerts.js:496` | launch | `com.palm.app.searchpreferences` | `org.webosphoenix.settings` | `launch`, `page` | ⚠ known: org.webosphoenix.settings does not read launch (apps/settings/public/appinfo.json): Settings' Just Type page opens, its search providers ("Add More") are on it |
| `third_party/luna-systemui/app/SystemServiceAlerts/SystemServiceAlerts.js:126` | launch | `com.palm.app.dateandtime` | `org.webosphoenix.settings` | `launchType`, `page` | ⚠ known: org.webosphoenix.settings does not read launchType (apps/settings/public/appinfo.json): Settings' Date & Time page opens; it has no separate "set the time temporarily" mode to start |
| `apps/agenda/src/App.tsx:74` | launch | `com.palm.app.calendar` | same | `showEventDetail` | ✅ |
| `apps/assistant/public/appinfo.json:25` | Just Type action | `org.webosphoenix.assistant` | same | `text` | ✅ |
| `apps/assistant/service/assistant.js:1090` | launch | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/assistant/service/assistant.js:1111` | launch | `org.webosphoenix.settings` | same | `page`, `connect`, `threadId` | ✅ |
| `apps/assistant/service/lib/commands.js:840` | open descriptor | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/assistant/service/lib/commands.js:891` | open descriptor | `org.webosphoenix.weather` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:922` | launch | `org.webosphoenix.weather` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:957` | open descriptor | `org.webosphoenix.maps` | same | (variable) | ✅ |
| `apps/assistant/service/lib/commands.js:972` | launch | `org.webosphoenix.maps` | same | `nearby` | ✅ |
| `apps/assistant/service/lib/commands.js:985` | launch | `org.webosphoenix.maps` | same | `nearby` | ✅ |
| `apps/assistant/service/lib/commands.js:995` | launch | `org.webosphoenix.maps` | same | `target` | ✅ |
| `apps/assistant/service/lib/commands.js:1005` | launch | `org.webosphoenix.maps` | same | (variable) | ✅ |
| `apps/assistant/service/lib/commands.js:1069` | open descriptor | `com.palm.app.calendar` | same | `showEventDetail` | ✅ |
| `apps/assistant/service/lib/commands.js:1103` | open descriptor | `com.palm.app.calendar` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1121` | open descriptor | `com.palm.app.calendar` | same | `showEventDetail` | ✅ |
| `apps/assistant/service/lib/commands.js:1129` | open descriptor | `com.palm.app.calendar` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1135` | open descriptor | `com.palm.app.calendar` | same | `showEventDetail` | ✅ |
| `apps/assistant/service/lib/commands.js:1140` | open descriptor | `com.palm.app.calendar` | same | `showEventDetail` | ✅ |
| `apps/assistant/service/lib/commands.js:1168` | launch | `com.palm.app.clock` | same | `action`, `key`, `setTime` | ✅ |
| `apps/assistant/service/lib/commands.js:1252` | launch | `org.webosphoenix.tasks` | same | `reminder` | ✅ |
| `apps/assistant/service/lib/commands.js:1372` | launch | `org.webosphoenix.phone` | same | `number`, `dial` | ✅ |
| `apps/assistant/service/lib/commands.js:1373` | open descriptor | `org.webosphoenix.phone` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1376` | launch | `org.webosphoenix.messaging` | same | `to`, `name` | ✅ |
| `apps/assistant/service/lib/commands.js:1377` | open descriptor | `org.webosphoenix.messaging` | same | `to`, `name` | ✅ |
| `apps/assistant/service/lib/commands.js:1382` | open descriptor | `org.webosphoenix.messaging` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1394` | open descriptor | `org.webosphoenix.messaging` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1399` | open descriptor | `org.webosphoenix.messaging` | same | `threadId` | ✅ |
| `apps/assistant/service/lib/commands.js:1410` | launch | `com.palm.app.email` | same | `recipients`, `summary` | ✅ |
| `apps/assistant/service/lib/commands.js:1412` | open descriptor | `com.palm.app.email` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1421` | open descriptor | `com.palm.app.email` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1434` | open descriptor | `com.palm.app.email` | same | `emailId` | ✅ |
| `apps/assistant/service/lib/commands.js:1437` | open descriptor | `com.palm.app.email` | same | `emailId` | ✅ |
| `apps/assistant/service/lib/commands.js:1452` | launch | `org.webosphoenix.assistant` | same | `timerDone` | ✅ |
| `apps/assistant/service/lib/commands.js:1493` | open descriptor | `com.palm.app.clock` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1501` | open descriptor | `com.palm.app.clock` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1507` | open descriptor | `com.palm.app.clock` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1512` | open descriptor | `com.palm.app.clock` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1518` | open descriptor | `org.webosphoenix.tasks` | same | `taskId` | ✅ |
| `apps/assistant/service/lib/commands.js:1525` | open descriptor | `org.webosphoenix.tasks` | same | `taskId` | ✅ |
| `apps/assistant/service/lib/commands.js:1539` | open descriptor | `com.palm.app.notes` | same | `memoId` | ✅ |
| `apps/assistant/service/lib/commands.js:1548` | open descriptor | `com.palm.app.notes` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1551` | open descriptor | `com.palm.app.notes` | same | `memoId` | ✅ |
| `apps/assistant/service/lib/commands.js:1581` | open descriptor | `com.palm.app.contacts` | same | `launchType`, `id` | ✅ |
| `apps/assistant/service/lib/commands.js:1598` | open descriptor | `com.palm.app.contacts` | same | `launchType`, `id` | ✅ |
| `apps/assistant/service/lib/commands.js:1614` | open descriptor | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/assistant/service/lib/commands.js:1656` | open descriptor | `org.webosphoenix.photos` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1665` | open descriptor | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/assistant/service/lib/commands.js:1668` | launch | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/assistant/service/lib/commands.js:1669` | open descriptor | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/assistant/service/lib/commands.js:1697` | open descriptor | `org.webosphoenix.maps` | same | `target` | ✅ |
| `apps/assistant/service/lib/commands.js:1729` | open descriptor | `org.webosphoenix.photos` | same | (variable) | ✅ |
| `apps/assistant/service/lib/commands.js:1741` | launch | `org.webosphoenix.photos` | same | `imageList` | ✅ |
| `apps/assistant/service/lib/commands.js:1744` | launch | `org.webosphoenix.music` | same | `play` | ✅ |
| `apps/assistant/service/lib/commands.js:1745` | open descriptor | `org.webosphoenix.music` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1799` | launch | `org.webosphoenix.phone` | same | `number`, `dial` | ✅ |
| `apps/assistant/service/lib/commands.js:1800` | open descriptor | `org.webosphoenix.phone` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1803` | open descriptor | `com.palm.app.email` | same | `emailId` | ✅ |
| `apps/assistant/service/lib/commands.js:1814` | open descriptor | `org.webosphoenix.files` | same | `path` | ✅ |
| `apps/assistant/service/lib/commands.js:1821` | open descriptor | `org.webosphoenix.files` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1840` | open descriptor | `org.webosphoenix.phone` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1851` | open descriptor | `com.palm.app.calendar` | same | `showEventDetail` | ✅ |
| `apps/assistant/service/lib/commands.js:1878` | open descriptor | `com.palm.app.calendar` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1883` | open descriptor | `com.palm.app.calendar` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1889` | open descriptor | `com.palm.app.calendar` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1903` | open descriptor | `com.palm.app.notes` | same | `memoId` | ✅ |
| `apps/assistant/service/lib/commands.js:1914` | open descriptor | `org.webosphoenix.tasks` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1923` | open descriptor | `org.webosphoenix.tasks` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1925` | open descriptor | `org.webosphoenix.tasks` | same | `taskId` | ✅ |
| `apps/assistant/service/lib/commands.js:1931` | open descriptor | `org.webosphoenix.tasks` | same | `taskId` | ✅ |
| `apps/assistant/service/lib/commands.js:1942` | open descriptor | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/assistant/service/lib/commands.js:1947` | open descriptor | `org.webosphoenix.marketplace` | same | `sourceId`, `id` | ✅ |
| `apps/assistant/service/lib/commands.js:1954` | launch | `org.webosphoenix.marketplace` | same | (variable) | ✅ |
| `apps/assistant/service/lib/commands.js:1957` | open descriptor | `org.webosphoenix.marketplace` | same | none | ✅ |
| `apps/assistant/service/lib/commands.js:1962` | open descriptor | `org.webosphoenix.help` | same | `topic` | ✅ |
| `apps/assistant/service/lib/commands.js:1963` | open descriptor | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/assistant/service/lib/commands.js:1969` | open descriptor | `org.webosphoenix.help` | same | none | ✅ |
| `apps/assistant/service/lib/details.js:103` | open descriptor | `com.palm.app.calendar` | same | `showEventDetail` | ✅ |
| `apps/assistant/service/lib/details.js:121` | open descriptor | `com.palm.app.notes` | same | `memoId` | ✅ |
| `apps/assistant/service/lib/details.js:130` | open descriptor | `com.palm.app.calendar` | same | `showEventDetail` | ✅ |
| `apps/assistant/service/lib/details.js:192` | open descriptor | `com.palm.app.notes` | same | `memoId` | ✅ |
| `apps/assistant/service/lib/details.js:224` | open descriptor | `org.webosphoenix.tasks` | same | `taskId` | ✅ |
| `apps/assistant/service/lib/details.js:234` | open descriptor | `org.webosphoenix.tasks` | same | none | ✅ |
| `apps/assistant/service/lib/details.js:261` | open descriptor | `com.palm.app.contacts` | same | `launchType`, `id` | ✅ |
| `apps/assistant/service/lib/details.js:292` | open descriptor | `com.palm.app.clock` | same | none | ✅ |
| `apps/assistant/service/lib/details.js:309` | open descriptor | `org.webosphoenix.tasks` | same | `taskId` | ✅ |
| `apps/assistant/src/App.tsx:467` | launch | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/authenticator/src/App.tsx:86` | launch | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/camera/src/App.tsx:220` | launch | `org.webosphoenix.photos` | same | `imageList` | ✅ |
| `apps/clipboard/src/App.tsx:145` | launch | `org.webosphoenix.passwords` | same | `newEntry` | ✅ |
| `apps/clipboard/src/App.tsx:149` | launch | `org.webosphoenix.authenticator` | same | `otpauth` | ✅ |
| `apps/clipboard/src/App.tsx:354` | launch | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/docview/src/Views.tsx:30` | launch | `com.palm.app.browser` | same | `target` | ✅ |
| `apps/dropshare/src/App.tsx:115` | launch | `org.webosphoenix.files` | same | `path` | ✅ |
| `apps/fediverse/compose.js:145` | launch | `com.palm.app.accounts` | same | `templateId` | ✅ |
| `apps/firstuse/src/App.tsx:425` | launch | `com.palm.app.accounts` | same | none | ✅ |
| `apps/firstuse/src/App.tsx:544` | launch | `org.webosphoenix.help` | same | none | ✅ |
| `apps/firstuse/src/App.tsx:546` | launch | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/help/public/appinfo.json:24` | Just Type dbsearch | `org.webosphoenix.help` | same | `topic` | ✅ |
| `apps/help/src/App.tsx:168` | launch | `com.palm.app.browser` | same | `target` | ✅ |
| `apps/maps/public/appinfo.json:25` | Just Type action | `org.webosphoenix.maps` | same | `query` | ✅ |
| `apps/maps/public/appinfo.json:25` | Just Type dbsearch | `org.webosphoenix.maps` | same | `placeId` | ✅ |
| `apps/marketplace/service/packagesservice.js:697` | open descriptor | `org.webosphoenix.marketplace` | same | `section` | ✅ |
| `apps/marketplace/src/accountTypes.ts:169` | launch | `com.palm.app.accounts` | same | `templateId` | ✅ |
| `apps/marketplace/src/accountTypes.ts:174` | launch | `com.palm.app.accounts` | same | none | ✅ |
| `apps/marketplace/src/App.tsx:347` | launch | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/messaging/src/views/Buddies.tsx:75` | launch | `com.palm.app.accounts` | same | none | ✅ |
| `apps/messaging/src/views/ThreadList.tsx:31` | launch | `org.webosphoenix.messaging` | same | `threadId` | ✅ |
| `apps/notificationlab/src/lib/lab.ts:212` | launch | `org.webosphoenix.notificationlab` | same | `task`, `scheduled` | ✅ |
| `apps/passwords/src/App.tsx:307` | launch | `com.palm.app.browser` | same | `target` | ✅ |
| `apps/phone/src/App.tsx:95` | launch | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/phone/src/App.tsx:143` | launch | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/photos/src/App.tsx:189` | launch | `org.webosphoenix.camera` | same | none | ✅ |
| `apps/photos/src/Viewer.tsx:180` | launch | `org.webosphoenix.videos` | same | `target` | ✅ |
| `apps/podcasts/src/store.ts:231` | launch | `org.webosphoenix.podcasts` | same | `refresh` | ✅ |
| `apps/podcasts/src/store.ts:243` | open descriptor | `org.webosphoenix.podcasts` | same | `newEpisodes` | ✅ |
| `apps/scanner/src/App.tsx:185` | launch | `org.webosphoenix.settings` | same | `page`, `join` | ✅ |
| `apps/scanner/src/App.tsx:190` | launch | `com.palm.app.contacts` | same | `launchType`, `contact` | ✅ |
| `apps/scanner/src/App.tsx:195` | launch | `org.webosphoenix.authenticator` | same | `otpauth` | ✅ |
| `apps/settings/src/pages/DeviceInfo.tsx:127` | launch | `com.palm.app.certificate` | `org.webosphoenix.settings` | `page` | ✅ |
| `apps/settings/src/pages/DeviceInfo.tsx:171` | launch | `org.webosphoenix.help` | same | none | ✅ |
| `apps/settings/src/pages/DeviceInfo.tsx:173` | launch | `org.webosphoenix.firstuse` | same | `rerun` | ✅ |
| `apps/settings/src/pages/DevMode.tsx:116` | launch | `org.webosphoenix.settings` | same | `page` | ✅ |
| `apps/settings/src/pages/DropShare.tsx:30` | launch | `org.webosphoenix.dropshare` | same | none | ✅ |
| `apps/shared/connector-kit/share-page/compose.js:99` | launch | `com.palm.app.accounts` | same | `templateId` | ✅ |
| `apps/shared/luna/src/tasks.ts:227` | launch | `org.webosphoenix.tasks` | same | `reminder` | ✅ |
| `apps/shared/luna/src/tasks.ts:252` | open descriptor | `org.webosphoenix.tasks` | same | `taskId`, `fromReminder` | ✅ |
| `apps/tasks/public/appinfo.json:24` | Just Type action | `org.webosphoenix.tasks` | same | `text` | ✅ |
| `apps/tasks/public/appinfo.json:24` | Just Type dbsearch | `org.webosphoenix.tasks` | same | `taskId` | ✅ |
| `apps/voicedial/src/App.tsx:123` | launch | `org.webosphoenix.phone` | same | `number`, `dial` | ✅ |
| `apps/voicememos/public/appinfo.json:24` | Just Type action | `org.webosphoenix.voicememos` | same | `newMemo` | ✅ |
| `apps/voicememos/public/appinfo.json:24` | Just Type dbsearch | `org.webosphoenix.voicememos` | same | `memoId` | ✅ |
| `compat/rootfs/usr/palm/applications/com.palm.systemui/app/PowerdAlerts/PowerdAlerts.js:118` | launch | `com.palm.app.help` | `org.webosphoenix.help` | `target` | ✅ |
| `compat/rootfs/usr/palm/frameworks/enyo/0.10/framework/lib/accounts/source/entry-first-launch.js:269` | open | `com.palm.app.enyo-findapps` | `org.webosphoenix.marketplace` | `common` | ✅ |
| `runtime/phoenix-runtime.js:2019` | launch | `org.webosphoenix.settings` | same | `page` | ✅ |
| `runtime/phoenix-runtime.js:7742` | open descriptor | `org.webosphoenix.messaging` | same | `threadId` | ✅ |
| `runtime/phoenix-runtime.js:7760` | open descriptor | `org.webosphoenix.messaging` | same | `threadId` | ✅ |
| `runtime/phoenix-runtime.js:7999` | open descriptor | `org.webosphoenix.messaging` | same | `threadId` | ✅ |
| `runtime/phoenix-runtime.js:8774` | open descriptor | `org.webosphoenix.screenshot` | same | `path`, `capture` | ✅ |
| `runtime/phoenix-runtime.js:11280` | launch | `org.webosphoenix.voicedial` | same | `source` | ✅ |
| `runtime/phoenix-runtime.js:12818` | launch | `org.webosphoenix.marketplace` | same | `sourceId`, `id` | ✅ |
| `runtime/phoenix-runtime.js:13272` | open descriptor | `org.webosphoenix.printmanager` | same | `jobID` | ✅ |
| `runtime/phoenix-runtime.js:14370` | open descriptor | `org.webosphoenix.files` | same | `path` | ✅ |
| `runtime/phoenix-runtime.js:14663` | open descriptor | `org.webosphoenix.settings` | same | `page` | ✅ |
| `shell/qml/Phoenix/Shell/Shell.qml:239` | launch | `org.webosphoenix.settings` | same | `page` | ✅ |
| `shell/qml/Phoenix/Shell/Shell.qml:2057` | launch | `org.webosphoenix.screenshot` | same | `path` | ✅ |
| `shell/qml/Phoenix/Shell/Shell.qml:3277` | launch | `org.webosphoenix.settings` | same | `page` | ✅ |
| `shell/qml/Phoenix/Shell/Shell.qml:3354` | launch | `org.webosphoenix.assistant` | same | `threadId` | ✅ |
| `shell/qml/Phoenix/Shell/Shell.qml:3757` | launch | `org.webosphoenix.clipboard` | same | none | ✅ |
| `shell/qml/Phoenix/Sim/SimWindowSource.qml:668` | launch | `com.palm.app.browser` | same | `target` | ✅ |
| `shell/qml/Phoenix/Sim/SimWindowSource.qml:2169` | open | `com.palm.app.browser` | same | `target` | ✅ |
| `shell/qml/Phoenix/Sim/SimWindowSource.qml:2296` | launch | `org.webosphoenix.phone` | same | (variable) | ✅ |
| `shell/qml/Phoenix/Sim/SimWindowSource.qml:2336` | launch | `org.webosphoenix.messaging` | same | (variable) | ✅ |
| `shell/qml/sim.qml:454` | launch | `org.webosphoenix.assistant` | same | `followUp` | ✅ |
| `shell/qml/sim.qml:1295` | launch | `org.webosphoenix.marketplace` | same | none | ✅ |
| `shell/qml/sim.qml:2089` | launch | `org.webosphoenix.screenshot` | same | none | ✅ |
| `third_party/app-services/com.palm.service.calendar.reminders/on-autoclose-handler.js:165` | launch | `com.palm.app.calendar` | same | `alarmClose` | ✅ |
| `third_party/app-services/com.palm.service.calendar.reminders/on-db-changed-handler.js:362` | launch | `com.palm.app.calendar` | same | `alarmDeleted` | ✅ |
| `third_party/app-services/com.palm.service.calendar.reminders/on-db-changed-handler.js:526` | launch | `com.palm.app.calendar` | same | `alarmUpdated` | ✅ |
| `third_party/app-services/com.palm.service.calendar.reminders/on-wake-handler.js:179` | launch | `com.palm.app.calendar` | same | `alarm` | ✅ |
| `third_party/core-apps/com.palm.app.calendar/app/shared/LunaAppManager.js:124` | open opencontact: | `opencontact:` | `com.palm.app.contacts` | `target` | ✅ |
| `third_party/core-apps/com.palm.app.calendar/app/shared/LunaAppManager.js:138` | launch | `com.palm.app.email` | same | `account`, `recipients`, `summary`, `text` | ✅ |
| `third_party/core-apps/com.palm.app.calendar/app/shared/LunaAppManager.js:162` | launch | `com.palm.app.help` | `org.webosphoenix.help` | `target` | ✅ |
| `third_party/core-apps/com.palm.app.calendar/app/shared/LunaAppManager.js:189` | launch | `com.palm.app.maps` | `org.webosphoenix.maps` | `route`, `address` | ✅ |
| `third_party/core-apps/com.palm.app.calendar/app/shared/LunaAppManager.js:212` | launch | `com.palm.app.maps` | `org.webosphoenix.maps` | (variable) | ✅ |
| `third_party/core-apps/com.palm.app.calendar/app/shared/LunaAppManager.js:265` | launch | `com.palm.app.calendar` | same | `showDetailFromReminder` | ✅ |
| `third_party/core-apps/com.palm.app.calendar/appinfo.json:17` | Just Type action | `com.palm.app.calendar` | same | `quickLaunchText` | ✅ |
| `third_party/core-apps/com.palm.app.calendar/appinfo.json:17` | Just Type dbsearch | `com.palm.app.calendar` | same | `showEventDetail` | ✅ |
| `third_party/core-apps/com.palm.app.clock/utility/powerdmanager.js:52` | launch | `com.palm.app.clock` | same | `action`, `key` | ✅ |
| `third_party/core-apps/com.palm.app.contacts/app/PseudoDetailsInApp.js:118` | launch | `com.palm.app.contacts` | same | (variable) | ✅ |
| `third_party/core-apps/com.palm.app.contacts/app/PseudoDetailsInApp.js:311` | open mailto: | `mailto:` | `com.palm.app.email` | `target` | ✅ |
| `third_party/core-apps/com.palm.app.contacts/app/PseudoDetailsInApp.js:318` | open | `com.palm.app.messaging` | `org.webosphoenix.messaging` | `compose` | ✅ |
| `third_party/core-apps/com.palm.app.contacts/app/PseudoDetailsInApp.js:343` | open | `com.palm.app.phone` | `org.webosphoenix.phone` | `address`, `transport`, `video` | ✅ |
| `third_party/core-apps/com.palm.app.contacts/app/PseudoDetailsInApp.js:354` | open | `com.palm.app.messaging` | `org.webosphoenix.messaging` | `compose` | ✅ |
| `third_party/core-apps/com.palm.app.contacts/app/PseudoDetailsInApp.js:406` | open | `com.palm.app.messaging` | `org.webosphoenix.messaging` | `compose` | ✅ |
| `third_party/core-apps/com.palm.app.contacts/app/PseudoDetailsInApp.js:434` | open | `com.palm.app.maps` | `org.webosphoenix.maps` | `address` | ✅ |
| `third_party/core-apps/com.palm.app.contacts/app/PseudoDetailsInApp.js:441` | open | `com.palm.app.browser` | same | `url` | ✅ |
| `third_party/core-apps/com.palm.app.email/accounts/source/ManualConfig.js:593` | launch | `com.palm.app.certificate` | `org.webosphoenix.settings` | `page` | ✅ |
| `third_party/core-apps/com.palm.app.email/appinfo.json:24` | Just Type action | `com.palm.app.email` | same | `text` | ✅ |
| `third_party/core-apps/com.palm.app.email/appinfo.json:24` | Just Type dbsearch | `com.palm.app.email` | same | `emailId` | ✅ |
| `third_party/core-apps/com.palm.app.email/data/EmailAccount.js:769` | launch | `com.palm.app.help` | `org.webosphoenix.help` | `target` | ✅ |
| `third_party/core-apps/com.palm.app.email/mail/source/MailApp.js:588` | open | `com.palm.app.help` | `org.webosphoenix.help` | `target` | ✅ |
| `third_party/core-apps/com.palm.app.email/source/DashboardManager.js:693` | launch | `com.palm.app.accounts` | same | `launchType`, `accountId` | ✅ |
| `third_party/core-apps/com.palm.app.notes/app/lib/ServiceWrapper.js:98` | launch | `com.palm.app.email` | same | `summary`, `text` | ✅ |
| `third_party/core-apps/com.palm.app.notes/appinfo.json:17` | Just Type action | `com.palm.app.notes` | same | `text` | ✅ |
| `third_party/enyo-1.0/framework/lib/accounts/source/add-account.js:87` | open | `com.palm.app.enyo-findapps` | `org.webosphoenix.marketplace` | `common` | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/DetailsInDialog.js:87` | launch | `com.palm.app.contacts` | same | (variable) | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/DetailsInDialog.js:259` | open mailto: | `mailto:` | `com.palm.app.email` | `target` | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/DetailsInDialog.js:268` | open | `com.palm.app.messaging` | `org.webosphoenix.messaging` | `compose` | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/DetailsInDialog.js:297` | open | `com.palm.app.phone` | `org.webosphoenix.phone` | `address`, `transport`, `video` | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/DetailsInDialog.js:310` | open | `com.palm.app.messaging` | `org.webosphoenix.messaging` | `compose` | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/DetailsInDialog.js:366` | open | `com.palm.app.messaging` | `org.webosphoenix.messaging` | `compose` | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/DetailsInDialog.js:395` | open | `com.palm.app.maps` | `org.webosphoenix.maps` | `address` | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/DetailsInDialog.js:402` | open | `com.palm.app.browser` | same | `url` | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/PseudoDetails.js:192` | launch | `com.palm.app.contacts` | same | (variable) | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/PseudoDetails.js:414` | open mailto: | `mailto:` | `com.palm.app.email` | `target` | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/PseudoDetails.js:423` | open | `com.palm.app.messaging` | `org.webosphoenix.messaging` | `compose` | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/PseudoDetails.js:452` | open | `com.palm.app.phone` | `org.webosphoenix.phone` | `address`, `transport`, `video` | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/PseudoDetails.js:465` | open | `com.palm.app.messaging` | `org.webosphoenix.messaging` | `compose` | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/PseudoDetails.js:521` | open | `com.palm.app.messaging` | `org.webosphoenix.messaging` | `compose` | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/PseudoDetails.js:548` | open | `com.palm.app.maps` | `org.webosphoenix.maps` | `address` | ✅ |
| `third_party/enyo-1.0/framework/lib/contactsui/UI/PseudoDetails.js:555` | open | `com.palm.app.browser` | same | `url` | ✅ |
| `third_party/enyo-1.0/framework/lib/printdialog/source/PrintJob.js:36` | launch | `com.palm.app.printmanager` | `org.webosphoenix.printmanager` | `runHeadless` | ✅ |
| `third_party/enyo-1.0/framework/lib/syncui/source/missingCredentials.js:89` | open | `com.palm.app.accounts` | same | none | ✅ |
| `third_party/enyo-1.0/framework/lib/syncui/source/syncDashboard.js:234` | open | `com.palm.app.accounts` | same | `launchType`, `accountId` | ✅ |
| `third_party/isis/isis-browser/source/Browser.js:387` | launch | `com.palm.app.email` | same | `summary`, `text`, `attachments` | ✅ |
| `third_party/isis/isis-browser/source/BrowserApp.js:622` | launch | `com.palm.app.help` | `org.webosphoenix.help` | `target` | ✅ |
| `third_party/isis/isis-browser/source/ShareLinkDialog.js:167` | launch | `com.palm.app.email` | same | `summary`, `text` | ✅ |
| `third_party/isis/isis-browser/source/ShareLinkDialog.js:175` | launch | `com.palm.app.messaging` | `org.webosphoenix.messaging` | `compose` | ✅ |
| `third_party/loadable-frameworks/contacts/javascript/App.js:46` | open | `com.palm.app.contacts` | same | `launchType`, `person`, `contact` | ✅ |
| `third_party/luna-applauncher/app/LaunchAndSearch.js:188` | launch | `com.palm.app.browser` | same | `scene`, `target` | ✅ |
| `third_party/luna-applauncher/app/LaunchAndSearch.js:300` | launch | `com.palm.app.browser` | same | `scene`, `target` | ✅ |
| `third_party/luna-applauncher/app/LaunchAndSearch.js:309` | launch | `com.palm.app.browser` | same | `scene`, `target` | ✅ |
| `third_party/luna-applauncher/app/LaunchPointSearch.js:31` | launch | `com.palm.app.devmodeswitcher` | `org.webosphoenix.settings` | `page` | ✅ |
| `third_party/luna-applauncher/data/AppLauncher.js:32` | open mailto: | `mailto:` | `com.palm.app.email` | `target` | ✅ |
| `third_party/luna-applauncher/data/AppLauncher.js:37` | launch | `com.palm.app.browser` | same | `scene`, `target` | ✅ |
| `third_party/luna-applauncher/data/AppLauncher.js:46` | launch | `com.palm.app.messaging` | `org.webosphoenix.messaging` | `personId`, `address`, `serviceName`, `type`, `compose` | ✅ |
| `third_party/luna-applauncher/data/AppLauncher.js:52` | launch | `com.palm.app.messaging` | `org.webosphoenix.messaging` | `compose` | ✅ |
| `third_party/luna-applauncher/data/AppLauncher.js:67` | launch | `com.palm.app.phone` | `org.webosphoenix.phone` | `action`, `address`, `personId`, `label`, `service`, `transport` | ✅ |
| `third_party/luna-applauncher/data/AppLauncher.js:78` | launch | `com.palm.app.phone` | `org.webosphoenix.phone` | `address`, `service`, `personId`, `label`, `transport`, `video` | ✅ |
| `third_party/luna-applauncher/data/AppLauncher.js:88` | launch | `com.palm.app.phone` | `org.webosphoenix.phone` | `address`, `service`, `personId`, `label` | ✅ |
| `third_party/luna-applauncher/data/AppLauncher.js:176` | launch | `com.palm.app.contacts` | same | `id`, `launchType` | ✅ |
| `third_party/luna-applauncher/data/AppLauncher.js:185` | launch | `com.palm.app.contacts` | same | `launchType`, `personId`, `focusField` | ✅ |
| `third_party/luna-applauncher/data/AppLauncher.js:190` | launch | `com.palm.app.help` | `org.webosphoenix.help` | `target` | ✅ |
| `third_party/luna-applauncher/data/AppLauncher.js:194` | launch | `com.palm.app.searchpreferences` | `org.webosphoenix.settings` | `page` | ✅ |
| `third_party/luna-systemui/app/StoragedAlerts/StoragedAlerts.js:99` | launch | `com.palm.app.help` | `org.webosphoenix.help` | `target` | ✅ |
| `third_party/luna-systemui/app/SystemManagerAlerts/SystemManagerAlerts.js:73` | launch | `com.palm.app.backup` | `org.webosphoenix.settings` | (variable) | ✅ |
| `third_party/luna-systemui/app/SystemManagerAlerts/SystemManagerAlerts.js:580` | launch | `com.palm.app.help` | `org.webosphoenix.help` | `target` | ✅ |
| `third_party/luna-systemui/app/SystemManagerAlerts/SystemManagerAlerts.js:1244` | launch | `com.palm.app.help` | `org.webosphoenix.help` | `target` | ✅ |
| `third_party/luna-systemui/app/SystemManagerAlerts/SystemManagerAlerts.js:1350` | launch | `com.palm.app.help` | `org.webosphoenix.help` | `target` | ✅ |
| `third_party/luna-systemui/app/SystemServiceAlerts/SystemServiceAlerts.js:61` | launch | `com.palm.app.firstuse` | `org.webosphoenix.firstuse` | none | ✅ |
| `third_party/luna-systemui/app/SysUpdateAlerts/SysUpdateAlerts.js:99` | launch | `com.palm.app.updates` | `org.webosphoenix.settings` | `installNow`, `page` | ✅ |
| `third_party/luna-systemui/app/SysUpdateAlerts/SysUpdateAlerts.js:186` | launch | `com.palm.app.updates` | `org.webosphoenix.settings` | `page` | ✅ |
| `third_party/luna-systemui/app/SysUpdateAlerts/SysUpdateAlerts.js:428` | launch | `com.palm.app.updates` | `org.webosphoenix.settings` | `page` | ✅ |
| `third_party/luna-systemui/app/SysUpdateAlerts/SysUpdateAlerts.js:527` | launch | `com.palm.app.updates` | `org.webosphoenix.settings` | `page` | ✅ |
| `third_party/luna-systemui/app/TelephonyAlerts/TelephonyAlerts.js:61` | launch | `com.palm.app.phone` | `org.webosphoenix.phone` | `preferences` | ✅ |
| `third_party/luna-systemui/app/TelephonyAlerts/TelephonyAlerts.js:292` | launch | `com.palm.app.help` | `org.webosphoenix.help` | `target` | ✅ |

246 launches: 236 ✅, 3 ⚠, 7 ❌ (5 of the ❌ go to apps Phoenix does not have; every ⚠ and ❌ has its why in tools/launch-contracts.json).
<!-- /launch-table -->
