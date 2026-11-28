# Connector settings (not in the repository)

Some Synergy connectors need an id registered with the service they reach,
which Phoenix keeps out of its public source tree (docs/OPEN-QUESTIONS.md
Q16, Q17). A connector names the settings it reads (`settings` in its
definition, docs/SYNERGY-SDK.md); the kit gives them through
`ctx.setting(name)`, from `/etc/phoenix/connectors/<service>.json`.

- **On a device** the image's recipe writes that file from build-time
  variables (meta-phoenix, e.g. `PHOENIX_TELEGRAM_API_ID` and
  `PHOENIX_TELEGRAM_API_HASH` in `local.conf` or the CI's secrets).
- **In the simulator** it is this folder (`runtime/rootfs.json` mounts it at
  `/etc/phoenix/connectors/`). Put a file here for your own testing, e.g.
  `org.webosphoenix.service.telegram.json`:

  ```json
  {"apiId": 12345, "apiHash": "0123456789abcdef0123456789abcdef"}
  ```

  `.gitignore` keeps every `*.json` here out of git. Never commit one.

Without its file, a connector that needs one says so: the account type shows
"not available in this build".

## The connectors' registrations (clients.json)

The OAuth connectors read their client ids from `/etc/palm/<name>/clients.json`
(`drives`, `microsoft`, `google`, `todoist`, ...; docs/SYNERGY-CONNECTORS.md
"The registrations in an image and the simulator"). In the simulator,
`runtime/rootfs.json` serves `/etc/palm/<name>/` from `clients/<name>/` here.
Write them from one file kept outside the repository:

```sh
python3 tools/connector-clients.py ~/phoenix/connector-clients.json --sim
```

with `{"drives": {"dropbox": {"clientId": "..."}, "box": {"clientId": "...", "relay": true}}, ...}`.
Client ids only: a provider whose token exchange needs the client secret
(Box, Todoist) says `"relay": true` and signs in through Phoenix's token
relay, so the simulator needs an account signed in to a Phoenix server whose
relay holds that secret. The same file goes into an image with
`PHOENIX_CONNECTOR_CLIENTS` (meta-phoenix `phoenix-apps`). A value kept in
the simulator's store (`localStorage` `phoenix:systemConfig:<name>/clients.json`)
still wins over the file.

The simulator has no TDLib: with any app id here, the Unofficial Telegram
account reaches the demo stand-in (`apps/telegram/service/test/fake-tdjson.cjs`:
any phone number, the code 12345), as `tools/test-telegram.cjs` does with a
test id it writes and removes.
