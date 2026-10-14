# Open-source web apps in the Marketplace

> **The owner's request (13 October 2026):** put ArtCraft's apps in the
> catalog, compile a list of the major, popular web-built apps from Linux
> and add them to the Marketplace's feed; and host the updated 2.0 apps
> there, so a user can download one again or add it to a 1.0 device
> ([APP-STORE.md](APP-STORE.md) "The 2.0 apps").

This page is the list: popular open-source apps people use on Linux that
also ship a web build which runs entirely in the browser, with no server of
their own. For each: its licence, where it comes from, how it is
distributed, whether it needs a server or an account, whether it runs in a
Phoenix card, and what the Marketplace does with it. Checked 13 October
2026, at the versions given.

## How an app gets in

Three outcomes, by its licence and how it is distributed (docs/LEGAL.md
"Marketplace"):

- **Hosted.** A permissive licence (MIT, Apache-2.0, BSD, ISC, Zlib, CC0)
  and a release build that is a static site. The Marketplace packs
  upstream's own release, unmodified, as an `.ipk` with an `appinfo.json`,
  the app's icon as upstream ships it, and its licence and notice files,
  and hosts it. Upstream is the vendor and the developer the Marketplace
  names; the summary and description are ours. Each one is pinned in
  `server/marketplace/catalog/web-apps.json` (its download and SHA-256,
  checked again against upstream's own `SHA256SUMS.txt` where it publishes
  one; its icon and licence files at the release's tag, each pinned; its
  `releaseNotesUrl`, the GitHub release of the pinned version, which the
  app's page links as Release notes, as the package has no update log of
  ours: APP-STORE.md 3.15), and
  `server/marketplace/bin/web-apps.py` fetches, checks, packs and publishes
  it ([server/marketplace/README.md](../server/marketplace/README.md)
  "Open-source web apps"). Nothing of it is in this repository.
- **A link.** A copyleft licence (GPL, AGPL), or no static release to
  host, but an official hosted instance with a web app manifest: listed as
  a curated web app (`catalog/curated-sites.json`, probed by
  `bin/probe-pwas.py`), which opens the official site in its own card, as
  the other curated web apps do. Phoenix hosts nothing of it, so no source
  offer is owed.
- **Left out**, with the reason: proprietary, needs a server of its own,
  too large for a package, or nothing to host or link to (yet).

## The list

"Runs in a card" says what was tried in phoenix-sim (tablet) on 13 October
2026: *installed* means installed from the local catalog through the
Marketplace and launched; *started* means launched from its packed files
(`web-apps.py shoot`, the screenshots the catalog lists). In this container
there is no GPU: the ArtCraft apps draw with WebGL 2, which needs
`QTWEBENGINE_CHROMIUM_FLAGS="--ignore-gpu-blocklist --enable-unsafe-swiftshader"`
here (not with a real GPU).

### Hosted

| App | Licence | Upstream (version) | Distributed as | Server / account | Runs in a card |
| --- | --- | --- | --- | --- | --- |
| **PhotoCraft** (photo editing) | MIT OR Apache-2.0 | [storytold/photocraft](https://github.com/storytold/photocraft) 0.8.2 | `photocraft-web-0.8.2.zip`, `SHA256SUMS.txt` | none | yes, installed (Open and Save: see below) |
| **VectorCraft** (vector illustration) | MIT OR Apache-2.0 | [storytold/vectorcraft](https://github.com/storytold/vectorcraft) 0.10.0 | `vectorcraft-web-0.10.0.zip`, sums | none | yes, started |
| **FilmCraft** (video editing) | MIT OR Apache-2.0 | [storytold/filmcraft](https://github.com/storytold/filmcraft) 0.7.2 | `filmcraft-web-0.7.2.zip`, sums | none | yes, started |
| **LightCraft** (raw photos, library) | MIT OR Apache-2.0 | [storytold/lightcraft](https://github.com/storytold/lightcraft) 0.7.1 | `lightcraft-web-0.7.1.zip`, sums | none (AI masks' model and place names are the user's own downloads) | yes, started; its package is 63 MB, just under the catalog's 64 MB |
| **PdfCraft** (PDF tools) | MIT OR Apache-2.0 | [storytold/pdfcraft](https://github.com/storytold/pdfcraft) 0.7.1 | `pdfcraft-web-0.7.1.zip`, sums | none | yes, started |
| **EffectCraft** (motion graphics) | MIT OR Apache-2.0 | [storytold/effectcraft](https://github.com/storytold/effectcraft) 0.9.2 | `effectcraft-web-0.9.2.zip`, sums | none | yes, started |
| **DesignCraft** (page layout) | MIT OR Apache-2.0 | [storytold/designcraft](https://github.com/storytold/designcraft) 0.7.1 | `designcraft-web-0.7.1.zip`, sums | none | yes, started |
| **WordCraft** (word processor) | MIT OR Apache-2.0 | [storytold/wordcraft](https://github.com/storytold/wordcraft) 0.6.1 | `wordcraft-web-0.6.1.zip`, sums | none | yes, installed (Open and Save: see below) |
| **GridCraft** (spreadsheets) | MIT OR Apache-2.0 | [storytold/gridcraft](https://github.com/storytold/gridcraft) 0.6.1 | `gridcraft-web-0.6.1.zip`, sums | none | yes, started |
| **DeckCraft** (presentations) | MIT OR Apache-2.0 | [storytold/deckcraft](https://github.com/storytold/deckcraft) 0.6.1 | `deckcraft-web-0.6.1.zip`, sums | none | yes, started |
| **KeeWeb** (KeePass passwords) | MIT | [keeweb/keeweb](https://github.com/keeweb/keeweb) 1.18.9 | `KeeWeb-1.18.9.html.zip` | none (cloud drives optional, with their accounts) | yes, installed; its demo database opens. In the simulator it first warns "Not Secure" (apps are served from `phoenix://` there; on a device from `file://`) |
| **Phanpy** (Mastodon client) | MIT | [cheeaun/phanpy](https://github.com/cheeaun/phanpy) 2026.10.09.febb38d (packed as 2026.10.9) | `phanpy-dist.zip` | a Mastodon/Fediverse account on the user's server; no server of its own | yes, installed; its sign-in (OAuth back to the card) not tried, for want of an account |

All ten ArtCraft apps with a web build: every one of PhotoCraft,
VectorCraft, FilmCraft, LightCraft, PdfCraft, EffectCraft, DesignCraft,
WordCraft, GridCraft and DeckCraft has a `*-web-*.zip` in its latest
release (none is without one). They are Rust and egui compiled to
WebAssembly, MIT OR Apache-2.0, their icons too (each repository's
`assets/app-icon/LICENSE.txt`). Their packages carry upstream's
`LICENSE-MIT`, `LICENSE-APACHE` (in the release), and from the tag
`NOTICE`, `ATTRIBUTION.md` or `ASSETS.md`, the icon's licence and the
licence texts of the fonts, icons and word lists their `NOTICE` names. The
ArtCraft name and logos are the ArtCraft Team's trademarks (their
`NOTICE`); the catalog uses each app's own name and icon to identify it,
as upstream ships them, and names the ArtCraft Team as its developer.
DeckCraft uses the Symphonia audio decoders unmodified under MPL-2.0; its
`NOTICE`, in the package, says where their source is, which is what MPL-2.0
3.2 asks of a binary distribution of unmodified code.

**Open and Save** in the ArtCraft apps (and opening a `.kdbx` in KeeWeb)
go through Phoenix's own pickers: a file input or `showOpenFilePicker`
opens the file picker, and Save (a Blob download or `showSaveFilePicker`)
opens the save picker; the files show in Files (SHARE-AND-FILES.md "A web
page's own files"). WordCraft's and VectorCraft's Save and Open were
checked that way in the simulator. On a device the app runtime refuses
file choosers and downloads until WebAppMgr's side is done (GAPS, "A web
page's own files").

### Links (curated web apps)

| App | Licence | Upstream | Distributed as | Server / account | Listed as |
| --- | --- | --- | --- | --- | --- |
| **Excalidraw** (sketches) | MIT | [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | no release build (an npm component; the app is built from source) | none; sharing and collaboration use its servers | excalidraw.com (already listed) |
| **draw.io** (diagrams) | Apache-2.0 | [jgraph/drawio](https://github.com/jgraph/drawio) 32.4.1 | `draw.war`, a Java web archive with server parts | none for the editor | app.diagrams.net (already listed) |
| **Squoosh** (image compression) | Apache-2.0 | [GoogleChromeLabs/squoosh](https://github.com/GoogleChromeLabs/squoosh) | no release build | none | squoosh.app (already listed) |
| **JS Paint** (paint program) | MIT | [1j01/jspaint](https://github.com/1j01/jspaint) | no release build (the site is the repository, deployed as it changes) | none | jspaint.app (added) |
| **JupyterLite** (notebooks) | BSD-3-Clause | [jupyterlite/jupyterlite](https://github.com/jupyterlite/jupyterlite) | a Python package that builds a site; the Python kernel comes from a CDN | none | jupyterlite.github.io/demo (added) |
| **Kiwix JS** (offline Wikipedia) | GPL-3.0 | [kiwix/kiwix-js](https://github.com/kiwix/kiwix-js) 4.0.0 | releases (browser extensions, a PWA) | none | pwa.kiwix.org (already listed) |
| **Element** (Matrix chat) | AGPL-3.0 | [element-hq/element-web](https://github.com/element-hq/element-web) 1.12.30 | release tarball | a Matrix account | app.element.io (already listed) |
| **Cinny** (Matrix chat) | AGPL-3.0 | [cinnyapp/cinny](https://github.com/cinnyapp/cinny) 4.12.7 | release tarball | a Matrix account | app.cinny.in (added) |
| **FluffyChat** (Matrix chat) | AGPL-3.0 | [krille-chan/fluffychat](https://github.com/krille-chan/fluffychat) 2.10.0 | web tarball | a Matrix account | fluffychat.im/web (added) |

Excalidraw, draw.io, Squoosh, Kiwix and Element were already curated web
apps; JS Paint, JupyterLite, Cinny and FluffyChat are new ones
(`curated-sites.json`; their manifests found by the probe on 13 October
2026). A link opens the site itself, which keeps the user's data.

### Left out

| App | Licence | Upstream | Why |
| --- | --- | --- | --- |
| **PDF.js viewer** | Apache-2.0 | [mozilla/pdf.js](https://github.com/mozilla/pdf.js) 6.4.299 (`pdfjs-6.4.299-dist.zip`, no server) | Phoenix's PDF View is PDF.js already (`apps/pdfview`); the release's `web/viewer.html` is upstream's demo viewer, with no app icon of its own |
| **miniPaint** | MIT | [viliusle/miniPaint](https://github.com/viliusle/miniPaint) 4.14.3 | no release build (the tagged source carries the built app, but GitHub's source archives could not be fetched from here); its site's manifest is switched off, so it cannot be a link. Could be hosted from the tagged source later |
| **Elk** (Mastodon client) | MIT | [elk-zone/elk](https://github.com/elk-zone/elk) 1.0.1 | a Nuxt app with its own server, no static release; its site adds its manifest by script (`/manifest-en.webmanifest` answers with the page), so the probe cannot confirm it (kept in `curated-sites.json`) |
| **Wavacity** (Audacity in WebAssembly) | GPL-2.0 | [ahilss/wavacity](https://github.com/ahilss/wavacity) | copyleft, and no release build to host found; its site has no web app manifest, so it cannot be a link yet (kept in `curated-sites.json`) |
| **ZetaOffice** (LibreOffice in WebAssembly) | LibreOffice's MPL-2.0 | [zetaoffice.net](https://zetaoffice.net/) (allotropia) | no build to download: demos and a CDN offered as a paid service in open beta |
| **CyberChef** (data recipes) | Apache-2.0 | [gchq/CyberChef](https://github.com/gchq/CyberChef) 11.5.0 | its release zip is 79 MB, above the catalog's 64 MB package limit; its site has no web app manifest (kept in `curated-sites.json`) |
| **Godot editor (web)** | MIT | [godotengine/godot](https://github.com/godotengine/godot) 4.7.2 (`Godot_v4.7.2-stable_web_editor.zip`, 51.5 MB) | needs cross-origin isolation (SharedArrayBuffer), which a Phoenix card does not have: a page in a card reports `crossOriginIsolated` false and no `SharedArrayBuffer` (tried in phoenix-sim) |
| **Pixelorama** (pixel art) | MIT | [Orama-Interactive/Pixelorama](https://github.com/Orama-Interactive/Pixelorama) 1.2.3 | its releases are desktop builds only; the web version is on itch.io |
| **Penpot** (design) | MPL-2.0 | [penpot/penpot](https://github.com/penpot/penpot) | needs its own server (backend and database) |
| **tldraw** | the tldraw license | [tldraw/tldraw](https://github.com/tldraw/tldraw) | not open source: source-available, with a licence key for production use. Not in this list; tldraw.com stays a curated website, as before |
| **Photopea** | proprietary | photopea.com | not open source. Not in this list; photopea.com stays a curated website, as before |

## Updating the list

Pin a new version in `catalog/web-apps.json` (the download's URL and
SHA-256, and the icon's and licence files' at the new tag; `web-apps.py
check` checks the entry), then `web-apps.py publish ID` (and `shoot ID`
for new screenshots). An app whose licence is not permissive is refused by
`check`: list it as a link instead. A link is a line in
`curated-sites.json` and `bin/probe-pwas.py ID`.
