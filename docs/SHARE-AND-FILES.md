# Share sheet and file picker (system-wide)

One share sheet and one file picker for every app, built once in the
system, so a new place to share or save to appears in every app at once.
The trigger was the Screenshot preview's Save (Save to Photos or Save to
Files, in a folder the user picks).

> **Status (2 October 2026).** Agreed with the owner: the sheet looks like
> webOS 1 (its popup art and menu rows) with a row of app icons on top (two
> rows when there are many) that scrolls sideways, the way the latest iOS
> sheet mixes icons and a list; Save to Files opens the last folder used.
> **Built in the simulator:** SF3 (save picker), SF4 (share sheet) and SF5
> for Screenshot; Messaging takes text, links and pictures. SF2 for
> pictures: `org.webosphoenix.filepicker/pick {kinds: ["image"], title?}`
> shows Photos' pictures album by album (Camera Roll first) and answers
> `{files: [{fullPath, mimeType, name}]}` or `{canceled: true}`
> (`filePicker.pick()`; Messaging's attach button). SF5 since: Files
> (Share in select mode, one file or several: Save to Photos saves every
> picture, Save to Files is offered for one file), Photos (its Share is the
> sheet, no longer its own Email/Messaging menu), the browser (Share Link,
> from the share menu or a link's menu) and, in every app, **Share in the
> app menu, after Edit** (below).
>
> **10 October 2026: SF1, SF2 and SF5 built in the simulator.** SF1: the
> original apps' `enyo.FilePicker` opens luna-systemui's own picker in their
> card, as on webOS (Clock's alarm sound, Email's attachments, Contacts'
> photo with its crop view); see "The original picker" below. SF2:
> `pick {kinds: ["image" | "video" | "audio" | "document" | "file"],
> multiple?, cropWidth?, cropHeight?, extensions?, title?}` answers `{files:
> [{fullPath, mimeType, name, size, cropInfo?, croppedPath?}]}` or
> `{canceled: true}`: several kinds ask for the kind first (the original's
> Photos, Videos, Music, Documents, and Files, any file by folder); several
> files are ticked and OK sends them ("2 Files Selected"); a crop size shows
> the picture in a frame of that shape to move and zoom, and answers
> `cropInfo` in Enyo's CroppableImage names and `croppedPath`, the crop at
> that size (`filePicker.pick()` in `@phoenix/luna`). SF5: Docs (the
> reader's Share and app menu: the document's file), Voice Memos (a memo's
> Share: its recording) and Maps (Share Location and the app menu: the
> place's name, address and map link, the text its own Messaging / Email
> menu sent) open the sheet. `tools/test-filepicker.cjs`, `test-docs.cjs`,
> `test-voicememos.cjs`, `test-maps.cjs`. Voice Memos' "Open in Music"
> (10 October 2026): Music takes audio from the sheet (`shareTargets`
> `audio/*`) and plays it in Now Playing under the share's title, the
> library's tags when it has the file (`sharedSongs`, apps/music;
> `test-voicememos.cjs`). Left: SF6 (2.0).
>
> **10 October 2026: accounts in the sheet.** A Synergy connector that
> posts (the Fediverse) is in the sheet once per signed-in account, and not
> at all without one; see "Accounts in the sheet" below
> (`tools/test-sharing.cjs`, `test-fediverse.cjs`).

### Accounts in the sheet

A connector (a Synergy account type, [SYNERGY-SDK.md](SYNERGY-SDK.md)
section 7) says in its definition what its service takes (`share`:
text, a link, pictures with alt text, who may see a post) and how to post
it. `phoenix-connector pack` writes that into its app's `appinfo.json` as a
share target with the declaration under `connector` (`templateId`,
`service`, `accepts`, `audience`, `accountLabel`), so a connector's target
is never written by hand.

The runtime's `targetsFor` (block "Share sheet and save picker") lists such
a target **once per account** of that template
(`com.palm.service.accounts/listAccounts {templateId}`, read each time the
sheet opens, so an account added or removed in Accounts shows at once;
one being deleted is left out), and **none when no account is signed in**.
Each entry has the app's icon and two lines, the service and the account
("Fediverse", "@me" / "@example.social"; its full label "Fediverse ·
@me@example.social"). Choosing one launches the connector's app with
`{share, accountId, target}`: its compose page (the kit's, or the
connector's own, as the Fediverse's) posts as that account through the
connector's `share` method. `org.webosphoenix.share/targets` answers the
same entries with `accountId`, `account` and `service`. Like every target,
an account is offered only for what the declaration takes.

Built and checked in the simulator. On a device not yet checked: the
listing asks the device's accounts service (`listAccounts`) for the
connector's template, and the compose page calls the connector's service
under `run-js-service`.

### Drives

Cloud storage as places beside Internal Storage (11 October 2026, built in
the simulator): in Files (a **Drives** section under the favourites, the
path bar starting at "Drives"), in the file picker's Files kind (SF2), in
Save to Files (SF3: Back from Internal Storage shows **Places**, Internal
Storage and every drive) and so in every share sheet. Each drive is a
Synergy account (DOCUMENTS) of the drives' connector
(`apps/connectors/drives`, `org.webosphoenix.drives`), added in Accounts
or Connections, with a sign-up link:

| Account type | Sign-in | Status |
| --- | --- | --- |
| Nextcloud | Login Flow v2 (the server's own page in the browser; an app password comes back, revoked when the account is removed) or an app password | beta |
| ownCloud, WebDAV (any server) | app password / password | beta |
| S3 Storage (Backblaze B2, Wasabi, MinIO, Amazon S3, any) | access key and secret; Signature V4 | beta |
| Dropbox, OneDrive (Microsoft Graph), Google Drive, Box | OAuth with PKCE through `org.webosphoenix.service.oauth`; "not available in this build" without Phoenix's registration ([DEVELOPER-APPS.md](DEVELOPER-APPS.md)) | experimental |

The package is Phoenix's own but **not pre-installed**: it is in the
catalog (`server/marketplace/catalog/accounts.json`), and installing it
from Connections needs no Developer Mode (`preinstalled.json` "catalog",
`packagesservice.js` `isFirstParty`).

**Paths.** A drive is `/media/drives/<accountId>/...` to Files'
service (`org.webosphoenix.filemanager`), which hands those paths to the
kit's drive router (`createDriveRouter`, connector-kit `src/drives.ts`):
list, stat, mkdir, rename and move inside a drive, delete, search, and
copy between the device and a drive (an upload or a download) or between
drives. New methods: `open {path}` (a drive file as a device copy, under
`/media/internal/.phoenix/drive-cache/<accountId>/`, used as is when the
drive cannot be reached: `stale: true`), `quota`, `transfers`, `cancel
{id}`. Apps open a drive file through its device copy, so viewers, Email's
attachments and the pickers read it as any file; the file picker answers
`fullPath` (the copy) and `remotePath`.

**Transfers.** Uploads go in chunks (8 MB; Nextcloud's chunked upload,
S3 multipart, Dropbox's upload session, Graph's upload session, Google's
resumable upload, Box's chunked upload above its threshold), downloads in
ranges; each transfer is an ongoing activity in the notification area
(`org.webosphoenix.ongoing`, "Uploading big.bin", with its progress),
which Files' bar shows with Cancel; a cancel stops between chunks and
drops the provider's upload session where it has a way to (Dropbox's expire by themselves).

**Offline.** No connection: the folder says the drive can't be reached,
with Try Again; nothing is lost; a file opened before opens from its
device copy. A refused sign-in (401) says so with a way to Accounts.
Errors are the kit's numbers (`FILE_ERRORS`: OFFLINE 10, AUTH 11, QUOTA
12, CANCELED 13, NOT_AVAILABLE 14, UNSUPPORTED 15, RATE_LIMITED 16, after
the file manager's own).

**Not offered: SFTP.** The connectors' services reach the network only
through the kit's `request()` (HTTP, by the runtime's proxy in the
simulator and Node on a device): there are no raw sockets. The one
permissively licensed SSH implementation in JavaScript, `ssh2` (MIT),
needs Node's `net` and `crypto` (and optionally a native module), so it
could only run on a device and not be tested in the simulator as every
other provider is. SFTP waits for a socket API in the kit (GAPS.md).

**Not yet:** the original picker (SF1) lists what the media indexer has,
so drives are not in it (the Files kind of SF2 has them); no offline
"keep on this device" pinning beyond the cache; device OAuth sign-in waits
for the browser sheet on devices (`services/oauth/service.js`:
`UNSUPPORTED` there), so on a device only the WebDAV and S3 drives sign
in today.

### The original picker (SF1)

Enyo 1's `enyo.FilePicker` (FilePicker.js:48) shows
`/usr/lib/luna/system/luna-systemui/app/FilePicker/filepicker.html` in a
CrossAppUI frame of the app's page; the page answers with a
`enyoCrossAppResult=` message (CrossAppResult.js:13). On webOS every frame
had `PalmSystem` and `PalmServiceBridge`; here the compat copy of
`filepicker.html` loads the runtime, which takes the app of the page around
the frame as its own. Behind it, as webOS 3's media indexer kept them in
db8: albums (`com.palm.media.image.album:1`: name, path, total {images,
videos}, sortKey; the camera's "Photo roll" first), pictures and videos
with their album's `albumId`, `appCacheComplete` and `appGridThumbnail`
(found "from" the parent kind `com.palm.media.types:1`), songs with
`isRingtone` (the system's ringtones and /media/internal/ringtones), and
the documents (`com.palm.media.misc.file:1`, as before); systemservice
`ringtone/addRingtone` / `deleteRingtone` (its add-ringtone button and
swipe). Contacts makes its photo from the crop with `com.palm.image/convert`
(and `ezResize`, `imageInfo`; `com.palm.filecache` for synced contacts),
which the runtime does on a canvas; pages show the user's pictures by
their path (an `<img>` or an inline background naming
/media/internal/... or /var/file-cache/...), and `palmGetResource` reads
the files the Files store keeps.

**Share in every app menu.** As Edit is in every app menu, Share follows
it: React apps' `AppMenu` (`@phoenix/ui`) takes `share`, what the app is
showing (Photos: the picture; `false` leaves it out); Enyo 1 apps get it
from the runtime with Edit, and say what to share with
`__phoenixRuntime.setShareContent(fn)` (Memos: the open memo; the browser:
the page). An app that says nothing shares the text selected on the page;
with nothing selected, Share is dimmed.

## 1. What the original had

- **A file picker, for opening only.** Enyo 1's `enyo.FilePicker` (and
  Mojo's) shows a page that luna-systemui provides,
  `/usr/lib/luna/system/luna-systemui/app/FilePicker/filepicker.html`, inside
  the app's card (CrossAppUI). It picks images (by album, with a crop
  view for wallpapers and contact photos), audio, ringtones, videos and
  documents, one or several. Email attaches files with it, Contacts sets
  a photo, Clock picks an alarm sound. It is in our tree
  (`third_party/luna-systemui/app/FilePicker`, Apache-2.0).
- **No save picker.** Apps saved to fixed places (`/media/internal/...`).
- **No share sheet.** Each app had its own menu (Photos: Email, Messaging,
  Facebook...), so a new service meant changing every app.

## 2. The plan

| Piece | What it is | Line |
| --- | --- | --- |
| **SF1. The original file picker** | luna-systemui's own picker, running as on the original: legacy apps' `FilePicker` (Email's attachments, Contacts' photo, Clock's sounds) work unchanged | 1.x |
| **SF2. Picker service** | `luna://org.webosphoenix.filepicker/pick` for every app (React, Enyo 2, web apps): the same picker, a promise with the chosen files. Types, extensions, several files, a crop size, as the original's parameters | 1.x |
| **SF3. Save picker** | A Phoenix addition in the same style: `.../save {name, data or path, types}`. It shows the folders of `/media/internal` (Documents, Downloads, Pictures and any the user made), with New Folder and a name field, and writes the file there | 1.x |
| **SF4. Share sheet** | `luna://org.webosphoenix.share/open {files, text, url, title}`: a sheet that slides up from the bottom, in the classic look. It has two rows. **Actions**: Save to Photos (pictures and videos), Save to Files (SF3), Copy, Print later. **Apps**: those that say in their `appinfo.json` what they take, e.g. `"phoenix": {"shareTargets": [{"types": ["image/*"], "label": "Email"}]}`, and Synergy accounts that post, one entry per signed-in account ("Accounts in the sheet" above). The chosen app is launched with `{share: {...}}` (and `accountId`) | 1.x |
| **SF5. Apps** | Screenshot first (Share opens the sheet; Save asks Photos or Files). Then Photos, Docs, Files, Voice Memos, Browser (Share Page), Maps (Share Location): their own menus give way to the sheet | 1.x |
| **SF6. 2.0** | The sheet's 2.0 look, people to share with (recent conversations), share to nearby devices, extensions that edit in place (markup) | 2.0 |

**How it is built.** The sheet and the picker are one hidden app,
`org.webosphoenix.sharesheet` (`apps/sharesheet`). The runtime of the page
that asks lays it over its card in a frame and dims the card; the two talk
with postMessage. The picker only chooses (a folder, a name, new folders):
the runtime of the asking page writes the file, into the media store under
`/media/internal` (pictures there show in Photos, everything in Files). Save
to Photos copies into the Camera Roll unless the picture is in a Photos
album already. The back gesture goes to the sheet while it is up. Apps call
`shareSheet.open` and `filePicker.save` (`@phoenix/luna`); `appinfo.json`
`"phoenix": {"shareTargets": [{"types": [...], "label"?}]}` puts an app in
the sheet (`apps.json` carries it), and the original Email, which cannot
say so, is in a table in the runtime (its `attachments` launch params).

**Why system-wide.** The sheet and the pickers are pages the system
provides (as the original's picker was). An app calls a service and gets
an answer, so changing the sheet changes it everywhere, without
rebuilding any app. Apps that can receive a share say so in their
`appinfo.json`, so a newly installed app shows up in every sheet.

**From the shell.** The launcher's icon menu (Share, [M6-PLAN.md](M6-PLAN.md)
F1) has no app page to lay the sheet over, so the shell opens the sheet's
own page as a see-through system window with `{systemShare: {title, url}}`
(`Shell.shareApp`, `openSystemWindow(..., "share")`); that page asks
`org.webosphoenix.share/open` as an app would and closes its window when the
sheet is done. The back gesture goes to it while it is up.

**Effort.** SF1 S to M; SF2-SF3 M; SF4 M; SF5 S per app.

## Open questions for you

1. The sheet's look for 1.x: the classic webOS popup menu style (a list,
   like the app menu), or a bottom sheet with icons in a row, as iOS (a
   Phoenix addition in the classic art)?
2. Should Save to Files default to Documents, or to the last folder used?
