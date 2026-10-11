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
places: [SHARE-AND-FILES.md](SHARE-AND-FILES.md) "Drives"). Telegram,
Slack, LinkedIn and Zoom (Q17) get their rows here when their connectors
are built.

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
