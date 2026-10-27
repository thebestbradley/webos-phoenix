# System notices feed (plan)

Staff write a notice once on the platform site, and every Phoenix device picks
it up on its next check and shows it as a system notification. Uses:
"System update 1.0.3 is out", "Sync is down; we're on it", "Please update:
security fix", "Public beta survey".

This is a plan; nothing here is built yet. It reuses what the updates and
revocation feeds already do ([PLATFORM-CLIENT.md](PLATFORM-CLIENT.md) rows 5
and 7): a static, signed file on the feeds host that devices poll. There's no
push server, no device registry and no per-device tracking. Instant push
(the declared `push` scope, UnifiedPush/WebPush) comes later and would only
wake the device to check this same feed sooner.

## 1. The feed

`notices/v1/notices.json` with the detached signature `notices.json.sig`
(base64 Ed25519 over the file's bytes, as every other feed).

```json
{
  "format": 1,
  "sequence": 42,
  "generated": "2026-11-02T15:00:00Z",
  "expires": "2026-11-09T15:00:00Z",
  "notices": [{
    "id": "7f0c2a4e-…",
    "severity": "info",
    "title": "Phoenix 1.0.3 is ready",
    "body": "Fixes Wi-Fi reconnects and the Email sync delay.",
    "starts": "2026-11-02T15:00:00Z",
    "ends": "2026-11-16T00:00:00Z",
    "audience": {"channels": ["beta"], "compatible": ["phoenix-vm-arm64"], "minBuild": 0, "maxBuild": 20261101, "locales": []},
    "action": {"kind": "update"},
    "dismissible": true
  }]
}
```

- **severity:** `info` (a banner, then a dashboard you can swipe away),
  `important` (a dashboard that stays until it's dismissed), or `critical`
  (a one-time popup alert, the luna-systemui alert style, then a dashboard).
- **text:** plain text only. Title up to 60 characters, body up to 300. No
  HTML or links in the text.
- **action**, optional:
  - `update` opens Settings > Updates;
  - `app` opens an allowlisted app with params (Settings panes, the
    Marketplace, the browser);
  - `url` is an https link on the project's own origin only, opened in the
    browser.
- **audience:** every field is optional; empty means everyone. Devices
  filter by their own channel, compatible string, build and locale. The
  server never learns which device saw what.
- **Limits:** at most 20 active notices and 64 KB. Any notice whose `ends`
  is in the past is left out.
- **expires** is at most 7 days ahead. The server signs the file again every
  day even when nothing changed, so a stalled server can't keep an old
  "everything is fine" notice alive forever.

## 2. Keys

- A new **notices key** (Ed25519), separate from the catalog key, so a leak
  of one can't forge the other.
- It's added to `servers.json` as
  `"notices": {"url": "notices/v1/notices.json", "keys": ["<base64>"]}` and
  pinned in the image.
- Rotation uses the drivers feed's hand-over (old key signs the new one).
- Signing goes through the existing mTLS signer; the private key never
  touches the web server.
- Recorded in Phoenix-Web-Services `docs/KEYS.md`.

## 3. Server (Phoenix-Web-Services)

- **Model:** a `notices` table holding:
  - the fields above;
  - state: draft, scheduled, published, withdrawn;
  - author, timestamps;
  - audit events for every change.
- **Staff page:** a Filament resource with live preview of the banner and
  dashboard text.
  - Who can publish: the new permission `notices.publish`, for owner and
    admin, plus the staff passkey confirmation that publishing already
    needs.
  - `critical` asks for a second confirmation.
- **Publishing:**
  - A job builds the document from published notices whose time window is
    current.
  - It bumps `sequence`, signs through the signer and writes the file with
    `StaticFeedExport`, the same path the catalog uses.
  - The scheduler re-signs it daily.
  - Withdrawing a notice publishes a new sequence without it.
- **Website:** published notices also show on the site's status page.
  Optionally, a notice can link to a News article.
- **Tests (feature):**
  - only permitted, confirmed staff publish;
  - the output is signed and verifies against the public key;
  - sequence always rises;
  - expired and withdrawn notices are left out;
  - the size limits hold;
  - a preview never publishes.

## 4. Device (webos-phoenix, then 2.0)

- **Where it runs:** a `notices` module in `services/updates` (it already
  has the daily activity, the feeds config and the signed-file code) or its
  own small service.
- **When it checks:**
  - a daily activity, `org.webosphoenix.notices.check`;
  - once after boot when the network comes up;
  - when the Updates pane checks.
- **Verifying:** `@phoenix/platform` `signed.verifyWithAny` against the
  pinned notices keys, with the same rules as the revocations feed:
  - `BAD_SIGNATURE`;
  - `EXPIRED`;
  - `ROLLBACK` (a lower sequence than one already seen);
  - `BAD_FEED`.
- **Showing:** each notice id is shown once, at its severity, through the
  shell's normal notification path (banner, dashboard, popup alert). Seen
  and dismissed ids are kept in the service's state.
- **Settings:** Settings > Notifications gets "Phoenix announcements"
  (on/off). Owner decision: can `critical` be turned off?
- **Simulator:** the runtime serves a fixture feed, plus a scene,
  `--scene notice`, for screenshots.
- **Tests:**
  - verify;
  - rollback;
  - expiry;
  - audience filter;
  - shown once;
  - the action allowlist (a notice can't open arbitrary apps or URLs);
  - the dismiss state survives a reboot.

## 5. Who does what

| Part | Who |
|---|---|
| Server model, staff page, publisher, tests | cloud |
| Device service, notifications UI, Settings toggle, simulator scene, tests | cloud |
| Generate the notices key on the signer, add it to the server, deploy | codex (key ceremony per KEYS.md) |
| Check it end to end in the UTM image | local |
| Approve the key, who may publish, whether critical can be switched off | owner |

## 6. Open questions

1. Can users turn off `critical` notices? Suggested: no, but each critical
   notice shows only once.
2. Should notices also go out by email to account holders? Suggested: no.
   Email stays for account and security mail; the newsletter covers
   announcements.
3. Should a public RSS/JSON copy of notices exist for the website and
   status page? Suggested: yes, the same text, unsigned, at `/status`.
