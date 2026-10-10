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

**Status (October 2026).** The kit, the command and the suite are built
(phase C1). Third-party connectors install **in Developer Mode only** until
the connector trust tier (SYNERGY-CONNECTORS.md 4.1, phase C5), and the
Marketplace does not list connector packages yet (phase C4); its checks are
already the ones `phoenix-connector validate` runs. Two connectors are built
on the kit: the **Fediverse** account (`apps/fediverse`, built in) and the
hello-world **News Feed** example
(`apps/shared/connector-kit/examples/feeds`).

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

The sign-in page (`accounts/signin.html`) is plain HTML: the Accounts app
loads it in a frame with `?enyoWindowParams={mode, template, account}`, it
calls the validator over the bus (`PalmServiceBridge`), and posts its answer
to the parent as `"enyoCrossAppResult=" + JSON` (Enyo's `CrossAppResult.js`):
`{returnValue: true, template, templateId, username, credentials, config}`,
or `{returnValue: false}` to cancel. Without a custom page, Accounts shows its
own user name and password page and calls the validator with them.

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

**What every function gets (`ctx`):**

| | |
| --- | --- |
| `ctx.http` | `request(req)`, `json(req)` (`json: body`, `withResponse`), `allowHost(host)`; requests outside the allowed hosts are refused, a short `Retry-After` is waited out, a long one stops the sync until then (section 5) |
| `ctx.db`, `ctx.tempdb`, `ctx.luna` | db8 (`find`, `get`, `put`, `merge`, `del`, `delQuery`) and any Luna call your role allows |
| `ctx.oauth` | `token(keyId)`, `forget(keyId)`: tokens the OAuth service keeps for you (section 6) |
| `ctx.cachePhoto(key, url)` | A remote picture as a file of the device (a contact's photo must be a file: the Contacts framework checks with `palmGetResource`) |
| `ctx.readFile(path)` | A file the user shares: `{bytes, mimeType}` |
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

## 7. Testing

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

The fixture (`service/test/fixture.js`) gives the template, what the sign-in
page sends (`validateParams`), `server()` (a fake server: `request`,
`requests()`, `unauthorized(on)`, `throttle(seconds)`, and for two-way
`editRemote(remoteId, field, value)`), `handlers` for other Luna calls (the
OAuth service's `token`), `minObjects`, and for two-way `conflict: {providerId,
field, localValue, remoteValue}`. Run it:

```sh
phoenix-connector test path/to/org.example.feeds        # all 5 or 6 checks
```

or from a test runner: `conformanceChecks(definition, fixture)` gives
`[{name, run}]` (the kit's own tests, `src/kit.test.ts`, and the Fediverse's,
`apps/fediverse/service/connector.test.ts`, do so). The Fediverse's fake
Mastodon server (`apps/fediverse/service/test/fake-mastodon.cjs`) is a
fuller example of a fake server: it follows the API's documentation page by
page.

## 8. Validating and packing

```sh
phoenix-connector new org.example.foo --capability CONTACTS
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

`pack` validates first, then writes the `.ipk` the Marketplace takes: every
file under `usr/palm/applications/<app id>/`, the kit and the sync layer in
`service/node_modules/@phoenix/` (a device's `run-js-service` finds them
there), tests and sources of a build left out.

## 9. Running it

**In the simulator.** A built-in connector is listed in the runtime's
"Synergy connectors on the kit" block. Any other: pack it and install the
`.ipk` with Developer Mode on (Settings > Developer Mode), through
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

## 10. The worked examples

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
extra methods (`signIn`, `post`, `outbox`) and a share target page.

## 11. Not yet

- Connector packages in the Marketplace (C4), the trust tier and the db8
  permission rule for generic kinds (C5).
- Push (UnifiedPush) registration (C6); connectors poll meanwhile.
- The OAuth sheet and the key store on a device (C3; placeholders).
- Generic kinds for FEEDS, SOCIAL, PHOTO, MEDIA, PODCASTS and BOOKMARKS
  (OPEN-QUESTIONS.md Q3).
- JSContact and JSCalendar mappers (SYNERGY-CONNECTORS.md 3.3 lists them;
  the vCard and iCalendar ones are in synckit).
