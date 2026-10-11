# Developer apps Phoenix registers with providers

Some Synergy accounts sign in with the provider's OAuth, and OAuth needs an
app registered with the provider: its **client id**. Phoenix's are
registered by a Phoenix project account, not a person's own (the owner,
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) Q16, Q17), and kept **out of the
public tree**: an image gets them as a build-time setting, a developer's
simulator from their own registration. Without one, the account type says
"&lt;Provider&gt; is not available in this build" on its sign-in page, and
offers no Sign In (`errorCode` `NOT_AVAILABLE`, 14, from the connector).
How the ids are kept and which providers need a secret:
[PLATFORM.md](PLATFORM.md) 6.5.4.

This page is the checklist, provider by provider, for the drives (Files'
places: [SHARE-AND-FILES.md](SHARE-AND-FILES.md) "Drives") and for the
Synergy accounts built on the connector kit (Microsoft, Google, Todoist,
Bluesky, Zoom, LinkedIn, Slack: "The accounts" below; what each one does:
[SYNERGY-CONNECTORS.md](SYNERGY-CONNECTORS.md) 8). Telegram gets its row
when its connector is built.

## Where the ids go

`/etc/palm/drives/clients.json` on the image, read by the drives'
connector (`org.webosphoenix.drives`, `ctx.systemConfig("drives/clients.json")`):

```json
{
  "dropbox":     { "clientId": "..." },
  "onedrive":    { "clientId": "..." },
  "googledrive": { "clientId": "...", "clientSecret": "...", "scope": "drive.file" },
  "box":         { "clientId": "...", "clientSecret": "..." }
}
```

Optional per provider: `redirectUri` (the default is the OAuth service's:
`http://127.0.0.1/oauth/callback` on a device, RFC 8252 7.3; the
simulator's own `signed-in.html` page in the simulator), `scope` (Google
Drive only: `"drive"` turns on the full scope, below), and endpoint
addresses for a test server (`authorizationEndpoint`, `tokenEndpoint`,
`revocationEndpoint`, and `api` / `content` / `upload` / `graph`: what
`tools/test-drives.cjs` and the connector's tests use).

- **Image:** a `phoenix-drive-clients` setting of the build (a file outside
  the repository the recipe installs as that path, mode 0644: the ids are
  public, as every installed app's are). Not in the layer yet: the file
  is installed by hand until the first image with drives
  (OPEN-QUESTIONS Q76).
- **Simulator:** the same JSON in the simulator's store, key
  `phoenix:systemConfig:drives/clients.json` (in a page's devtools:
  `localStorage.setItem("phoenix:systemConfig:drives/clients.json",
  JSON.stringify({...}))`), which wins over a rootfs file.

A registration's redirect URI must be the one the sign-in uses. The sign-in
sheet watches for that address and stops there, so it never has to load.

## Per provider

Costs are what the provider asked when this was written (October 2026):
check the console. "Verification" is what the provider asks before anyone
outside the developer's own accounts can sign in.

### Dropbox

| | |
| --- | --- |
| Console | https://www.dropbox.com/developers/apps, Create app |
| App type | Scoped access, **Full Dropbox** (a place in Files is the whole Dropbox, not an app folder) |
| Client | Public: PKCE, no secret on the device |
| Redirect URI | `http://127.0.0.1/oauth/callback` (Dropbox takes `http` only for loopback addresses) |
| Scopes (Permissions tab, then Submit) | `account_info.read`, `files.metadata.read`, `files.content.read`, `files.content.write` |
| Tokens | `token_access_type=offline` (a refresh token; the connector asks for it) |
| Verification | A new app is in *development* status with a cap on linked users; apply for *production* in the console before release (Dropbox's review: branding, how the scopes are used) |
| Cost | Free |

### OneDrive (Microsoft Graph)

| | |
| --- | --- |
| Console | https://entra.microsoft.com, App registrations, New registration |
| Accounts | "Accounts in any organizational directory and personal Microsoft accounts" (OneDrive personal and work) |
| Platform | Mobile and desktop applications; "Allow public client flows": yes (no secret) |
| Redirect URI | `http://127.0.0.1/oauth/callback` (Entra matches loopback addresses on any port) |
| Scopes (delegated) | `Files.ReadWrite`, `User.Read`, `offline_access` |
| Verification | None to work; *publisher verification* (a Microsoft partner id) removes the "unverified" label on the consent page; work tenants may need their admin's consent |
| Cost | Free |

The same registration later serves Outlook and Teams (SYNERGY-CONNECTORS.md 7), with their scopes added.

### Google Drive

| | |
| --- | --- |
| Console | https://console.cloud.google.com, a project; APIs & Services: enable the **Google Drive API**; OAuth consent screen (External); Credentials, OAuth client ID, **Desktop app** |
| Client | Desktop: PKCE; its "client secret" is not secret (Google says so for installed apps) and ships in `clients.json` |
| Redirect URI | Desktop clients take loopback addresses without registering them |
| Scopes | `https://www.googleapis.com/auth/drive.file` (the default): the files Phoenix made or the user opened with it. **Non-sensitive**: no security assessment |
| Full drive (`"scope": "drive"`) | `https://www.googleapis.com/auth/drive` is **restricted**: Google's app verification plus a yearly third-party security assessment (CASA, paid to the assessor) before more than 100 test users can sign in. Off until it is funded and passed (OPEN-QUESTIONS Q77) |
| Verification | For `drive.file`: brand verification of the consent screen (homepage, privacy policy on the project's domain, verified in Search Console) |
| Cost | Free for `drive.file`; the CASA assessment for `drive` |

With `drive.file`, Files shows what Phoenix uploaded and what the user
picked with it, not the whole Drive: its sign-in page says so.

### Box

| | |
| --- | --- |
| Console | https://app.box.com/developers/console, Create New App, **Custom App**, User Authentication (OAuth 2.0) |
| Client | Box's token endpoint asks for the `client_secret` even with PKCE: it ships in `clients.json` (readable from an image) or goes through the token broker (PLATFORM.md 6.5.4; OPEN-QUESTIONS Q78) |
| Redirect URI | `http://127.0.0.1/oauth/callback` (Box takes `http` for loopback only) |
| Scopes | "Read and write all files and folders stored in Box" (`root_readwrite`) |
| Verification | None for personal accounts; an enterprise's admin may have to authorize the app for their users |
| Cost | Free |

### No registration needed

WebDAV (Nextcloud with Login Flow v2, ownCloud, any server) and
S3-compatible storage (Backblaze B2, MinIO, Wasabi, any) sign in with the
user's own app password or keys: nothing to register. SFTP is not offered
(SHARE-AND-FILES.md "Drives").

## The accounts

Each account's connector reads its own setting, `/etc/palm/<name>/clients.json`
(`ctx.systemConfig`; in the simulator the store key
`phoenix:systemConfig:<name>/clients.json`, or a file under
`compat/rootfs/etc/palm/`), with the same shape as the drives' file: the
provider's name, then `clientId` and what else it needs. Without it the
account type is still in Accounts and Connections, and its sign-in page
says "&lt;Provider&gt; is not available in this build"; Todoist and Bluesky
then offer their sign-ins that need no registration.

| Account | File | Needs | Works without it |
| --- | --- | --- | --- |
| Microsoft (Outlook.com, Microsoft 365) | `microsoft/clients.json` | `{"microsoft": {"clientId"}}`: the drives' OneDrive registration | nothing |
| Google | `google/clients.json` | `{"google": {"clientId", "clientSecret"}}`: the drives' Google project and Desktop client | nothing |
| Todoist | `todoist/clients.json` | `{"todoist": {"clientId", "clientSecret"}}` | the personal API token: everything |
| Bluesky | `bluesky/clients.json` | `{"bluesky": {"clientId": "https://webosphoenix.org/oauth/bluesky/client-metadata.json", "redirectUri": "org.webosphoenix:/oauth/bluesky"}}`, and the OAuth service lending its sheet (Q98) | an app password: everything |
| Zoom | `zoom/clients.json` | `{"zoom": {"clientId", "relay"}}` and the OAuth service's broker (Q49, Q99), or `clientSecret` | nothing |
| LinkedIn | `linkedin/clients.json` | `{"linkedin": {"clientId", "relay"}}` and the broker, or `clientSecret` | the Connections.csv import needs a signed-in account |
| Slack | `slack/clients.json` | `{"slack": {"clientId", "relay"}}` and the broker; `"marketplace": true` once listed | nothing |

Optional in each: `redirectUri` (the OAuth service's otherwise), `scope`,
and a test server's addresses (`authorizationEndpoint`, `tokenEndpoint`,
`revocationEndpoint`, and the API's: `graph`; `userinfo`, `calendar`,
`people`, `tasks`; `api`; Bluesky's `resolver`, `plc`, `wellKnown`).

**Trying them without registrations.** `node
apps/connectors/testing/fake-providers.cjs 8098` starts stand-ins for all
seven providers on one port (the same ones the connectors' tests and
`tools/test-connectors.cjs` use: their sign-in pages, token endpoints and
APIs, Bluesky's with real DPoP checks) and prints the `localStorage` lines
that point each connector at them, the Todoist token and the Bluesky
handle and app password; it then logs each request as it comes
(`FAKE_SHOW_AUTH=1` adds the Authorization header).

### Microsoft (Outlook.com, Microsoft 365)

| | |
| --- | --- |
| Console | The OneDrive registration above (https://entra.microsoft.com, App registrations) |
| Add | API permissions, Microsoft Graph, Delegated: `Contacts.ReadWrite`, `Calendars.ReadWrite`, `Tasks.ReadWrite` (with `User.Read`, `openid`, `profile`, `offline_access`) |
| Redirect URI | The same loopback address |
| Teams meetings | Their join addresses come with the events (`onlineMeeting.joinUrl`): no more scopes. Making a Teams meeting would need `OnlineMeetings.ReadWrite` (not used) |
| Mail | Not asked for: Outlook's mail in Email is still to come (SYNERGY.md 2.5; Graph's `Mail.ReadWrite`, `Mail.Send`, or `IMAP.AccessAsUser.All` and `SMTP.Send` on outlook.office.com for IMAP with XOAUTH2) |
| Verification | As OneDrive: none to work, publisher verification for the label; work tenants may need their admin's consent to the calendar and contacts scopes |
| Cost | Free |

### Google (Calendar, Contacts, Tasks)

| | |
| --- | --- |
| Console | The Google Drive project above; APIs & Services, Library: enable the **Google Calendar API**, **People API** and **Google Tasks API** |
| Client | The same Desktop app client (PKCE; its secret ships, as Google says it may for installed apps) |
| Scopes (consent screen, Data access) | `openid`, `email`, `profile`, `https://www.googleapis.com/auth/calendar`, `https://www.googleapis.com/auth/contacts`, `https://www.googleapis.com/auth/tasks` |
| Verification | Calendar, contacts and tasks are **sensitive** scopes: Google's app verification (the consent screen's brand, a privacy policy on the project's domain, a video of each scope in use) before more than 100 users, who meanwhile see the "unverified app" screen. No security assessment (that is for restricted scopes only) |
| Cost | Free |

### Todoist

| | |
| --- | --- |
| Console | https://app.todoist.com/app/settings/integrations/app-management, Create a new app |
| Client | Todoist's token exchange asks for the `client_secret`: it ships in `clients.json` (readable from an image) or goes through the token relay (Q49) |
| Redirect URI | One "OAuth redirect URL" per app: the OAuth service's loopback address *(check that Todoist takes one)* |
| Scopes | `data:read_write,data:delete` |
| Verification | None; listing in Todoist's integrations directory is optional (its own submission) |
| Cost | Free |

Without it: the user pastes the personal API token (Todoist's Settings,
Integrations, Developer), and everything works.

### Bluesky (AT Protocol OAuth)

Nothing to register with Bluesky: the client id is the address of a
**client metadata document** Phoenix publishes, and any AT Protocol
authorization server fetches it.

| | |
| --- | --- |
| Host | `apps/connectors/bluesky/oauth/client-metadata.json` at `https://webosphoenix.org/oauth/bluesky/client-metadata.json` (its `client_id` is that address; served as `application/json` over HTTPS), with `client_uri` and the site's homepage on the same domain |
| Client | `application_type: native`, public (`token_endpoint_auth_method: none`), DPoP-bound tokens |
| Redirect URI | `org.webosphoenix:/oauth/bluesky`: native clients use the client id's domain reversed as the scheme |
| Scopes | `atproto transition:generic transition:chat.bsky` (direct messages need the chat one) |
| Device | The OAuth service lending its sign-in sheet for the browser step alone: the AT Protocol's PAR, DPoP and per-server endpoints are the connector's (`lib/oauth.js`), not the generic `authorize` (Q98) |
| Cost | Free (the hosting) |

Without it: the handle and an app password (Bluesky's Settings, Privacy
and security, App passwords, with direct messages allowed), and
everything works.

### Zoom

| | |
| --- | --- |
| Console | https://marketplace.zoom.us, Develop, Build App, **General App**, user-managed |
| Client | Zoom's token endpoint takes the secret by HTTP Basic client authentication: the token relay (Q49), or `clientSecret` in `clients.json` once the OAuth service can send it that way (Q99) |
| Redirect URI | "OAuth Redirect URL" and the allow list: the relay's callback (the loopback address only for a build that ships the secret) |
| Scopes (granular) | `user:read:user`, `meeting:read:list_meetings`, `meeting:read:meeting`, `meeting:write:meeting` |
| Verification | Users outside the developer's own Zoom account can add the app only once it is published through Zoom's app review |
| Cost | Free |

### LinkedIn

| | |
| --- | --- |
| Console | https://www.linkedin.com/developers/apps, Create app (it must name a LinkedIn Page, whose admin verifies the app) |
| Products | **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn** (both self-serve) |
| Client | The token exchange needs the `client_secret`: the token relay (Q49), or `clientSecret` in `clients.json` |
| Redirect URI | "Authorized redirect URLs for your app": the relay's callback |
| Scopes | `openid`, `profile`, `email`, `w_member_social` |
| Verification | The Page admin's verification of the app; nothing more for these two products. The connections API stays closed (partner programmes): connections come from the user's own `Connections.csv` |
| Cost | Free |

### Slack

| | |
| --- | --- |
| Console | https://api.slack.com/apps, Create New App, From scratch |
| Client | `oauth.v2.access` needs the `client_secret` and answers with the user token inside `authed_user`: the token relay (Q49) |
| Redirect URI | OAuth & Permissions, Redirect URLs: the relay's callback (Slack asks for HTTPS) |
| User token scopes | `channels:history`, `groups:history`, `im:history`, `mpim:history`, `channels:read`, `groups:read`, `im:read`, `mpim:read`, `users:read`, `users:read.email`, `chat:write` |
| Verification | Distribution on (Manage Distribution) to sign in outside the developer's workspace; a workspace's admins may have to approve outside apps. **The Slack Marketplace listing** (Slack's review) lifts the 2025 history limit for apps outside it (one `conversations.history` call a minute, 15 messages): until then the connector reads one conversation per sync; `"marketplace": true` in the setting once listed |
| Cost | Free |
