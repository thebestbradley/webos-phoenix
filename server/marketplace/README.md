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
Or let the simulator do it: `./build/phoenix-sim --marketplace` starts
`serve.sh` (setting it up the first time), waits until it answers, opens
the Marketplace, and stops it on quitting (one already running is used as
it is; its log is `data/simulator.log`). It needs PHP 8 with sodium and
pdo_sqlite, which `scripts/mac-setup.sh` and `scripts/linux-setup.sh`
install.

The first time the Marketplace reads it, it shows the key's fingerprint
(`php server/marketplace/bin/marketplace.php key` prints it) and asks to
trust it.

- Catalog: `/v1/key.json`, `/v1/index.json`, `/v1/index.json.sig`, `/v1/packages/`
- API: `/api/` (see `src/Api.php`)
- Review queue: <http://127.0.0.1:8088/admin> with the token in `data/admin.token`

Everything it keeps is in `data/` (git-ignored). **Keep a copy of
`data/signing.key`**: with a new key every device has to trust the catalog
again.

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
`seed` load.

## Tests

    php server/marketplace/tests/run.php

and, for the device's side against this server,
`apps/marketplace/service/service.test.ts` and `tools/test-marketplace.cjs`.
