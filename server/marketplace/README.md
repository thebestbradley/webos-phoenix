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
Marketplace looks (`apps/marketplace/service/etc/palm/marketplace/sources.json`).
Or let the simulator do it: **Services > Marketplace Catalog** in its menu
bar (or **Start Local Catalog** on the Marketplace's "Can't reach" card, or
`./phoenix run --marketplace`, or `./build/phoenix-sim --marketplace`)
starts `serve.sh` without blocking the simulator (`shell/sim/simmarketplace.h`),
setting it up the first time; the menu item shows it starting, running or
failed with the reason, and the Marketplace opens once it answers. It stops
on quitting (one already running, another simulator's, is used as it is);
its log is `data/simulator.log` (Services > Show Catalog Log). **Services >
Start Catalog with the Simulator** starts it with every run where PHP is,
and is on unless turned off (`--no-marketplace` for one run). It needs PHP 8
with sodium and pdo_sqlite, which `./phoenix` installs (Homebrew's `php`;
apt's `php-cli` and `php-sqlite3`, whose `php-common` has sodium).

The simulator's Marketplace trusts this catalog without the fingerprint
step: phoenix-sim reads the public key from the catalog's data folder
(`data/public/v1/key.json`, which every publish writes) and gives it as the
key of the sources file's `phoenix` catalog, as a device's sources file
gives a catalog's key. Whatever answers at 127.0.0.1:8088 must sign its
index with that key. A catalog elsewhere (another data folder, another
address) shows its fingerprint (`php server/marketplace/bin/marketplace.php
key` prints it) and asks to trust it.

**A development catalog.** `serve.sh` runs it with `MARKETPLACE_DEV=1`
(unless set): a developer's upload is approved and published at once, with
no review. It keeps a local developer (`data/developer.token`, made by
`bin/marketplace.php developer`) for `phoenix-connector publish --local`
and `bin/marketplace.php upload FILE.ipk`, and once per catalog
(`data/seed/done`) it publishes the connector kit's News Feed example, as
that developer, and the connector packages Phoenix comes with
(`apps/marketplace/service/etc/palm/marketplace/preinstalled.json`: the
Fediverse) as Phoenix's own (`upload --phoenix`, the admin, in Phoenix's
namespaces), so the simulator can install one again after removing it.
Packing them needs the connector kit built (the build does it). Never set
`MARKETPLACE_DEV` on a server.

- Catalog: `/v1/key.json`, `/v1/index.json`, `/v1/index.json.sig`, `/v1/packages/`
- API: `/api/` (see `src/Api.php`)
- Review queue: <http://127.0.0.1:8088/admin> with the token in `data/admin.token`

Everything it keeps is in `data/` (git-ignored). **Keep a copy of
`data/signing.key`**: with a new key every device has to trust the catalog
again.

## System updates

The same server serves the system update feed devices read
(`com.palm.update`, `services/updates`): `/updates/<compatible>/<channel>.json`
next to its RAUC bundles, in `data/updates` (`MARKETPLACE_UPDATES`
elsewhere), written by `server/updates/src/UpdateFeed.php`. An admin
publishes a release with the bundle as the request body:

    curl -X POST -H "Authorization: Bearer $TOKEN" --data-binary @phoenix.raucb \
        "https://…/api/admin/updates?compatible=phoenix-pinephone&version=1.1.0&build=110&channel=stable&note=…"

(`note=` repeats, one line each; for `compatible=phoenix-sim` with no body,
the simulator's stand-in bundle.) `POST /api/admin/updates/withdraw
{compatible, channel}` takes a release back; `GET /api/updates` lists every
channel. A device's default feed (`services/updates/etc/palm/updates.json`)
is this server's `/updates/`. The feed is not signed; the bundles are
(RAUC, on the device), and builds only go up.

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

Today 135 of the 160 sites are listed, three of them (Ground News, NYT
Games, Formula 1) with generated icons, as all the icons their manifests
name are missing (probed again 9 October 2026). Of the rest, some show a
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
names them) and stops on a bad one, so the published index stays as it was;
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

## Tests

    php server/marketplace/tests/run.php

and, for the device's side against this server,
`apps/marketplace/service/service.test.ts` and `tools/test-marketplace.cjs`.
