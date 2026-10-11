# The platform's clients on the device

What a Phoenix device (and the simulator) asks of the Phoenix platform
([PLATFORM.md](PLATFORM.md)), how it checks what it gets, and what it does
when the platform is away or wrong. Written 11 October 2026 when the device
side was made ready for the Laravel platform, so that pointing a device at
the real servers is a change of one file.

The contract both sides follow is in [platform-api/](platform-api/):
[openapi.yaml](platform-api/openapi.yaml) (every endpoint, both hosts) with
JSON Schemas for the feeds ([feeds.schema.json](platform-api/feeds.schema.json)),
the API's bodies ([api.schema.json](platform-api/api.schema.json)) and the
configuration ([servers.schema.json](platform-api/servers.schema.json)).
[PLATFORM-BUILD-PROMPT.md](PLATFORM-BUILD-PROMPT.md) tells the platform's
builder to build to them; [the conformance suite](#conformance) checks a
server against them by running the device's own code.

## Contents

1. [The configuration](#the-configuration)
2. [Touchpoints](#touchpoints)
3. [Signatures and keys](#signatures-and-keys)
4. [The app catalog](#the-app-catalog)
5. [System updates](#system-updates)
6. [The account and cloud services](#the-account-and-cloud-services)
7. [Failures, offline, backoff](#failures-offline-backoff)
8. [Mismatches fixed](#mismatches-fixed)
9. [What the platform must implement](#what-the-platform-must-implement)
10. [Conformance](#conformance)
11. [Still to do](#still-to-do)

---

## The configuration

**One file: `/etc/palm/phoenix/servers.json`.** Every service that talks to
the platform reads its addresses and trust anchors from it, through
`@phoenix/platform` (`apps/shared/platform/src/servers.js`, `load()` in
`index.js`); no code names a production host. Shape
([servers.schema.json](platform-api/servers.schema.json)):

```json
{
  "format": 1, "name": "...",
  "feeds": "https://feeds.<domain>/",
  "api": "https://api.<domain>/",
  "catalog":     {"url": "catalog/v1/", "key": null, "root": "<base64 Ed25519>"},
  "updates":     {"url": "updates/", "channel": "stable", "channels": ["stable", "beta", "dev"], "key": null, "root": "<...>"},
  "revocations": {"url": "revocations/v1/revoked.json"},
  "drivers":     {"url": "drivers/v1/", "key": "<pinned>", "reportUrl": "drivers/v1/report"},
  "account":     {"issuer": "https://api.<domain>", "clientId": "phoenix-device", "scope": "...", "key": "<entitlements key>"},
  "push":        {"server": "https://push.<domain>/"},
  "assistant":   {"url": "v1/assistant/"},
  "connectivity": {"probe": "https://connect.<domain>/generate_204"}
}
```

Relative `url`s are below `feeds` (catalog, updates, revocations, drivers)
or `api` (the rest). `api: null` (or no `account.issuer`) means no account,
cloud backup, push relay or assistant service: each says "not set up". A
feed with neither `key` nor `root` pinned is a development feed: the
catalog's key is then checked by the user (fingerprint), an update feed is
taken unsigned (RAUC still checks every bundle). Plain `http` is refused
except for `127.0.0.1`/`localhost` and in Developer Mode's override.

| Where | servers.json | Who writes it |
| --- | --- | --- |
| A device image | `/etc/palm/phoenix/servers.json` | `meta-phoenix` `phoenix-apps_git.bb` runs `tools/servers-json.py` with `PHOENIX_FEEDS_URL`, `PHOENIX_API_URL`, `PHOENIX_ACCOUNT_ISSUER`, `PHOENIX_PUSH_URL`, `PHOENIX_PROBE_URL`, `PHOENIX_UPDATE_CHANNEL(S)`, `PHOENIX_CATALOG_KEY`/`_ROOT_KEY`, `PHOENIX_UPDATES_KEY`/`_ROOT_KEY`, `PHOENIX_DRIVERS_KEY`, `PHOENIX_API_KEY`. The production hosts are named once, as the recipe's defaults (Q1). The script refuses plain HTTP and malformed keys; `--check FILE` reads one as a device does |
| The simulator, `tools/install-rootfs.py` without the recipe | `services/account/etc/palm/phoenix/servers.json` (rootfs.json mounts it at `/etc/palm/phoenix/`) | This repository: this computer's servers (`server/marketplace` on 127.0.0.1:8088 for the catalog and the update feed, the sample driver catalog), no account server |
| Developer Mode (testing a staging server) | `/var/lib/phoenix/servers.override.json` on a device, the store key `platform:servers` in the simulator | Settings > Developer Mode > Platform Servers ("Use the servers at" a platform's own `<api>/v1/servers.json`, "Use the Device's Own Servers"), i.e. `org.webosphoenix.service.account/setServers`. Laid over the image's file section by section, only while Developer Mode is on; changing it signs the account out |

The older per-service files keep only what is not the platform's:
`/etc/palm/marketplace/sources.json` (the third-party catalogs; the Phoenix
entry's `url` is `null`: servers.json gives it), `/etc/palm/hardware/catalog.json`
(revoked driver keys, any other driver catalogs). `/etc/palm/updates.json`
is gone.

## Touchpoints

Every request a device makes to the platform. Auth: `none`, `bearer`
(the account's access token, refreshed when within a minute of expiry, one
retry after a 401), `basic` (WebDAV app password). Paths are below
servers.json's `feeds` (F) or `api` (A).

| # | What | Endpoint | Request / reply | Auth | Verification | Caching, offline | Errors, backoff | Device code |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Catalog key | F `catalog/v1/key.json` | `keyFile` | none | Pinned root: delegations (scope `catalog`, not expired, not revoked) signed by the root; pinned key: not read; nothing pinned: fingerprint shown to the user (TOFU) | Read at each refresh when a root is pinned | `NO_DELEGATION`, `BAD_INDEX` | `packagesservice.js` `catalogKeys`, `keyInfo` |
| 2 | Catalog index | F `catalog/v1/index.json` + `.sig` | `catalogIndex` (apps, web apps, connectors, account types, `revoked`, releases' `rollout`) | none | Detached Ed25519 over the bytes by a trusted key; `version` 1; `expires` future; `build` not lower than the last | Kept in the service's state; browsing, search, account types and app pages work offline from it | `BAD_SIGNATURE`, `EXPIRED`, `ROLLBACK`, `BAD_INDEX`, `CONNECTION_FAILED`; daily activity `org.webosphoenix.marketplace.updates` | `lib/catalog.js` `verifyIndex`, `packagesservice.js` `refreshOne` |
| 3 | Packages (apps, connectors) | `release.url` (F `catalog/v1/packages/...`) | `.ipk` | none | `size` and `sha256` from the signed index; then the package is read (no scripts, one app, connector rules, Mojo, native) | Not kept after install | `BAD_PACKAGE`, `DOWNLOAD_FAILED`, `NEEDS_DEVMODE`, `REVOKED` | `packagesservice.js` `packageFor`, `check` |
| 4 | Icons, screenshots | URLs in the index | images | none | none (pictures) | WebView cache | shown blank | Marketplace app |
| 5 | Revocation list | F `revocations/v1/revoked.json` + `.sig` | `revocationList` | none | Signed by the catalog's keys (as 1); `sequence` not lower; `expires` future | Kept; an older or unsigned list is ignored (logged, `revocationsError`) | 404: none published yet | `@phoenix/platform` `revocations.js`, `packagesservice.js` `refreshRevocations`, `applyRevocations` |
| 6 | Update feed key | F `updates/key.json` | `keyFile` | none | As 1, scope `updates` | Read at each check when a root is pinned | `NO_DELEGATION` | `updatesservice.js` `feedKeys` |
| 7 | Update feed | F `updates/<compatible>/<channel>.json` (+ `.sig`) | `updateFeed` format 2 (format 1 accepted only when nothing is pinned) | none | Detached signature; `expires`; `sequence` not lower (per compatible/channel); release `build` above the running one; staged `rollout` bucket; `revoked` builds dropped | Release kept in state; prepared slot survives offline | `NOT_SET_UP`, `BAD_SIGNATURE`, `EXPIRED`, `ROLLBACK`, `BAD_FEED`, `CONNECTION_FAILED`; 404 = nothing for this device; daily activity `com.palm.update.check` | `updatesservice.js` `check`, `parseFeedDocument` |
| 8 | RAUC bundle | `release.url` | bundle | none | `size`, `sha256` of the whole; then RAUC's own signature check against the image's keyring, `compatible`, build newer | Kept in `/var/lib/phoenix/updates` until prepared; a stopped download continues (`Range`) | `DOWNLOAD_FAILED` (partial kept), `BAD_DOWNLOAD` (removed), `BAD_BUNDLE`, `WRONG_DEVICE`, `NOT_NEWER` | `updatesservice.js` `download`, `prepare`; `lib/node.js` `download` |
| 9 | Driver catalog | F `drivers/v1/drivers.json` (+ `.sig`, `key.json`, hand-over) | [DRIVERS.md](DRIVERS.md) | none | Pinned key only (never TOFU), hand-over, revoked keys | Kept | as before | `services/hardware/lib/drivers.js` |
| 10 | Hardware report | A `drivers/v1/report` | `hardwareReport` -> 201 | none | — | not kept | `CONNECTION_FAILED` | `hardwareservice.js` `sendReport` |
| 11 | Servers of a staging platform | A `v1/servers.json` | `servers.schema.json` | none | Checked (`checkOverride`); Developer Mode only | Kept as the override | `NEEDS_DEVMODE`, `BAD_PARAMS` | `accountservice.js` `setServers` |
| 12 | OIDC discovery | `<issuer>/.well-known/openid-configuration` | `openidConfiguration` | none | `issuer` must equal servers.json's | Kept 24 h | `BAD_SERVER`, `CONNECTION_FAILED` | `accountservice.js` `discovery` |
| 13 | Device code | `device_authorization_endpoint` (A `oauth/device/code`) | form `client_id`, `scope` -> `deviceCode` | none | — | in memory | `BAD_SERVER` | `deviceCode` |
| 14 | Tokens | `token_endpoint` (A `oauth/token`) | device_code / refresh_token grants -> `tokens` | none | — | Key store only (`account:tokens`), never in state or logs | RFC 8628: `authorization_pending` (poll on), `slow_down` (+5 s), `access_denied`, `expired_token`; 429/5xx: +5 s; offline: +5 s up to 60 s until the code expires; `invalid_grant` on refresh: signed out | `poll`, `accessToken` |
| 15 | Browser sign-in | `authorization_endpoint` via `org.webosphoenix.service.oauth/authorize` | PKCE S256 | — | the OAuth service's | its key store (keyId) | `CANCELED`, `ACCESS_DENIED`, `UNSUPPORTED` on hardware until the sheet (Q29) | `browser` |
| 16 | Revoke | `revocation_endpoint` (A `oauth/revoke`) | RFC 7009 | none | — | — | best effort | `signOut` |
| 17 | Profile | A `v1/me` | `me` | bearer | — | Kept (Settings shows it offline) | 401: signed out | `finishSignIn`, `refresh` |
| 18 | Device registration | A `v1/devices` POST | `deviceRegistration` -> `deviceCreated` (Idempotency-Key) | bearer | — | Device id kept | 422 | `finishSignIn` |
| 19 | Devices | A `v1/me/devices`, `v1/devices/{id}` DELETE | `deviceList` | bearer | — | — | Sign Out unregisters first (best effort) | `devices`, `signOut` |
| 20 | Entitlements | A `v1/me/entitlements` + A `v1/key.json` | `entitlements`, header `X-Phoenix-Signature` | bearer | Ed25519 over the body's bytes by `account.key` (else `v1/key.json`) | Kept; trusted offline until `validUntil` + `graceDays` | `BAD_SIGNATURE` | `readEntitlements`, `entitlements` |
| 21 | Backup credentials | A `v1/backup/credentials` POST | `backupCredentials` | bearer (`backup`) | — | Key store (`account:backup`), asked once | `NOT_SET_UP`, `SIGNED_OUT`, 409 `NO_DEVICE` | `backupCredentials` (callers: the backup service) |
| 22 | Backup files | A `dav/backups/<deviceId>/` WebDAV | `.pbak` (AES-256-GCM, PBKDF2 passphrase: ciphertext only) | basic | the archive's GCM tags; the passphrase | on the server | `UNAUTHORIZED`, `NO_SPACE` (507), `BAD_SERVER` | `apps/settings/service` `lib/webdav.js`, `backupservice.js` (`phoenix` destination, other devices read only) |
| 23 | Backup summary | A `v1/backup/summary` | `backupSummary` | bearer | — | — | — | First Use's restore |
| 24 | Push endpoint | the push server (ntfy) | a topic `up<32 hex>?up=1` | none (anonymous topic) | — | Kept per app | `NOT_SET_UP` | `pushEndpoint` |
| 25 | Relay channels | A `v1/push/channels` (+ `/renew`, DELETE) | `pushChannelRequest` -> `pushChannel` | bearer (`push`) | — | the connector keeps the id | 422 | `pushRegister`, `pushRenew`, `pushDrop` |
| 26 | Token relay | A `v1/oauth-broker/<provider>/authorize`, `/redeem`, `/refresh` | `brokerTokens` | bearer for redeem/refresh | PKCE: the verifier never leaves the device until redeem | nothing kept by the broker | `BAD_VERIFIER`, 404 | `tokenRelay` (Q49) |
| 27 | Assistant proxy | A `v1/assistant/chat/completions`, `models` | OpenAI Chat Completions | bearer (`assistant`) | — | — | 429 `QUOTA` | `apps/assistant` provider type `phoenix`, `assistantProvider` |
| 28 | Connectivity probe | `connectivity.probe` | 204 | none | — | — | — | configured, not yet read by the network stack (see [Still to do](#still-to-do)) |

## Signatures and keys

- **Detached signatures.** `<file>.sig` is base64 of the Ed25519 signature
  of the file's exact bytes, then a newline (as `server/marketplace`
  `Catalog::publish` has always written `index.json.sig`). The device
  fetches both as bytes and verifies before parsing
  (`@phoenix/platform` `signed.js` `verifyDetached`, `verifyWithAny`).
  The publisher writes the signature first, then the file.
- **Key delegation (Q45, PLATFORM.md 7.1 step 2), done on the device.**
  A feed's `key.json` carries `delegations`: `{scope, key, issued,
  expires, signature}` where `signature` is the offline root's signature of
  the UTF-8 text `"phoenix-key-delegation:1\n" + scope + "\n" + key + "\n"
  + issued + "\n" + expires + "\n"`. A fixed text, not JSON, so PHP and
  JavaScript need no shared canonical form. Devices that pin the root take
  any listed delegation for the feed's scope that is unexpired and not in
  the revocation list's `keys`; two may be listed while the online key
  changes (`signed.js` `trustedKeys`). Scopes: `catalog` (the index and the
  revocation list), `updates`, `drivers` (reserved; the driver catalog keeps
  its pinned key and hand-over, [DRIVERS.md](DRIVERS.md)).
- **What is pinned where.** servers.json: `catalog.root` (or `.key`),
  `updates.root` (or `.key`), `drivers.key`, `account.key` (entitlements).
  The RAUC keyring is the image's (`/etc/rauc/`, not yet in meta-phoenix:
  [Still to do](#still-to-do)).
- **Revoked keys.** The signed revocation list's `keys` are never trusted
  again, whatever signs them: a leaked online key is answered by a new
  delegation plus this entry.

## The app catalog

`org.webosphoenix.service.packages` (`apps/marketplace/service`), the
Marketplace and Connections.

- **Index** (touchpoint 2): apps (`kind` `pwa`, `ipk`, `connector`), the
  categories, account types for Connections (`accounts`), and optional
  `revoked`; unknown fields are ignored inside version 1. Search, browse,
  categories, screenshots and ratings all come from the signed index; the
  device calls no dynamic catalog endpoint (reviews from devices are
  PLATFORM.md P2 work: `POST /v1/catalog/apps/{id}/reviews` is not called
  yet).
- **Packages**: installed through OSE's installer after the checks
  (touchpoint 3). Web apps (`pwa`) are packaged on the device from the
  site's manifest.
- **App updates**: `listInstalled` / `updateAll` and the daily activity
  compare the index's version with the installed one; a release with
  `rollout` `{percent, seed}` is offered as an update only to devices in
  its percentage ([Staged rollout](#staged-rollout)); a first install takes
  the version the index lists.
- **Pre-installed connectors** (`/etc/palm/marketplace/preinstalled.json`:
  the Fediverse) reinstall from the built-in Phoenix catalog without
  Developer Mode when that catalog's key is pinned (key or root) or was
  checked by the user (`firstPartyEntry`); any other connector needs
  Developer Mode until the connector tier (C5).
- **Developer submissions and review** are invisible to devices by design:
  only approved releases are in the signed index.
- **Revocation (kill switch)**: `malware` and `security` remove the app or
  connector and say why; `legal` and `developer` warn once ("withdrawn from
  the Marketplace because ... You can remove it in the Marketplace") and
  mark it in `listInstalled`/`getApp`; a revoked id never installs again
  from any catalog (`REVOKED`). Q56's default, APP-STORE.md 3.9.
- **Third-party sources** (`sources.json`: App Museum II, the PreCentral
  homebrew feed; `addSource` for any other Phoenix catalog with the
  fingerprint step): unchanged, off by default; `getSources` now says
  `insecure: true` for a plain-HTTP source not on this computer (Q65) and
  `pinned`, `notSetUp` for the built-in one.

### Staged rollout

A release (system or app) may carry `"rollout": {"percent": 0-100, "seed":
"..."}`. The device's bucket is the first four bytes of
`SHA-256(seed + ":" + rolloutId)` as a big-endian unsigned number modulo
100, where `rolloutId` is 16 random bytes in hex the device made once and
never sends; it takes the release when bucket < percent. The platform only
publishes the numbers; raising the percentage only adds devices; `0`
pauses (`@phoenix/platform` `rollout.js`). Settings > Updates says when a
staged release has not reached this device yet.

## System updates

`com.palm.update` (`services/updates`), Settings > Updates, luna-systemui's
alerts.

1. **Channel**: Settings > Updates offers servers.json's `channels`
   (stable, beta, dev: Q56); a new device starts on `updates.channel`.
2. **Check** (daily activity, or the button): `key.json` when a root is
   pinned, the channel file and its signature as bytes; verify; parse
   (format 2: `sequence`, `expires`, `revoked`); rollout bucket; keep the
   release. A build in `revoked` that was downloaded or prepared is
   dropped and luna-systemui's alerts closed.
3. **Download**: to `/var/lib/phoenix/updates/phoenix-<build>.raucb`; a
   stopped download is kept and continued with `Range: bytes=<n>-` (206
   appends, 200 restarts, 416 = complete); the whole is checked against
   `size` and `sha256` (`lib/node.js` `download`).
4. **Prepare**: `rauc info` (RAUC verifies the bundle's signature against
   the image's keyring), `compatible`, newer build, the feed's build; `rauc
   install` writes the other slot; the running slot stays primary.
5. **Install**: "Install Now" (battery at least 20% or charging) marks the
   prepared slot active and restarts; "Install Later" waits for the charger.
6. **After the restart**: the service marks the running slot good (`rauc
   status mark-good`, what meta-rauc's `rauc-mark-good.service` does) when
   it first starts, which luna-systemui's GetStatus subscription causes
   once the System UI is up; a system that never gets there is not marked
   good, so the bootloader's counter takes the device back, and the service
   then says "The update to X did not start".

On a device the RAUC calls are its command line talking to the RAUC daemon
over D-Bus (`lib/node.js`); in the simulator the fake slots in the runtime
(`runtime.updateSlots`); in tests `services/updates/test/fake-rauc.cjs`.

## The account and cloud services

`org.webosphoenix.service.account` (`services/account`, new), behind
servers.json, inert ("notSetUp") until an account server is configured.
The user-visible name is one string (`ACCOUNT_NAME`, "Phoenix Account",
Q40).

- **Sign in**: the device authorization grant (touchpoints 12-14), the
  default: Settings > Phoenix Account and First Use's Phoenix Account step
  show the code and a QR code of `verification_uri_complete`. "Sign In on
  This Device" uses `org.webosphoenix.service.oauth/authorize` (only
  called, not changed here); on hardware that answers `UNSUPPORTED` until
  the browser sheet exists (Q29).
- **Then**: `GET /v1/me`, `POST /v1/devices` with the device's own Ed25519
  public key (made once, kept beside the tokens), signed entitlements.
- **Phoenix Cloud backup**: Settings > Backup offers "Phoenix Cloud" when
  signed in; the backup service asks the account for this device's WebDAV
  folder and app password and writes the same encrypted `.pbak` as to any
  WebDAV server. First Use's Restore lists every device's backups in the
  account (`backupSummary`) and reads another device's folder read-only
  with this device's credentials.
- **Push**: `pushEndpoint {app}` makes a UnifiedPush topic on the push
  server for a connector; `pushRegister` asks the relay for a webhook URL
  bound to it (Graph, Google Calendar, Gmail). The device's ntfy
  connection and RFC 8291 decryption are the push service's (Synergy C6,
  not built yet).
- **Token relay** (Q49): `tokenRelay` gives the broker's authorize URL and
  redeems or refreshes through it; the OAuth service's `broker` option will
  call it.
- **Assistant**: a "Phoenix" provider type in Settings > Assistant; its
  address and key (the account's access token) come from
  `assistantProvider` at each request.
- **Who may call what**: cloud credentials only to the backup service,
  the assistant provider only to the assistant, changes only from Settings
  and First Use (`CALLERS` in `accountservice.js`, plus the ACG groups
  `account.query`, `account.management`, `account.cloud`).

## Failures, offline, backoff

- Feeds: a failed check leaves what was taken before in place (the catalog
  browses from the last verified index, a downloaded or prepared update
  stays); the daily activities try again the next day; errors are shown
  where the user looks (Settings > Updates, the Marketplace's catalog list).
- API: errors are `{error, code, details}` (PLATFORM.md 5); the device's
  `errorCode` is the server's `code`, else one by status (`UNAUTHORIZED`,
  `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `TOO_LARGE`, `BAD_REQUEST`,
  `RATE_LIMITED` with `retryAfter`, `QUOTA`, `SERVER_ERROR`), and
  `errorText` is the server's sentence (`@phoenix/platform` `http.js`).
  `backoff(failures, retryAfter)` is 1 min doubling to 6 h with jitter,
  never below Retry-After, for scheduled callers.
- A 401 after a refresh, or `invalid_grant` on refresh, signs the device
  out locally and says so; the next sign-in starts over.
- Entitlements are trusted offline until `validUntil + graceDays`; after
  that Settings shows the plan as ended (the server enforces every limit
  itself).

## Mismatches fixed

Between the device and PLATFORM.md as it was:

| Mismatch | Fixed in | Why |
| --- | --- | --- |
| Server addresses in four files (`sources.json`, `updates.json`, `hardware/catalog.json`, nothing for the account), PLATFORM.md 3's "devices name it in" | Device: one servers.json; spec: PLATFORM.md 2, 3, 11.3, 12 | Task 2; the platform's hosts are build settings |
| The driver catalog on `drivers.webosphoenix.org` (catalog.json) vs PLATFORM.md 3's `feeds.<domain>/drivers/v1/` | Device (servers.json's `drivers` below `feeds`, report on the API host) | The spec's two hosts |
| No `dev` channel (`CHANNELS` stable, beta) | Device and `server/updates` | Q56 |
| `rollout` "hash(seed + device random) mod 100" undefined | Spec and device: SHA-256 of `seed:rolloutId`, first four bytes big-endian mod 100 | Both sides must compute the same bucket |
| Update feed unsigned; format 2 "later" | Device now: format 2 signed and required when a key or root is pinned; format 1 kept for development | Task 3; a mirror could hold devices on a withdrawn release |
| Revocation list "signature over the ids joined" in the file | Spec: a detached `revoked.json.sig` over the whole file (reasons, kinds, `sequence`, `expires`, `keys` all covered); the runtime's `com.palm.appinstaller/revoke` keeps its own format for LunaSysMgr's API | The ids-only signature left the reason (remove or warn) unsigned |
| Entitlements `signature` field "over the JSON without this field" | Spec: `X-Phoenix-Signature` header over the body's bytes | No canonical JSON form PHP and JavaScript share |
| No mark-good after an update (nothing in the repository called it; meta-phoenix has no RAUC) | Device: `rauc status mark-good` at the service's first start | Without it, boot counting would have reverted every update |
| No resume of a stopped bundle download | Device (Range) | Bundles are hundreds of MB |
| Catalog key delegation, revocation fetch, app rollout listed as device work (PLATFORM.md 12) | Device: done | Q45, Q56 |
| No `GET /v1/servers.json` | Spec (openapi.yaml), mock | Developer Mode's "Use These Servers" and the conformance suite need the platform's own configuration |
| WebDAV: "a device sees its own folder and, for restore, the other devices' folders read-only" without a credential story | Spec: the device's app password reads its account's other devices' folders (GET, PROPFIND), writes only its own | First Use's restore on a new device |
| The simulator's backup service called other services as the page (Settings), not as itself | `runtime/phoenix-runtime.js` | The account gives cloud credentials to the backup service only |

## What the platform must implement

Everything in [platform-api/openapi.yaml](platform-api/openapi.yaml) with
the bodies of its schemas, and on staging the `conformance` controls. In
short: the feeds (signed index, key files with delegations, signed update
feed format 2 per compatible and channel with Range-capable bundles, signed
revocation list), the account (OIDC discovery, RFC 8628 device grant,
refresh rotation, revocation, `/v1/me`, devices, signed entitlements,
`/v1/key.json`, `/v1/servers.json`), Phoenix Cloud (credentials, summary,
WebDAV with the read rule above, 507 over quota), push channels, the
OAuth broker, the assistant proxy (OpenAI-compatible, 429 `QUOTA`), the
hardware report, and the errors of PLATFORM.md 5.
`tools/platform-mock/server.cjs` is a working reference of all of it in
one file (signatures with Node's Ed25519).

## Conformance

`tools/test-platform-client.cjs` runs the device's own services (the files
a device runs, in Node) against a platform and checks every file and reply
against the schemas: catalog, updates, account, cloud, 60 checks; with
`--ui`, also Settings > Updates, Settings > Phoenix Account, Backup to
Phoenix Cloud, First Use's sign-in and cloud restore on a second device,
and the Marketplace and Connections installing the platform's package,
its staged update and its connector, in Chromium (the simulator's pages and
runtime), with screenshots (`--out`).

```sh
# against the mock platform (it starts it)
node tools/test-platform-client.cjs
NODE_PATH="$(npm root -g)" node tools/test-platform-client.cjs --ui --out build/platform-client-tests

# against the real platform's staging server
node tools/test-platform-client.cjs --api https://api.staging.<domain>/ --token "$PHOENIX_CONFORMANCE_TOKEN" [--ui]
```

The staging server must serve `GET <api>/v1/servers.json` (its own hosts,
roots pinned) and the controls `POST <api>/v1/conformance/{updates,
catalog, revocations, approve, deny, rotate}` behind a token, which
publish signed test releases with its staging keys and approve a device
code for a test account; production must not have them. The suite uses
the device type `phoenix-conformance` and the ids `org.example.mockapp`,
`org.example.mockfeeds`, `org.example.feeds`.

The mock on its own, e.g. for the simulator:

```sh
node tools/platform-mock/server.cjs --port 8099 --seed --write-servers /tmp/servers.json
```

then Settings > Developer Mode > Platform Servers: `http://127.0.0.1:8099/api/v1/servers.json`.

Unit tests: `apps/shared/platform/src/platform.test.ts`,
`services/updates/updatesservice.test.ts`,
`apps/marketplace/service/platform.test.ts`,
`services/account/accountservice.test.ts`; `python3
tools/test-install-rootfs.py` checks the image layout and `servers-json.py`.

## Still to do

- **RAUC in meta-phoenix**: no RAUC recipe, `system.conf` or keyring yet
  (PLATFORM.md 7.2; PRE-IMAGE-CHECKLIST U-rows). The update service calls
  the CLI and needs `rauc` and its daemon in the image.
- **The connectivity probe** is configured (`connectivity.probe`) but
  OSE's network stack still uses its own; pointing it there is
  meta-phoenix configuration.
- **The push service** (Synergy C6): the ntfy WebSocket and RFC 8291
  decryption; registration is ready here.
- **The OAuth service's broker option** and **reviews from devices**
  (`POST /v1/catalog/apps/{id}/reviews`): not called yet.
- **Signing device requests** with the device key (PLATFORM.md 6.3,
  optional for v1): the key is registered, nothing is signed with it yet.
