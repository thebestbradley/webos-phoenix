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
> app menu, after Edit** (below). To do: SF1, SF2 for other kinds, several
> files and a crop size, and Docs, Voice Memos and Maps of SF5.

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
| **SF4. Share sheet** | `luna://org.webosphoenix.share/open {files, text, url, title}`: a sheet that slides up from the bottom, in the classic look. It has two rows. **Actions**: Save to Photos (pictures and videos), Save to Files (SF3), Copy, Print later. **Apps**: those that say in their `appinfo.json` what they take, e.g. `"phoenix": {"shareTargets": [{"types": ["image/*"], "label": "Email"}]}`. The chosen app is launched with `{share: {...}}` | 1.x |
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
