# Synergy: accounts and sync

Synergy was webOS's account framework. You signed in to an account once
(Google, Exchange, Facebook, Yahoo, LinkedIn, ...) and that one account fed
Contacts, Calendar, Messaging and Email. The Contacts app never showed
contacts: it showed *people*, each merged from the contacts that every
account knew about that person.

This page has three parts:

1. [How Synergy worked](#1-how-synergy-worked), from the code HP and LG released as
   Open webOS (`third_party/app-services`, `third_party/core-apps`,
   `third_party/enyo-1.0`, `third_party/loadable-frameworks`). Paths below are
   relative to the repository root, and line numbers are those of the
   submodule commits this repository pins.
2. [A plan to rebuild it on today's protocols](#2-modernizing-synergy), one
   service per protocol, with the phases in which to build them.
3. [Phase 1 as built](#3-phase-1-carddav-and-caldav): a CardDAV and CalDAV
   account (`apps/dav`) that works in the simulator today and is written to
   run on a device.

[SYNERGY-MODERN.md](SYNERGY-MODERN.md) continues section 2: where each
provider stands today (checked September 2026, with sources), messaging
Synergy across SMS, Matrix, XMPP and bridged networks, photos, files and
social accounts, push and the power budget, an optional self-hostable relay,
and a roadmap past phase 4.

Only the account *framework* was open-sourced. The transports that made
Synergy famous (Google, Exchange ActiveSync, Facebook, Yahoo, LinkedIn,
Skype, AIM via libpurple) were never released. What survives of them is
their account templates, recorded as test fixtures in
`third_party/core-apps/com.palm.app.accounts/mock/accountManager_accounts_templates_listAccountTemplates.json`
(and `third_party/core-apps/com.palm.app.calendar/libs/mock.js`), which show
every field a real transport declared.

## 1. How Synergy worked

### 1.1 The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Accounts service `com.palm.service.accounts` | `third_party/app-services/com.palm.service.accounts` | Account records, templates, credentials, and the calls to each transport when an account is created, changed or deleted |
| Account templates | `/usr/palm/public/accounts/<templateId>/<templateId>.json`, e.g. `third_party/app-services/account-templates/palmprofile/com.palm.palmprofile/com.palm.palmprofile.json`, `third_party/app-services/mojomail/imap/files/usr/palm/public/accounts/com.palm.imap/com.palm.imap.json` | Declare an account type: its name, icons, validator, and one *capability provider* per thing it syncs |
| Transports | one Luna service per protocol: `com.palm.imap`, `com.palm.pop`, `com.palm.smtp` (`third_party/app-services/mojomail`, C++); Google, EAS, Facebook, ... (not released) | Validate credentials, react to the account's lifecycle, sync their capability's data into db8 |
| db8 | `com.palm.db`, `com.palm.tempdb` | Where every synced object lives, in a kind per capability and transport |
| Activity manager | `com.palm.activitymanager` | Runs transport methods on a schedule, when the network comes up, or when a db8 query changes |
| Contacts linker | `third_party/app-services/com.palm.service.contacts.linker` | Merges contacts from all accounts into `com.palm.person:1` |
| Apps | `third_party/core-apps`, Enyo's `lib/accounts` | Read the merged data from db8; add and edit accounts with the accounts library |

### 1.2 Account templates and capabilities

A template is a JSON file; the accounts service reads every one under
`/usr/palm/public/accounts` (its schema:
`third_party/app-services/com.palm.service.accounts/schemas/template.json`).
The HP webOS profile's template
(`third_party/app-services/account-templates/palmprofile/com.palm.palmprofile/com.palm.palmprofile.json`)
lists its capabilities in `capabilityProviders` (lines 16-66): CONTACTS,
CALENDAR, TASKS, MEMOS, PHONE, MESSAGING (subtype SMS) and
LOCAL.FILESTORAGE. Each provider has an `id` unique across templates and a
`capability`, and may add:

- `dbkinds`: the db8 kinds its data goes into, e.g.
  `{"contact": "com.palm.contact.palmprofile:1"}` (line 21-23). The kind
  *extends* the capability's generic kind, so the apps query
  `com.palm.contact:1` and get every account's contacts
  (`third_party/app-services/com.palm.service.contacts.linker/db/kinds/com.palm.contact.palmprofile`,
  `"extends": ["com.palm.contact:1"]`). The Calendar app also reads
  `subKind` (`third_party/core-apps/com.palm.app.calendar/app/shared/CalendarsManager.js`
  lines 323-337) and saves new events in that kind
  (`app/edit/EditView.js` line 574).
- `implementation`: the transport's bus address;
- lifecycle callbacks `onCreate`, `onEnabled`, `onDelete`,
  `onCredentialsChanged` (IMAP: `com.palm.imap.json` lines 21-25);
- `sync`: the method to call to sync now. The released templates have none
  (IMAP syncs itself), but every unreleased Synergy transport did, e.g. Google
  contacts `"sync": "palm://com.palm.service.contacts.google/sync"` and EAS
  `"palm://com.palm.eas/syncAllContacts"` in the mock templates above;
- `validator` (per provider, overriding the template's), `alwaysOn`,
  `readOnlyData`, `refetchPhoto`, `loc_name`, `icon`, and for IM
  `capabilitySubtype: "IM"`, `serviceName` and `chatWithNonBuddies` (Google Talk
  through `com.palm.imlibpurple`, with `dbkinds` `com.palm.immessage.libpurple:1`
  and `com.palm.imcommand.libpurple:1`).

The template itself has `templateId`, `loc_name`, `icon`,
`loc_usernameLabel` / `loc_passwordLabel` (shown by the sign-in page,
`third_party/enyo-1.0/framework/lib/accounts/source/credentials.js` lines 56-63),
`hidden`, `readPermissions` / `writePermissions` (which apps may list or
create these accounts; `third_party/app-services/com.palm.service.accounts/utils.js`
lines 56-78, the Accounts app always may), and a `validator`. The validator is
a bus method, or an object with `address` and `customUI` naming an app page
that replaces the standard user name / password page (IMAP: `com.palm.imap.json`
line 10, Email's `accounts/wizard.html`).

An *account* is a `com.palm.account:1` object with only `templateId`,
`username`, `alias`, `beingDeleted` and the enabled providers as
`{id, capability}` (`handlers/create.js` lines 176-186). `listAccounts` and
`getAccountInfo` "annotate" it: the template's fields are laid over the
account and each enabled provider is completed from the template
(`models/account-model.js` lines 26-71). db8 gives each provider object an
`_id`, and "enabled" is tested as `!!cp.onEnabled && cp._id`
(`handlers/notify-created.js` line 90).

### 1.3 Creating an account: validator, credentials, callbacks

1. The accounts library shows the sign-in page, or the template's customUI
   (`third_party/enyo-1.0/framework/lib/accounts/source/entry-add.js` lines 52-63).
2. It calls the template's validator, and each provider's own validator,
   with `{username, password, templateId, config, accountId}`
   (`lib/accounts/source/login-utils.js` lines 35-56,
   `credentials.js` lines 123-165). A validator answers `{credentials,
   config}`: credentials are what the transport will need later (a password,
   a token), `config` its settings. Errors are codes the library can show
   (`lib/accounts/source/errors.js` lines 5-29: `401_UNAUTHORIZED`,
   `HOST_NOT_FOUND`, `SSL_CERT_UNTRUSTED`, ...).
3. `createAccount` (`third_party/app-services/com.palm.service.accounts/handlers/create.js`)
   refuses duplicates (same template and user name, lines 143-173), stores the
   account, stores the credentials (line 224) and calls
   `notifyAccountCreated` without waiting (line 231).
4. `notifyAccountCreated` (`handlers/notify-created.js`) calls every
   provider's `onCreate {accountId, config}` (lines 58-84), then
   `onEnabled {accountId, capabilityProviderId, enabled: true}` for each
   enabled provider (lines 90-120), then the template's
   `onCapabilitiesChanged` (lines 125-134).

Later, `modifyAccount` calls `onEnabled` true / false for switched
capabilities (`handlers/modify.js` lines 291-334) and `onCredentialsChanged`
when credentials change (lines 232-285, and `handlers/credentials.js` lines
90-97). `deleteAccount` marks the account `beingDeleted`
(`handlers/delete.js` line 63), and `notifyAccountDeleted` calls
`onEnabled(false)` and then every `onDelete` (`handlers/notify-deleted.js`
lines 70-100, 111-125). Transports remove their own data there.

**Credentials** were kept by the native key manager: one key per account
holding a JSON object of named credentials, `"common"` by convention
(`models/credentials-model_keymanager.js`: `fetchKey` / `store` on
`palm://com.palm.keymanager/`, lines 26-60, stored as `ASCIIBLOB`).
`readCredentials {accountId, name}` is private to trusted callers (the
transports; `services.json`), and `readCredentialsPublic` checks the
template's `readPermissions`. The desktop build replaced the key manager with
a db8 kind, `com.palm.account.credentials:1`, in clear text
(`models/credentials-model.js` lines 22-32). mojomail reads its password (or
Yahoo's token) from the `"common"` credentials
(`third_party/app-services/mojomail/smtp/src/commands/AccountFinderCommand.cpp`
lines 134-137, 185).

### 1.4 The sync framework

There was no sync library that every transport shared; there was a
contract, and each transport implemented it:

- **Data**: each capability's objects in the provider's db8 kinds, each
  carrying `accountId` (and a `remoteId`, "the same for this contact across
  multiple syncs, restores, and devices", `com.palm.contact` schema lines
  7-11). `deleteAccount` in the simulator and the transports' `onDelete` find
  an account's data by `accountId`.
- **Triggers**, all through the activity manager:
  - a *schedule*: mojomail's scheduled sync is an explicit, persistent
    activity with a sync interval, network requirements and a callback
    `palm://com.palm.imap/syncAccount {accountId}`
    (`third_party/app-services/mojomail/imap/src/activity/ImapActivityFactory.cpp`
    lines 337-366);
  - a *db8 watch*: the outbox, drafts and the account's own settings are
    watched with activity triggers, so a message saved by the Email app is
    sent without the app calling the transport (same file, lines 122-280);
    the contacts linker is started the same way
    (`third_party/app-services/com.palm.service.contacts.linker/activities/com.palm.service.contacts.linker/com.palm.service.contacts.linker.json`);
  - *Sync now*: Contacts creates an activity whose callback is the
    provider's `sync` method with `{accountId}`
    (`third_party/core-apps/com.palm.app.contacts/app/Prefs.js` lines 146-170);
    Calendar does the same for every account with a calendar provider
    (`app/shared/CalendarsManager.js` lines 717-757).
- **Local changes**: db8 revisions. Every object has a `_rev` that grows on
  each change, queries can ask for `_rev > n` including deleted objects
  (`incDel`), and kinds can declare *revision sets* bumped only when certain
  fields change (the Calendar app watches `eventDisplayRevset`, Email the
  transport's `UpsyncRev`). A transport remembers the last revision it
  uploaded and asks db8 for everything newer; the contacts linker does exactly
  that (`autolinker.js` lines 1680-1720).
- **Status**: `com.palm.account.syncstate:1` in tempdb
  (`com.palm.service.accounts/tempdb/kinds/com.palm.service.accounts/com.palm.account.syncstate`),
  `{accountId, capabilityProvider, syncState: "INITIAL_SYNC" |
  "INCREMENTAL_SYNC" | "IDLE" | "ERROR", errorCode}`. The Accounts list shows a
  warning on an account whose state is `ERROR` with `401_UNAUTHORIZED` or
  `CREDENTIALS_NOT_FOUND` (`third_party/enyo-1.0/framework/lib/accounts/source/accounts-list.js`
  line 138); `lib/syncui` shows dashboards from the same records.

### 1.5 The contacts linker

`com.palm.service.contacts.linker` keeps one `com.palm.person:1` for each
group of contacts that are the same person. It is started by a db8 watch on
`com.palm.contact:1` (`_rev > -1`, with deletions) whose callback is
`dbUpdatedRelinkChanges` (the activity file above). For each contact that
changed since the last revision it processed (`autolinker.js`
`performAutolink`, line 989), it looks for people who look similar:

| Rule | Code | Weight (`autoLinkUnit.js` lines 40-53) |
| --- | --- | --- |
| same name | `Autolinker.similarName`, line 104 | 100 |
| same mobile number | `similarPhoneNumber`, line 275 | 100 (other numbers 55) |
| same email address | `similarEmail`, line 482 | 100 |
| same IM address | `similarIM`, line 542 | 100 |
| linked by hand before | `Autolinker.manualLinks`, line 593 | +99999 |
| unlinked by hand before | `Autolinker.manualUnlinks`, line 664 | -99999 |

A person whose total weight reaches 100 (`WEIGHT_MATCH_THRESHOLD`) gets the
contact; otherwise it gets a new person. Manual link and unlink are service
calls (`linker.js` `manuallyLink` line 180, `manuallyUnlink` line 303) and are
backed up (`contactLinkBackup.js`) so a restore or a re-sync links the same
way again. The person holds `contactIds`, the merged fields (names, emails
and phone numbers with a `normalizedValue`, organization, photos) and the
`sortKey` and search fields the apps' queries use (indexes in
`db/kinds/com.palm.person`).

### 1.6 How the apps read it

- **Contacts** lists `com.palm.person:1` (by `sortKey`, `favorite`,
  `searchProperty`), and shows a person with all of its contacts
  (`ContactsLib.Person.getDisplayablePersonAndContactsById`, the
  `third_party/loadable-frameworks/contacts` framework). A new contact goes
  into the default account's `dbkinds.contact`, and the framework asks the
  linker to save the person with it (`saveNewPersonAndContacts`).
- **Phone, Messaging, Just Type** look people up in `com.palm.person:1` by
  normalized phone number or email.
- **Calendar** lists accounts with a CALENDAR provider (`listAccounts
  {capability}`), their `com.palm.calendar:1` objects, and events from
  `com.palm.calendarevent:1` by `calendarId` (`app/shared/DatabaseManager.js`
  lines 122-160). An edited occurrence of a repeating event is a child event
  with `parentId` and `recurrenceId`, and the parent lists it in `exdates`
  (`app/edit/EditView.js` lines 1170-1182).
- **Email** lists accounts with MAIL, and reads `com.palm.email:1` by
  folder.

None of them talks to a transport, except to create, edit and "sync now".

## 2. Modernizing Synergy

### 2.1 What stays and what changes

The contract above is still a good one: templates, capability providers,
callbacks, db8 kinds per capability, a linker over all accounts, and apps
that only read db8. What changes is the transports: the protocols webOS
spoke (Google Data APIs, EAS, Facebook's Graph API of 2011, AIM, XMPP to
Google Talk, Yahoo's cookie auth) are gone or closed. The plan keeps the
accounts service and the kinds, and writes new transports:

| Capability | Protocol | Service (Phoenix) | Template |
| --- | --- | --- | --- |
| CONTACTS, CALENDAR, TASKS | CardDAV, CalDAV (VEVENT, VTODO) | `org.webosphoenix.service.dav` (**phase 1, built**) | `com.webosphoenix.dav`; later presets per provider |
| CONTACTS, CALENDAR (Google) | People API, Calendar API (REST, OAuth 2.0) | `org.webosphoenix.service.google` | `com.webosphoenix.google` (also MAIL through IMAP) |
| CONTACTS, CALENDAR, MAIL, TASKS (Microsoft 365, Outlook.com) | Microsoft Graph (REST, OAuth 2.0) | `org.webosphoenix.service.msgraph` | `com.webosphoenix.microsoft` |
| MAIL | IMAP + SMTP with XOAUTH2 or passwords | mojomail (`com.palm.imap`, `com.palm.smtp`) with an XOAUTH2 command | existing `com.palm.imap`, plus provider templates |
| MAIL (and later CONTACTS, CALENDAR) | JMAP | `org.webosphoenix.service.jmap` | `com.webosphoenix.jmap` |
| MESSAGING / SMS, MMS | modem via the telephony service | `com.palm.telephony` on oFono or ModemManager | the profile account's `palmprofile.sms` |
| MESSAGING / IM | Matrix (with bridges) | `org.webosphoenix.service.matrix` | `com.webosphoenix.matrix` |

All of them are Node.js Luna services on the device (section 2.10), share
one OAuth helper (2.3) and one key store (2.9), and write the same kinds the
apps already read. The linker (section 1.5) runs over all of them.

### 2.2 CardDAV and CalDAV: iCloud, Fastmail, Nextcloud, any server

CardDAV (RFC 6352) and CalDAV (RFC 4791) are the one open standard every
large provider except Google-without-OAuth and Microsoft still speaks, and
most self-hosted servers (Nextcloud, ownCloud, Radicale, Baikal, SOGo) speak
nothing else. Service design (built; details in [section 3](#3-phase-1-carddav-and-caldav)):

- **Sign-in**: server address, user name, app password. Discovery: the
  RFC 6764 well-known URIs (`/.well-known/carddav`, `/.well-known/caldav`),
  then RFC 5397 `current-user-principal`, then `addressbook-home-set` and
  `calendar-home-set`, then the collections in each. A URL that is itself an
  address book or calendar is used as is.
- **Sync**: RFC 6578 `sync-collection` with the stored `sync-token`; for
  servers without it, the collection's CalendarServer `getctag` to skip
  unchanged collections and a comparison of every resource's `getetag`.
  `addressbook-multiget` / `calendar-multiget` to fetch, conditional `PUT` /
  `DELETE` (`If-Match`, `If-None-Match: *`) to write.
- **Providers**: iCloud and Fastmail require an app-specific password for
  third-party clients. Nextcloud offers app passwords
  and serves DAV under `/remote.php/dav` with the well-known redirects set up
  by its web server configuration. Some providers put contacts and calendars
  on different hosts (iCloud uses `contacts.icloud.com` and
  `caldav.icloud.com`; Fastmail `carddav.fastmail.com` and
  `caldav.fastmail.com`): phase 1 discovers both services from one address,
  so such providers need a per-provider template with both hosts (next
  step, see 2.11).
- **Tasks**: VTODO in the same calendar collections (the
  `supported-calendar-component-set` says which accept them), mapped to a
  `com.palm.task:1` kind. The profile template already has a TASKS
  capability (`com.palm.palmprofile.json` lines 29-32), but the webOS Tasks
  app and its kinds were not released, so this needs a Tasks app first. The
  engine already keeps VTODO resources untouched when it edits a calendar.

### 2.3 OAuth 2.0 for installed apps (shared)

Google and Microsoft accept no passwords for their APIs. One helper
service, `org.webosphoenix.service.oauth`, does it for every transport:

- **Authorization code with PKCE** (RFC 7636) as a public client, per
  "OAuth 2.0 for Native Apps" (RFC 8252): no client secret on the device.
- **Redirect to a loopback address**: the service listens on
  `http://127.0.0.1:<random port>/` for the one redirect, and the account's
  customUI page opens the provider's sign-in page in the browser card. This
  is what Google recommends for desktop-class clients, and Microsoft's
  identity platform accepts `http://localhost` redirects for public clients.
- **Device authorization grant** (RFC 8628) as the fallback for devices
  where the browser card cannot be used: show a code, sign in on another
  device. Google's device flow allows only sign-in, two Drive scopes and
  YouTube, so neither Calendar, Contacts nor Gmail can use it
  ([SYNERGY-MODERN.md](SYNERGY-MODERN.md#12-google)); Microsoft allows the
  Graph scopes used here.
- **Tokens**: the refresh token goes into the key store (2.9) as the
  account's `"common"` credentials, the access token is cached in memory,
  refreshed before expiry, and a revoked refresh token turns into
  `syncState: "ERROR", errorCode: "401_UNAUTHORIZED"`, which puts the warning
  on the account and lets the user sign in again (`onCredentialsChanged`).
- **Client registration**: a client ID per provider, registered by the
  project (see 2.12). Builds can override it with their own.

### 2.4 Google: People API and Calendar API

`org.webosphoenix.service.google`, one template with CONTACTS, CALENDAR and
MAIL (like the unreleased `com.palm.google` template in the mock file above,
whose MAIL provider was mojomail IMAP with Gmail's servers in `config`).

- **Contacts**: People API `people.connections.list` with `personFields` and
  `requestSyncToken`, then the `syncToken` for changes (an expired token
  means a full sync); `createContact`, `updateContact` with the person's
  `etag` (a mismatch is the same "server wins" as DAV), `deleteContact`;
  contact groups as tags. Other contacts ("Other contacts" in Gmail) are
  read-only.
- **Calendar**: Calendar API `calendarList.list`, `events.list` with
  `syncToken` (HTTP 410 means start over), `singleEvents=false` so recurring
  events stay one event with `recurrence` (RRULE strings) and exceptions
  (`recurringEventId`, `originalStartTime`) map to child events;
  `events.insert/patch/delete` with `If-Match` on the event's etag; reminders
  as `alarm`.
- **Mail**: Gmail over IMAP with XOAUTH2 (2.6), scope `https://mail.google.com/`.
- **Google's verification**: an app that asks for Calendar or Contacts
  scopes needs Google's OAuth app verification before it can leave "testing"
  (in testing, refresh tokens expire after 7 days and only listed test users
  can sign in; an unverified app shows a warning and has a user cap). The
  Gmail scope is *restricted*: on top of verification it needs a yearly
  third-party security assessment. That makes Gmail over OAuth the most
  expensive thing on this page; users can still use Gmail over IMAP with an
  app password where Google allows one.
- Google's CalDAV and CardDAV endpoints also take OAuth tokens, so the DAV
  engine could serve Google with the OAuth helper; the REST APIs are
  preferred because they expose Google-specific data (contact groups,
  conference links, event colours) and have clearer quotas.

### 2.5 Microsoft Graph

`org.webosphoenix.service.msgraph`, one template with MAIL, CONTACTS,
CALENDAR and TASKS for Microsoft 365 and Outlook.com accounts. Exchange
ActiveSync (the unreleased `com.palm.eas`) is not an option: it is licensed
per client, and Microsoft has retired basic authentication for it in
Exchange Online.

- **Sign-in**: the OAuth helper against the Microsoft identity platform
  (`/common` for both work and personal accounts), scopes `offline_access`,
  `Contacts.ReadWrite`, `Calendars.ReadWrite`, `Mail.ReadWrite`, `Mail.Send`,
  `Tasks.ReadWrite`.
- **Sync**: delta queries: `/me/contacts/delta`, `/me/calendarView/delta`
  (a window of time) or per-calendar event deltas, `/me/mailFolders/delta`
  and `/me/mailFolders/{id}/messages/delta`, each returning a `deltaLink` to
  store as the sync token. Writes with `If-Match` on `@odata.etag`.
- **Mail**: Graph for folders and messages, or IMAP/SMTP with XOAUTH2 using
  the Outlook scopes (`https://outlook.office.com/IMAP.AccessAsUser.All`,
  `SMTP.Send`), which reuses mojomail. Graph is the better long-term choice
  (push through change notifications needs a public endpoint, so polling
  with deltas on a schedule is what a phone can do).
- **Tasks**: Microsoft To Do (`/me/todo/lists/{id}/tasks`, with delta).
- **Throttling**: Graph answers HTTP 429 with `Retry-After`; the service must
  back off per mailbox and never retry in a tight loop.

### 2.6 IMAP and SMTP with XOAUTH2 (mojomail)

mojomail already has the hook: IMAP picks its login command in
`ImapSession` (`third_party/app-services/mojomail/imap/src/client/ImapSession.cpp`
lines 554-569: Yahoo's `AUTHENTICATE XYMCOOKIEB64`,
`commands/AuthYahooCommand.cpp` line 27, otherwise `LOGIN`), and SMTP in
`SmtpSession` (`smtp/src/client/SmtpSession.cpp` lines 194-200: Yahoo token,
`AUTH LOGIN`, `AUTH PLAIN`). XOAUTH2 is one more command in each:
`AUTHENTICATE XOAUTH2 <base64("user=" user "\x01auth=Bearer " token "\x01\x01")>`
for IMAP and `AUTH XOAUTH2 ...` for SMTP, chosen when the account's
`"common"` credentials hold an access token rather than a password, exactly
as the Yahoo token is carried today (`smtp/src/commands/AccountFinderCommand.cpp`
line 185). The token comes from the OAuth helper, refreshed by it; mojomail
only asks for a fresh one on `AUTHENTICATIONFAILED`. Whether mojomail (C++,
built on the old MojoDB / `mojocore` libraries) builds on OSE is its own
task; if it does not, a Node.js IMAP transport with the same kinds is the
fallback.

### 2.7 JMAP

JMAP (RFC 8620 core, RFC 8621 mail) replaces IMAP's many round trips with
JSON over HTTPS and has proper change tracking (`Foo/changes` with a state
string, which maps directly onto the sync-token model of section 3). Fastmail
runs it, as do Stalwart and Cyrus. `org.webosphoenix.service.jmap`:
session discovery from `/.well-known/jmap`, `Mailbox/get` and
`Email/query` / `Email/changes` into the existing `com.palm.email:1` and
folder kinds, `EmailSubmission/set` to send; push over the EventSource
endpoint while a card is open, polling otherwise. Contacts over JMAP
(JSContact, RFC 9553, and JMAP for Contacts) can replace CardDAV for such
servers later; JMAP for Calendars is still a draft.

### 2.8 Messaging: SMS / MMS and Matrix

**SMS and MMS** are the profile account's MESSAGING provider
(`com.palm.palmprofile.sms`, `com.palm.palmprofile.json` lines 48-59), not an
online account. Phoenix Messaging already stores texts as
`com.palm.smsmessage:1` and threads as `com.palm.chatthread:1`, and puts
outgoing texts in the outbox for the telephony service to send (the API
LuneOS's `webos-telephonyd` implements; docs/APP-RUNTIME.md "Phone and
Messaging"). On a device that is `webos-telephonyd` on oFono, or an
equivalent on ModemManager, plus an MMS daemon (`mmsd` / `mmsd-tng`, which
postmarketOS uses) for picture messages and group texts. No account, no
OAuth: the SIM is the account.

**Matrix** is the modern "IM" capability, the role AIM, Google Talk, Yahoo
and Skype had through libpurple. `org.webosphoenix.service.matrix`:

- Template `com.webosphoenix.matrix`, MESSAGING with `capabilitySubtype:
  "IM"`; sign-in with the homeserver (from the user ID's server name,
  `/.well-known/matrix/client`) and a password or the homeserver's SSO in the
  browser card; the access token in the key store.
- `/sync` long-polling while online (the activity manager restarts it after
  network changes), rooms mapped to `com.palm.chatthread:1`, messages to an
  `com.palm.immessage:1` kind (the kinds the libpurple transport used; see
  the Google template's `dbkinds` in the mock file), members to buddy status
  for the Buddies view.
- End-to-end encryption is required in practice: the Rust `matrix-sdk-crypto`
  (vodozemac) through its Node.js or WebAssembly bindings, with the crypto
  store encrypted by a key from the key store. Cross-signing verification
  needs a small UI in Messaging.
- **Bridges** bring the closed networks in: WhatsApp (`mautrix-whatsapp`,
  which logs in as a linked device of the user's phone), Signal
  (`mautrix-signal`, linked device), Telegram (`mautrix-telegram`, puppeting
  the user's account with a Telegram API ID). They run on the user's
  homeserver (or a hosted service such as Beeper), not on the phone; to
  Phoenix each bridged chat is a Matrix room. Messaging can show the network
  a room is bridged to from its state events and pick the icon.

### 2.9 Where credentials live

The legacy accounts service kept credentials in `com.palm.keymanager`
(section 1.3). We have not found a key manager among webOS OSE's published
components, so Phoenix has to provide one; the accounts service's
`KeyStore` interface (`put`, `get`, `del`, `has` per account and name) is
the boundary:

1. **A Phoenix key store service** (`org.webosphoenix.service.keystore`)
   that implements the legacy `com.palm.keymanager` methods the accounts
   service calls (`store`, `fetchKey`, `remove`, `keyInfo`), so
   `credentials-model_keymanager.js` works unchanged. It encrypts with a
   device key: from a TPM or TEE where the board has one, otherwise a key file
   readable only by the service's user (no better than the file system's
   permissions, but not in db8 in clear text as the desktop build did).
2. **The Secret Service API** (freedesktop.org, over D-Bus, via libsecret)
   where a provider runs (gnome-keyring, KeePassXC). OSE images do not
   include one; it fits desktop-class builds and the simulator host, and is
   the option if Phoenix ever shares a keyring with Linux apps.

Whatever the store, only the accounts service reads it; transports get
credentials through `readCredentials`, as today. In the simulator the
runtime keeps them in localStorage (`runtime/phoenix-runtime.js`, block
"Accounts").

### 2.10 On the device and in the simulator

| | On a device (webOS OSE) | In the simulator |
| --- | --- | --- |
| Transports | Node.js Luna services with `webos-service`, started on demand by `run-js-service`, installed by `tools/install-rootfs.py` from an app's `service/` folder (as `apps/files/service`) with their luna-service2 role, permission and service files | The same service modules, loaded into the page by `runtime/phoenix-runtime.js` and registered on the simulated bus |
| HTTP | Node's `http`/`https` | `fetch`, through `tools/serve-rootfs.py`'s proxy (browsers refuse cross-origin DAV) |
| Accounts service, linker | `com.palm.service.accounts` and the contacts linker ported to `webos-service` (they run on the old `mojoservice` framework, which OSE does not have), or reimplemented | Simulated in the runtime (block "Accounts"), with the DAV block adding the transport callbacks |
| Activities | OSE's activity manager (check the `com.palm.activitymanager` API and permission groups on OSE) | "Sync now" activities run at once; no schedules |
| db8 | OSE's db8 (`com.palm.db`, `com.palm.tempdb`), kinds from `/etc/palm/db/kinds` | The runtime's db8 in localStorage |
| Key store | 2.9 | localStorage |
| OAuth | loopback listener in the OAuth service, browser card for sign-in | the same service, with the host browser (to do) |

### 2.11 Phases

0. **Framework on the device** (before any transport works there): run
   `com.palm.service.accounts` and the contacts linker on OSE (port from
   `mojoservice` to `webos-service`, or a Phoenix reimplementation of their
   bus API), a key store (2.9), and check the activity manager API. The
   simulator already has all of this.
1. **CardDAV and CalDAV** (done, section 3): contacts and calendars, two-way,
   against any standard server. Next steps on it: per-provider templates
   (iCloud, Fastmail, Nextcloud) with both hosts and help text; photos
   through a file cache; VTODO once a Tasks app exists; linker hand-over
   once the real linker runs.
2. **OAuth helper + Google + Microsoft Graph** for contacts and calendars;
   **XOAUTH2 in mojomail** (or a Node IMAP transport) for their mail.
3. **SMS / MMS on real telephony** (with M3 hardware bring-up), and the
   **Matrix** IM transport with encryption; bridges are the user's choice
   on their homeserver.
4. **JMAP** for mail (Fastmail, Stalwart), **Tasks** app over CalDAV VTODO,
   Microsoft To Do and Google Tasks.

Phase 1 needed no registration with anyone and no secrets, which is why it
came first. Phase 2 cannot ship to users without the client registrations
and Google's verification (2.12).

### 2.12 Legal and practical limits

- **No official iMessage API.** Apple offers none; third-party iMessage
  clients (Beeper Mini, 2023) worked by reverse engineering and were shut
  out by Apple within weeks. Phoenix will not ship one.
- **No official WhatsApp client API.** The WhatsApp Business Platform is for
  businesses messaging customers, not for personal accounts. Bridges such as
  `mautrix-whatsapp` use the reverse-engineered multi-device protocol, which
  WhatsApp's terms do not allow and which can get an account banned. Phoenix
  can show such rooms (they are Matrix rooms), but must not bundle or promote
  the bridge. Signal likewise has no third-party client API; its bridge is a
  linked device built on Signal's own libraries (AGPL), with similar risks.
  Telegram does allow third-party clients with an API ID of your own.
- **OAuth client registration** is a project decision: a Google Cloud
  project and a Microsoft Entra app registration in the project's name, the
  consent screen, privacy policy and homepage they require, Google's
  verification for the Calendar and Contacts scopes and the yearly security
  assessment for Gmail's restricted scope (2.4). Client IDs are not secret
  for public clients, but abuse under the project's ID can get it
  suspended; builds should be able to use their own.
- **Rate limits and quotas**: Google's APIs have per-project and per-user
  quotas (one project's quota is shared by every Phoenix user unless builds
  use their own); Graph throttles with 429 and `Retry-After`; iCloud and
  other DAV servers throttle aggressive clients. Transports should sync on
  schedules of 15 minutes or more, use sync tokens rather than full
  listings, back off exponentially on 429 / 503, and sync when the user asks.
- **App passwords** are what makes phase 1 work without OAuth; providers
  can withdraw them (Google has been restricting "less secure" access for
  years), which is one more reason for phase 2.
- **Exchange ActiveSync** needs a patent licence from Microsoft; it is out of
  scope. EWS, the other Exchange protocol, is switched off in Exchange
  Online between October 2026 and April 2027
  ([SYNERGY-MODERN.md](SYNERGY-MODERN.md#13-microsoft-365-outlookcom-and-the-end-of-ews)).

## 3. Phase 1: CardDAV and CalDAV

### 3.1 What is where

| Path | What |
| --- | --- |
| `apps/dav/public/accounts/com.webosphoenix.dav/com.webosphoenix.dav.json` | The account template, installed at `/usr/palm/public/accounts/com.webosphoenix.dav/`: CONTACTS (`dbkinds.contact` `com.palm.contact.dav:1`) and CALENDAR (`com.palm.calendar.dav:1`, `com.palm.calendarevent.dav:1`), both with `onCreate`, `onEnabled`, `onDelete`, `onCredentialsChanged` and `sync` on `org.webosphoenix.service.dav`; validator `checkCredentials` with a customUI |
| `apps/dav/accounts/` | The customUI: a sign-in page with server, user name and app password (Enyo 1.0, laid out like the accounts library's own), in the hidden app `org.webosphoenix.dav` |
| `apps/dav/configuration/db/` | db8 kinds and permissions (installed to `/etc/palm/db`) |
| `apps/dav/service/davservice.js` | The transport's methods: `checkCredentials`, `onCreate`, `onEnabled`, `onCredentialsChanged`, `onDelete`, `sync`, `accountSettings` |
| `apps/dav/service/service.js` | The Luna service on a device (`webos-service`) |
| `apps/dav/service/lib/` | The sync engine: `davclient.js` (discovery, sync-collection, ctag/etag, multiget, conditional writes), `sync.js` (two-way sync), `webcal.js`, `xml.js`; the mapping (`vcard.js`, `ical.js`), `linker.js` (persons), `contentline.js`, `datetime.js` and `node-http.js` moved to `apps/shared/synckit/src/` (`@phoenix/synckit`, SYNERGY-CONNECTORS.md C1). Plain CommonJS, so the same files run in Node and in the simulator's page |
| `apps/dav/service/sysbus/` | luna-service2 role, permissions, groups, service file |
| `runtime/phoenix-runtime.js`, last block | The simulator's side (3.6) |
| `tools/serve-rootfs.py` | `POST /__phoenix/proxy` for the simulator's HTTP |

### 3.2 Mapping

**vCard (3.0 and 4.0 written; 2.1 read) and `com.palm.contact:1`**, with the
contacts framework's type names (`third_party/loadable-frameworks/contacts/javascript/vCard/VCard.js`
and the `TYPE` constants in `javascript/properties/`):

| vCard | Contact |
| --- | --- |
| `N` (family; given; middle; prefix; suffix), `FN` when there is no `N` | `name` |
| `NICKNAME` | `nickname` |
| `TEL;TYPE=CELL / HOME / WORK / FAX / PAGER / MAIN / CAR`, `PREF` | `phoneNumbers[]` `type_mobile`, `type_home`, `type_work`, `type_personal_fax` / `type_work_fax`, `type_pager`, `type_main`, `type_car`, `type_other`; `primary` |
| `EMAIL;TYPE=HOME / WORK` | `emails[]` `type_home` / `type_work` / `type_other` |
| `ADR` (PO box, extended and street joined by new lines) | `addresses[]` `streetAddress`, `locality`, `region`, `postalCode`, `country` |
| `ORG`, `TITLE` | `organizations[0]` `name`, `department`, `title` |
| `URL`, `IMPP` and `X-AIM` / `X-JABBER` / ... | `urls[]`, `ims[]` (`type_jabber`, `type_skype`, ...) |
| `BDAY`, `ANNIVERSARY` / `X-ANNIVERSARY` (`--MMDD` and Apple's omitted year as `0000-MM-DD`) | `birthday`, `anniversary` (`yyyy-mm-dd`) |
| `NOTE` | `note` |
| `PHOTO` (base64 in 2.1/3.0, `data:` URI in 4.0, or a URL) | `photos[0]` `{type: "type_big", value, localPath}` |

A card for a company only (`ORG`, no name) keeps an empty name, as the
Contacts app does for companies.

**iCalendar VEVENT and `com.palm.calendarevent:1`**, with the Calendar app's
field formats (`third_party/loadable-frameworks/calendar.io/javascript/import.js`
lines 72-288 for the names; `import_rrule.js`, `transform_rrule.js` for rules):

| iCalendar | Event |
| --- | --- |
| `DTSTART`, `DTEND` / `DURATION` with `TZID` | `dtstart`, `dtend` (ms, UTC), `tzId` (IANA). IANA names through the Intl API; Outlook's Windows zone names mapped for the common zones; other `TZID`s through the resource's `VTIMEZONE` (yearly `BYMONTH`/`BYDAY` rules); `Z` times get `tzId` `"UTC"` as the legacy importer did; floating times the device's zone |
| `VALUE=DATE` | `allDay`, from local midnight to 23:59:59 of the last day (the exclusive `DTEND` minus one second), as the Calendar app saves all-day events |
| `RRULE` | `rrule {freq, interval, count, until, wkst, rules: [{ruleType: "BYDAY", ruleValue: [{day, ord}]}, {ruleType: "BYMONTHDAY", ruleValue: [{ord}]}, ...]}` |
| `EXDATE` | `exdates[]`, `"yyyyMMddTHHmmssZ"` |
| override `VEVENT` with `RECURRENCE-ID` | a child event (`parentId`, `recurrenceId`), and its date in the parent's `exdates` |
| `SUMMARY`, `LOCATION`, `DESCRIPTION` | `subject`, `location`, `note` |
| `VALARM` `TRIGGER` (duration, `RELATED=END`, or date-time) | `alarm[] {action, alarmTrigger: {value, valueType: "DURATION" / "DATETIME", related}}` |
| `ORGANIZER`, `ATTENDEE` | `attendees[] {email, commonName, organizer, role, participationStatus}` |
| `TRANSP`, `CLASS`, `STATUS`, `URL`, `CATEGORIES`, `SEQUENCE` | same-named fields |

Written back: all-day events as `DATE` values, timed events with their IANA
`TZID` but no `VTIMEZONE` (RFC 7809 lets servers advertise that they accept
this; in practice common servers do, Radicale included; generating
`VTIMEZONE`s is a later improvement) or in UTC, overrides as `RECURRENCE-ID` components and not also as `EXDATE`s.

**Round trips keep what is not mapped.** An edit on the device is written
over the server's last copy of the resource, replacing only the properties
above: categories, custom labels, `X-` properties, `GENDER`, attendees of
existing events, `VTIMEZONE`s and `VTODO`s in the same resource stay as the
server had them.

### 3.3 Sync and conflicts

`lib/sync.js`, per collection: **pull, push, pull**.

1. **Pull**: changes since the last sync, by `sync-collection` and the
   stored token; without RFC 6578 support (or when the server rejects the
   token), by listing every resource's etag, skipped entirely when the
   collection's ctag has not moved. Fetched with multiget and written to db8.
2. **Push**: the device's changes. Each server resource has an item record
   (`org.webosphoenix.dav.item:1`) with its href, etag, the server's last copy
   and the `_rev` of the db8 object(s) it maps to as last synced. An object
   whose `_rev` differs was edited; an object of the account without an item
   is new (it goes to the account's first address book, or to its own
   calendar); an item whose object is gone or `_del` was deleted. New
   resources are `PUT` with `If-None-Match: *`, edits with `If-Match: <etag>`,
   deletions `DELETE` with `If-Match`.
3. **Pull again**: stores the new token or ctag and picks up whatever changed
   on the server meanwhile; the device's own uploads come back with the etag
   it already has and are skipped.

**Conflicts: the server wins.** If a resource changed both on the server and
on the device since the last sync, step 1 applies the server's copy and the
device's edit is dropped. If an upload is refused because the etag no longer
matches (HTTP 412, someone changed it between steps 1 and 2), the server's
copy is fetched and replaces the device's. A refused `DELETE` brings the
server's copy back; a resource deleted on the server is deleted on the device
even if it was edited there. Every such case is counted (`conflicts` in the
sync result) and logged. There is no field-by-field merge: the server is the
copy other devices see, and a sync that silently mixed two edits would be
worse than one that loses the device's. (A later version could keep the
losing copy as a note, or merge fields that did not both change, using the
item's stored base copy.)

A recurring event and its edited occurrences are one resource: a change to
any of them uploads the whole resource.

**Persons.** After a sync, `lib/linker.js` updates `com.palm.person:1` for
the contacts that changed, with the linker's strongest rules (same email,
same mobile number, same given and family name; section 1.5), so a DAV
contact with the email of a local contact joins that person. This stands in
for the real linker, which does not run on OSE or in the simulator yet
(`linkPersons: false` hands the job back to it).

**Status**: `com.palm.account.syncstate:1` in tempdb for each capability
(`INCREMENTAL_SYNC`, `IDLE`, `ERROR` with `401_UNAUTHORIZED` and friends), so
the Accounts app marks an account whose password stopped working.

### 3.4 The transport's calls

| Call | From | Does |
| --- | --- | --- |
| `checkCredentials {username, password, config: {serverUrl}, accountId?}` | the sign-in page (the template's validator) | Discovery; answers `{credentials: {common: {password, serverUrl}}, config: {serverUrl, principalUrl, addressbooks, calendars}}` or an error code |
| `onCreate {accountId, config}` | accounts service | Stores the server record (`org.webosphoenix.dav.account:1`) |
| `onEnabled {accountId, capabilityProviderId, enabled}` | accounts service | On: schedules the periodic sync (activity, 1 hour, needs internet) and starts a sync of that capability. Off: removes the capability's data |
| `onCredentialsChanged {accountId}` | accounts service | Syncs with the new password |
| `onDelete {accountId}` | accounts service | Removes everything, cancels the activity |
| `sync {accountId, capability?}` | "Sync now" in Contacts and Calendar, the periodic activity | One sync at a time per account; answers the counts (`contactsChanged`, `eventsChanged`, `uploaded`, `conflicts`, ...) |
| `accountSettings {accountId}` | the sign-in page, to change a password | The server address |

### 3.5 On a device

`tools/install-rootfs.py` installs the service to
`/usr/palm/services/org.webosphoenix.service.dav` and its luna-service2 files,
the kinds to `/etc/palm/db`, the template to `/usr/palm/public/accounts`, and
the hidden app with the sign-in page; `meta-phoenix`'s `phoenix-apps` recipe
ships them. It has not run on a device yet: it needs phase 0 (the accounts
service and a key store on OSE), and the ACG group names in
`sysbus/*.perm.json` and the activity manager calls need checking against
OSE. Contact photos are written to `/media/internal/.phoenix/dav-photos` and
referenced by path.

### 3.6 In the simulator

The last block of `runtime/phoenix-runtime.js` loads `davservice.js` and
`lib/` from `/usr/palm/applications/org.webosphoenix.dav/service/` into the
page and registers `org.webosphoenix.service.dav` on the simulated bus with
the device's code. It adds the template to the simulated accounts service,
calls the transport's callbacks as the real accounts service does (1.3),
runs "Sync now" activities, and teaches db8 the new kinds. HTTP goes through
a proxy of the host, since DAV servers do not allow cross-origin requests:
`tools/serve-rootfs.py`'s `POST /__phoenix/proxy` when the page is served
over HTTP (the browser dev server and the tests), phoenix-sim's
`GET /__phoenix/proxy?req=...` (its `phoenix://` scheme handler, on Qt
Network) in the simulator. Any server works; none needs CORS headers.

To try it: `pip install radicale`, run it with a user (recent versions refuse
every login until an `[auth]` type is set; `apps/dav/service/test/radicale.cjs`
writes such a configuration), start `tools/serve-rootfs.py`, open Accounts,
*Add an Account*, *CardDAV & CalDAV*, and enter `http://127.0.0.1:5232`.

### 3.7 Tests

- `apps/dav/service/mapping.test.ts` (vitest): vCard 2.1 / 3.0 / 4.0 and
  iCalendar to db8 objects and back, time zones, rules, alarms, overrides,
  what round trips keep, line folding; the XML reader.
- `apps/dav/service/sync.test.ts` (vitest, needs Radicale): the device
  service against a real Radicale with db8 and the accounts service in
  memory: discovery and the validator's error codes, the first sync, uploads
  of edits, new and deleted contacts and events, an edited occurrence of a
  recurring event, server edits and deletions, both "server wins" cases (a
  change on both sides; a 412 between pull and push), a sync with nothing
  to do, capability off and account deletion, and a server without
  `sync-collection`.
- `tools/test-dav-sync.cjs` (Playwright, needs Radicale): the simulator end
  to end. Adds the account in the original Accounts app through the sign-in
  page (a wrong password is refused first), checks db8 against the server and
  that Contacts and Calendar show the data, that a contact with the email of
  a sample contact is linked to that person, syncs device changes up and
  server changes down through "Sync now" activities, compares db8 with the
  server, and deletes the account.

CI installs Radicale and runs all three.
