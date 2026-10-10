# Synergy accounts, a connector catalog and a developer kit (draft)

*Draft, 10 October 2026. Thoughts and plans only; nothing here is built. The Marketplace view this page calls the Accounts view is named **Connections** (the owner, section 5).*

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
| Templates | HP profile, IMAP, POP, other mail; CardDAV & CalDAV; Subscribed Calendar (webcal); a simulated Jabber (XMPP) account | `compat/rootfs/usr/palm/public/accounts/`, `apps/dav/public/accounts/`, runtime block "Instant messaging" |
| Reference connector | `apps/dav`: hidden app + wizard + template + db8 kinds and permissions + Node service with luna-service2 files | `apps/dav/` (layout in section 3.1) |
| Marketplace | Index kinds `pwa` and `ipk`; web apps only; services refused by the server and need Developer Mode on the device | `server/marketplace/src/Catalog.php` `publish()`, `src/Ipk.php` (header: "no services"), `apps/marketplace/service/packagesservice.js` lines 338-357 |
| OAuth, key store, push, synckit | Planned, not built. Simulator keeps credentials in localStorage | SYNERGY.md 2.3, 2.9; SYNERGY-MODERN.md 4.2, 4.8 |

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
2. **Templates are a fixed list in the simulator.** The original service
   scans two roots, `/usr/palm/public/accounts` and
   `/media/cryptofs/apps/usr/palm/accounts` (for installed apps), and
   reloads on `appsChanged` (`third_party/app-services/com.palm.service.accounts/accounts.js`
   lines 26-29, `handlers/apps-changed.js`). The runtime reads hard-coded
   files (`TEMPLATE_FILES`, line 3005; `DAV_TEMPLATES`, line 10411), so a
   connector installed from the Marketplace would not appear.
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
   not reconstruct it.

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
| Matrix (and bridged networks on the user's server) | Matrix client-server, sliding sync, E2EE | PW / SSO / OAuth (MAS) | none | SM 2.4; bridges documented, not shipped | P1 |
| XMPP | XMPP + XEP-0198/0357, OMEMO | PW | none | Simulated today; OMEMO library licence (SM 5, 6a) | P2 |
| Telegram | TDLib | phone login | own `api_id` | SM 6b; "Unofficial" naming rule | P3 |
| **new** Delta Chat (chat over email) | IMAP/SMTP + Autocrypt; core library `deltachat-core-rust` | PW | none | The library is MPL-2.0 *(check)*, which allows linking with per-file copyleft. Fits Synergy because the account is already a mail account | P3 |
| **new** IRC with a bouncer | IRCv3 (`chathistory`, `soju` / `ergo` bouncers) | PW / SASL | none | The user runs the bouncer; one thread per channel or person | P3 |
| WhatsApp, Signal, iMessage, RCS | - | - | - | Positions in SYNERGY.md 2.12 and SM 6 stand | - |

### Social and feeds (SOCIAL, new FEEDS)

| Account | Protocol / API | Auth | Reg | Terms / notes | P |
| --- | --- | --- | --- | --- | --- |
| Fediverse (Mastodon, Pixelfed, GoToSocial, ...) | Mastodon client API, NodeInfo | OAuth per server | none | SM 3.1: contact enrichment, notifications, DMs, sharing | P1 |
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
  already use (`apps/dav/service/test/memdb.cjs`), recorded HTTP fixtures,
  and a **conformance suite** every connector must pass to be listed:
  create → enable → sync → disable → delete leaves no data; a second sync
  with nothing changed writes nothing; 401 gives `ERROR`/`401_UNAUTHORIZED`;
  429 is honoured; a conflict keeps both edits or records the loser.
- **Simulator run**: `./phoenix run --launch org.webosphoenix.marketplace`
  with a local connector source, as `tools/test-dav-sync.cjs` does for DAV.
- **Docs**: a `docs/SYNERGY-SDK.md` for developers, with `apps/dav` as the
  worked example. A minimal read-only example (an RSS/FEEDS connector) is
  the "hello world".

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
rows). The owner wants the plan fleshed out before C0 is built.

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
| **C1** | Extract `synckit` from `apps/dav` (SM phase 1c); `@phoenix/connector-kit`, CLI `new/validate/pack`, conformance suite; `docs/SYNERGY-SDK.md` with a FEEDS example | M | C0 |
| **C2** | First-party connectors on the kit: DAV presets (iCloud, Fastmail, Nextcloud LF v2), CalDAV tasks for Tasks, Immich, gpodder, FreshRSS/Miniflux | M | C1 |
| **C3** | OAuth service + browser sheet + key store (sim, then device), then Microsoft and the Fediverse (SM 2a, 7c) | L | C1; SYNERGY phase 0 for the device |
| **C4** | `connector` kind in the backend: profile checks, review, privacy/terms fields; Developer Mode installs from the Marketplace | M | C1 |
| **C5** | Connector trust tier + db8 permission rule; open submissions to everyone | L | APP-STORE A5, device |
| **C6** | Push (UnifiedPush) and relay in the kit; per-account app visibility; account health | M | SM phase 5 |

C0 and C1 need no registration with anyone and no new server, as DAV
needed none in phase 1. They also make every later connector, ours or a
developer's, show up in one place.

When parts of this are built, update `docs/spec/feature-inventory.md` and
`docs/spec/GAPS.md`, and move the agreed parts into SYNERGY-MODERN.md and
APP-STORE.md.
