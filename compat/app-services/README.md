# Open webOS's app services on webOS OSE

The core apps' background services (`third_party/app-services`, Open webOS
2012: `com.palm.service.accounts`, `com.palm.service.contacts`,
`com.palm.service.contacts.linker`, `com.palm.service.calendar.reminders`)
are Mojo-era Node services: a `services.json` and assistants that
`mojoservicelauncher` runs with the foundations frameworks. OSE still has
both (`meta-webos/recipes-webos/mojoservicelauncher`, `mojoloader`, and
Phoenix installs the foundation and loadable frameworks under
`/usr/palm/frameworks`), so on a device they run as they are. In the
simulator the runtime stands in for them (`runtime/phoenix-runtime.js`,
"Services for the original Open webOS core apps").

What the originals cannot bring is their bus files: theirs
(`files/sysbus/*.json`) are luna-service 1's (one role with
`inbound`/`outbound`), which OSE's luna-service2 does not read. These
folders hold OSE's: a role (trust level `oem`), the service's methods for
every app (`<service>/*`, trust `dev`), the client permissions it needs
(db8's `database.operation`, the legacy application manager) and a
manifest. `tools/install-rootfs.py` installs each service at
`/usr/palm/services/<id>` with its db8 kinds and permissions
(`/etc/palm/db`, `/etc/palm/tempdb`) and activities
(`/etc/palm/activities/<id>`), and these files under
`/usr/share/luna-service2`. Its upstart job (accounts'
`createLocalAccount`) is not installed: OSE runs systemd.

Beside `sysbus/`, a folder may hold Phoenix's additions to the service's
code, which `tools/install-rootfs.py` lays over the original's files (later
entries win, as `compat/rootfs` does). The accounts service has one:

- `handlers/list-my-accounts.js`: `listMyAccounts {templateId?,
  capability?}`, the accounts `listAccounts` answers less those the caller
  may not read (the template's `readPermissions`, checked by `utils.js`
  `hasPermission` as `getAccountInfo` checks them), for an app's picker of
  its own accounts (group `phoenix.accounts.mine`; docs/DEVICE-AUDIT.md
  "Names and groups on the hub").
- `services.json` and `sources.json`: JSON, so they cannot say why they are
  here. They are the original's, unchanged, plus `listMyAccounts`'s command
  (`ListMyAccountsCommandAssistant`, not public) and its source, loaded
  after `handlers/list-accounts.js`, whose assistant it runs.

STATUS: written against the services' sources and OSE's recipes; not yet
run on a device (docs/DEVICE-AUDIT.md). The groups their own calls need
beyond db8 and the application manager are to be seen there.

`mojomail` (IMAP, POP, SMTP) is C++ and not built yet: see
docs/DEVICE-AUDIT.md.
