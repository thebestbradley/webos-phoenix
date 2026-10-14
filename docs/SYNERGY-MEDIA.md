# Synergy for music, podcasts and books (plan)

The owner's question (14 October 2026): can music and books join Synergy,
so that you sign in with your accounts and they sync into the default apps?
Yes, for services that give other apps a way in: open protocols and
self-hosted servers. Mostly no for the big commercial stores, which have no
playback or reading API for other apps, or which lock their files with DRM
that Phoenix does not have.

The owner chose the order (14 October 2026), and asked for it to be planned
and put on the roadmap now, to be built later:

1. **Music sources** for the Music app: Subsonic-compatible servers,
   Jellyfin, Plex and your drives.
2. **Podcast sync** with gPodder.
3. **A Books app** for the default apps. There is none today. It reads EPUB,
   PDF and comics and plays audiobooks, with OPDS catalogs, Audiobookshelf
   and KOReader sync as its sources.

This page is the plan for those three steps, named MB1 to MB3 (media and
books), with MB0 for what they share. It extends
[SYNERGY-CONNECTORS.md](SYNERGY-CONNECTORS.md), which already lists the
media servers and gPodder as P2 candidates and proposes the `MEDIA` and
`PODCASTS` capabilities. Every connector here is built on the connector kit
(`@phoenix/connector-kit`, [SYNERGY-SDK.md](SYNERGY-SDK.md)) and appears in
Accounts and in the Marketplace's Connections, as the Fediverse account does.

Items marked *(check)* are to be confirmed against the service's current
documentation and terms before that part is built.

## What is possible

| Kind of source | Possible? | Examples |
| --- | --- | --- |
| Self-hosted music servers | Yes. Open APIs for browsing, streaming and playlists | Navidrome, Gonic, Ampache, Funkwhale and Nextcloud Music through the Subsonic API; Jellyfin; Plex |
| Music files in your drives | Yes. Synergy's drive connectors already reach them | Nextcloud and WebDAV, SFTP, S3 (`apps/connectors/drives`) |
| Podcasts | Yes. Open standards for feeds, subscriptions and progress | RSS (the Podcasts app today), gpodder.net, Nextcloud gPodder Sync, self-hosted gPodder-compatible servers |
| E-books from open catalogs | Yes, through OPDS | Calibre and Calibre-Web, Kavita, Komga, Project Gutenberg, Standard Ebooks *(check its feed terms)* |
| Audiobooks | Yes | Audiobookshelf (also podcasts), LibriVox (public domain) |
| Reading progress across devices | Yes | The KOReader sync server (`kosync`), public or self-hosted |
| Commercial music streaming | Mostly no. No playback API for other apps, or playback needs Widevine or FairPlay | Spotify, Apple Music, YouTube Music, Tidal, Amazon Music |
| Commercial e-books and audiobooks | No. No public API, and the files carry DRM | Kindle, Kobo, Apple Books, Audible, Libby and OverDrive |

What can still be done for the commercial services, outside this plan:
their web players as catalog web apps; scrobbling to Last.fm and
ListenBrainz (SYNERGY-CONNECTORS.md section 7); Spotify's "now playing"
and remote control of playback on another device, which needs an app
registered with Spotify (OPEN-QUESTIONS.md Q17); and library lending
through the Palace Project, which needs Readium LCP, a certified DRM
(later, with the streaming DRM work in [APP-STORE.md](APP-STORE.md#311-streaming-apps-and-drm)).

## Principles

- **The apps stay the apps.** Music, Podcasts and Books show a source's
  library beside what is on the device, as Synergy merged accounts into
  Contacts and Calendar. No source gets an app of its own.
- **Both lines.** 1.x gains modern accounts in the classic style, and the
  connectors sit below the UI, so 1.0's Music and Podcasts (webos-phoenix
  `apps/`) and 2.0's (phoenix-default-apps) read the same kinds. The Books
  app is a 2.0 default app (step 3); what 1.x gets is an owner question
  (below).
- **Standards first.** One Subsonic connector covers several servers; one
  OPDS reader covers every catalog; one gPodder connector covers gpodder.net
  and the servers that speak its API.
- **Licences.** Clients are written from each service's published API, not
  from its code: most of these servers are GPL or AGPL (docs/LEGAL.md takes
  Apache-2.0 and permissive sources only). Jellyfin's TypeScript SDK is
  MPL-2.0 *(check)*, so the Jellyfin client is written from its OpenAPI
  description.
- **Secrets in the key store.** Passwords and tokens are kept as the
  Fediverse account keeps its token (SYNERGY-CONNECTORS.md 4.1, "As built").
- **Offline is a choice.** A source's library is browsed and streamed; an
  album, a playlist, an episode or a book is downloaded for offline use on
  request, through `com.webos.service.downloadmanager`, as Podcasts already
  downloads episodes. Downloads show as ongoing activities.

## The shared pieces (MB0)

Needed by all three steps; built with the first.

| Piece | What |
| --- | --- |
| Capabilities | `MEDIA` (music and video libraries) and `PODCASTS`, as proposed in SYNERGY-CONNECTORS.md (its open question 4), and a new `BOOKS` (e-books, comics, audiobooks, reading and listening progress) |
| Generic kinds | One per capability, which the connectors extend (SYNERGY-SDK.md rule C10): for `MEDIA` an album, a track and a playlist; for `PODCASTS` a subscription and an episode action; for `BOOKS` a book (an e-book, a comic or an audiobook) and a reading position. Names and fields are agreed with the first connector of each |
| What is synced | Metadata only: artists, albums, tracks, playlists, covers (cached), books and positions. Large libraries are synced in pages and kept up to date with each API's "changed since" where it has one; search goes to the server when it has a search call |
| Streaming | Playback through the apps' existing players: the source gives an address the `<audio>` element can play (a token in the address where the API takes one), and range requests for seeking. A format the device cannot decode is asked for transcoded (Subsonic `format`, Jellyfin's universal audio address) |
| Playback reports | What is played goes back to its source: Subsonic `scrobble`, Jellyfin's playback progress, Plex's timeline, Audiobookshelf's progress. Off with a switch per account |
| Just Type | Artists, albums, podcasts and books from every source in Just Type and the Assistant ("play Kind of Blue"), from the synced metadata |
| Now playing | The shell's now-playing dashboard, still to build (M4, second wave), shows a source's track as any other |
| Simulator | A fake server per protocol (as `apps/fediverse/service/test/fake-mastodon.cjs`), the conformance suite, and a Chromium test per app (`tools/test-<area>.cjs`). Real servers (Navidrome, Jellyfin, Audiobookshelf, Kavita, kosync) can be started in containers for an optional check |

## MB1: music sources

Where: connectors in webos-phoenix `apps/connectors/` (`subsonic`,
`jellyfin`, `plex`, and music in `drives`); 1.0's Music in webos-phoenix
and 2.0's Music in phoenix-default-apps read them.

| Source | API and sign-in | Notes |
| --- | --- | --- |
| Subsonic-compatible: Navidrome, Gonic, Ampache, Funkwhale, Nextcloud Music, Airsonic | The Subsonic REST API with token sign-in (`t` = MD5 of the password and a salt, `s` = the salt, API 1.13 and later); an OpenSubsonic API key where the server offers one *(check)* | One connector for every server that speaks it. OpenSubsonic's extensions (synced lyrics, multiple artists, more precise dates) when the server lists them. Token sign-in keeps the password in the key store; an API key avoids that |
| Jellyfin | Its REST API: sign-in by user name and password (`/Users/AuthenticateByName`) or Quick Connect (a code approved from another signed-in device), then an access token | Music libraries first; video libraries for the Videos app later, on the same connector |
| Plex | A PIN sign-in on plex.tv (the device shows a code to enter at plex.tv/link), then the user's servers from plex.tv, then each server's library API with the token | Needs a product name and a client id, no registration. Since 2025 Plex charges for remote playback of personal media (Plex Pass or Remote Watch Pass) *(check how it applies to other apps)*; playback on the home network is free. Plex's terms for third-party apps *(check)* |
| Your drives | The drive connectors (WebDAV and Nextcloud, SFTP, S3) | The user picks a music folder per drive. Tags and cover art are read with range requests (ID3 and MP4 headers), into the same kinds as the servers. No transcoding: formats the device cannot play are skipped and counted |

In the Music app:

- **Library:** the device's music and each source's, merged into one
  Artists, Albums and Songs view, with a source filter (All, On This
  Device, then each account), as Synergy's calendars could be shown or
  hidden.
- **Playlists:** the sources' playlists listed and played; editing them
  where the API allows (Subsonic, Jellyfin, Plex). Music's own playlists
  are still to build (APP-GAPS.md); they come first.
- **Offline:** "Download" on an album or playlist; a downloaded album plays
  without the network and is marked.
- **Ratings and favourites:** a source's stars and favourites shown, and set
  back where the API allows.
- **Settings:** per account, whether to stream on mobile data, the
  streaming quality, and whether to report plays.

Done when: each of the four sources signs in, lists its library, plays,
seeks and downloads in both Music apps in the simulator, against its fake
server, with its test in CI; the shell's now-playing dashboard shows the
source; Just Type finds an album from a source.

## MB2: podcast sync

Where: a `gpodder` connector in webos-phoenix `apps/connectors/`; 1.0's
Podcasts (webos-phoenix `apps/podcasts`) and 2.0's (phoenix-default-apps)
read it. APP-GAPS.md lists gpodder.net and Nextcloud sync as the Podcasts
app's main missing piece.

| Service | API | Notes |
| --- | --- | --- |
| gpodder.net | The gpodder API v2: subscriptions per device (`/api/2/subscriptions/{user}/{device}.json`, changes since a timestamp) and episode actions (`/api/2/episodes/{user}.json`: download, play with position, delete, new) | The public service is free and has been slow at times *(check)*. Sign-in with user name and password |
| Nextcloud gPodder Sync | The same two parts on a Nextcloud server (`/index.php/apps/gpoddersync/subscriptions` and `/episode_action`) | What AntennaPod and other apps use with Nextcloud. Reuses the Nextcloud account's sign-in where the user has one |
| Self-hosted gPodder-compatible servers | The gpodder API | For example oPodSync *(check which servers implement episode actions)* |

What syncs:

- **Subscriptions** both ways: a podcast subscribed to on another device
  appears in Podcasts, and one added or removed here is sent back. OPML
  import and export stay as they are.
- **Episode actions** both ways: where you stopped (the position), what you
  finished and what you deleted, so an episode resumes where another app
  left it. Conflicts: the latest action wins, as the API's timestamps say.
- **When:** at start, after playback stops, and with the existing refresh
  (every 6 hours through the activity manager), not on every second of
  play.

Audiobookshelf also serves podcasts. Its podcasts come with the Books step
(MB3), through the same account, into Podcasts.

Done when: subscriptions and positions round-trip between both Podcasts apps
and a fake gpodder server, and between two simulators (`--instance`), in CI.

## MB3: the Books app

A new default app in phoenix-default-apps (2.0, Ember Glass), `apps/books`.
Doc View keeps opening a single file, as now (APP-GAPS.md: its EPUB 2/3
reader); Books is the library and the reader for books you keep, and shares
Doc View's EPUB and PDF rendering rather than writing its own.

**Formats:**

| Format | How |
| --- | --- |
| EPUB 2 and 3 | Doc View's EPUB reader: pages in CSS columns, two on a tablet, table of contents, text size and font, night mode, reading position. Books adds bookmarks, highlights with notes, search in the book, and fixed-layout EPUB (for picture books and some comics) |
| PDF | PDF View's renderer, with Books' library, position and bookmarks |
| Comics: CBZ, CB7, CBR, PDF | Pages as pictures, swiped one by one or as a strip, double pages on a tablet, right-to-left for manga; `ComicInfo.xml` for series, number and reading direction. CBZ through the zip library the apps already use (fflate); CBR (RAR) and CB7 through libarchive compiled to WebAssembly (BSD licence; its RAR5 support *(check)*) |
| Audiobooks: M4B, MP3 folders | The chapter list from the file (MP4 chapters, ID3 `CHAP` frames) or one chapter per file; speed, sleep timer, skip back and forward, resume; background playback and the now-playing dashboard, as Podcasts |

**Sources:**

| Source | What it brings | API |
| --- | --- | --- |
| On this device | Books in `/media/internal/books` (and any folder the user adds), books opened from Files, Email and the browser ("Add to Books") | The file system and the share sheet |
| OPDS catalogs | Browse, search and download from Calibre's content server, Calibre-Web, Kavita, Komga and public catalogs (Project Gutenberg; Standard Ebooks *(check)*); comics streamed page by page where the server offers OPDS-PSE (Komga, Kavita) | OPDS 1.2 (Atom) and OPDS 2.0 (JSON); HTTP sign-in where the catalog has one |
| Audiobookshelf | Your audiobooks and e-books, streamed or downloaded, with listening progress and bookmarks kept on the server, so another Audiobookshelf app resumes at the same place; its podcasts go to Podcasts | Its REST API (api.audiobookshelf.org): sign-in for a token (newer servers add refresh tokens *(check)*), libraries, items, play sessions, progress |
| KOReader sync | Reading position shared with KOReader (e-ink readers, Kobo and Kindle with KOReader, Android) | The kosync API: a user and key (MD5 of the password), `PUT /syncs/progress` and `GET /syncs/progress/{document}` |
| LibriVox | Public-domain audiobooks to browse and download | Its catalog API and per-book feeds |
| Your drives | A books folder on a WebDAV, Nextcloud, SFTP or S3 drive | The drive connectors |

**KOReader positions:** KOReader names a book by a hash of parts of the file
(its "partial MD5") and stores a position as an address in its own
renderer's document (an XPointer), with a percentage beside it. Books
computes the same document hash from KOReader's documented method (not from
its code, which is AGPL), sends its own position as the percentage plus the
closest XPointer it can derive, and on reading another device's position
uses the XPointer when it maps to the same paragraph, otherwise the
percentage. Exact positions across apps are best effort; the plan should
not promise more.

**The app (2.0's patterns):** a library of covers (Reading Now, Want to
Read, Finished, by series, by author), a search across every source, a
"Continue" row on top with the last book of each kind, and a mini player
for the audiobook playing. Collections as in Apple Books; the Ember Glass
look and the default apps' update log and What's New, as every rebuilt app.

Done when: EPUB, PDF, CBZ and M4B open and keep their place; an OPDS
catalog, Audiobookshelf and KOReader sync each work against a fake server in
CI; a book's position moves between two simulators.

## Order and size

| Step | Work | Size | Depends on |
| --- | --- | --- | --- |
| MB0 | Capabilities, generic kinds, the fake servers, the Synergy plumbing for metadata sync and playback reports | M | The connector kit (C1, built) |
| MB1 | Subsonic, then Jellyfin, then drives, then Plex; both Music apps (sources, merged library, offline, settings); Music's own playlists first | L | MB0; the now-playing dashboard for the last item |
| MB2 | gPodder (gpodder.net, Nextcloud, compatible servers); both Podcasts apps | S–M | MB0 |
| MB3 | The Books app: library, EPUB, PDF, comics, audiobooks; then OPDS, Audiobookshelf, KOReader sync, LibriVox, drives | L | MB0; Doc View's and PDF View's renderers shared as packages |

On a device, the downloads, background playback and the activity manager
need the device-side work already listed (ROADMAP.md M4, "Synergy on a
device" and "Device side of the new apps").

## Questions for the owner

Not needed to start; asked when each step begins.

1. **1.x and Books.** Should 1.x get a Books app in the classic style too,
   or keep Doc View's EPUB reader and gain only OPDS downloads in it?
2. **Plex.** Include it in MB1 given the charge for remote playback, or
   leave it until its terms are checked?
3. **Video.** Bring Jellyfin's and Plex's video libraries to the Videos app
   in MB1, or later?
4. **Scrobbling.** Add Last.fm and ListenBrainz with MB1 (they are small),
   or keep them for later as SYNERGY-CONNECTORS.md section 7 has them?
5. **Library lending.** Look into the Palace Project and Readium LCP after
   MB3, with the streaming DRM work?

## Sources

- Subsonic API: subsonic.org/pages/api.jsp; OpenSubsonic: opensubsonic.netlify.app
- Jellyfin API: api.jellyfin.org (OpenAPI)
- Plex: the plex.tv PIN sign-in and the Plex Media Server API (developer.plex.tv)
- gpodder API: gpoddernet.readthedocs.io (API v2); Nextcloud gPodder Sync: github.com/thrillfall/nextcloud-gpodder
- OPDS: specs.opds.io (1.2 and 2.0), OPDS-PSE (anansi-project.github.io)
- Audiobookshelf API: api.audiobookshelf.org
- KOReader sync server: github.com/koreader/koreader-sync-server
- ComicInfo.xml: anansi-project.github.io
- LibriVox API: librivox.org/api/info
- Readium LCP: readium.org/lcp-specs; the Palace Project: thepalaceproject.org
