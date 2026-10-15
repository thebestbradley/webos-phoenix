# Phoenix Marketplace: the catalog service

The server side of the Marketplace (docs/APP-STORE.md): developer accounts,
submissions with automatic checks, a review queue, ratings and reviews,
reports, opt-outs, and the **signed static catalog** devices read. Plain
PHP 8 with PDO: MySQL/MariaDB on a server (LAMP), SQLite on one computer.

## On this computer (for now)

    server/marketplace/bin/serve.sh

sets itself up the first time (`bin/marketplace.php init`: the database, the
signing key, the curated web apps, an admin account, a first publish) and
serves at <http://127.0.0.1:8088/>, which is where the simulator's
Marketplace looks (`/etc/palm/phoenix/servers.json`). It needs PHP 8 with
sodium and pdo_sqlite, which `./phoenix` installs (Homebrew's `php`; apt's
`php-cli` and `php-sqlite3`, whose `php-common` has sodium).

**One catalog per user** (docs/APP-STORE.md 3.16), shared by every simulator
of every checkout (1.0's webos-phoenix, 2.0's phoenix-ember-glass-ui): its
folder is outside the checkouts, `~/.local/share/phoenix/catalog`
(`$XDG_DATA_HOME/phoenix/catalog`), on a Mac `~/Library/Application
Support/Phoenix/catalog`; `MARKETPLACE_DATA` names another, for every tool
(`serve.sh`, `bin/marketplace.php`, `bin/web-apps.py`, `phoenix-connector
publish --local`, phoenix-sim). The folder holds the database, the signing
key, the uploads, the published catalog (`public/v1`), the update feed
(`updates`), the log (`simulator.log`), the fills' state (`fill/`) and, while
it runs, `server.json` (the process serving it, its port, the simulator that
started it and the checkout), which that process writes once its PHP serves
the port and alone removes. The first start
imports the checkout's old `server/marketplace/data` when the folder has no
catalog yet (the log says so; the old folder is left as it was). **Keep a
copy of its `signing.key`**: with a new key every device has to trust the
catalog again.

**The simulator starts it**: **Services > Marketplace Catalog** in its menu
bar (or **Start Local Catalog** on the Marketplace's "Can't reach" card, or
`./phoenix run --marketplace`, or `./build/phoenix-sim --marketplace`)
starts `serve.sh` without blocking the simulator (`shell/sim/simmarketplace.h`),
setting it up the first time; the menu item shows it starting, running
(started here, by another simulator, or by an older one, used as it is) or
failed with the reason, and the Marketplace opens once it answers. **Services
> Start Catalog with the Simulator** starts it with every run where PHP is,
and is on unless turned off (`--no-marketplace` for one run). Started by a
simulator, `serve.sh` leaves PHP's server running under a watch of its own,
which keeps it while any simulator runs, whichever started it (the one that
started it, and those listed in the simulators' registry,
`shell/sim/siminstances.h`, older builds' too), and stops it a few seconds
after the last one quits or crashes (`PHOENIX_CATALOG_GRACE`, 5). A
simulator whose catalog went away starts it again, unless it was stopped from
the menu (for every simulator: every watch stops within a second, and so do
the worker processes PHP forks, which on a Mac outlive PHP). Two simulators
starting it at once set it up one after the other. Run by hand, `serve.sh`
serves until it is stopped (Ctrl+C, or a simulator's menu).

**It fills itself.** Each start publishes the curated web apps (`seed`,
`publish`), then, in the background, `bin/web-apps.py fill`: the open-source
web apps of `catalog/web-apps.json` when that file changed since the last
fill that worked (the network: offline, it says so and the next start tries
again) and the 2.0 apps of a built phoenix-default-apps checkout
(`PHOENIX_DEFAULT_APPS`, the simulator's setting `marketplace/defaultApps`, or
a sibling `../phoenix-default-apps` with built apps) whose version is newer
than the catalog's. One fill runs at a time; `fill/status.json` says what it
does and did, and Services > **Refill Catalog** runs one now (`fill
--force`); `serve.sh --no-fill` skips it.

The simulator's Marketplace trusts this catalog without the fingerprint
step: phoenix-sim reads the public key from the catalog's folder
(`public/v1/key.json`, which every publish writes) and gives it as the key
of the sources file's `phoenix` catalog, as a device's sources file gives a
catalog's key. Whatever answers at 127.0.0.1:8088 must sign its index with
that key; one an older simulator runs from its own checkout's data is used,
and the Marketplace shows its fingerprint (`php
server/marketplace/bin/marketplace.php key` prints it) and asks to trust it.

**A development catalog.** `serve.sh` runs it with `MARKETPLACE_DEV=1`
(unless set): a developer's upload is approved and published at once, with
no review. It keeps a local developer (`developer.token` in the folder, made
by `bin/marketplace.php developer`) for `phoenix-connector publish --local`
and `bin/marketplace.php upload FILE.ipk`, and once per catalog
(`seed/done`) it publishes the connector kit's News Feed example, as that
developer, and the connector packages Phoenix comes with
(`apps/marketplace/service/etc/palm/marketplace/preinstalled.json`: the
Fediverse) as Phoenix's own (`upload --phoenix`, the admin, in Phoenix's
namespaces), so the simulator can install one again after removing it.
Packing them needs the connector kit built (the build does it). Never set
`MARKETPLACE_DEV` on a server.

- Catalog: `/v1/key.json`, `/v1/index.json`, `/v1/index.json.sig`, `/v1/packages/`
- API: `/api/` (see `src/Api.php`)
- Review queue: <http://127.0.0.1:8088/admin> (Services > Open Catalog in
  Browser) with the token in `admin.token` in the catalog's folder

## System updates

The same server serves the system update feed devices read
(`com.palm.update`, `services/updates`): `/updates/<compatible>/<channel>.json`
next to its RAUC bundles, in `updates` in the catalog's folder (`MARKETPLACE_UPDATES`
elsewhere), written by `server/updates/src/UpdateFeed.php`. An admin
publishes a release with the bundle as the request body:

    curl -X POST -H "Authorization: Bearer $TOKEN" --data-binary @phoenix.raucb \
        "https://…/api/admin/updates?compatible=phoenix-pinephonepro&version=1.1.0&build=110&channel=stable&note=…"

(`note=` repeats, one line each; for `compatible=phoenix-sim` with no body,
the simulator's stand-in bundle.) `POST /api/admin/updates/withdraw
{compatible, channel}` takes a release back; `GET /api/updates` lists every
channel. The simulator's `/etc/palm/phoenix/servers.json` names this
server's `/updates/` (and its `/v1/` catalog). The feed is format 1, not
signed (a development feed: the platform's is signed, format 2,
docs/PLATFORM-CLIENT.md); the bundles are (RAUC, on the device), and
builds only go up.

## On a server

Point Apache or nginx (with PHP-FPM) at `public/router.php` for every
request, and set:

| Variable | What |
| --- | --- |
| `MARKETPLACE_DSN` | e.g. `mysql:host=localhost;dbname=marketplace;charset=utf8mb4` |
| `MARKETPLACE_DB_USER`, `MARKETPLACE_DB_PASS` | the database account |
| `MARKETPLACE_DATA` | a folder outside the web root (the key, uploads, the published catalog) |
| `MARKETPLACE_BASE_URL` | where devices read the catalog, e.g. `https://marketplace.example.org/v1/` |
| `MARKETPLACE_NAME` | the catalog's name |

Then `php bin/marketplace.php init`, and put the URL and the public key
(`bin/marketplace.php key`) in the device's sources file so devices trust it
without asking. Before opening sign-up to the public, add email (or forge)
verification to `POST /api/accounts` (`src/Api.php`).

## The curated web apps

Phoenix lists popular sites that ship a web app manifest; a site can ask to
be taken off (`POST /api/optout`, then an admin accepts it). The list is
`catalog/curated-sites.json`; `bin/probe-pwas.py` finds each site's manifest
and writes `catalog/curated-pwas.json` (checked live), which `init` and
`seed` load. The probe asks as a browser does (gzip, Fetch Metadata: some
sites refuse other requests), reads the page as a phone and then as a
desktop browser, follows a manifest `<link>` or a manifest URL in the page's
scripts, then guesses the usual names next to the page and at its root (and
next to the URL asked for, when the page redirected to a sign-in page). A
site whose page adds its manifest link with JavaScript from a file of its
own can name the manifest in `curated-sites.json` (`"manifest"`, as
Outlook's); the probe still checks it. A site is listed only with a manifest
that has a name and a picture icon that is there on the web (the probe
loads it, and prefers one another site's page may show); the others stay in
the file's `notFound` with the reason, naming the bot check (Cloudflare,
DataDome, Akamai) when one refused the probe. A site whose manifest is good
but whose icons are all missing is listed anyway, with an icon the catalog
makes: the probe records `iconGenerated` (the letters, from the title: "GN",
"NYT", "F1", and the manifest's `theme_color`, else its `background_color`,
else a colour of its own), `seed` draws it as a plain SVG (its letters on a
rounded square of that colour; `Catalog::generatedIcon`) into the published
files, `/v1/icons/<id>.svg`, and the index marks the app `"iconGenerated":
true`; a device installing the web app uses it when none of the site's own
icons comes (`apps/marketplace/service/packagesservice.js`). It is our own
lettering, not the brand's logo. Its start page is the
manifest's `start_url` when that is on the site, else the site (as
browsers do, so a manifest kept on a CDN still starts on the site).

Devices get every picture from the catalog itself: the index names an icon
or screenshot on another site as the catalog's copy,
`/v1/icons/copy/<id>-<hash of its address>` (`/v1/screenshots/copy/...`).
The first request for it fetches it from the site and keeps it in the
published files (a PNG, JPEG, GIF, WebP or ICO, by its own bytes, never an
SVG; icons at most 2 MB, screenshots 8 MB); an admin listing an app or
approving a release fetches its pictures then. Until a picture can be had
(tried again after an hour) an icon is the app's initials, so a list never
shows an empty square, and a screenshot is left out (`Catalog::mediaCopy`).
So pictures show wherever the catalog is reachable (phoenix-sim's local
catalog included), a device browsing the catalog tells the sites nothing,
and a site renaming a hashed file breaks no listing.

The addresses come from developers, so the fetch (`src/SafeFetch.php`)
cannot be pointed at the server's own network: https only; every address
the host resolves to must be public (no loopback, RFC 1918, link-local and
the cloud metadata address, 100.64/10, multicast, reserved, documentation,
nor IPv6's ::1, fc00::/7, fe80::/10, ff00::/8 or an IPv4 address inside
IPv6); the connection is pinned to the address checked (no DNS rebinding);
each of at most three redirects is checked again; size and time are
capped. `MARKETPLACE_FETCH_LOCAL=1` lets it reach http://127.0.0.1 as well,
for the tests' local sites only; `MARKETPLACE_FETCH_PROXY` names an egress
proxy the operator trusts (it then resolves the names).

`bin/serve.sh` publishes the index again at each start, and runs PHP's
server with several workers, since a first copy waits on its site.

Today 139 of the 167 sites are listed, three of them (Ground News, NYT
Games, Formula 1) with generated icons, as all the icons their manifests
name are missing (probed again 9 October 2026; JS Paint, JupyterLite, Cinny
and FluffyChat, open-source web apps linked rather than hosted, added 13
October 2026, docs/WEB-APP-CATALOG.md; Elk, Wavacity and CyberChef, added
then too, have no manifest the probe can find). Of the rest, some show a
visitor who is not signed in no manifest at all (Bluesky, Discord, Notion,
Trello, Word, OneDrive, Tuta, Zoho Mail, Yahoo Mail, Evernote, McDonald's,
trivago), and the others turned the probe away with a bot check from the cloud network it ran
on (Canva, The New York Times, Reuters, The Economist, Skyscanner,
Tripadvisor, DoorDash, Revolut, Stack Overflow, CodePen, Yelp, VSCO,
Reddit). ChatGPT's Cloudflare check lets the probe through only at times.
From an ordinary home connection more of them get through.

### Refreshing the list (on a Mac)

From the checkout, on a home connection (bot checks refuse many sites from
servers and cloud networks):

    python3 server/marketplace/bin/probe-pwas.py
    git diff --stat server/marketplace/catalog/curated-pwas.json

It prints `ok` or `skip` (with the reason) for each site and rewrites
`curated-pwas.json`; look at what came and went before committing it.
`probe-pwas.py ID ...` (ids or titles) probes only those sites and keeps
the others as they were. (If
Python cannot check certificates, run `/Applications/Python 3.x/Install
Certificates.command` once.) Then load it into the catalog and publish:

    php server/marketplace/bin/marketplace.php seed
    php server/marketplace/bin/marketplace.php publish

`seed` updates and lists the curated web apps in the file, sets the ones
it no longer has to `gone` (listed again when a later list has them back;
`seed FILE` only adds and updates the apps in FILE),
and leaves opted-out sites and listings an admin pulled alone; `publish`
signs and writes the catalog devices read. With the server's database
elsewhere, set `MARKETPLACE_DSN` (and the account) and `MARKETPLACE_DATA`
as on the server first, or run the two commands there. Add a site by
adding a line to `curated-sites.json` (our own summary, its developer,
categories from the ones already used) and running the probe.

## Open-source web apps and the 2.0 apps

The catalog hosts packages it makes itself from their makers' builds
(docs/APP-STORE.md 3.12-3.14): open-source web apps from their upstream's
release (`catalog/web-apps.json` pins each one; why each app is hosted, a
link or left out: docs/WEB-APP-CATALOG.md), and webOS Phoenix 2.0's apps
from a phoenix-default-apps checkout. `bin/web-apps.py` makes and
publishes them; run it isolated (`python3 -I`; it restarts itself so):

    python3 -I server/marketplace/bin/web-apps.py check              catalog/web-apps.json, offline
    python3 -I server/marketplace/bin/web-apps.py publish [ID ...]   fetch, check, pack, publish
    python3 -I server/marketplace/bin/web-apps.py shoot ID ...       screenshots for the listing
    python3 -I server/marketplace/bin/web-apps.py default-apps --from ../phoenix-default-apps --publish
    python3 -I server/marketplace/bin/web-apps.py fill [--force]     what changed of both (serve.sh runs it)

- **fetch** downloads an app's release, its icon and its licence files into
  a cache outside the repository (`--cache`, `PHOENIX_WEB_APPS_CACHE`, else
  `~/.cache/phoenix-marketplace/web-apps`; it refuses one inside), each
  download into a new empty folder, each checked against its pinned
  SHA-256 and, where upstream publishes a `SHA256SUMS.txt`, against that
  too. The archive is unpacked by the script itself, every path checked: no
  links or special files, nothing outside its folder, at most 512 MB.
- **pack** writes `<id>_<version>_all.ipk` in the cache: the release's
  files (those under its `root`, or its `include` list), an `appinfo.json`
  (upstream's title and vendor, `main`, `icon.png`, `removable`, the
  launcher's Downloads tab), the icon and `licenses/` (the notices).
  Deterministic: the same inputs give the same bytes, so a re-run
  publishes nothing new. A package over 64 MB is refused, as the catalog
  and devices refuse one.
- **publish** packs, then runs `php bin/marketplace.php upload --phoenix
  --listing LISTING.json PKG` (`--data` for another data folder, `--php`):
  the admin's upload, approved and published, with the listing
  (`Catalog::applyListing`: title, developer and its address, summary, our
  description with where the release came from, categories, licence,
  homepage, `source`, icon, the screenshots in `<cache>/<id>/screenshots/`).
  A version already there with the same bytes only gets its listing again;
  other bytes under a version already uploaded are refused.
- **shoot** starts the packed app in phoenix-sim (`--sim`, default
  `build/phoenix-sim`; `--extra-rootfs` with its files, a fresh HOME,
  `--tablet`, `--delay`; under `xvfb-run` without a display) and keeps the
  screenshot for the next publish. `--software-gl` gives WebGL 2 in
  software (`--ignore-gpu-blocklist --enable-unsafe-swiftshader`), which
  the ArtCraft apps need on a machine without a GPU.
- **default-apps** packs each built app of the checkout (`--from PATH` or
  `PHOENIX_DEFAULT_APPS`; none given: it says the 2.0 apps are skipped and
  why), its `dist/` with `removable: true`, and with `--publish` publishes
  it as Phoenix's own under "Phoenix 2.0". The apps offered in the
  Marketplace only (`phoenix.catalogOnly`: Home) are packed with the rest
  and listed as new apps, not updates; `DEFAULT_LISTINGS` holds our own
  words for a listing where the app's `package.json` summary is not what
  the catalog should say (Home: a companion for Home Assistant, not
  affiliated with the Open Home Foundation). The checkout is private:
  nothing of it is ever committed here.

`php bin/marketplace.php listing ID LISTING.json` sets an app's listing
again (and publishes). On a server the same commands run there, with the
server's `MARKETPLACE_*` settings.

## Update logs

A package's `changelog.json`, beside its `appinfo.json`, is its update log
(docs/APP-STORE.md 3.15: the format, the rules, the Marketplace's What's
New and Version History). On upload `Ipk::check` checks it with
`src/Changelog.php` (the rules of phoenix-default-apps'
`tools/lib/changelog.mjs`, with the same messages; both run
`tests/changelog-cases.json`, a copy of that repository's cases) and
refuses a malformed one, or one whose newest version is not the package's;
it is optional. The log is kept with the release (`releases.changelog`),
without `unreleased`. A listed app's index entry has `whatsNew`, its
listed version's entry, and `detail: {url, sha256}`, a file published
beside the index (`/v1/apps/<id>-<hash>.json`: `{id, version,
versionHistory}`), which keeps the signed index small and is as trusted as
it; `GET /api/apps/{id}` has `whatsNew` and `versionHistory`, `GET
/api/apps` `whatsNew`. A hosted web app's listing may name
`releaseNotesUrl`, its upstream's release notes (`catalog/web-apps.json`).
`bin/web-apps.py default-apps` packs a 2.0 app's `changelog.json` without
`unreleased`.

The system's release notes travel in the update feed: `POST
/api/admin/updates?...&releaseNotes=release-notes.json` takes the
version's entry from a notes file at the top of this checkout (the one
`product.json` names) and writes it as the release's `releaseNotes`, with
its lines as `notes` when no `note=` is given (server/updates README).

## Account types (Connections)

The index also lists the **account types** Phoenix can connect to, for the
Marketplace's Connections view (`docs/SYNERGY-CONNECTORS.md` 2.1, phase C0):
`"accounts": [{templateId, title, provider, icon, summary, capabilities:
[{capability, direction?}], protocols, auth: {type, registration}, server,
privacy: {dataGoesTo, e2ee, phoenixServers}, push, status, package: {id,
builtin}, help?, signUp?, featured}]`. `signUp` is where a person without an
account gets one, an `https://` address (the Fediverse's
joinmastodon.org/servers, XMPP's providers.xmpp.net; none where the server is
the user's own or no account is needed); the device's account type page
offers "Don't have an account? Sign up" beside Set up. Here are the built-in ones (CardDAV & CalDAV, Subscribed Calendar, Email
Account, the simulator's Jabber), `package.builtin: true`, and the
connector packages Phoenix comes with (the Fediverse), `package: {builtin:
false, preinstalled: true}`: removable, installed again from the catalog
without Developer Mode (`preinstalled` only with `builtin: false`; a bad
value stops the publish). Every other connector lists its own types from its
package (below).

The list is `catalog/accounts.json`, edited by hand. It is not kept in the
database: every `publish` reads it, checks each entry (required fields, the
allowed values in `Catalog::ACCOUNT_ENUMS`, capabilities as the template
names them, texts of 1 to 80 characters for `title` and `provider`, each a
line in Connections, 300 for `summary` and 200 for `privacy.dataGoesTo`)
and stops on a bad one, so the published index stays as it was;
`init` and `seed` check it too. Each entry's `iconFrom` is the template's own
icon in this checkout (open-source release or Phoenix art, with its
provenance where it lives); `publish` copies it to
`/v1/icons/accounts/<templateId>.png`, and the index gives its full address.

## Connector packages (Synergy, phase C4)

A connector (`docs/SYNERGY-SDK.md`: an app with its service in `service/`,
its account templates and its kinds) goes up as any package:
`POST /api/apps/packages` with the `.ipk`, or `phoenix-connector publish`.
The catalog takes one that passes the connector rules (`src/Connector.php`,
the same as `phoenix-connector validate`; `Ipk::check` refuses a service in
any other package), lists it in the index as kind `"connector"` (with a
`release`, as an `ipk`; devices before C4 leave the kind out), and lists its
account types in `accounts` with `package.builtin: false`. Their entries come
from the package: its template (the name, the capabilities, the icon, copied
to `icons/accounts/<templateId>.png`) and its `catalog.json` (the summary,
where the data goes, the sign-in, ...: `Catalog::connectorTypes`), checked
as `catalog/accounts.json`'s entries are. A catalog type with the same
template id wins (the Fediverse's entry in `accounts.json`). On a server a
person reviews each release; on a development catalog it is approved at
once. `org.webosphoenix.*` packages are Phoenix's own: only an admin uploads
them, in the `org.webosphoenix` and `com.webosphoenix` namespaces.

Devices install a connector only in Developer Mode (the owner's decision,
until the connector trust tier, C5), except one Phoenix comes with
(`/etc/palm/marketplace/preinstalled.json`) from a catalog the device ships
with (`apps/marketplace/service/packagesservice.js`, `firstPartyEntry`), and
Phoenix's own that are only in the catalog, not pre-installed (that file's
`catalog` list: the drives, `org.webosphoenix.drives`; their entries in
`accounts.json` say `package: {id, builtin: false}` without `preinstalled`,
which `Catalog.php` allows for the `org.webosphoenix` / `com.webosphoenix`
ids only). `bin/serve.sh` puts those packages into a development catalog.

## Device classes and kinds

Which apps each kind of device is offered (docs/APP-STORE.md 3.17; the lists
are `apps/marketplace/service/lib/availability.json`, `src/Availability.php`).
Each app has a kind, `phoenix`, `legacy`, `web`, `native` or `local`, assigned
when it is published (a website is `web`; an id in Phoenix's namespaces
`phoenix`; a development catalog's local developer's upload `local`; a
package with a service `native`; the rest `web`), and the device classes it
is offered on, `phone`, `tablet`, `desktop`: its package's (`appinfo.json`
`"phoenix": {"deviceClasses": [...]}`, an unknown class refused), else all.
The admin can set both for an app, and switch a kind or a whole feed
(`catalog`, `connectors`, `appmuseum`, `preware`) off per class; each change
publishes. The index says each entry's `appKind` and `deviceClasses` and the
switches as `availability: {deviceClasses, appKinds, feeds, off: {kinds:
{kind: [class]}, feeds: {feed: [class]}}}`, staying version 1; devices filter
(`apps/marketplace/service/lib/availability.js`).

- The admin page's **Devices and Kinds**: a box per kind, feed and app and class.
- `GET /api/admin/availability`, `POST /api/admin/availability {off}`,
  `POST /api/admin/apps/{id}/availability {appKind?, deviceClasses?}` (null:
  the assigned kind, the package's classes).
- `php bin/marketplace.php availability` (JSON), `availability off|on kind|feed
  NAME CLASS...`, `availability app ID classes CLASS,...|package`,
  `availability app ID kind KIND|assigned`.

## Tests

    php server/marketplace/tests/run.php

and, for the device's side against this server,
`apps/marketplace/service/service.test.ts` and `tools/test-marketplace.cjs`;
for the simulator's side (the shared catalog's lifetime across simulators,
with this `bin/serve.sh`), `build/simmarketplace-test`.
