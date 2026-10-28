# Phoenix notices feed (the simulator's sample)

Devices read the system notices feed, `notices/v1/notices.json` and its
detached signature `notices.json.sig`, from the feeds host and show each
notice once as a system notification ([docs/NOTICES.md](../../docs/NOTICES.md)).
The platform (Phoenix-Web-Services) writes and signs the real one; this
repository has only the device side (`@phoenix/platform` `notices.js`,
`services/updates/notices.js`) and this sample.

```
sample/notices.sample.json     the sample's notices (edit this)
sample/signing.key             the sample key (in git on purpose)
sample/sign.cjs                writes public/notices.json and signs it
sample/public/notices.json     what the simulator reads (+ .sig)
```

`node server/notices/sample/sign.cjs` writes and signs it again after an
edit; `--check` says whether the files are current. The sample key signs
nothing else, and only the simulator's `/etc/palm/phoenix/servers.json`
(`services/account/etc/palm/phoenix/servers.json`, "notices") pins it, as
`server/drivers/sample/signing.key` is the sample driver catalog's. Images
never carry the sample (`tools/install-rootfs.py` leaves `server/` out) and
pin the platform's notices key instead (`PHOENIX_NOTICES_KEY`).

The sample never expires; it has an `info` notice (Settings > Updates), an
`important` one without an action, and one only for the beta channel.
`--scene notice` shows them (`shell/qml/sim.qml`).
