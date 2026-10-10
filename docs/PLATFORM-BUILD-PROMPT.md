# Master prompt: build the Phoenix platform in Laravel

The owner gives the text below (everything after the line) to the agent
that will build the platform. It is self-contained: that agent has not
seen this repository's history. The plan and spec it follows is
[PLATFORM.md](PLATFORM.md); the owner's open decisions are rows Q1 and Q40
to Q57 of [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md). Update this prompt when
the owner answers one.

---

## Who you are working for, and the goal

You are building **the Phoenix platform**: the servers behind **webOS
Phoenix**, an open-source project that brings the webOS 1.x-3.x experience
(cards, gestures, Just Type, notifications, Synergy) to modern phones and
tablets on top of webOS OSE. Palm's and HP's servers were switched off
years ago, which broke the original devices; this platform replaces them,
built so that it cannot break devices the same way.

The platform is one **Laravel** application plus a few separate services.
It hosts: the website (news, keynotes, downloads), the user account
(working name **Pre Account**; say "Phoenix Account" in public text until
the owner decides, Q40), the developer portal (accounts, submissions,
review), the **signed static feeds devices read** (the Marketplace
catalog, system updates, the driver catalog), downloads (simulator builds,
device images, GPL sources), developer docs, the device table, community
and support links, and small optional paid cloud services (encrypted
backup, a push relay, an OAuth token broker, an assistant model proxy).

The owner runs macOS, prefers the LAMP stack (PHP, MySQL/MariaDB, nginx or
Apache), and is comfortable with Python and React + TypeScript. Write
plainly, in short sentences, in code comments, docs and commit messages.

## Read first (in the Phoenix repository)

Clone the Phoenix repository read-only next to your platform repository.
You must not change it unless the owner asks; when the platform needs a
device change, write it down (see "Reporting").

1. `docs/PLATFORM.md`: **the spec you implement.** Sections 2 (the device
   contracts), 3 (hosts), 4 (stack), 5 (API conventions), 6 (components),
   7 (keys and release pipeline), 8 (data model), 9 (operations), 10
   (legal), 11 (migration), 12 (device changes), 13 (phases and their
   acceptance checks), 14 (open questions).
2. `server/marketplace/` (README, `src/*.php`, `public/router.php`,
   `tests/run.php`, `catalog/*.json`): the current catalog server, plain
   PHP 8. Its behaviour is the reference for everything device-facing.
3. `server/updates/` (README, `src/UpdateFeed.php`, `tests/run.php`) and
   `server/drivers/` (README, `src/Catalog.php`, `public/router.php`,
   `tests/run.php`, `sample/`).
4. The device side, which defines the contracts:
   `apps/marketplace/service/lib/catalog.js` (`verifyIndex`, `normalize`),
   `apps/marketplace/service/packagesservice.js` (`keyInfo`, `refreshOne`),
   `apps/marketplace/service/etc/palm/marketplace/sources.json`,
   `services/updates/updatesservice.js` (`parseFeed`, `feedUrl`),
   `services/updates/etc/palm/updates.json`,
   `services/hardware/hardwareservice.js` (`reportOf`, `sendReport`),
   `services/hardware/lib/drivers.js` (hand-over),
   `services/hardware/etc/palm/hardware/catalog.json`,
   `services/oauth/oauthservice.js`.
5. `docs/APP-STORE.md` (3.3 to 3.10), `docs/DRIVERS.md` ("Releasing the
   catalog"), `docs/SYNERGY-CONNECTORS.md` (2.1, 2.2, 6, 7),
   `docs/SYNERGY-MODERN.md` (4.4 to 4.9: OAuth, push, the relay),
   `docs/APP-RUNTIME.md` (Marketplace, System updates, Hardware and drivers,
   Backup), `docs/HARDWARE.md` (device tiers, OTA), `docs/LEGAL.md`,
   `docs/BRANDING.md`.

## The stack

| Part | Use |
| --- | --- |
| Framework | **Laravel 13** (released March 2026; bug fixes to Q3 2027, security fixes to Q1 2028; Laravel has no LTS line, so plan the yearly major upgrade) |
| PHP | **8.4** (8.3 is Laravel 13's minimum) with `sodium`, `pdo_mysql`, `intl`, `zip`, `gd` or `imagick`, `redis` |
| Database | **MariaDB 11.4 LTS** (MySQL 8.4 must also work); SQLite for unit tests only where the SQL is portable |
| Cache, queues | Redis 7 (or Valkey); **Horizon** |
| Auth | **Passport 13** (OAuth 2: the device authorization grant RFC 8628, authorization code with PKCE, refresh tokens, scopes, personal access tokens); **Fortify** for web sign-in, email verification, TOTP; passkeys with `spatie/laravel-passkeys` or `web-auth/webauthn-lib`. Sanctum is not used (PLATFORM.md 4.2 says why) |
| Admin | **Filament 4** |
| Portals | Inertia + React + TypeScript for the account and developer portals; Blade for the website |
| Billing | Laravel **Cashier (Paddle)** unless the owner picks Stripe (Q41); keep your own `subscriptions`/`entitlements` so the provider can change |
| Search | Scout (database driver; Meilisearch later) |
| WebDAV | `sabre/dav` mounted on a route (cloud backup) |
| Web Push | `minishlink/web-push` |
| Roles, audit | `spatie/laravel-permission`, `spatie/laravel-activitylog`, plus an append-only, hash-chained `key_events` table |
| Realtime | Reverb only if a phase asks for it; not at first |
| Tests | **Pest**, Laravel HTTP tests, Larastan (level 6 or higher), Pint |
| Errors | Sentry or Flare |

Licences: the platform is open source (assume Apache-2.0 in its own
repository until the owner says otherwise, Q57). Only permissive
dependencies (MIT, BSD, Apache-2.0, ISC) in anything that ships to
devices or into the device-facing JSON tools; copyleft programs (ClamAV,
Discourse, GoToSocial, ntfy) only as separate services, never linked.
Record each dependency's licence in `docs/DEPENDENCIES.md` of the platform
repository.

## The repository to create

```
webos-phoenix-platform/
  app/
    Domain/            Account, Devices, Developer, Catalog, Checks, Updates,
                       Drivers, Billing, Backup, Relay, Broker, Assistant,
                       Website, Downloads, Audit (one folder each: models,
                       services, jobs, policies)
    Http/Controllers/  Api/V1/ (device and account API), Api/Legacy/ (the
                       frozen /api/* of server/marketplace), Web/, Webhooks/
    Filament/          admin resources and pages (review queue, release
                       console, account desk, ...)
  packages/
    catalog-checks/    the ported Ipk, Connector and SafeFetch classes, a
                       framework-free Composer package (the Phoenix repo's
                       server can use it too)
  signer/              the small separate signing service (PLATFORM.md 7.1)
  database/            migrations, factories, seeders
  resources/js/        Inertia + React + TS pages
  routes/              web.php, api.php, legacy.php, webhooks.php, dav.php
  tests/
    Contract/          fixtures captured from server/marketplace, updates,
                       drivers, and the replay tests
    Device/            Node scripts that run the device's own verifiers
                       (copied or vendored from the Phoenix repo) against
                       this app's output
    Feature/, Unit/
  docs/                README, DEPLOY.md, RUNBOOK.md, DEPENDENCIES.md,
                       KEYS.md (key ceremonies, without keys), PROGRESS.md
  deploy/              nginx config, supervisor/Horizon, CI workflow
```

## Rules

1. **Never break a device contract.** The device-facing paths and JSON of
   PLATFORM.md section 2 are fixed: the catalog's `key.json`, `index.json`
   and `index.json.sig` (Ed25519 over the exact bytes; `version: 1`;
   `build` always increasing; `expires` 14 days; the same field names and
   JSON flags as `Catalog::publish`), the packages and pictures; the update
   feed `<compatible>/<channel>.json` (`format: 1`); the driver catalog
   (`format: 1`, 30-day expiry, hand-over files); the hardware report
   (`POST`, `format: 1`, 201 `{"ok": true}`). New fields may be added inside
   a version; nothing may be renamed, removed or retyped. A breaking change
   is a new versioned path served beside the old one.
2. **Tests first for every device-facing endpoint.** Before writing an
   endpoint, add its contract test. Contract tests replay the device's real
   requests and compare JSON (ignoring ids, times, build numbers, tokens
   and signatures) and status codes with **fixtures captured from the
   Phoenix repository's own servers**: run `php server/marketplace/tests/run.php`,
   `php server/updates/tests/run.php` and `php server/drivers/tests/run.php`
   with request/response capture (a small wrapper around their `Api::handle`
   and router calls), and commit the captured pairs under
   `tests/Contract/fixtures/`. Also run the device's own code (Node) on your
   output: `lib/catalog.js` `verifyIndex` on every published index,
   `updatesservice.js` `parseFeed` on every channel file,
   `services/hardware/lib/drivers.js` on the driver catalog and a hand-over.
   CI fails if any of these fail.
3. **Errors**: `{"error": "a sentence", "code": "MACHINE_CODE", "details":
   {...}}` with the HTTP status; the legacy `/api/*` routes keep sending
   exactly what `server/marketplace/src/Api.php` sends (`{"error": "..."}`
   with 400/401/403/404).
4. **Security.** No secret, key or token in the repository, logs, error
   reports or fixtures. Offline keys (driver catalog, RAUC, download
   signing, the catalog root) never touch a server: the platform only
   verifies signatures made with them. The online catalog key lives only in
   the signer. Every server-side fetch of a URL a developer gave goes
   through the `SafeFetch` rules (https only, public addresses only, pinned
   connection, checked redirects, size and time caps). Store only hashes of
   bearer tokens. Passkey step-up for owner-only actions (approving a
   system update or driver release, granting roles, key changes). Rate
   limits on every unauthenticated POST. CSRF on every web form; HSTS;
   strict CSP on the website and portals. Never log request bodies of the
   OAuth broker or the assistant proxy. Uploads: size limits, content
   checked by bytes not extension, scanned (ClamAV service) before a person
   opens them. Follow OWASP ASVS level 2 for the account and admin.
5. **Privacy.** No account is needed to browse, install or update. No
   analytics in device-facing endpoints; download counts from CDN logs as
   daily counts only; IPs kept no longer than the rate limiter needs.
   Backups are ciphertext the server cannot read. Export and delete work
   from day one of the account.
6. **Find the root cause** of every failure; no retries or sleeps that hide
   a problem; no test marked flaky without an explanation.
7. **Small, clear commits**; never name an AI model in commits, PRs or
   docs. Each phase ends with its acceptance checks passing (below) and
   `docs/PROGRESS.md` updated.
8. **Don't decide the owner's open questions.** Implement the recommended
   default from PLATFORM.md 14 behind a configuration value or a clearly
   marked seam, so the owner's answer is a configuration change, and say in
   PROGRESS.md which defaults you relied on.

## The phases, in order

Do them in this order. Each phase's acceptance checks are in PLATFORM.md
13; they are summarised here.

**P0 Foundations.** Repository, CI (Pint, Larastan, Pest, contract tests,
`composer audit`, `npm audit`), local (Laravel Herd or `php artisan serve`
on the owner's Mac), staging and production configurations; the
`catalog-checks` package ported with its tests passing on the Phoenix
repository's test cases (including `server/marketplace/tests/connector-cases.json`
for rules C1-C13); the contract fixtures captured and failing against an
empty app; the signer skeleton; `docs/KEYS.md` describing each key ceremony
(the owner performs them, PLATFORM.md 7). *Done when* staging deploys from
CI and the fixtures are in place.

**P1 Feeds and the first device image.** The catalog and publisher with
the signer; the admin review queue in Filament; developer accounts with
email verification and 2FA; the developer submission API at parity with
`server/marketplace` (web apps and `.ipk`, the same checks and messages);
the legacy `/api/*` routes; the update feed and the release console (CI
upload with a CI-only token, the owner's offline signature step, passkey
approval, publish, withdraw; `rollout` and the `dev` channel behind a
switch until devices support them); the driver catalog release through the
same console and the hardware report intake; downloads with SHA-256 and
signatures and the GPL corresponding-source page; the website MVP (home,
features, download, news with RSS, Atom and JSON Feed, legal pages,
`/.well-known/security.txt`); the docs site build from the Phoenix repo's
Markdown (PLATFORM.md 6.12); the connectivity probe; monitoring that
downloads and verifies the index and checks `expires`. *Done when* the
seven checks of PLATFORM.md 13 P1 pass, including the simulator ones.

**P2 1.0: account and community.** The Pre Account (sign-up, verification,
passkeys, TOTP, sessions, profile, export, delete with a 30-day grace),
device sign-in with the device authorization grant and `/v1/devices`,
`/v1/me`, entitlements (signed); reviews and ratings with account tokens;
the full developer portal (organisations, verified namespaces by DNS TXT or
well-known file, the review conversation, stats, a CLI-friendly API),
connector packages (C1-C13 plus the new M1-M7 checks of PLATFORM.md 6.6),
the signed revocation list; the device table and install guides; help
center from the Help app's topics; contact; the forum's SSO (OIDC provider
on Passport); newsletter with double opt-in. *Done when* the P2 checks
pass.

**P3 Phoenix Cloud.** Billing (Cashier Paddle by default), plans and
entitlements, refunds and receipts through the provider; cloud backup as
WebDAV (`sabre/dav`) per account and device, quotas, app passwords per
device; the push relay (`/v1/push/channels`, `/relay/graph`,
`/relay/google/calendar`, `/relay/google/pubsub`) feeding an ntfy server;
the OAuth broker (PLATFORM.md 6.5.4: PKCE between device and broker, a
two-minute encrypted handle, nothing stored); the assistant proxy
(OpenAI-compatible, token quotas, nothing logged). *Done when* the P3
checks pass.

**P4 Community services.** Phoenix Messaging on XMPP (Prosody, a separate
service, signed in through the Pre Account), the Fediverse instance
(GoToSocial, separate), the video pipeline and keynote pages, events.

**P5 Later.** Only when the owner asks: paid apps, settings sync, more
storage, TUF in full, mirrors network, map, weather and podcast proxies, a
Windows simulator.

## Running the device contract tests against your local platform

The Phoenix simulator (`phoenix-sim`, built from the Phoenix repo with
`./phoenix`; on a Mac it needs Homebrew's Qt) reads:

- the Marketplace catalog at `http://127.0.0.1:8088/v1/`
  (`apps/marketplace/service/etc/palm/marketplace/sources.json`), its key
  trusted on first use after showing the fingerprint;
- the update feed at `http://127.0.0.1:8088/updates/`
  (`services/updates/etc/palm/updates.json`);
- in the simulator, the store key `"updates:config"` stands for an edited
  `updates.json` and `"hardware:config"` for an edited
  `/etc/palm/hardware/catalog.json` (see `runtime/phoenix-runtime.js`,
  "System updates", and `tools/test-updates.cjs`).

So: run your platform locally on **127.0.0.1:8088** with its local
configuration serving the catalog at `/v1/` and updates at `/updates/` (in
production they are `/catalog/v1/` and `/updates/` on the feeds host: make
the prefix a configuration value), make sure the Phoenix repo's own PHP
catalog is not running (the simulator's Services > Marketplace Catalog
off), and run:

```sh
./phoenix run tablet --launch org.webosphoenix.marketplace --screenshot out.png --delay 8000
NODE_PATH="$(npm root -g)" node tools/test-marketplace.cjs
NODE_PATH="$(npm root -g)" node tools/test-updates.cjs
NODE_PATH="$(npm root -g)" node tools/test-hardware.cjs
```

`tools/test-marketplace.cjs` starts the repo's PHP server itself through
`apps/marketplace/service/test/servers.cjs`; to point it at your instance
it needs an option to use a server already running at a URL. That is a
change in the Phoenix repo: propose it to the owner (see Reporting) rather
than making it. Without a display, prefix the simulator with
`QTWEBENGINE_DISABLE_SANDBOX=1 xvfb-run -a -s "-screen 0 1920x1200x24"`,
and use a fresh `HOME` per run for a clean device. Look at the
screenshots, not only the exit codes.

## Decisions that are still the owner's

Implement the default and leave a seam; do not settle these yourself.
Numbers are rows in the Phoenix repo's `docs/OPEN-QUESTIONS.md`:

- **Q1** the domain and hosts (default: `feeds.<domain>` and
  `api.<domain>` for devices; PLATFORM.md 3).
- **Q40** the account's public name (default "Phoenix Account").
- **Q41** Paddle or Stripe (default Paddle).
- **Q42** plans and prices (default in PLATFORM.md 6.4).
- **Q43** Phoenix Messaging on XMPP or Matrix (default XMPP/Prosody).
- **Q44** a hosted Fediverse instance and who may join (default later,
  GoToSocial, members only).
- **Q45** the catalog key: signer only, or offline root plus delegation
  (default: signer for the first image, delegation before 1.0).
- **Q46** where code and CI live (default: CI anywhere, uploading with a
  CI-only token).
- **Q47** Discourse or Flarum (default Discourse).
- **Q48** free developer accounts without ID checks (default yes).
- **Q49** the OAuth token broker for confidential clients (default yes,
  only for those providers, labelled `token-relay`).
- **Q50** the assistant proxy and its upstream (default later, P3).
- **Q51** the legal entity (default: no paid services until there is one).
- **Q52** video hosting (default a video service plus YouTube and PeerTube
  mirrors).
- **Q53** a Windows simulator (default no).
- **Q54** website analytics (default cookieless self-hosted Umami).
- **Q55** hosting (default Hetzner VPS with Forge, Cloudflare R2 and CDN).
- **Q56** device changes the platform relies on: `dev` channel, rollouts,
  revocations, later a signed update feed (default yes; until a device
  supports one, keep it behind a switch).
- **Q57** the platform's licence and repository (default open source,
  Apache-2.0, separate repository).

Also the owner's own steps, which you prepare but never do: every key
ceremony, every release approval, the Apple Developer ID signing and
notarisation of the macOS simulator, registering developer apps with
providers (Google, Microsoft, Slack, LinkedIn, Zoom, Dropbox, Box,
Telegram: done by the Phoenix project account), the DMCA agent
registration, signing up with payment, mail and hosting providers.

## Reporting progress

- Keep `docs/PROGRESS.md` in the platform repository: per phase, what is
  done, the acceptance checks with their state, which open-question
  defaults the code relies on, what is blocked on the owner.
- At the end of each working session, a short report to the owner: what
  changed (commits), what passed (tests, contract tests, simulator runs
  with screenshots), what is blocked and why, the next step.
- **Device changes** the platform needs (PLATFORM.md 12) go into the
  report as a list with the file and the change; the Phoenix repo is the
  owner's to change.
- If a device contract seems wrong or impossible to keep, stop and ask;
  never "fix" it on the server alone.
