# Writing a Synergy connector

A **connector** is an account type: the user adds it in Accounts, and it
fills Contacts, Calendar, Messaging, notifications or a capability of its own
from a service, as webOS's Synergy transports did (Facebook, Google, Exchange).
This page is for developers who write one. It covers the kit
(`@phoenix/connector-kit`), the shared sync layer under it
(`@phoenix/synckit`), the `phoenix-connector` command, the conformance suite,
and how a connector runs in the simulator and on a device.

The reasoning behind all this, the catalog and the rules for listing a
connector are in [SYNERGY-CONNECTORS.md](SYNERGY-CONNECTORS.md) (sections 3
and 4); how webOS's Synergy worked is in [SYNERGY.md](SYNERGY.md).
An app (rather than an account type) that reads Synergy's data (contacts,
calendar, accounts) or composes a message or an email uses the Phoenix
service plugin instead: [APP-SDK.md](APP-SDK.md).

**Status (October 2026).** The kit, the command and the suite are built
(phase C1). The Marketplace's catalog takes connector packages, and its
Connections view installs them (phase C4; `phoenix-connector publish`,
section 9): third-party connectors **in Developer Mode only** until the
connector trust tier (SYNERGY-CONNECTORS.md 4.1, phase C5). Two connectors
are built on the kit: the **Fediverse** account (`apps/fediverse`, a
connector package Phoenix comes with: pre-installed, removable) and the
hello-world **News Feed** example
(`apps/shared/connector-kit/examples/feeds`). Since 10 October 2026 a
connector can be a place to share to (section 7): the share sheet lists
it once per signed-in account.

## 1. The pieces

| Piece | Where | What it is |
| --- | --- | --- |
| `@phoenix/synckit` | `apps/shared/synckit/src` | Plain CommonJS, no dependencies: Luna and db8 helpers, sync state records, scheduling, an HTTP client with host allow-list and `Retry-After` backoff, item records with a three-way merge, the contacts linker's rules, the vCard and iCalendar mappers. Extracted from the CardDAV and CalDAV transport (`apps/dav`), which runs on it |
| `@phoenix/connector-kit` | `apps/shared/connector-kit/src` (TypeScript, built to `lib/` CommonJS by `npm run build`) | `defineConnector`, the service it makes (`createConnectorService`), the sync engine, the device runner (`lib/device`), the conformance suite (`lib/conformance`), the command (`lib/tools`) |
| `phoenix-connector` | `apps/shared/connector-kit/bin` | `new`, `validate`, `pack`, `test` |
| OAuth service | `services/oauth` (`org.webosphoenix.service.oauth`) | Sign-in with OAuth 2.0 and PKCE in the system's browser sheet; tokens in the key store |
| Worked examples | `apps/dav` (the contract by hand, on synckit), `apps/fediverse` (on the kit), `examples/feeds` (hello world) | |

The same compiled files run in three places: a device's `run-js-service`,
the simulator's page (`runtime/phoenix-runtime.js` loads the service's
CommonJS files and gives them the simulated bus), and Node's tests.

## 2. Hello world: a news feed as an account

`phoenix-connector new` makes this layout (SYNERGY-CONNECTORS.md 3.1); the
News Feed example is the same with its code written:

```
org.example.feeds/                      hidden app ("phoenix": {"hidden": true})
  appinfo.json  index.html  icon.png
  accounts/signin.html                  the sign-in page (validator.customUI)
  public/accounts/org.example.feeds/    the account template, and its pictures
    org.example.feeds.json              (images/, 32 and 48 px with @2x and @3x)
  configuration/db/kinds/               org.example.feeds.entry, .state, .item
  configuration/db/permissions/         who may read the entries
  service/
    package.json                        "name": the Luna service, "main": service.js,
                                        "dependencies": {"@phoenix/connector-kit": "*"}
    connector.js                        the definition (below)
    service.js                          require(".../lib/device").runOnDevice(require("./connector"))
    sysbus/                             .service, .role.json, .api.json, .perm.json,
                                        .groups.json, .manifest.json
    test/fixture.js                     the conformance suite's fixture
```

The whole connector (`service/connector.js`, shortened):

```js
var kit = require("@phoenix/connector-kit");
var feed = require("./lib/feed");          // RSS 2.0 and Atom, no DOM needed

module.exports = kit.defineConnector({
    service: "org.example.service.feeds",
    templateIds: ["org.example.feeds"],
    kinds: { state: "org.example.feeds.state:1", item: "org.example.feeds.item:1" },

    // The template's validator: the sign-in page sends {config: {url}}.
    validate: function (ctx, p) {
        var url = new URL(p.config.url).href;
        ctx.http.allowHost(new URL(url).host);
        return fetchFeed(ctx, url, null).then(function (r) {
            return { username: url, credentials: { common: { url: url } },
                     config: { url: url, title: r.parsed.title } };
        });
    },

    capabilities: {
        "org.example.feeds.entries": {                     // the template's capabilityProviders[].id
            capability: "FEEDS",
            kind: "org.example.feeds.entry:1",
            fields: ["title", "link", "summary", "published", "updated", "feedTitle"],
            // Everything the feed lists now; the token keeps its ETag.
            pull: function (ctx, token) {
                return fetchFeed(ctx, ctx.config.url, token && JSON.parse(token)).then(function (r) {
                    if (r.notModified) return { changes: [], nextToken: token };
                    return { full: true, nextToken: JSON.stringify({ etag: r.etag }),
                             changes: r.parsed.entries.map(function (e) {
                                 return { remoteId: e.id, etag: e.updated + "|" + e.title,
                                          fields: { title: e.title, link: e.link, ... } };
                             }) };
                });
            }
        }
    },
    schedule: { every: "1h" }
});
```

That is all a read-only connector writes. The kit does the rest: the
accounts service's callbacks, the periodic activity, writing the entries
with `accountId` and `remoteId`, item records so an unchanged entry is not
written again, deleting what the feed no longer lists, the sync state
Accounts shows, backoff when the server asks for it, and removing every entry
when the capability is turned off or the account deleted.

### Sign-up link

Not everyone who finds your account type has an account yet. Say where to
get one in the definition:

```js
signUp: "https://example.com/join"
// or, for a federated service: a page to choose a server, and servers to suggest
signUp: { url: "https://joinmastodon.org/servers",
          servers: [{ name: "example.social", url: "https://example.social/auth/sign_up" }] }
```

Every address is `https://` (`defineConnector` and `validate` refuse
anything else, rule C16). `phoenix-connector pack` writes it into your
account template as `"signUp": {url?, servers?}` (as it writes the share
target into `appinfo.json`), and `validate` says when the template is
behind the definition. The user then sees **"Don't have an account? Sign
up"**:

- on the sign-in step in Accounts, under the fields: the accounts
  library's own user name and password page shows it for a template with a
  `signUp` (Phoenix's compat overlay, `lib/accounts/source/phoenix-signup.js`);
  a sign-in page of your own adds `{kind: "Accounts.SignUpLink", name:
  "signUp"}` and calls `this.$.signUp.setTemplate(params.template)` (the
  Fediverse's `accounts/FediverseWizard.js` does). Suggested servers show as
  "Or join a, b or c";
- on your account type's page in the Marketplace's Connections, beside Set
  up, from the catalog entry's `signUp` (an `https://` address;
  `server/marketplace/README.md`).

The link opens in the browser; nothing is sent to the service. The
Fediverse's is joinmastodon.org's list of servers; a feed reader needs no
account and has none.

The sign-in page (`accounts/signin.html`) is plain HTML: the Accounts app
loads it in a frame with `?enyoWindowParams={mode, template, account}`, it
calls the validator over the bus (`PalmServiceBridge`), and posts its answer
to the parent as `"enyoCrossAppResult=" + JSON` (Enyo's `CrossAppResult.js`):
`{returnValue: true, template, templateId, username, credentials, config}`,
or `{returnValue: false}` to cancel. Without a custom page, Accounts shows its
own user name and password page and calls the validator with them.

A feed reader posts nothing, so the example has no `share` (section 7) and
is in no share sheet.

FEEDS is a new capability: no generic kind is agreed for it yet
(OPEN-QUESTIONS.md Q3), so the entries go to the connector's own kind and
`validate` says so as a warning.

## 3. The definition

`defineConnector(definition)` checks the definition when the service loads
and returns it.

| Field | |
| --- | --- |
| `service` | The Luna service name, in your namespace (`org.example.service.foo`) |
| `templateIds` | The account templates this service implements |
| `kinds` | `{state, item}`: your own kinds for the account's state (one record) and the item records |
| `hosts` | Hosts the connector may reach besides the user's server (`"api.example.com"`, `"*.example.com"`); anything else is refused before it is sent (3.2 rule 8) |
| `validate(ctx, params)` | The template's validator: `{username, password, config, templateId, accountId?}` from the sign-in page; returns `{credentials, config?, username?}` or throws (an error with `errorCode` from the accounts library's list: `401_UNAUTHORIZED`, `HOST_NOT_FOUND`, ...) |
| `capabilities` | By capability provider id; see below |
| `schedule` | `{every: "1h"}`: the periodic sync, 15 minutes or more (3.2 rule 6) |
| `onCreate(ctx)`, `onDelete(ctx)` | After the account is created; before its data goes (revoke a token) |
| `methods` | More service methods, `(ctx, params) -> result`. With `params.accountId`, `ctx` is that account's |
| `push` | `{unifiedPush: true}`: recorded only, until phase C6 |
| `share` | What the service takes from the share sheet and `send(ctx, content)` to post it: section 7 |
| `signUp` | Where a person without an account gets one: `"https://..."`, or `{url?, servers?: [{name, url}]}` (below, "Sign-up link") |

**A capability that is a set of objects** (contacts, events, entries) has a
`kind` and a `pull`:

| | |
| --- | --- |
| `pull(ctx, token)` | What changed on the server since `token` (`null` the first time) -> `{changes: [{remoteId, etag?, fields}], deleted?: [remoteId], nextToken?, full?}`. `full: true`: a complete listing, so what it does not list is deleted |
| `fields` | The fields your mapping owns (the item record keeps a base copy of them) |
| `toDb(fields, ctx)`, `fromDb(object)` | Mapping between the server's fields and the db8 object, when they differ |
| `push(ctx, change)` | **Two-way**: `{op: "create" \| "update" \| "delete", remoteId, etag, fields, base}` -> `{remoteId, etag}` |
| `conflict` | `"remote"` (the default: the server wins, as SYNERGY.md 3.3) or `"local"` |
| `linkPersons` | CONTACTS: keep `com.palm.person:1` with the contacts linker's rules (default on) |

**Any other capability** (notifications, messages) has `sync(ctx)` instead,
and, if it wrote anything, `remove(ctx)`. A messaging capability can also
have `watch: {query, method}`: an activity with a db8 trigger calls that
method when the query matches (the outbox of pending messages, as mojomail
watched its outbox).

**A drive** (cloud storage as a place in Files, the pickers and Save to
Files) is the legacy `DOCUMENTS` capability with `files(ctx)` instead: it
returns the account's provider (`DriveProvider`, connector-kit
`src/files.ts`): `list(path)`, `stat(path)`, `download(entry, sink, opts)`
(`kit.downloadInRanges` does it with ranged GETs), `upload(path, source,
opts)` (source: `{size, name, mimeType, read(offset, length)}`;
`kit.forEachChunk` cuts it in `opts.chunkSize` pieces, reporting
`opts.onProgress(done, total)` and stopping when `opts.signal.aborted`),
`mkdir`, `move(from, to, {overwrite})`, `copy?`, `remove`,
`search?(query, {path, limit})` and `quota?()`. Paths are the drive's own
(`/Photos/lake.png`); entries are `{name, path, type: "file" |
"directory", size, mtime, mimeType?, etag?, id?}`.
The kit makes the service methods from it (`listFiles`, `statFile`,
`downloadFile`, `uploadFile`, `makeFolder`, `moveFile`, `copyFile`,
`removeFile`, `searchFiles`, `driveQuota`, `transfers`, `cancelTransfer`:
reserved names), runs transfers as ongoing activities with progress and
cancel, and turns failures into the numbers apps see (`FILE_ERRORS`:
OFFLINE 10 for no connection, AUTH 11 for a 401, QUOTA 12, CANCELED 13,
NOT_AVAILABLE 14, UNSUPPORTED 15, RATE_LIMITED 16 with `retryAt`;
`kit.fileError(code, text)`, `kit.httpError(status, what)`). A drive has
no periodic sync (its "sync" checks the drive answers); nothing is copied
ahead. `chunkSize` (64 KB or more, 8 MB by default) on the capability.
Files reaches it through the kit's drive router (`createDriveRouter`,
`/media/drives/<accountId>/...`; [SHARE-AND-FILES.md](SHARE-AND-FILES.md)
"Drives"). `apps/connectors/drives` is the worked example: WebDAV, S3,
Dropbox, Microsoft Graph, Google Drive and Box behind that one interface.

**What every function gets (`ctx`):**

| | |
| --- | --- |
| `ctx.http` | `request(req)`, `json(req)` (`json: body`, `withResponse`), `allowHost(host)`; requests outside the allowed hosts are refused, a short `Retry-After` is waited out, a long one stops the sync until then (section 5) |
| `ctx.db`, `ctx.tempdb`, `ctx.luna` | db8 (`find`, `get`, `put`, `merge`, `del`, `delQuery`) and any Luna call your role allows |
| `ctx.oauth` | `token(keyId)`, `forget(keyId)`: tokens the OAuth service keeps for you (section 6) |
| `ctx.cachePhoto(key, url)` | A remote picture as a file of the device (a contact's photo must be a file: the Contacts framework checks with `palmGetResource`) |
| `ctx.readFile(path)` | A file the user shares: `{bytes, mimeType}` |
| `ctx.systemConfig(name)` | `/etc/palm/<name>` of the image, parsed (an OAuth client id kept out of the source tree: [DEVELOPER-APPS.md](DEVELOPER-APPS.md)); `null` when there is none |
| `ctx.log(text)`, `ctx.now()` | Never log tokens, message text or addresses (3.2 rule 9) |
| Account functions also: `ctx.accountId`, `ctx.account`, `ctx.credentials` (the account's `common` credentials), `ctx.config` (the validator's config, kept since `onCreate`), `ctx.state` (yours, saved after the call when it changed), `ctx.notify({title, body, appId, params})` (a notification: `com.webos.notification` `createToast`), `ctx.putMessage(message)` (into Messaging: `org.webosports.service.messaging` `putMessage`) | |

## 4. The sync engine

For a capability with a kind, each sync:

1. **pull**: new objects are put in the kind, with `accountId` and
   `remoteId`, and an item record (`kinds.item`) keeps the remote id, the
   etag, the object's id and `_rev` as written, and the **base copy** of its
   fields. A changed object (another etag, or other fields without one)
   replaces the device's copy. What the server deleted (or, on a full pull,
   no longer lists) is deleted.
2. **push** (two-way): objects new on the device, edited since the last sync
   (their `_rev` is not the item's), or deleted, are sent one by one.
3. The next token is kept in the account's state.

**Nothing is written when nothing changed**, which the conformance suite
checks. **A field changed on both sides** is a conflict: the three-way merge
(`synckit.merge3`) keeps each side's own changes, the winner's value for a
field both changed (the server's by default), and records the loser on the
item record (`conflicts: [{field, lost, at}]`), so no edit is lost silently.
An object deleted on the device but changed on the server comes back (the
server wins); one deleted on the server and changed on the device goes.

Sync state records (`com.palm.account.syncstate:1` in tempdb) are kept per
capability: `INITIAL_SYNC`, `INCREMENTAL_SYNC`, `IDLE`, `ERROR` with the
error's code. `401_UNAUTHORIZED` puts the warning on the account in Accounts.
One sync runs at a time per account.

## 5. Being a good client

`ctx.http` enforces 3.2 rule 8: only the template's `hosts` and the user's
server (the validator's `config.server`, `serverUrl` or `url`, or what
`allowHost` adds). On **429** or **503** it reads `Retry-After` (seconds or a
date): up to 30 s it waits and tries once more; longer, the sync stops with
`503_SERVICE_UNAVAILABLE` and `retryAt`, which the kit keeps with the
account, and **no request is sent before then** (a sync asked meanwhile
answers `{skipped: "backoff"}`). Network errors and 502, 504 are retried
twice with backoff; every request has a 60 s timeout.

## 6. Signing in with OAuth

A connector whose service uses OAuth 2.0 asks
`org.webosphoenix.service.oauth` (built for the Fediverse, phase C2; the
rest of it is C3):

| Method | |
| --- | --- |
| `authorize {authorizationEndpoint, tokenEndpoint, clientId, clientSecret?, scope, redirectUri?, revocationEndpoint?}` | Shows the provider's page in the **system's browser sheet** over the card (its address visible; your code cannot read the page), with PKCE (S256) and `state`; exchanges the code; keeps the tokens under a new key -> `{keyId, scope}`; `CANCELED`, `ACCESS_DENIED` |
| `token {keyId}` | `{accessToken, expiresAt}`, refreshed when it can be. Only the service that owns the key may ask |
| `forget {keyId}` | Revokes (RFC 7009) and deletes |
| `client {name, value?}` | A client registration you keep here (a per-server client id and secret) |
| `redirectUri {}` | The address this device's sign-ins come back to (for registering a client) |

Keep only the key in the account's credentials (`{common: {oauthKey}}`),
never the token. The Fediverse connector's `signIn` method
(`apps/fediverse/service/connector.js`) is the worked example: WebFinger and
NodeInfo find the server, the app registers itself with it once, then
`authorize`. On a device the sheet and the key store are placeholders until
C3 (`services/oauth/service.js`).

## 7. Sharing to your service

A connector whose service takes posts (a social network, a photo site, a
link saver) can be a place to share to: the system's **share sheet**
([SHARE-AND-FILES.md](SHARE-AND-FILES.md) SF4) then lists it in every app
that shares, **once for each account of it the user has signed in**, and
not at all when none is. You declare what the service takes and write one
function that posts; the kit does the rest. A connector that posts nothing
(a feed reader, an address book) leaves `share` out: the News Feed example
does.

### The declaration

`share` in the definition:

```js
share: {
    label: "Fediverse",                 // the sheet's label (default: the app's title)
    accountLabel: "@{username}",        // how an account is named (default "{username}")
    accepts: {
        text: { maxLength: 5000 },      // characters
        link: true,                     // a link of its own; without it, a link goes in the text
        image: { max: 4, maxBytes: 16 * 1024 * 1024,
                 mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
                 altText: { maxLength: 1500 } },  // each picture may have a description
        // video: {max, maxBytes, mimeTypes?}, file: {max, maxBytes, mimeTypes?}
    },
    audience: {                         // who may see a post, if the service has a choice
        label: "Who can see it",
        options: [{ value: "public", label: "Public", hint: "Everyone" },
                  { value: "private", label: "Followers" }],
        default: "public"
    },
    send: function (ctx, content) { ... }   // below
}
```

| Field | |
| --- | --- |
| `accepts` | One or more of `text`, `link`, `image`, `video`, `file`: `true`, or limits. `max` (how many in one post), `maxBytes` (one file's size), `maxLength` (text), `mimeTypes` (pictures, videos, files: default `image/*`, `video/*`, any), `altText` (`true` or `{maxLength}`) |
| `audience` | `options` (`value`, `label`, `hint?`), `default` (else the first), `label` |
| `label`, `accountLabel` | What the sheet shows: `"Fediverse"` and `"@me@example.social"`. `accountLabel` takes any field of the account: `{username}`, `{alias}` |
| `templateId` | When the connector has several templates: the one whose accounts are listed (default the first) |

`defineConnector` checks it when the service loads. The share sheet only
sees `appinfo.json`, so **`phoenix-connector pack` writes the declaration
there**, as the app's share target (`"phoenix": {"shareTargets": [...]}`,
with `types` from `accepts` and the declaration under `connector`), before
it packs; `phoenix-connector new --share` starts with one. Do not write a
connector's share target by hand: `validate` refuses one (C14), and says
when `appinfo.json` is behind the definition (run `pack` again).

### The handler

`send(ctx, content)` posts, **as the account the user chose**: `ctx` is
that account's (its `credentials`, `config`, `state`, `http`, `oauth`), as
for a sync. It answers `{url?, id?}` (the post's address, which the page
offers to open) or throws an error with an `errorCode`.

| `content` | |
| --- | --- |
| `text` | What the user wrote (with the link, when `accepts` has no `link`) |
| `url` | The link, when `accepts` has `link` |
| `title` | The shared thing's title (a page's), for services that keep one |
| `files` | `[{path, mimeType, kind, description, read()}]`: `kind` is `image`, `video` or `file`; `description` the alt text ("" when the kind takes none); `read()` gives `{bytes, mimeType}` and refuses a file above `maxBytes` (`SHARE_TOO_LARGE`) |
| `audience` | One of the options' values |
| `idempotencyKey` | The same for every try of one share: send it to the server (an `Idempotency-Key` header) so a retry never posts twice |

The kit checks the content against `accepts` before `send` runs, so `send`
never sees what the declaration does not take: too long a text
(`SHARE_TOO_LONG`), too many pictures (`SHARE_TOO_MANY`), a kind it does
not take (`SHARE_NOT_ACCEPTED`), nothing at all (`SHARE_NOTHING`), an
audience not offered (`SHARE_BAD_AUDIENCE`), an account that is not one
of yours (`ACCOUNT_NOT_FOUND`).

The kit makes the service's `share` method from it:

```
luna://<service>/share {accountId, content: {title?, text?, url?, files?: [{path, mimeType?, description?}]},
                        audience?, idempotencyKey?}
    -> {returnValue: true, posted: {url?, id?}, url?}
    or {returnValue: false, errorCode, errorText, retryable, retryAt?}
```

List it in your service's `.api.json`, in a group your app's
`requiredPermissions` names (the Fediverse's `fediverse.account`), so your
compose page may call it (C15).

### The compose page

Choosing your account in the sheet launches **your app's main page** with

```
{share: {title, text, url, files: [{path, mimeType}]},
 accountId,      the account chosen
 target}         the declaration, as appinfo.json has it
```

`phoenix-connector new --share` makes it the **kit's compose page**
(`apps/shared/connector-kit/share-page`: `index.html`, `share/compose.js`,
`share/compose.css`; plain HTML and script, no build). It shows the account
("Post as @me@example.social", a choice when there are several), the text
with what is left of `maxLength`, the link, each picture with a field for
its description, the audience as buttons, and says what it leaves out (a
fifth picture, a video the service does not take). Post calls `share`;
after an error it keeps the text and offers **Try Again** with the same
key. Launched without a share it offers to add an account.

**To replace it**, write your own main page: read the launch parameters
(`PalmSystem.launchParams`), list your accounts
(`com.palm.service.accounts/listAccounts {templateId}`, pre-selecting
`accountId`), and call your `share` method with one `idempotencyKey` per
share. The Fediverse's page (`apps/fediverse/index.html`, `compose.js`)
does, with Mastodon's character count and its four visibilities.

### What the user sees

- **No account**: the sheet has no entry for the service.
- **One account**: one entry, the service's icon (your app's) and two
  lines, the label and the account: "Fediverse", "@me@example.social".
- **Several**: an entry each, so the user picks the account in the sheet.
- Accounts added or removed in Accounts show the next time the sheet
  opens; an account being deleted is not listed.
- Your entry is offered only for what `accepts` takes: a video shared to
  a connector that takes pictures does not list it.

### Errors and retries

`share` answers `retryable: true` when trying again later may work: the
server is busy or unreachable (`503_SERVICE_UNAVAILABLE`,
`500_SERVER_ERROR`, `CONNECTION_FAILED`, `CONNECTION_TIMEOUT`,
`HOST_NOT_FOUND`). A 429 or 503 with `Retry-After` is the account's backoff
(section 5): `retryAt` says until when, and no request is sent before then,
for posts and syncs alike. `401_UNAUTHORIZED` is not retryable: the user
signs in again in Accounts (the page says so). The kit does not retry a
post by itself; the user does, with Try Again, and the `idempotencyKey`
keeps that from posting twice.

### Privacy: what the connector receives

Only what the user posts, after editing it on the compose page: the text,
the link, the files the share names (`ctx.readFile` refuses any other path
during `send`, `PERMISSION_DENIED`), their descriptions when the kind takes
alt text, and the audience. Not the app that shared, the other targets,
the user's other accounts, nor anything when the user cancels. Nothing is
sent until the user presses Post. Say in your listing's privacy box where
posts go (`privacy.dataGoesTo`, SYNERGY-CONNECTORS.md 2.1).

### Testing it

With `share` in the definition the conformance suite adds three checks:

| Check | |
| --- | --- |
| share | the fixture's share is posted by `send`, as the account chosen, with that account's credentials; an account that is not there is refused |
| share limits | what `accepts` does not take (too long, too many, another kind, nothing, an audience not offered) never reaches `send` or the server |
| share errors | a 401 while posting gives `401_UNAUTHORIZED`; a 429 gives `503_SERVICE_UNAVAILABLE`, retryable, with `retryAt`, and nothing reaches the server before then |

The fixture gives what to post and the files it names:

```js
share: { content: { text: "Hello", url: "https://example.org/",
                    files: [{ path: "/media/internal/DCIM/100PHNX/a.jpg", mimeType: "image/jpeg", description: "A lake" }] },
         audience: "unlisted" },
files: { "/media/internal/DCIM/100PHNX/a.jpg": { bytes: new Uint8Array([...]), mimeType: "image/jpeg" } }
```

The kit's own tests (`src/kit.test.ts`, "a connector that shares"; the
compose page in `src/share-page.test.ts`) and the Fediverse's
(`connector.test.ts`) run them; `tools/test-fediverse.cjs` shares a page to
a signed-in account through the real sheet, and `tools/test-sharing.cjs`
checks the sheet's entries for one, two and no accounts.

## 8. Testing

**The conformance suite** (`lib/conformance`) runs your connector against a
fake server of yours, with db8, the accounts service and the activity
manager in memory. A connector must pass it to be listed:

| Check | |
| --- | --- |
| validate | the validator signs in and gives credentials |
| lifecycle | create, enable, sync, disable, delete leaves no data (no object of the account, no person of its contacts, no state, no sync state); the periodic activity is 15 minutes or more, needs the internet, and is cancelled |
| idempotent | a second sync with nothing changed writes nothing to db8 |
| unauthorized | a 401 gives `ERROR` / `401_UNAUTHORIZED` |
| rate limit | a 429 with `Retry-After` stops the sync, and nothing reaches the server before then |
| conflict | (two-way) a field edited on both sides keeps both edits or records the loser |
| share, share limits, share errors | (with `share`) section 7, "Testing it" |
| drive lifecycle, drive files, drive unauthorized, drive rate limit | (a drive, in place of lifecycle to rate limit) no periodic sync and the sync checks the drive; upload, list, download, refuse to overwrite, rename, remove; a 401 is AUTH (11) for the files and `401_UNAUTHORIZED` for the account; a 429 is RATE_LIMITED (16) and nothing is sent before its `retryAt` |

The fixture (`service/test/fixture.js`) gives the template, what the sign-in
page sends (`validateParams`), `server()` (a fake server: `request`,
`requests()`, `unauthorized(on)`, `throttle(seconds)`, and for two-way
`editRemote(remoteId, field, value)`), `handlers` for other Luna calls (the
OAuth service's `token`), `minObjects`, for two-way `conflict: {providerId,
field, localValue, remoteValue}`, and with `share` what to post (`share`,
`files`; section 7). Run it:

```sh
phoenix-connector test path/to/org.example.feeds        # 5 checks, 6 two-way, 3 more with share
```

or from a test runner: `conformanceChecks(definition, fixture)` gives
`[{name, run}]` (the kit's own tests, `src/kit.test.ts`, and the Fediverse's,
`apps/fediverse/service/connector.test.ts`, do so). The Fediverse's fake
Mastodon server (`apps/fediverse/service/test/fake-mastodon.cjs`) is a
fuller example of a fake server: it follows the API's documentation page by
page.

## 9. Validating and packing

```sh
phoenix-connector new org.example.foo --capability CONTACTS [--share]
phoenix-connector validate org.example.foo           # or a .ipk
phoenix-connector pack org.example.foo --out dist    # dist/org.example.foo_0.1.0_all.ipk
```

`validate` runs **the Marketplace's own checks**: the server runs the same
rules (`server/marketplace/src/Connector.php`), and both are tested on the
same cases (`server/marketplace/tests/connector-cases.json`). Each problem
starts with its rule:

| Rule | |
| --- | --- |
| C1 | `appinfo.json`: valid, a reverse-DNS id, type `web`, a version (a warning if the app is not hidden) |
| C2 | at least one template, `public/accounts/<templateId>/<templateId>.json` |
| C3 | the template follows the accounts service's schema (`app-services/com.palm.service.accounts/schemas/template.json`) |
| C4 | `templateId` is its folder's name |
| C5 | the template, the capability provider ids, the service and your own kinds are in your namespace (the app id's first two labels, or `--namespace`) |
| C6 | the template's icons are in the package (a warning without `@2x`) |
| C7 | the validator is your service; a sign-in page is your app's |
| C8 | upper-case capability names; `implementation` and every callback on your service; `dbkinds` your kinds |
| C9 | one service in `service/`: `package.json` with its name, `sysbus/` `.service`, `.role.json`, `.api.json`; the role calls only `com.palm.db`, `com.palm.tempdb`, `com.palm.activitymanager`, `com.palm.service.accounts`, `org.webosphoenix.service.oauth`, `.keystore`, `.push`, `com.webos.notification`, `org.webosports.service.messaging` |
| C10 | your kinds are owned by your service; a capability's kinds extend its generic kind (`com.palm.contact:1`, `com.palm.immessage:1`, ...: 3.2 rule 4) |
| C11 | db8 permissions only on your own kinds |
| C12 | no native code (ELF, Mach-O, PE; `.node`, `.so`, `.dylib`, `.dll`, `.exe`) |
| C13 | (`.ipk`) files only under the app, no links, no maintainer scripts, 64 MB at most, the control file agreeing with `appinfo.json`, `Architecture: all` |
| C14 | share targets: each written from the definition's `share` (none by hand), its template and service the package's, `accepts` and `audience` well formed, `types` what `accepts` takes; on a folder, `validate` also compares it with the definition |
| C15 | sharing reaches the service: `<service>/share` in an `.api.json` group the app's `requiredPermissions` names; the app's main page (the compose page) in the package |
| C16 | the template's `signUp`: `https://` addresses only (`url`, `servers[].url`), each server with a name |

`pack` writes `appinfo.json`'s share target from the definition (section
7), validates, then writes the `.ipk` the Marketplace takes: every
file under `usr/palm/applications/<app id>/`, the kit and the sync layer in
`service/node_modules/@phoenix/` (a device's `run-js-service` finds them
there), tests and sources of a build left out.

### Publishing

```sh
phoenix-connector publish org.example.foo --local                       # the catalog on this computer
phoenix-connector publish org.example.foo --catalog https://... --token T  # any other catalog
```

`publish` packs a folder (or takes an `.ipk`), validates it, and uploads it
through the catalog's developer API (`POST /api/apps/packages`,
`server/marketplace`). The catalog runs the same rules again and lists the
package as kind `connector`; its account types go into the index's
`accounts`, which the Marketplace's **Connections** view lists. What
Connections says of each one that the template does not is yours, in
**`catalog.json`** at the app's root (`phoenix-connector new` writes one to
fill in):

```json
{"accountTypes": [{
    "templateId": "org.example.foo",
    "summary": "What it brings to this device, in a sentence.",
    "auth": {"type": "password", "registration": "none"},
    "server": "user",
    "privacy": {"dataGoesTo": "the server you enter", "e2ee": false, "phoenixServers": "none"},
    "protocols": ["foo-rest"], "push": "poll", "status": "beta",
    "help": "https://...", "signUp": "https://..."
}]}
```

The fields are those of the catalog's own account types
(`server/marketplace/catalog/accounts.json`, its README "Account types");
the title, the provider and the capabilities default to the template's
`loc_name`, your app's `vendor` and its capability providers (`readOnlyData`:
read-only), the status to `experimental`, `push` to `poll`; the icon is the
template's (`loc_48x48`, its `@2x`). Only Phoenix features a type.

`--local` is the catalog on this computer (`server/marketplace/bin/serve.sh`,
which the simulator starts: `http://127.0.0.1:8088/`, or `PHOENIX_CATALOG`).
It is a **development catalog** (`MARKETPLACE_DEV=1`): an upload is approved
and published at once, as its local developer, whose token is
`server/marketplace/data/developer.token` (a local catalog without one gets a
developer account registered, its token kept in
`~/.config/phoenix-connector/tokens.json`). On any other catalog a person
reviews it first; `--token` (or `PHOENIX_CATALOG_TOKEN`) is your developer
account's. The same version twice is refused: raise `version` in
`appinfo.json`.

## 10. Running it

### Testing in the simulator

The whole store runs on this computer: the simulator starts the
Marketplace's catalog with every run where PHP is (`./phoenix run`;
**Services > Start Catalog with the Simulator** turns that off,
`--no-marketplace` for one run), and its Marketplace trusts that catalog at
once (the key comes from the catalog's own data folder, not the network).

1. **Start**: `./phoenix run tablet`. The first start sets the catalog up
   and publishes the News Feed example, so **Marketplace > Connections**
   lists a third-party connector (under Social & Feeds) beside the
   Fediverse (Installed: it comes with Phoenix).
2. **Publish yours**: `phoenix-connector publish path/to/yours --local`. It
   is in Connections at once (the Marketplace reads the catalog again each
   time it opens).
3. **Install**: open its page in Connections and tap **Install**. Without
   Developer Mode the page says why and links to Settings > Developer Mode
   (reveal it first with the Konami code in Just Type, as on webOS: up up
   down down left right left right b a start); with it on, Install installs
   the package through the Marketplace (the catalog's signed SHA-256
   checked), its service starts in the page, its kinds are put, and its
   template is in Accounts.
4. **Add the account**: **Set up** opens Accounts at your template: your
   sign-in page (`customUI`) or the template's user name and password, then
   your validator, then Create Account.
5. **Sync**: Contacts' and Calendar's **Sync now**, or the account's own
   sync; periodic syncs do not run in the simulator (no background
   process). Your data is in db8 (`luna://com.palm.db/find` from a page's
   console: `PalmServiceBridge`).
6. **Remove**: **Remove** on its page asks first, naming the accounts that
   go with it, then deletes them (each capability's `onDelete`) and removes
   the package. Publish a new version (raise `version`) and install it again.

`server/marketplace/data/` holds the catalog (delete it to start over: the
next start sets it up again); `tools/test-marketplace.cjs` runs this whole
path in Chromium, `node tools/test-fediverse.cjs` a connector's sync.

**Without the Marketplace.** A built-in connector, and a connector package
Phoenix comes with (`/etc/palm/marketplace/preinstalled.json`), is listed in
the runtime's "Synergy connectors on the kit" block. Any other: pack it and
install the `.ipk` with Developer Mode on (Settings > Developer Mode), through
`com.webos.appInstallService/install` with `developerMode: true` (as the
Marketplace installs in Developer Mode); without it the install is refused,
as on a device. Its service then runs in the page, its
template is in Accounts, and its kinds are put from its
`configuration/db/kinds`. The simulator plays the device's parts: HTTP
through the host's proxy (bytes too), avatars kept in the Files store under
`/var/file-cache/<service>/`, Messaging's outgoing messages handed to the
method your `watch` names. Periodic syncs do not run (no background process);
Contacts' and Calendar's "Sync now" do.

```sh
node tools/test-fediverse.cjs        # the Fediverse and the News Feed example, end to end
```

**On a device.** `service.js` runs the kit's `runOnDevice(definition)` under
`run-js-service`. Built-in connectors get the kit in their `node_modules` from
`tools/install-rootfs.py`; a package carries it (`pack`).

## 11. The worked examples

**`apps/dav`** is the contract written by hand on synckit: its
`davservice.js` makes the same callbacks the kit makes (with synckit's
`createLuna`, `createScheduler`, `createSerializer`, `fail`), and its
`lib/sync.js` is a two-way engine for WebDAV's collections, sync tokens and
etags (synckit's `setSyncState`, `linker`, `vcard`, `ical`). Read it for
the details the kit hides: the activity's callback, the sync state
records, `onEnabled(false)` removing one capability's data,
`readCredentials`. `phoenix-connector validate apps/dav --namespace
org.webosphoenix --namespace com.webosphoenix` passes but for the webcal
template's icons, which are the system's.

**`apps/fediverse`** is a connector on the kit with everything a social
account has: a sign-in by handle with OAuth, a read-only CONTACTS capability
(`pull` of the people you follow), a MESSAGING capability with `sync`,
`remove` and an outbox `watch`, a SOCIAL capability that only notifies,
extra methods (`signIn`, `outbox`), and sharing: its `share` declaration
(text, a link, four pictures with alt text, Mastodon's visibilities) with
its own compose page in place of the kit's.

## 12. Not yet

- The trust tier and the db8 permission rule for generic kinds (C5); until
  then third-party connectors install in Developer Mode only. Review of a
  connector's first release on a public catalog, and the privacy and terms
  fields for reviewers (C4's admin side).
- Push (UnifiedPush) registration (C6); connectors poll meanwhile.
- The OAuth sheet and the key store on a device (C3; placeholders).
- Generic kinds for FEEDS, SOCIAL, PHOTO, MEDIA, PODCASTS and BOOKMARKS
  (OPEN-QUESTIONS.md Q3).
- JSContact and JSCalendar mappers (SYNERGY-CONNECTORS.md 3.3 lists them;
  the vCard and iCalendar ones are in synckit).
