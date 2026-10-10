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

STATUS: written against the services' sources and OSE's recipes; not yet
run on a device (docs/DEVICE-AUDIT.md). The groups their own calls need
beyond db8 and the application manager are to be seen there.

`mojomail` (IMAP, POP, SMTP) is C++ and not built yet: see
docs/DEVICE-AUDIT.md.
