# Synergy accounts, a connector catalog and a developer kit (draft)

*Draft, 10 October 2026, with what is built since: phases C0, C1 (the kit) and C2 (the Fediverse account), each in an "As built" note; since, sharing in the kit (a connector's accounts in the share sheet, SYNERGY-SDK.md section 7). The Marketplace view this page calls the Accounts view is named **Connections** (the owner, section 5). Developers: [SYNERGY-SDK.md](SYNERGY-SDK.md).*

The owner asked: which accounts fit our Accounts app and fill Synergy with a
modern twist; a feed for accounts in the catalog with its own Synergy view;
what developers must follow to build Synergy connectors; and what to change
in the framework for modern sites. This page answers those questions.
It builds on what is already written and does not repeat it:

- [SYNERGY.md](SYNERGY.md): how Synergy worked (1.x), the modern transports
  (2.x), and the CardDAV/CalDAV account that is built (3.x).
- [SYNERGY-MODERN.md](SYNERGY-MODERN.md): where each provider stands
  (September 2026), messaging, social, photos, files, the shared sync layer
  `synckit` (4.2), OAuth (4.4), secrets (4.5), push and the relay (4.8, 4.9),
  and the roadmap (5).
- [APP-STORE.md](APP-STORE.md): the Marketplace, its signed index and the
  PHP backend (`server/marketplace`), and phase A5 (sandboxed services).
- [COMMUNITY-FEATURES.md](COMMUNITY-FEATURES.md): the community's
  connectors (Synergy Revival, WebCal Sync, C+Dav, the OAuth Broker).

New here: account types the earlier pages leave out (feeds, podcasts,
bookmarks, notes, media servers, chat-over-email, IRC), the **connector feed**
and the **Accounts view** in the Marketplace, the **developer contract and
kit**, and a few gaps found in today's code that block third-party connectors.

## 0. What exists today, and the gaps found

| Piece | Today | Where |
| --- | --- | --- |
| Accounts app | The original Enyo app, unmodified, over the runtime's simulated `com.palm.service.accounts` | `third_party/core-apps/com.palm.app.accounts`, overlay in `compat/rootfs/usr/palm/applications/com.palm.app.accounts` |
| Templates | HP profile, IMAP, POP, other mail; CardDAV & CalDAV; Subscribed Calendar (webcal); the connector packages' own (the Fediverse, Unofficial Telegram; Jabber, Matrix, Delta Chat from the catalog) | `compat/rootfs/usr/palm/public/accounts/`, `apps/dav/public/accounts/`, each package's `public/accounts/` |
| Reference connector | `apps/dav`: hidden app + wizard + template + db8 kinds and permissions + Node service with luna-service2 files | `apps/dav/` (layout in section 3.1) |
| Marketplace | Index kinds `pwa`, `ipk` and (C4) `connector`: a package with a service only as a connector that passes the rules; third-party connectors need Developer Mode on the device, the pre-installed ones (the Fediverse, Unofficial Telegram) and Phoenix's own in its catalog (Jabber, Matrix, Delta Chat: `preinstalled.json` "firstParty", OPEN-QUESTIONS Q85) do not | `server/marketplace/src/Catalog.php` `publish()`, `src/Ipk.php` (header: "no services"), `apps/marketplace/service/packagesservice.js` lines 338-357 |
| OAuth, key store, push, synckit | synckit built (C1); the OAuth service's sign-in with PKCE built for the Fediverse (C2), its sheet and key store in the simulator only; push planned. Simulator keeps credentials in localStorage | SYNERGY.md 2.3, 2.9; SYNERGY-MODERN.md 4.2, 4.8; `services/oauth` |

**Gaps that matter for third-party connectors** (found while reading the code):

1. **"Find More..." goes nowhere.** The original "Add an Account" list ends
   with *Find More...*, which opens the App Catalog (`com.palm.app.enyo-findapps`)
   in a search for `type: "connector"` with the capabilities as
   `connectorInfo.types` (`third_party/enyo-1.0/framework/lib/accounts/source/add-account.js`
   lines 66-91; also `entry-first-launch.js` lines 246-271; titles from
   `util.js` `getSynergyTitle`, line 295). Palm's catalog was the connector
   store. Phoenix's `APP_ALIASES` (`runtime/phoenix-runtime.js` line 1708)
   does not map that id to the Marketplace, and the Marketplace has no
   connector search. (The shell's launcher already treats both ids as "the
   catalog", `shell/qml/Phoenix/Shell/LauncherLayout.js` line 54.)
   *Done in C0:* `APP_ALIASES` maps `com.palm.app.enyo-findapps` to the
   Marketplace, its params unchanged (`tools/test-accounts.cjs`).
2. **Templates are a fixed list in the simulator.** The original service
   scans two roots, `/usr/palm/public/accounts` and
   `/media/cryptofs/apps/usr/palm/accounts` (for installed apps), and
   reloads on `appsChanged` (`third_party/app-services/com.palm.service.accounts/accounts.js`
   lines 26-29, `handlers/apps-changed.js`). The runtime reads hard-coded
   files (`TEMPLATE_FILES`, line 3005; `DAV_TEMPLATES`, line 10411), so a
   connector installed from the Marketplace would not appear.
   *Done in C0:* the runtime's accounts block finds the templates in the
   folders `runtime/rootfs.json` mounts under `/usr/palm/public/accounts/`
   and in the installed apps' `public/accounts/<id>/`, reloads them when
   apps are installed or removed, and signals the change in tempdb as the
   service does; Accounts launched with `{templateId}` opens that
   template's sign-in (compat overlay `source/phoenix-launch.js`).
3. **Services need Developer Mode.** A connector is a background service,
   so it falls under APP-STORE.md phase A5 (sandboxed JS services). Until
   then, third-party connectors can only be side-loaded with Developer Mode.
4. **db8 permissions name every app that reads them.** `apps/dav/configuration/db/permissions/com.palm.contact.dav`
   lists Contacts, the linker, accounts, Phone and Messaging one by one. A
   third-party connector cannot know every app that reads contacts. We need
   a rule: apps that may read the generic kind may also read any kind that
   extends it. *(Check how OSE's db8 handles permissions on extended kinds.)*
5. **Data stays in its own app.** Tasks (`com.palm.task:1`) has no account
   sync, and the Passwords app has no WebDAV sync yet
   (`docs/spec/feature-inventory.md`, `docs/APP-GAPS.md`). Both are open
   slots that a connector could fill.
6. Palm's public Synergy SDK had a sync library for connectors
   (`Transport`-style sync commands in mojoservice). It is **not** in the
   open-source release (`third_party/foundation-frameworks` and
   `loadable-frameworks` have no sync framework; SYNERGY.md 1.4 says the
   same). *(From memory, unverified.)* Phoenix's kit replaces it; it does
   not reconstruct it. *Done in C1:* `@phoenix/connector-kit` (section 3.3).

## 1. Accounts that fit, with a modern twist

Legend: **Auth**: PW = password or app password, OAuth = OAuth 2 (PKCE
unless noted), Key = API key/token the user pastes in, LF = Nextcloud Login
Flow v2. **Reg**: registration Phoenix must do with the provider. **P**:
priority (P1 next, P2 after, P3 on demand). "SM" = SYNERGY-MODERN.md
section, which has the details and sources. Rows marked **new** are not in
the earlier pages.

### Contacts and calendars (CONTACTS, CALENDAR, REMOTECONTACTS)

| Account | Protocol / API | Auth | Reg | Terms / notes | P |
| --- | --- | --- | --- | --- | --- |
| Any CardDAV/CalDAV server | CardDAV, CalDAV | PW | none | Built (`com.webosphoenix.dav`) | done |
| iCloud, Fastmail, Nextcloud, Yahoo presets | DAV with fixed hosts | PW, LF | none | Presets planned (SM 4.1) | P1 |
| Subscribed calendars (webcal) | HTTPS `.ics` | none | none | Built (`com.webosphoenix.webcal`) | done |
| Microsoft 365 / Outlook.com | Graph | OAuth | Entra app | SM 1.3; EWS ends 2026-27 | P1 |
| Google | People + Calendar API | OAuth | Cloud project + verification | SM 1.2 | P2 |
| **new** Holidays, sports, school calendars as a curated list | `.ics` feeds through the webcal account | none | none | A "calendar directory" in the Accounts view (section 2); check each feed's terms | P2 |
| **new** Company directory | LDAP / CardDAV directory search (REMOTECONTACTS) | PW | none | Just Type remote contacts (SM 4.1 `REMOTECONTACTS`) | P3 |

### Mail (MAIL)

| Account | Protocol / API | Auth | Reg | Terms / notes | P |
| --- | --- | --- | --- | --- | --- |
| Generic IMAP/SMTP, Gmail/Yahoo/iCloud with app passwords | IMAP/SMTP | PW | none | Mail transport choice is open (SM 7 q6) | P1 |
| Fastmail, Stalwart, Cyrus | JMAP | Key / PW | none | Push over Web Push, fits UnifiedPush (SM 4.8) | P1 |
| Outlook.com / M365 | Graph or IMAP+XOAUTH2 | OAuth | Entra | SM 1.3 | P1 |
| Gmail with OAuth | IMAP+XOAUTH2 or Gmail API | OAuth | restricted scope, yearly assessment | SM 7 q2 | P3 |
| Proton Mail, Tuta | none for phones (Proton's Bridge is a desktop app; Tuta has no IMAP) | - | - | Not possible on the device; their PWAs go in the catalog instead | no |

### Messaging (MESSAGING, IM)

| Account | Protocol / API | Auth | Reg | Terms / notes | P |
| --- | --- | --- | --- | --- | --- |
| Matrix (and bridged networks on the user's server) | Matrix client-server, sliding sync, E2EE | PW / SSO / OAuth (MAS) | none | SM 2.4; bridges documented, not shipped. **Built** (11 October 2026, `apps/connectors/matrix`): E2EE not yet (OPEN-QUESTIONS Q82) | P1 |
| XMPP (Jabber) | XMPP + XEP-0198/0357, OMEMO | PW | none | **Built** (11 October 2026, `apps/connectors/xmpp`; section 7); OMEMO: no permissive library (OPEN-QUESTIONS Q81) | P1 |
| Telegram | TDLib | phone login | own `api_id` | SM 6b; "Unofficial" naming rule. **Built** (11 October 2026, `apps/telegram`, "Unofficial Telegram"): works where the build has the app id (Q16) and TDLib | P3 |
| **new** Delta Chat (chat over email) | IMAP/SMTP + Autocrypt; core library `deltachat-core-rust` | PW | none | The core is MPL-2.0 (checked: chatmail/core's LICENSE), run as its own program (`deltachat-rpc-server`), not linked. **Built** (11 October 2026, `apps/connectors/deltachat`); in images on the owner's decision (Q80) | P3 |
| **new** LoRa mesh (Meshtastic, MeshCore): off-grid text through a paired radio | The radio's client protocol over Bluetooth LE, USB serial or TCP | none (a channel key) | none | Added by the owner (10 October 2026, section 7). Needs a radio; licences to check (Meshtastic GPL-3.0, MeshCore MIT) | P2 |
| **new** IRC with a bouncer | IRCv3 (`chathistory`, `soju` / `ergo` bouncers) | PW / SASL | none | The user runs the bouncer; one thread per channel or person | P3 |
| WhatsApp, Signal, iMessage, RCS | - | - | - | Positions in SYNERGY.md 2.12 and SM 6 stand | - |
| Discord | - | - | - | Not a connector (the owner asked, 10 October 2026): its API is for bots; using a person's own account from another client (a "self-bot") is against Discord's terms and gets accounts banned. Sign in with Discord gives only the name, avatar, servers and linked accounts. Instead: the Discord web app in the catalog (its web push to check) | no |

### Social and feeds (SOCIAL, new FEEDS)

| Account | Protocol / API | Auth | Reg | Terms / notes | P |
| --- | --- | --- | --- | --- | --- |
| **Fediverse** (Mastodon, Pixelfed, GoToSocial, Akkoma, Friendica, ...): **the flagship connector** (the owner, 10 October 2026) | Mastodon client API, NodeInfo | OAuth per server, the app registering itself with each server | none | SM 3.1: contact enrichment, notifications, DMs, sharing; phase C2 | **P0** |
| Bluesky | AT Protocol | OAuth (atproto) | static client-metadata file | SM 3.1 | P2 |
| **new** RSS reader sync: FreshRSS, Miniflux, Nextcloud News, Inoreader, Feedly | Google Reader API (FreshRSS, Inoreader), Miniflux REST, Fever, Nextcloud News API | Key / PW (Inoreader and Feedly: OAuth + registration) | none for self-hosted | A new `FEEDS` capability: subscriptions and read state, for a reader app or a "Feeds" exhibition/Just Type. Plain RSS needs no account at all | P2 |
| **new** "Follow" on the open web | RSS/Atom, WebSub, h-feed | none | none | Subscriptions saved locally; a FEEDS account only syncs them | P3 |

### Photos, files and media (PHOTO, DOCUMENTS, new MEDIA)

| Account | Protocol / API | Auth | Reg | Terms / notes | P |
| --- | --- | --- | --- | --- | --- |
| Immich | REST | Key | none | SM 3.2, first photos source | P1 |
| Nextcloud / WebDAV (files, photos) | WebDAV | PW / LF | none | SM 3.3 | P1 |
| OneDrive, Dropbox, Google Drive (`drive.file`), Box, S3 | REST / S3 | OAuth / Key | per provider | SM 3.3 | P2 |
| **new** PhotoPrism, Nextcloud Memories | REST / WebDAV | Key / PW | none | Same PHOTO provider shape as Immich | P3 |
| **new** Flickr | Flickr API | OAuth 1.0a + API key | key | Non-commercial key terms *(check)*; a nod to webOS's photo accounts | P3 |
| **new** Jellyfin, Navidrome / Subsonic, Plex | Jellyfin REST, Subsonic API, Plex API | PW / Key (Plex: account sign-in) | none (Plex: product id) | A new `MEDIA` capability so Music, Videos and Podcasts see the user's own library (APP-GAPS.md lists these). Plex terms *(check)* | P2 |

### Tasks, notes, bookmarks, podcasts, passwords

| Account | Protocol / API | Auth | Reg | Terms / notes | P |
| --- | --- | --- | --- | --- | --- |
| CalDAV tasks (VTODO) | CalDAV | PW | none | Fills the Tasks app's missing sync (`com.palm.task:1`); the DAV engine already keeps VTODO | P1 |
| Microsoft To Do, Google Tasks | Graph, Tasks API | OAuth | as above | SYNERGY.md phase 4 | P2 |
| **new** Todoist, Vikunja | REST | Key (Todoist: OAuth or personal token) | Todoist app *(optional)* | Todoist's API terms *(check)*; Vikunja is self-hosted (AGPL server, separate program) | P3 |
| **new** Notes: Nextcloud Notes, Joplin (WebDAV/Joplin Server), Standard Notes | REST, WebDAV, E2EE API | PW / Key | none | `MEMOS` (legacy name; Notes uses `com.palm.note:1`). Standard Notes is end-to-end encrypted: keys stay on the device (section 4) | P2 |
| **new** Bookmarks: Nextcloud Bookmarks, Floccus (WebDAV/Git file), xBrowserSync | REST, WebDAV | PW / LF | none | A new `BOOKMARKS` capability for the browser | P3 |
| **new** Podcasts: gpodder.net, Nextcloud gPodder Sync | gpodder API v2 | PW | none | A new `PODCASTS` capability: subscriptions and episode progress for `apps/podcasts`, which already reads OPML | P2 |
| **new** Passwords: KeePass file over WebDAV/Nextcloud | WebDAV (the file stays encrypted) | PW / LF | none | Not a db8 capability: a DOCUMENTS root that Passwords opens (its listed "still to do") | P2 |
| **new** Bitwarden / Vaultwarden | Bitwarden API (E2EE) | PW + 2FA | client id *(check terms)* | Possible later; review security first (SECURITY-APPS.md) | P3 |

**Not candidates:** Facebook, Instagram, X, LinkedIn contact sync (closed
APIs or no APIs); Google Photos library sync (picker only, SM 3.2); iCloud
Photos/Drive; Proton (no device API). Their PWAs go in the catalog's web
apps.

## 2. The catalog: a connector feed and an Accounts view

### 2.1 Feed format

Keep **one signed index** (APP-STORE.md 3.4), so mirrors, signatures,
`expires` and updates work as they do today. Add two things:

- a package kind `connector`: an `.ipk` with a hidden app, a template,
  kinds and a service (the `apps/dav` layout). It installs like `ipk`, but
  under the connector rules (section 4.1), not Developer Mode.
- an `accounts` array: **account types**, each one template. One package
  can supply several (`org.webosphoenix.dav` supplies DAV, webcal and the
  iCloud/Fastmail/Nextcloud presets). Built-in ones are listed too
  (`builtin: true`), so the view shows everything Phoenix can connect to.

```json
"accounts": [{
  "templateId": "com.webosphoenix.immich",
  "title": "Immich", "provider": "Immich (self-hosted)",
  "icon": {"48": "...", "96": "..."},
  "summary": "Your albums in Photos; upload from Camera.",
  "capabilities": [
    {"capability": "PHOTO", "direction": "two-way"},
    {"capability": "PHOTO.UPLOAD"}
  ],
  "protocols": ["immich-rest"],
  "auth": {"type": "api-key", "registration": "none"},
  "server": "user",                     // user | fixed | discovered
  "privacy": {
    "dataGoesTo": "the server you enter",
    "e2ee": false, "phoenixServers": "none", // none | push-relay | token-relay
    "readsFrom": ["com.palm.media.image"], "writesTo": ["PHOTO kinds"]
  },
  "push": "poll",                       // poll | unifiedpush | relay
  "terms": "Self-hosted; no provider terms.",
  "status": "beta",                     // stable | beta | experimental
  "regions": {"allowed": null, "disallowed": null},   // as the original allowed_locales
  "package": {"id": "org.webosphoenix.immich", "minVersion": "0.1.0", "builtin": false},
  "help": "https://..."
}]
```

Field notes: `capabilities` uses the template's own names, so the device
can filter exactly as `listAccountTemplates {capability}` does
(`handlers/list-templates.js`). `privacy` is written by the developer,
checked in review, and shown on the device in plain words. `regions`
mirrors the original template's `allowed_locales`/`disallowed_locales`
(`accounts.js`, `addTemplate`). The publisher can fill most of the entry
from the template inside the package; only `summary`, `privacy`, `terms`
and `help` are new metadata.

**As built in C0** (`server/marketplace`, its README "Account types
(Connections)"): the built-in types only, from `catalog/accounts.json`,
with `templateId, title, provider, icon, summary, capabilities, protocols,
auth, server, privacy {dataGoesTo, e2ee, phoenixServers}, push, status,
package {id, builtin}, help?, signUp?, featured`. `signUp` (10 October
2026, the owner: "the accounts/connectors also need links to sign up and
register") is an `https://` page where a person without an account gets
one; the type's page in Connections offers "Don't have an account? Sign
up" beside Set up, and the template's own `signUp` puts the same link on
the sign-in step in Accounts (SYNERGY-SDK.md "Sign-up link"). `icon` is one address (the
catalog's copy of the template's 96 px icon), not the draft's sizes;
`direction` is `two-way`, `read-only` or `write-only`; `terms`, `regions`,
`readsFrom`/`writesTo` and `package.minVersion` wait for connector packages
(C4). The index stays `version: 1`; devices ignore keys they do not know.

### 2.2 Backend changes (`server/marketplace`)

- `apps.kind` gains `connector`; a new table `account_types (template_id,
  app_id, title, provider, capabilities, protocols, auth, server, privacy,
  push, terms, status, regions, help, builtin)`; `publish()` writes the
  `accounts` array.
- `Ipk::check` gets a connector profile. It accepts one `service/` folder and
  `public/accounts/<id>/` and `configuration/db/` under the app. It
  validates the template against
  `third_party/app-services/com.palm.service.accounts/schemas/template.json`,
  checks that `templateId`, kinds and the service name are in the
  developer's namespace, that every callback points at the package's own
  service, that every kind extends a generic kind and is owned by that
  service, and that no db8 permission grants access to another package's
  kinds. It allows no native code and no scripts.
  *Built in C1* as `server/marketplace/src/Connector.php` (`check`,
  `checkIpk`; rules C1 to C13), the same rules as the kit's
  `phoenix-connector validate` and tested on the same cases
  (`tests/connector-cases.json`). Since C4 the catalog takes a package
  with a service in its app (`service/package.json` or `service/sysbus/`)
  only as a connector that passes these rules (`Ipk::check` refuses a service
  in any other package), and the device's Marketplace service and the
  simulator install a third-party one only in Developer Mode.
  The layout differs from the draft above in one point: the service is in the
  app's `service/` folder (as `apps/dav` keeps it), not under
  `usr/palm/services/`, so the package is one app and C13's "files only under
  the app" holds.
- Review is always human for a connector's first release and for any change
  to auth, hosts or kinds (as APP-STORE.md 3.4 does for new ACGs).
- Admin: a field for the privacy and terms notes, and a "verified with
  provider" flag (e.g. the project's own OAuth registration).
- The **calendar directory** (holiday and sports `.ics` feeds, section 1) is
  a small curated list in the same index (`calendars: [{title, url,
  category, region}]`). The webcal account subscribes to an entry in one
  tap.

### 2.3 The Accounts view in the Marketplace

A fourth source next to Apps, Web apps and Classics: **Accounts** (Palm
called this "HP Synergy Services"; we should use our own name).

| Screen | Contents |
| --- | --- |
| Accounts home | Groups by capability: Contacts & Calendars, Mail, Messaging, Social & Feeds, Photos & Media, Files, Tasks & Notes; "Featured" (presets: iCloud, Fastmail, Nextcloud, Microsoft); the calendar directory |
| Account type page | Icon, provider, capability chips ("Contacts · Calendar · two-way"), a **Where your data goes** box from `privacy`, sign-in type ("App password", "Sign in with Microsoft"), push or polling, status badge, terms notes, the providing package, ratings and reviews |
| Button | Not installed: **Install**, then **Set up**. Installed or built in: **Set up** (opens the Accounts add flow at that template). Already added: **Open in Accounts** |
| Search | Matches account types by title, provider, capability and protocol ("caldav", "matrix") |

**Built (C0), as Connections** (the owner's name for it): the fifth tab
of the Marketplace, after Classics (`apps/marketplace/src/Connections.tsx`,
`accountTypes.ts`). The device service reads the index's `accounts`
loosely (`service/lib/accounts.js`: an entry without a usable `templateId`
is left out, an unknown value falls back to a plain default, an `icon`
relative to the index is resolved against it; an index without `accounts`
has none) and answers `listAccountTypes {capability?}`; `search` also
returns `accountTypes` (title, provider, capability, protocol). The home
groups them as above, "Featured" first, and "More" for capabilities in no
group. The type page has the chips, **Where your data goes**, the sign-in,
the server, how new data arrives, a Beta / Experimental badge and the help
link. **Set up** launches `com.palm.app.accounts` with `{templateId}`
(`setUpLaunch` in `accountTypes.ts`); a template already added as an
account (`listAccounts`) shows **Open in Accounts**. "Find More..." params
open the filtered list under its `searchBarTitle`, with **All Connections**.
Not yet: Install for connector packages (disabled, with a note), the
calendar directory, ratings, terms notes.

### 2.4 How Accounts reaches it

1. **Keep the original's "Find More..."**. Alias
   `com.palm.app.enyo-findapps` to `org.webosphoenix.marketplace` in
   `APP_ALIASES`. The Marketplace reads the original launch params
   (`common.params.type === "connector"`, `connectorInfo.types`) and opens
   the Accounts view filtered to those capabilities. This needs no change to
   `third_party`, and the Contacts, Calendar and Email "Add account" paths
   get it for free.
2. **Template discovery**: the simulator's accounts block scans
   `/usr/palm/public/accounts/*/` and the installed-apps root, as
   `accounts.js` does, and reloads on install or remove (`appsChanged`). The
   DAV block's list becomes "templates whose `implementation` is a Node
   service the runtime can load".
3. **After install**, the Marketplace offers **Set up** and launches
   Accounts with the template. *(Check which launch params
   `com.palm.app.accounts` accepts; if none fits, a compat overlay adds one.)*
4. **Later, optionally:** an overlay of `add-account.js` lists "Available to
   install" rows from the cached index under the installed templates. This
   is a UI change to the original, so it is the owner's call (question 3).

## 3. What a connector developer follows

### 3.1 Package layout (as `apps/dav`)

```
org.example.foo/                       hidden app, appinfo.json: "phoenix": {"hidden": true},
  appinfo.json                           "requiredPermissions": ["accounts.transport"]
  accounts/wizard.html                 optional custom sign-in page (validator.customUI)
  public/accounts/org.example.foo/     the template + images/ (32, 48 px and @2x/@3x)
    org.example.foo.json
  configuration/db/kinds/              own kinds, each "extends" a generic kind, "owner": the service
  configuration/db/permissions/        (with the rule of gap 4, only the service's own access)
  service/                             Node.js Luna service, CommonJS, no native modules
    service.js  package.json
    sysbus/ *.service *.role.json *.perm.json *.api.json *.groups.json *.manifest.json
```

### 3.2 The contract (unchanged from webOS, written down as rules)

1. **Template** (SYNERGY.md 1.2): `templateId`, `loc_name`, `icon`,
   `validator` (bus method, or `{address, customUI}`), `readPermissions` /
   `writePermissions`, and one `capabilityProviders` entry per capability,
   each with `id`, `capability` (+ `capabilitySubtype`, `serviceName` for
   IM), `dbkinds`, `implementation`, `onCreate`, `onEnabled`, `onDelete`,
   `onCredentialsChanged`, `sync`, and `readOnlyData` where it applies.
   Reuse a legacy capability name where one exists (SM 4.1).
2. **Validator** answers `{credentials, config}` or one of the error codes
   the accounts library shows (`third_party/enyo-1.0/framework/lib/accounts/source/errors.js`
   lines 5-29). It never stores anything itself.
3. **Callbacks** (SYNERGY.md 1.3) are idempotent. `onEnabled(true)` sets up
   the periodic activity and the first sync, and `onEnabled(false)` cancels
   it. `onDelete` removes every object with the account's `accountId`.
   `onCredentialsChanged` clears the error state and syncs.
4. **Data**: write only your own kinds, each extending the generic one, with
   `accountId` and a stable `remoteId` on every object:

   | Capability | Generic kinds you extend |
   | --- | --- |
   | CONTACTS | `com.palm.contact:1` (never write `com.palm.person:1`: the linker makes people) |
   | CALENDAR | `com.palm.calendar:1`, `com.palm.calendarevent:1` (+ `subKind` in the template) |
   | TASKS | `com.palm.tasklist:1`, `com.palm.task:1` (Phoenix Tasks) |
   | MEMOS | `com.palm.note:1` |
   | MAIL | `com.palm.mail.account:1`, `com.palm.folder:1`, `com.palm.email:1` (as `mojomail/imap/files/db8/kinds`) |
   | MESSAGING / IM | `com.palm.immessage:1` (extends `com.palm.message:1`), `com.palm.imbuddystatus:1` and `com.palm.imloginstate:1` (as the runtime's XMPP block) |
   | PHOTO, DOCUMENTS, SOCIAL, FEEDS, MEDIA, PODCASTS, BOOKMARKS | **To define.** No kinds were released for these. Phoenix publishes generic kinds first (one per capability), then connectors extend them |

5. **Sync state**: keep `com.palm.account.syncstate:1` up to date
   (`INITIAL_SYNC`, `INCREMENTAL_SYNC`, `IDLE`, `ERROR` + code). A
   `401_UNAUTHORIZED` puts the warning on the account
   (`accounts-list.js` line 138).
6. **Scheduling**: one periodic activity per account through the activity
   manager, with network and battery requirements, 15 minutes or more, and
   batched into the shared sync window (SM 4.7). The `sync` method serves
   "Sync now". Use db8 watches for the outbox and drafts, as mojomail does
   (`ImapActivityFactory.cpp` lines 122-280).
7. **Credentials** only through the accounts service
   (`readCredentials`/`writeCredentials`), never in db8 or files. OAuth
   tokens go through the OAuth service (section 4).
8. **Network**: only to the hosts the template declares (new field
   `hosts`), or to the server the user entered. Back off on 429 and 503 and
   honour `Retry-After`.
9. **Privacy**: no analytics; never log tokens, message text or addresses
   (SM 4.6); the catalog's `privacy` block must be true.
10. **Luna permissions**: the service's role may call only `com.palm.db`,
    `com.palm.tempdb`, `com.palm.activitymanager`,
    `com.palm.service.accounts`, and later the OAuth, key store and push
    services (the dav role is the model).

### 3.3 A modern kit: `@phoenix/connector-kit`

A TypeScript package in `apps/shared`, compiled to the same CommonJS a
device's `run-js-service` and the simulator's page loader both run (the
`createDavService({luna, request, log})` injection pattern of `apps/dav`).
It is built on `synckit` (SM 4.2), which is extracted from `apps/dav` first.

```ts
export default defineConnector({
  template: "public/accounts/org.example.foo/org.example.foo.json",
  validate: async ({ username, password, config }) => ({ credentials, config }),
  capabilities: {
    CONTACTS: {
      kind: "org.example.foo.contact:1",
      pull: async (ctx, token) => ({ changes, deleted, nextToken }),  // incremental
      push: async (ctx, localChanges) => results,                      // with etags
      map: { toDb: fromJSContact, fromDb: toJSContact },
    },
  },
  schedule: { every: "60m", network: true },
  push: { unifiedPush: true },                    // optional
});
```

The kit supplies: the callbacks (`onCreate`/`onEnabled`/`onDelete`/...)
made from that definition; item records with a base copy and three-way
field merge; sync-state records; scheduling; an HTTP client with backoff,
timeouts and host allow-listing; `ctx.credentials` and `ctx.oauth.token()`;
the mappers that already exist in `apps/dav/service/lib` (vCard, iCalendar)
plus JSContact/JSCalendar; and a push registration helper.

**Tooling:**

- `npx phoenix-connector new` scaffolds the layout of 3.1. `validate`
  checks the template schema, namespaces, kinds and permissions with the
  same checks the Marketplace runs. `pack` builds the `.ipk`.
- **Test harness**: the in-memory db8 and the accounts service the DAV tests
  already use (`apps/shared/synckit/src/test/memdb.js`), recorded HTTP fixtures,
  and a **conformance suite** every connector must pass to be listed:
  create → enable → sync → disable → delete leaves no data; a second sync
  with nothing changed writes nothing; 401 gives `ERROR`/`401_UNAUTHORIZED`;
  429 is honoured; a conflict keeps both edits or records the loser.
- **Simulator run**: `./phoenix run --launch org.webosphoenix.marketplace`
  with a local connector source, as `tools/test-dav-sync.cjs` does for DAV.
- **Docs**: a `docs/SYNERGY-SDK.md` for developers, with `apps/dav` as the
  worked example. A minimal read-only example (an RSS/FEEDS connector) is
  the "hello world".

**As built in C1** ([SYNERGY-SDK.md](SYNERGY-SDK.md) is the guide):

- `apps/shared/synckit` (`@phoenix/synckit`, plain CommonJS): extracted from
  `apps/dav`, which now runs on it (its tests unchanged and green). Moved:
  vCard, iCalendar, date and content-line mappers, the person linker,
  Node's `request()`, the in-memory db8 and fake bus of the tests; new from
  `davservice.js`: `createLuna` (db8, tempdb, credentials, account info),
  `createScheduler` (the periodic activity), `createSerializer` (one sync
  at a time), `errorCodeOf` / `fail`, `setSyncState`; new: `createHttp`
  (host allow-list, `Retry-After`, retries, timeouts), item records and
  `merge3` (the three-way field merge of SM 4.2).
- `apps/shared/connector-kit` (`@phoenix/connector-kit`, TypeScript, built to
  `lib/` CommonJS): `defineConnector` as sketched above, with two kinds of
  capability: a set of objects (`kind`, `pull`, and `push` for two-way) and
  anything else (`sync`, `remove`, an outbox `watch`); `createConnectorService`
  makes the callbacks; `lib/device` runs it under `run-js-service`. The
  simulator runs the same compiled files in the page (runtime "Synergy
  connectors on the kit": the built-in ones, and packages installed in
  Developer Mode), finding `@phoenix/*` by name (rootfs
  `/usr/lib/phoenix/node_modules/`); a device service carries them in its
  `node_modules` (`tools/install-rootfs.py`, `phoenix-connector pack`).
- `phoenix-connector new | validate | pack | test`; the conformance suite
  (`lib/conformance`) with the checks listed above, run on the hello-world
  FEEDS connector (`examples/feeds`, also run in the simulator by
  `tools/test-fediverse.cjs`), on a two-way test connector and on the
  Fediverse account.
- Not built: JSContact / JSCalendar mappers, push registration (C6),
  `minVersion` of the kit in packages.

**Compatibility:** the kit emits original-format templates and kinds, so
the original Contacts, Calendar, Email and Accounts apps keep working.
Legacy Synergy packages from the archives (Preware, Synergy Revival) can
run under Developer Mode, if their mojoservice dependencies are available.
They are not listed as connectors.

## 4. Framework and infrastructure updates

### 4.1 Changes

| Area | Change | Notes |
| --- | --- | --- |
| Template discovery | Scan both roots, reload on install or remove (gap 2) | Original behaviour; needed by anything installable |
| Connector trust tier | A sandbox level between web apps and Developer Mode: JS service only, no native code, a fixed luna allow-list (3.2 rule 10), network limited to declared hosts or the user's server, a CPU/wake budget | The concrete form of APP-STORE.md A5 for connectors |
| db8 permissions | Readers of a generic kind may read kinds that extend it; a connector may grant access only to its own kinds (gap 4) | Verify OSE db8 semantics first |
| OAuth service | `org.webosphoenix.service.oauth`: PKCE, loopback redirect, device-code fallback (SYNERGY.md 2.3, SM 4.4), shown as a **system browser sheet** over the Accounts card. The address bar is visible and the page can't be read by the connector | Never an embedded web view; bring-your-own client id per connector |
| Key store | `org.webosphoenix.service.keystore` behind the legacy `com.palm.keymanager` API (SYNERGY.md 2.9). Also holds per-account keys for encrypted local stores (Matrix, Standard Notes, Bitwarden) | Exclude it from unencrypted backup (SM 4.5) |
| Push | UnifiedPush distributor over Luna + optional relay (SM 4.8, 4.9); the kit's `push` option registers for the connector | Polling stays the fallback |
| Rate limits | Per-account backoff in the kit; a per-connector budget enforced by the activity manager; show "paused: provider asked us to slow down" | |
| Incremental sync | Kit requires a token-based `pull` (sync-token, delta link, JMAP state, `since`); full listings only for the first sync or after the token expires | |
| Conflicts | Three-way field merge from the base copy (SM 4.2, open q7) | |
| Per-account data permissions | In Accounts: what each account syncs (already capability switches) **and which apps may see it** (e.g. a work account's contacts hidden from Messaging), plus "Export my data" and "Remove data on sign-out" | New UI in an overlay; enforced by db8 queries per app |
| Account health | One list of sync states, last sync, errors, data used, battery attributed per account | Builds on `lib/syncui` dashboards |
| Webhooks | Only through the relay; the device creates subscriptions itself so the relay never holds tokens (SM 4.9) | |

### 4.2 Keep

Template format and `capabilityProviders`; the callbacks; db8 kinds
extending generic ones; the contacts linker and `com.palm.person:1`; sync
state records; the activity manager; credentials only through the accounts
service; "Find More..." as the way into the catalog. These are why the
original apps still work and why old connectors' ideas carry over.

## 5. Open questions for the owner

Decided (10 October 2026): the Marketplace view is called
**Connections**; third-party connectors are installable from the
Marketplace **for Developer Mode only** until the connector tier (4.1);
the Accounts app keeps the original **"Find More..." only** (no inline
rows). The owner wants the plan fleshed out before C0 is built, and the
**Fediverse** as the flagship Synergy account (phase C2, right after the
kit).

Still open:

4. **New capabilities:** agree to define `FEEDS`, `MEDIA`, `PODCASTS`,
   `BOOKMARKS` (and their generic kinds) as Phoenix additions?
5. **First-party vs community:** which of section 1's P1/P2 rows do we
   build, and which do we leave for developers using the kit?
6. **Privacy labels:** are they the developer's statement checked in review
   (proposed), or must we verify them technically (network audit in review)?
7. **Calendar directory:** curate holiday and sports `.ics` feeds ourselves
   (we would have to check each feed's terms)?

## 6. Phased plan

| Phase | Work | Size | Depends on |
| --- | --- | --- | --- |
| **C0** (simulator, now) | Alias "Find More..." to the Marketplace with its params; dynamic template discovery + reload; `accounts` array in the index with built-in types only; the Accounts view (browse, Set up); calendar directory | M | nothing |
| **C1** (built) | Extract `synckit` from `apps/dav` (SM phase 1c); `@phoenix/connector-kit`, CLI `new/validate/pack`, conformance suite; `docs/SYNERGY-SDK.md` with a FEEDS example | M | C0 |
| **C2** (built, but Pixelfed albums) | **The Fediverse first** (the flagship): one account type for any ActivityPub server with the Mastodon client API (SM 3.1), on the kit. The handle finds the server (WebFinger, NodeInfo); the app registers itself with that server (`POST /api/v1/apps`) and signs in with OAuth in a browser sheet, its token in the key store: the parts of C3's OAuth service it needs, built here first. Then followed accounts on contact cards (avatar, profile, latest post), notifications as webOS notifications (Web Push to UnifiedPush later, C6; polled until then), direct mentions in Messaging's threads (labelled "not private"), Pixelfed albums in Photos, and the account as a share target in the share sheet (post a photo, a link, a memo) | M–L | C1 |
| **C3** | The rest of the OAuth service (providers that need a registered client), then first-party connectors on the kit: Microsoft (SM 2a, 7c), DAV presets (iCloud, Fastmail, Nextcloud LF v2), CalDAV tasks for Tasks, Immich, gpodder, FreshRSS/Miniflux, Bluesky | L | C2; SYNERGY phase 0 for the device |
| **C4** (built, but the review fields) | `connector` kind in the backend: profile checks, review, privacy/terms fields; Developer Mode installs from the Marketplace | M | C1 |
| **C5** | Connector trust tier + db8 permission rule; open submissions to everyone | L | APP-STORE A5, device |
| **C6** | Push (UnifiedPush) and relay in the kit; per-account app visibility; account health | M | SM phase 5 |

**As built in C4** (10 October 2026; `server/marketplace` README
"Connector packages", SYNERGY-SDK.md "Publishing" and "Testing in the
simulator"): the catalog takes a package with a service only when it
passes the connector rules (`Connector::checkIpk`), lists it as kind
`connector` with a signed release, and lists its account types from its
template and its `catalog.json` (the fields of `accounts.json`'s entries,
checked the same way). A development catalog (`MARKETPLACE_DEV`, serve.sh's)
approves on upload; elsewhere a person reviews. `phoenix-connector publish`
packs, validates and uploads (`--local`: the simulator's catalog). The
Marketplace's Connections installs a connector through its install path:
a third-party one in Developer Mode only (else it says why and links to
Settings > Developer Mode), then Set up opens Accounts at its template.
Still to do: the reviewers' privacy and terms fields and the "verified
with provider" flag.

**As built in C2** (the Fediverse account, `apps/fediverse`, template
`com.webosphoenix.fediverse`, built in and listed in Connections, featured):

- **Sign-in**: the handle (`@you@example.social`) on the account's page in
  Accounts; WebFinger on the handle's domain finds the server (which may be
  another host), NodeInfo names its software (Lemmy, PeerTube, Misskey and
  others without the Mastodon client API are refused for now); the app
  registers itself with that server once (`POST /api/v1/apps`, kept by the
  OAuth service per server and redirect address); OAuth authorization code
  with PKCE in the system's browser sheet (the share sheet's page, kind
  `signin`: the server's page in a web view, its address above it); the
  token in the key store (in the simulator the runtime's credential storage;
  on a device a placeholder file until the key store, and no sheet yet:
  `services/oauth/service.js`); the account's credentials keep only the key.
  Scopes: `read:accounts read:follows read:notifications read:statuses
  write:statuses write:media`.
- **Contacts** (read only): the accounts you follow, as
  `com.palm.contact.fediverse:1` (name from the display name without custom
  emoji, `@handle` as nickname, the profile link and the links the server
  verified, the avatar kept as a file, the latest post in the note), linked
  to your people by the linker's rules (same name), as Synergy linked a
  Facebook friend. Latest posts are read only for those who posted since
  (`last_status_at`), 30 per sync.
- **Messaging**: direct mentions as `com.palm.immessage.fediverse:1`
  (`serviceName` `type_fediverse`), one conversation per person, which
  Messaging labels **not private** ("direct mentions are not encrypted, and
  the admins of both servers can read them"); a reply is posted back as a
  direct mention in reply to the last one (the outbox: a db8 watch on a
  device, the simulator's IM transport hook). The first sync brings recent
  ones in as read, without notifications.
- **Notifications** (capability `SOCIAL`): mentions, follows, boosts and
  favourites as webOS notifications (five at most per sync, then "n more");
  a tap opens the post or profile in the browser. Polled every 15 minutes
  (the kit's schedule); Web Push to UnifiedPush is C6.
- **Sharing**: the account is a share target, written from the kit's
  `share` declaration (10 October 2026, SYNERGY-SDK.md section 7): the
  share sheet lists it once per signed-in account ("Fediverse ·
  @you@example.social") and not at all without one; its page posts a link,
  text, up to four pictures each with its description (alt text), with the
  visibility chosen (public, unlisted, followers, mentioned only), through
  the kit's `share` method, with an `Idempotency-Key`.
- **Not done**: Pixelfed albums in Photos (no PHOTO capability or kinds yet;
  OPEN-QUESTIONS.md Q3), Bluesky, Web Push (C6), the sheet and key store on
  a device (C3).
- **Tests**: a fake Mastodon server (`apps/fediverse/service/test/fake-mastodon.cjs`,
  following docs.joinmastodon.org page by page), the conformance suite and
  unit tests (`connector.test.ts`), and `tools/test-fediverse.cjs`, the whole
  flow in the simulated runtime.

C0 and C1 need no registration with anyone and no new server, as DAV
needed none in phase 1; nor does C2: each Fediverse server registers the
app itself. They also make every later connector, ours or a
developer's, show up in one place.

When parts of this are built, update `docs/spec/feature-inventory.md` and
`docs/spec/GAPS.md`, and move the agreed parts into SYNERGY-MODERN.md and
APP-STORE.md.

## 7. Added by the owner, 10 October 2026

**Apple iCloud with an app-specific password** (C3, first of the DAV
presets): contacts (CardDAV, `contacts.icloud.com`), calendars (CalDAV,
`caldav.icloud.com`) and iCloud Mail (IMAP `imap.mail.me.com:993`, SMTP
`smtp.mail.me.com:587`). The user makes the password at account.apple.com
(Sign-In and Security, App-Specific Passwords; two-factor on); it reaches
only mail, contacts and calendars and can be revoked. The setup page says
how, with a link to Apple's page. Not reachable: iCloud Drive and Photos
(no public API; the tools that reach them use Apple's private web API with
the real password, against Apple's terms), the new Reminders (since iOS
13), Notes beyond the old IMAP ones.

**Drives and cloud storage, as places in the Files app** (a new
DOCUMENTS/files capability; also in the file picker and the share sheet's
Save to Files): first the ones needing no registration, WebDAV (Nextcloud,
ownCloud, any server; an app password), SFTP and S3-compatible storage
(Backblaze B2, MinIO, Wasabi); then with the OAuth service (C3) Dropbox,
OneDrive (Microsoft Graph) and Google Drive (its restricted scope needs
Google's verification; the per-file scope avoids most of it). iCloud Drive:
not planned.

**Telegram** (C3, after Bluesky): a Messaging and Contacts connector on
TDLib (Telegram's own client library, Boost Software License), driven from
Node through its JSON interface. Sign-in with the phone number, the code
and the two-step password; chats, groups and channels as Messaging
conversations; contacts linked; notifications from TDLib's updates (web
push registration later, C6); secret chats on this device only, as in
Telegram's apps. Its chats other than secret ones are not end-to-end
encrypted (Telegram's design): the setup page says so. It needs an app id
and hash from my.telegram.org (free; OPEN-QUESTIONS Q16), kept out of the
public tree as a build-time setting; Telegram's terms: the app is not
called "Telegram" nor made to look like the official one. WhatsApp (no
client API) and Signal (only through unofficial AGPL tools, against the
licence rule) stay out.

Telegram's app id is registered by a Phoenix project account (the owner,
OPEN-QUESTIONS Q16), as are the other developer apps below (Q17).

**LinkedIn** (C3; the work theme): its connections API is closed to all but
paid partner programmes, so: Sign In with LinkedIn (OpenID Connect: the
user's own name, photo, headline, email); Share on LinkedIn (the
`w_member_social` scope, open to any app) as a share-sheet target; and the
people on contact cards from an import of the user's own data export
(LinkedIn, Settings, Data privacy, Get a copy of your data:
`Connections.csv`, with name, company, position, profile URL and sometimes
email), matched to existing contacts and adding company, title and a
LinkedIn profile link; repeatable, not live. No feed, messages or live
connection updates.

**Meetings and video calls** (Skype closed in May 2025; webOS 2-3 phones had
Skype in Phone and Messaging): (1) before C3, needing no account: meeting
links (Zoom, Teams, Google Meet, Webex, Jitsi) found in events, invitations
and notifications get a Join button and a reminder as the meeting starts;
(2) before C3: a Video Call action on contacts and in Phone, through Jitsi
Meet (open source, WebRTC, no account; which server is an owner's choice),
the room link sent through Messaging; (3) C3: a Zoom account (Zoom's API,
OAuth: meetings listed in Calendar with Join, created by the Assistant;
meetings run in the browser, Zoom's own app has no ARM Linux build) and
Microsoft Teams through the Microsoft sign-in (meetings in Calendar, chats
in Messaging where Graph allows).

**Box** (C3, with Dropbox, OneDrive and Google Drive): its content API with
OAuth (Box dropped WebDAV), as a place in Files.

**Jabber (XMPP), a real account** (the owner: "add both"). *Built, 11
October 2026: see "Messaging accounts, as built" below.* It becomes a real connector on the kit: sign-in
with the Jabber ID and password (SASL SCRAM; the server found from the
domain's SRV records), chats as Messaging conversations (`com.palm.immessage`
as the original's IM transports wrote them), the roster as contacts linked
to people with presence (`com.palm.imbuddystatus`), stream management and
push (XEP-0198, XEP-0357, with the push service of C6), message carbons and
archive (XEP-0280, XEP-0313) so other clients' messages show too, file
upload (XEP-0363) for pictures, and OMEMO end-to-end encryption once a
permissively licensed library is chosen (until then: TLS to the server, and
the setup page says the messages are not end-to-end encrypted). Sign-up
link: a server list (e.g. providers.xmpp.net) or Snikket. Messaging and
Contacts capabilities; P1, after the connector store work.

**LoRa mesh messaging** (the owner: "add both"): off-grid text over LoRa
radio, no cell or internet service, through a small paired radio (phones
have no LoRa radio: about US$25-60, connected over Bluetooth LE, USB or the
radio's Wi-Fi). Networks: Meshtastic (the largest) and MeshCore. As a
Synergy account: mesh messages in Messaging, threaded by person and by
channel and marked "Mesh"; the nodes heard as contacts, with their last
position for Maps when they share it; new messages as notifications; the
radio's battery and signal on the account's page. In the simulator: a radio
on USB serial or the network, or a fake radio for tests; on a device:
Bluetooth LE (the device work's Bluetooth service). Licences first:
Meshtastic's firmware and protocol definitions are GPL-3.0, so a Phoenix
client must be written from the published protocol without GPL code (to
check), or start with MeshCore (MIT). Sign-up link: none needed (a channel
key); a page on getting a radio. P2, after XMPP.

**What comes with Phoenix** (the owner, 10 October 2026; the pre-installed
list is tentative): built in, part of the system and not removable, are only
the generic logins: Contacts & Calendars (any CardDAV / CalDAV server, the
iCloud, Nextcloud and Fastmail presets, subscribed calendars) and Email (any
IMAP / SMTP mailbox). Every other account is a connector package in the
catalog's Connections. Google, Microsoft, the Fediverse, Telegram and LoRa
mesh come pre-installed at launch, and can be removed and installed again
like any other; the rest (Jabber, Matrix, Bluesky, LinkedIn, the drives,
Zoom, Teams, Google Chat with Google, ...) are installed by those who want
them.

*As built (10 October 2026):* `catalog/accounts.json` marks a connector
package Phoenix comes with as `package: {builtin: false, preinstalled:
true}` (checked: `preinstalled` only with `builtin: false`); the Fediverse is
the first. The device's list is `/etc/palm/marketplace/preinstalled.json`
(`apps/marketplace/service/etc/palm/marketplace/`): the image has each one
among the apps the user may remove (`tools/install-rootfs.py`:
`/media/cryptofs/apps`, from `runtime/rootfs.json` `preinstalled`), phoenix-sim
and `tools/serve-rootfs.py` put it among their installed apps the first
time, and the Marketplace's service counts it as installed from the
`phoenix` catalog. Connections lists it Installed with Remove; Remove asks
first, naming the accounts that go with it, deletes them, then removes the
package, and it stays removed. Installing it again needs no Developer Mode:
the service treats a `connector` entry as first-party only when its id is
in the device's pre-installed list **and** it comes from a catalog the
device ships with (a built-in source) whose key the device was given or the
user checked, so its SHA-256 is signed by that key; the installer takes the
`firstParty` flag only from the Marketplace's service (ctx.caller). The same
package from a catalog the user added is a third party's: Developer Mode.
The catalog publishes Phoenix's own packages as an admin's, in the
`org.webosphoenix` and `com.webosphoenix` namespaces. Not yet: on a device
a removed pre-installed connector's service stays registered (unused) in
the system until devices run installed connectors' services (C5).

**Slack** (the owner, 10 October 2026; a catalog package, not pre-installed):
direct messages and channels as Messaging conversations, the workspace's
people linked to contacts, mentions and direct messages as notifications,
through Slack's Web API with the user's sign-in (OAuth, a user token). Its
limits: since 2025 Slack lets apps outside the Slack Marketplace read
message history only very slowly (about one request a minute, a few
messages each), too slow for a messaging account, so the Slack app must be
registered by the Phoenix project account (OPEN-QUESTIONS Q17) and listed
in the Slack Marketplace (Slack's review); a workspace's admins can also
refuse outside apps. Until it is listed it is built and tested with those
limits.

**Messaging accounts, as built** (11 October 2026). Four IM transports on
the kit (docs/SYNERGY-SDK.md "Staying connected"), each a connector package
with its template, db8 kinds (`com.palm.immessage.<x>:1`,
`com.palm.imloginstate.<x>:1`, a contact kind, and Jabber's
`com.palm.imbuddystatus.<x>:1` in tempdb) and messages written as the
original IM transports wrote them (LuneOS's imlibpurpleservice:
`src/IMMessage.cpp` createDBObject; `inc/IMMessage.h` for `chatType`,
`channelName`, `channelDisplayName`, `serviceMessageId`, `deliveryStatus`;
`BuddyListConsolidator.cpp` for the buddies and their contacts;
`IMLoginState.cpp` for the login state Messaging's My Status writes):

| Account | Package | How | Works today |
| --- | --- | --- | --- |
| Jabber (XMPP) | `apps/connectors/xmpp`, catalog | its own XMPP client (`service/lib`): SRV (`_xmpps-client`, `_xmpp-client`), STARTTLS or direct TLS, plain TCP refused but to the loopback, SASL SCRAM-SHA-256/1 (PLAIN only inside TLS), bind, stream management with resumption (XEP-0198), carbons (0280), archive catch-up (0313), HTTP upload (0363) and out-of-band links for pictures, receipts and markers (0184, 0333), chat states (0085), push hooks (0357, for C6), WebSocket (RFC 7395, found through host-meta XEP-0156) where there is no TCP | against Prosody 0.12 (`tools/test-xmpp-server.cjs`), its fake server (vitest, the conformance suite), and in the simulator's pages over WebSocket to the demo server chat.example (`tools/test-xmpp.cjs`). OMEMO: no permissive library (Q81); the sign-in page says the messages are encrypted to the server only |
| Matrix | `apps/connectors/matrix`, catalog | client-server API: discovery (`.well-known`), simplified sliding sync (MSC4186) or `/v3/sync`, password or the homeserver's OAuth 2.0 (MAS: RFC 7591 registration, PKCE, the system's sign-in sheet), rooms as conversations (direct chats by the other person's Matrix ID, linked to contacts), authenticated media both ways, read receipts both ways, presence | against its fake homeserver (vitest, conformance) and the simulator's demo matrix.example (`tools/test-matrix.cjs`). Encrypted rooms: shown as encrypted, nothing sent into them (Q82) |
| Delta Chat | `apps/connectors/deltachat`, catalog | Delta Chat's own core, `deltachat-rpc-server` (MPL-2.0, a separate program; JSON-RPC on its standard input and output; the kit starts it as a system helper with its accounts in the service's own folder): an address and password, or a new chatmail address (`dcaccount:`); chats and groups by Message-ID, pictures, delivered and read, read receipts sent; end-to-end encrypted by the core (Autocrypt) | against the real core 2.63 (method names, shapes and errors, offline) and a fake core (vitest, conformance, the simulator's chatmail.example, `tools/test-deltachat.cjs`). The image has the core only with `PHOENIX_DELTACHAT = "1"` (Q80) |
| Unofficial Telegram | `apps/telegram`, comes with Phoenix | TDLib (BSL-1.0) through `phoenix-tdjson`, a small C bridge putting TDLib's JSON interface on standard input and output (`meta-phoenix/recipes-connectors/tdlib`); phone, code and two-step password; private chats, groups and secret chats (no channels: Q83), pictures, read receipts both ways; the app id a build-time setting (Q16) | against a fake tdjson (vitest, conformance, `tools/test-telegram.cjs` with a test app id); the bridge against a stub libtdjson. Without the app id or TDLib: "not available in this build". Named "Unofficial Telegram", with a picture of its own, as Telegram's terms ask |

Each keeps one connection per account while a capability is on
(`definition.connection`), signs out on the server when the account is
deleted, notifies new messages (Messaging opens the conversation), and has a
sign-up link. Messaging sends pictures where the network takes them, shows
Delivered and Read, and says on Telegram's conversations what its servers
can read. Sharing to a person on these networks goes through Messaging's
share target (the person and network picked there). Just Type's chat
action reaches them as the original did (`compose.ims`), and the Assistant
sends on them ("message Priya on Telegram: ..."). The simulator's demos
(`runtime/rootfs.json`: `/usr/share/phoenix/demo/`) answer only for their
own domains.

**More platforms** (the owner, 10 October 2026: "add them with the others
as potentials or not likely"; catalog packages, none pre-installed):

Potentials:

| Platform | What it brings | How | Notes |
| --- | --- | --- | --- |
| KDE Connect | An Android phone's texts in Messaging (read and reply from a Phoenix tablet), its notifications mirrored, files and the clipboard shared | Its open protocol over the local network (TLS, paired with a code) | Written from the published protocol: KDE Connect's own code is GPL. A fit for tablets, as the TouchPad's "text from your tablet" was |
| Mattermost, Zulip, Rocket.Chat | Team chat: direct messages and channels in Messaging, the team's people in Contacts, mentions as notifications | Their REST and websocket APIs with the user's sign-in or a personal token | Self-hosted Slack alternatives with full user APIs: no marketplace review, no history limits |
| Nostr | Posts in the feed, people as contacts, direct messages in Messaging | Relays over websockets, the user's key (NIP-01, NIP-17 messages) | No registration; keys only. Next to the Fediverse and Bluesky |
| GitHub, GitLab, Forgejo / Codeberg | Notifications (mentions, reviews, CI, issues), assigned issues as tasks | Their REST APIs with a personal token or OAuth | For the work theme; free APIs |
| Home Assistant | Smart-home alerts as notifications; "turn off the lights" through Just Type and the Assistant | Its REST and websocket APIs with a long-lived token, on the user's own server | No registration; local |
| Last.fm, ListenBrainz, Spotify | Scrobbling what Music plays; Spotify's now playing and playlists | Last.fm and ListenBrainz APIs; Spotify Web API (OAuth) | Spotify needs an app registered (OPEN-QUESTIONS Q17) and its playback rules are strict |
| Reddit | Inbox messages and replies in Messaging, notifications | Reddit's OAuth API, free tier for personal non-commercial use | Its terms limit commercial use |

Not likely, and why:

| Platform | Why not | Instead |
| --- | --- | --- |
| Facebook | The original had it built in, but today's Graph API gives no friends' details, posts or Messenger messages to other apps | Its web app in the catalog |
| Instagram | Its API is only for business and creator accounts; no direct messages for personal ones | Its web app |
| Threads | Its API posts and reads the user's own posts only | The Fediverse account reaches Threads profiles that share to the fediverse |
| YouTube as an account | Little an account adds | Channel subscriptions as RSS feeds through the feeds connector |
