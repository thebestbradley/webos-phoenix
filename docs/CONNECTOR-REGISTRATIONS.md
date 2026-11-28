# Connector registrations: the owner's sheet

What the owner registers with each provider so that the Synergy
connectors' sign-ins work, in the launch order (C1 to C10), with the
exact values the code uses. Audited against the code on 28 November 2026
(`origin/main` 90664332). The background, per provider, is
[DEVELOPER-APPS.md](DEVELOPER-APPS.md); what each connector does is
[SYNERGY-CONNECTORS.md](SYNERGY-CONNECTORS.md) 8. No secret goes in this
file, on the board or in the repository: client ids are public, client
secrets go only into the image's setting file (below) from the owner's
password manager.

## Before any provider

1. **The public domain** (OPEN-QUESTIONS Q1). Google's consent screen,
   Microsoft's publisher verification, Dropbox's production review and
   Bluesky's client id all name a homepage and a privacy policy on a
   domain Phoenix owns. The code uses `webosphoenix.org` as a
   placeholder (`apps/connectors/bluesky/oauth/client-metadata.json`).
   Have the domain, the homepage and a privacy policy page up first.
2. **One Phoenix project account** per provider (Q16, Q17), not a
   personal account. Turn on two-step sign-in on each.
3. **Where the ids go.** Each connector reads one JSON file,
   `/etc/palm/<name>/clients.json`, through `ctx.systemConfig`
   (`apps/shared/connector-kit/src/device.ts:84`, `registered.ts:57`;
   the drives their own copy, `apps/connectors/drives/service/connector.js:99`).
   No build setting or recipe installs these files yet (Q76: nothing in
   `meta-phoenix` writes them), nor does `servers.json` carry them, and
   no token relay serves them. So, today:
   - **Image:** put the file in place by hand (mode 0644), or add a
     recipe that installs it from a file outside the repository.
   - **Simulator:** in a page's devtools,
     `localStorage.setItem("phoenix:systemConfig:<name>/clients.json", JSON.stringify({...}))`
     (`runtime/phoenix-runtime.js:14093`). Turn on the Sign In card
     first (`__phoenixRuntime.oauthUseCard(true)`): the default
     browser sheet redirects to the simulator's own
     `.../org.webosphoenix.sharesheet/signed-in.html`, which no provider
     registration below names; the card uses the device's loopback
     address (`phoenix-runtime.js:13813-13822, 13961`).
4. **The redirect a device uses** (`services/oauth/device.js:41, 69-70`,
   `loopback.js:30-31`): the OAuth service's loopback listener, `http`,
   host `127.0.0.1` (never `localhost`), path `/oauth/callback`, open
   only while a sign-in waits. Two forms:
   - `http://127.0.0.1/oauth/callback`: an ephemeral port per sign-in
     (`http://127.0.0.1:<port>/oauth/callback`), for providers that
     ignore the port of a loopback redirect. Used by Microsoft, Google,
     OneDrive, Google Drive, Todoist, Zoom and LinkedIn
     (`kit.oauthSignIn`, `registered.ts:110`).
   - `http://127.0.0.1:47613/oauth/callback`: the fixed port, for
     providers that match the redirect exactly. Used by Dropbox and Box
     (`drives/service/connector.js:69-74, 442`).
   A `redirectUri` in a connector's `clients.json` overrides both, and
   the device listens on that address's port (`device.js:57-61`): that
   is how a provider that matches exactly is given the fixed port
   without a code change (Todoist, LinkedIn below).
5. **One file can serve two connectors.** Microsoft's registration goes in
   `microsoft/clients.json` (key `microsoft`) and in `drives/clients.json`
   (key `onedrive`); Google's in `google/clients.json` (key `google`) and
   `drives/clients.json` (key `googledrive`). Same client id in both.

## C1. Microsoft (Outlook.com and Microsoft 365: contacts, calendars, To Do; OneDrive)

| | |
| --- | --- |
| Console | https://entra.microsoft.com, Identity, Applications, App registrations |
| App type | Public client (Mobile and desktop applications), PKCE, **no secret** |
| Supported accounts | Any organizational directory and personal Microsoft accounts (the code uses the `common` endpoints, `microsoft/service/lib/msgraph.js:32-33`, `drives/service/lib/graph.js:191-192`) |
| Redirect URI | `http://127.0.0.1/oauth/callback` (Entra ignores the port of a loopback redirect; the path must match) |
| Scopes, Microsoft connector | `offline_access openid profile User.Read Contacts.ReadWrite Calendars.ReadWrite Tasks.ReadWrite` (`msgraph.js:30`), with `prompt=select_account` |
| Scopes, OneDrive | `offline_access User.Read Files.ReadWrite` (`drives/service/lib/graph.js:193`) |
| Gates | None for personal accounts. Work and school accounts: most tenants refuse user consent to a multi-tenant app without a **verified publisher** (a Microsoft AI Cloud Partner Program id and a verified domain); some need their admin's consent anyway |
| Secret | No |

1. Sign in to https://entra.microsoft.com with the Phoenix project account.
2. Identity, Applications, App registrations, **New registration**.
3. Name: `webOS Phoenix`.
4. Supported account types: **Accounts in any organizational directory
   (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft
   accounts (e.g. Skype, Xbox)**.
5. Redirect URI: leave empty for now. **Register**.
6. Copy the **Application (client) ID** from Overview: this is `clientId`.
7. Authentication, **Add a platform**, **Mobile and desktop
   applications**, custom redirect URI `http://localhost`, Configure
   (the form takes `localhost`; the next step adds `127.0.0.1`).
8. Manifest: in `replyUrlsWithType` add
   `{"url": "http://127.0.0.1/oauth/callback", "type": "InstalledClient"}`,
   then remove the `http://localhost` entry. Save.
9. Authentication, Advanced settings, **Allow public client flows: Yes**.
   Save.
10. API permissions, Add a permission, Microsoft Graph, **Delegated**:
    `User.Read` (there already), `offline_access`, `openid`, `profile`,
    `Contacts.ReadWrite`, `Calendars.ReadWrite`, `Tasks.ReadWrite`,
    `Files.ReadWrite`. Do not grant admin consent (users consent for
    themselves).
11. Branding & properties: name, logo, homepage, terms and privacy
    addresses on Phoenix's domain. Publisher domain: Phoenix's domain
    (verified with the file Entra gives).
12. Later, for work accounts: Branding & properties, **Add MPN ID to
    verify publisher** (needs a Partner Program account).
13. The setting:
    - `microsoft/clients.json`: `{"microsoft": {"clientId": "<Application (client) ID>"}}`
    - `drives/clients.json`: `"onedrive": {"clientId": "<the same id>"}`

Outlook **mail** is not asked for (C8). No scope in this list needs
publisher verification for personal accounts.

## C2. Google Calendar, Contacts and Tasks

| | |
| --- | --- |
| Console | https://console.cloud.google.com |
| App type | OAuth client of type **Desktop app**, PKCE. Its "client secret" is required at the token endpoint but is not secret for installed apps (Google's word) |
| Redirect URI | Nothing to register: Desktop clients accept `http://127.0.0.1:<any port>` |
| Scopes | `openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/contacts https://www.googleapis.com/auth/tasks` (`google/service/lib/google.js:38`), with `access_type=offline` and `prompt=consent select_account` |
| APIs to enable | Google Calendar API, People API, Google Tasks API |
| Gates | All three are **sensitive** scopes: until Google verifies the app, at most 100 users, each shown "Google hasn't verified this app". Verification: verified domain, homepage, privacy policy, a demo video of each scope in use, a written reason per scope. No security assessment (that is for restricted scopes) |
| Secret | Yes, the Desktop client's, in `google/clients.json` on the device (`registered.ts:116`; public, as Google allows) |

1. https://console.cloud.google.com, the project picker, **New project**:
   `webos-phoenix`.
2. APIs & Services, Library: enable **Google Calendar API**, **People
   API**, **Google Tasks API** (and **Google Drive API** for C3).
3. Google Auth Platform (OAuth consent screen), Get started: App name
   `webOS Phoenix`, support email, audience **External**, contact email.
   Create.
4. Branding: logo, homepage `https://<domain>/`, privacy policy
   `https://<domain>/privacy`, terms, authorized domain `<domain>`
   (verify it in Google Search Console with the same account).
5. Data access, Add or remove scopes: `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile`, `https://www.googleapis.com/auth/calendar`,
   `https://www.googleapis.com/auth/contacts`,
   `https://www.googleapis.com/auth/tasks`, and for C3
   `https://www.googleapis.com/auth/drive.file`. Save.
6. Audience: add your own and the testers' Google accounts as **test
   users** (up to 100) while in Testing.
7. Clients, **Create client**, Application type **Desktop app**, name
   `webOS Phoenix`. Create; copy the **Client ID** and the **Client
   secret** (into the password manager).
8. The setting, `google/clients.json`:
   `{"google": {"clientId": "<client id>", "clientSecret": "<client secret>"}}`.
9. When the screens and the privacy policy are final: Audience, **Publish
   app**, then Verification Center, submit (the video shows sign-in,
   Calendar, Contacts and Tasks syncing on a device or the simulator).

## C3. Google Drive

The same project and Desktop client as C2.

| | |
| --- | --- |
| Scopes | `https://www.googleapis.com/auth/drive.file` (default, **non-sensitive**: brand verification only) and `https://www.googleapis.com/auth/drive` (full Drive, **restricted**) (`drives/service/lib/gdrive.js:309-310`), with `access_type=offline`, `prompt=consent` |
| API | Google Drive API |
| Gates | `drive.file`: none beyond brand verification. `drive`: Google's restricted-scope verification **and a yearly third-party security assessment (CASA)**, paid to the assessor; until passed, at most 100 users |
| Secret | Yes, the same Desktop client secret, in `drives/clients.json` |

**The owner's decision (28 November 2026): both scopes are offered and
the user picks**, `drive.file` now, full Drive as an option. Where the
code disagrees: today the drives' connector picks the scope from the
image's setting, for every user at once (`"scope": "drive"` in
`drives/clients.json`, `drives/service/connector.js:106-107`); the
sign-in page offers no choice. A follow-up change is needed for the user
to pick (the sign-in page asking which, the connector taking it per
sign-in). Until Google has passed the restricted verification, full Drive
works only for the project's test users.

1. In the C2 project, APIs & Services, Library: enable **Google Drive API**.
2. Data access: add `https://www.googleapis.com/auth/drive.file` (C2
   step 5). Add `https://www.googleapis.com/auth/drive` too, but submit
   it for verification separately once the CASA assessment is funded:
   a restricted scope in the submission holds up C2's sensitive-scope
   review until the assessment is done.
3. The setting, `drives/clients.json`:
   `"googledrive": {"clientId": "<C2 client id>", "clientSecret": "<C2 client secret>"}`
   (add `"scope": "drive"` only for a build whose every user gets full
   Drive, until the per-user choice exists).

## C4. Gmail in Email

**The owner's decision (28 November 2026): an app password now, Google
sign-in (XOAUTH2) after.** Nothing to register for the app password.

- **What exists.** The original Email's account wizard knows Gmail:
  `imap.gmail.com:993` SSL, `smtp.gmail.com:465` SSL
  (`third_party/core-apps/com.palm.app.email/accounts/source/AccountWizard.js:1720-1721`),
  and a device's mail transports are mojomail's (`mojomail-imap`,
  `-smtp`, from LuneOS: `meta-phoenix/recipes-core/packagegroups/packagegroup-webos-extended.bbappend:38-43`),
  which sign in with a password over TLS. The user makes the password at
  https://myaccount.google.com/apppasswords (two-step verification on)
  and types it as the password.
- **Not verified.** The simulator has no mail server (its transports are
  simulated, `runtime/phoenix-runtime.js:5076-5100`), so no test reaches
  Gmail; mojomail against Gmail has not been run on a device image. The
  wizard's `GOOGLE` type for Gmail (`AccountWizard.js:1655`) is not one of
  the `IMAP`/`POP` types its validation checks for by name (`:1268-1276`):
  that the validation succeeds for it needs a device run (local).
- **XOAUTH2 later.** Scope `https://mail.google.com/` (**restricted**:
  restricted-scope verification and the yearly CASA assessment, as full
  Drive; one assessment can cover both). Code: an `AUTHENTICATE XOAUTH2`
  command in mojomail's IMAP and `AUTH XOAUTH2` in its SMTP (SYNERGY.md
  2.6), the token from the OAuth service, and the account wizard offering
  Sign in with Google (a compat overlay). Mojomail is LuneOS's C++
  (a patch in a `meta-phoenix` bbappend), or a Phoenix Node transport in
  its place: about 2 to 3 weeks either way, device testing included.

## C5. Dropbox

| | |
| --- | --- |
| Console | https://www.dropbox.com/developers/apps |
| App type | Scoped access, **Full Dropbox**; public client with PKCE, **no secret** |
| Redirect URI | `http://127.0.0.1:47613/oauth/callback` (Dropbox matches exactly, port included) |
| Scopes | `account_info.read files.metadata.read files.content.read files.content.write` (`drives/service/lib/dropbox.js:195`), with `token_access_type=offline` |
| Gates | Development status: up to 500 users can link; once 50 have, Dropbox asks for production approval within two weeks. Production review: branding, how the scopes are used |
| Secret | No |

1. https://www.dropbox.com/developers/apps, **Create app**.
2. **Scoped access**, **Full Dropbox**, name `webOS Phoenix` (Dropbox may
   refuse names with its own; a variant is fine). Create app.
3. Settings: copy the **App key**: this is `clientId`. Ignore the App
   secret.
4. Settings, OAuth 2, Redirect URIs: add
   `http://127.0.0.1:47613/oauth/callback`. Allow public clients
   (Implicit Grant & PKCE): **Allow**.
5. Permissions: tick `account_info.read`, `files.metadata.read`,
   `files.content.read`, `files.content.write`. **Submit**.
6. Branding: icon, publisher, website.
7. The setting, `drives/clients.json`: `"dropbox": {"clientId": "<App key>"}`.
8. Before 50 users: Settings, Production status, **Apply for production**.

## C6. Box

| | |
| --- | --- |
| Console | https://app.box.com/developers/console |
| App type | **Custom App**, User Authentication (OAuth 2.0). Box's token endpoint asks for the client secret even with PKCE |
| Redirect URI | `http://127.0.0.1:47613/oauth/callback` (exact match, port included) |
| Scopes | `root_readwrite` ("Read and write all files and folders stored in Box", `drives/service/lib/box.js:261`) |
| Gates | None for personal accounts; an enterprise whose admin turned off unpublished apps must enable it. Listing in the Box Integrations directory is optional |
| Secret | **Yes.** The code takes `clientSecret` from `drives/clients.json` (`drives/service/connector.js:443`), readable on the image; the alternative, the token relay, does not exist yet (Q78, below) |

1. https://app.box.com/developers/console, **Create New App**,
   **Custom App**, **User Authentication (OAuth 2.0)**, name `webOS Phoenix`.
2. Configuration: copy the **Client ID**; the **Client Secret** to the
   password manager.
3. OAuth 2.0 Redirect URIs: `http://127.0.0.1:47613/oauth/callback`.
4. Application Scopes: **Read and write all files and folders stored in Box**.
   Save Changes.
5. The setting, `drives/clients.json`:
   `"box": {"clientId": "<client id>", "clientSecret": "<client secret>"}`
   (or decide Q78: the secret through a relay instead).

## C7. iCloud (contacts, calendars, mail with an app-specific password)

Nothing to register: the user makes an app-specific password at
https://account.apple.com (Sign-In and Security, App-Specific Passwords;
two-factor on).

- **What exists.** The CardDAV and CalDAV account (`apps/dav`,
  `org.webosphoenix.service.dav`) signs in to any server with an app
  password and finds the collections by RFC 6764 well-known addresses
  (`apps/dav/service/lib/davclient.js:146-167`). Email's wizard has the old
  `me.com`/`mac.com` presets (`mail.me.com`, `smtp.me.com`,
  `AccountWizard.js:1727-1728`), none for `icloud.com`.
- **Missing.** An iCloud preset: iCloud keeps contacts and calendars on
  two hosts (`contacts.icloud.com`, `caldav.icloud.com`), and the DAV
  account has one `serverUrl` (`apps/dav/service/davservice.js:129-143`),
  so one account cannot reach both today. Needed: a template
  (`com.webosphoenix.icloud`) or a preset in the DAV wizard with both
  hosts and no server field, the DAV account taking one server per
  service, the help text with Apple's link, and Email's presets for
  `icloud.com`, `me.com`, `mac.com` as `imap.mail.me.com:993` SSL and
  `smtp.mail.me.com:587` STARTTLS (a compat overlay of `AccountWizard.js`).
  Tests: a stand-in with the two hosts (Radicale behind two origins).
- **Size:** about 2 to 3 days; the mail half needs a device run.

## C8. Outlook mail (IMAP and SMTP with XOAUTH2)

Registration: the C1 Entra app, with two more delegated permissions
**on Office 365 Exchange Online** (APIs my organization uses, search
"Office 365 Exchange Online"; for personal accounts the scopes are
requested as `https://outlook.office.com/...`):
`IMAP.AccessAsUser.All`, `SMTP.Send` (with `offline_access`). Same
redirect, no secret.

- **What exists.** Nothing for mail on the Microsoft account
  (`microsoft/service/connector.js:28`: no mail scope; Q124). Email's wizard
  sends `hotmail.com`, `live.com`, `msn.com` to `pop3.live.com` with a
  password (`AccountWizard.js:1722-1724`), which Outlook.com refuses
  since basic authentication was turned off (16 September 2024).
- **Missing.** XOAUTH2 in mojomail's IMAP and SMTP (shared with C4),
  presets for `outlook.com`/`hotmail.com`/`live.com` as
  `outlook.office365.com:993` and `smtp-mail.outlook.com:587`, the wizard's
  Sign in with Microsoft, and a token for the Outlook resource: Entra issues
  a token per resource, so the Graph token of C1 cannot be used for IMAP;
  the OAuth service has to redeem the refresh token again with the
  `outlook.office.com` scopes.
- **Size:** about 1 to 2 weeks after C4's XOAUTH2 work (which it
  shares), device testing included. A Graph mail connector instead
  (SYNERGY.md 2.5's long-term choice) is 3 weeks or more.

## C9. Nothing to register (to verify)

| Account | Signs in with | Today |
| --- | --- | --- |
| Todoist | The personal API token (Settings, Integrations, Developer) | Works. Sign In with Todoist, optional, below |
| Bluesky | Handle and app password (direct messages allowed) | Works. Sign In with Bluesky, below |
| Nextcloud, ownCloud, WebDAV | Nextcloud's Login Flow v2, or an app password | Works |
| SFTP | Password or a key made on the device | Works |
| S3 (B2, Wasabi, AWS, MinIO) | Access key and secret | Works |
| XMPP, Matrix, Delta Chat | The user's own server account | Works |

**Todoist's OAuth (optional).** Console
https://app.todoist.com/app/settings/integrations/app-management, Create
a new app. Scope `data:read_write,data:delete`
(`todoist/service/lib/todoist.js:45`). Todoist takes one redirect URL per
app and its token exchange needs the **client secret** (Q123). The
connector asks for the ephemeral loopback address, which an exact match
refuses: register `http://127.0.0.1:47613/oauth/callback` and put it in
the setting, `todoist/clients.json`:
`{"todoist": {"clientId": "...", "clientSecret": "...", "redirectUri": "http://127.0.0.1:47613/oauth/callback"}}`.
Whether Todoist takes an `http` loopback address: check in its console.

**Bluesky's OAuth (optional).** Nothing to register with Bluesky: host
`apps/connectors/bluesky/oauth/client-metadata.json` at
`https://<domain>/oauth/bluesky/client-metadata.json` (its `client_id`
must be that address; Q120), and `bluesky/clients.json`
`{"bluesky": {"clientId": "<that address>", "redirectUri": "org.webosphoenix:/oauth/bluesky"}}`.
Still not enough: the OAuth service has no `sheet` method
(`services/oauth/oauthservice.js:107`), which the connector probes
(`bluesky/service/connector.js:79`; Q121), and its loopback listener
cannot receive the custom-scheme redirect: the card must stop at it.

## C10. Later: Slack, Zoom, LinkedIn

All three need the client secret in the token exchange, so their
redirect is the **token relay's callback** on Phoenix's server
(PLATFORM.md 6.5.4, Q49). **The relay does not exist yet**, on either
side: Phoenix-Web-Services has no `/v1/oauth-broker/` route (its
`routes/api.php` and `web.php` on `main`, read 28 November 2026), the
OAuth service has no `broker` method (`oauthservice.js:107`), and the
kit's `viaRelay` probes for it (`registered.ts:91-96`) while the accounts
service has a separate `tokenRelay` client of the same server API
(`services/account/accountservice.js:592-620`) that nothing calls. Until
one design is built end to end, register these only to reserve the names.

| | Slack | Zoom | LinkedIn |
| --- | --- | --- | --- |
| Console | https://api.slack.com/apps, Create New App, From scratch | https://marketplace.zoom.us, Develop, Build App, General App, user-managed | https://www.linkedin.com/developers/apps, Create app (names a LinkedIn Page) |
| Products | OAuth & Permissions; Manage Distribution | - | Sign In with LinkedIn using OpenID Connect; Share on LinkedIn |
| Redirect | `https://<api host>/v1/oauth-broker/slack/callback` (Slack takes HTTPS only) | `https://<api host>/v1/oauth-broker/zoom/callback`, in the redirect and the allow list | `https://<api host>/v1/oauth-broker/linkedin/callback` |
| Scopes | User token scopes: `channels:history groups:history im:history mpim:history channels:read groups:read im:read mpim:read users:read users:read.email chat:write` (`slack/service/connector.js:49`) | `user:read:user meeting:read:list_meetings meeting:read:meeting meeting:write:meeting` (`zoom/service/connector.js:48`) | `openid profile email w_member_social` (`linkedin/service/connector.js:46`) |
| Gates | Distribution on to sign in outside the developer's workspace; workspace admins may have to approve; the Slack Marketplace review lifts the 2025 history limit (`"marketplace": true` once listed) | Zoom's app review and publishing before users outside the developer's account | The Page admin verifies the app; both products self-serve |
| Secret | Yes, on the relay only (Slack's answer puts the user token in `authed_user`, which the OAuth service does not read: relay only) | Yes; Zoom wants it by HTTP Basic, which the OAuth service does not send (Q122): relay only in practice | Yes; a `clientSecret` in `linkedin/clients.json` works without the relay (LinkedIn takes it in the form), with `"redirectUri": "http://127.0.0.1:47613/oauth/callback"` registered, since LinkedIn matches exactly |

## Summary

| | App type | Redirect to register | Secret | Gate before the public |
| --- | --- | --- | --- | --- |
| C1 Microsoft + OneDrive | Entra public client | `http://127.0.0.1/oauth/callback` | No | Publisher verification for work accounts |
| C2 Google PIM | Google Desktop app | none | Yes (not secret) | Sensitive-scope verification, 100 users until |
| C3 Google Drive | the same | none | Yes (the same) | `drive.file` none; `drive` restricted + CASA yearly |
| C4 Gmail | app password now | - | - | XOAUTH2: restricted + CASA |
| C5 Dropbox | Scoped, Full Dropbox, PKCE | `http://127.0.0.1:47613/oauth/callback` | No | Production approval after 50 users |
| C6 Box | Custom App, OAuth 2.0 | `http://127.0.0.1:47613/oauth/callback` | Yes (Q78) | None for personal accounts |
| C7 iCloud | app-specific password | - | - | - |
| C8 Outlook mail | the C1 app + Exchange scopes | the C1 one | No | As C1 |
| C9 | nothing | - | - | - |
| C10 Slack, Zoom, LinkedIn | confidential | the relay's callback | Yes, on the relay | Marketplace review; Zoom app review; Page verification |
