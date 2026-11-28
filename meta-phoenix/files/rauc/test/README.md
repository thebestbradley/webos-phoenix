# RAUC test keys (insecure)

**The private key here is public.** Anyone with this repository can sign a
system update that an image built with this keyring installs. They are for
test images and CI only (docs/PLATFORM.md 7.2, "a separate development CA
for test images and CI"; docs/PRE-IMAGE-CHECKLIST.md U3).

| File | What |
| --- | --- |
| `ca.cert.pem` | The test CA: the keyring of test images (`/etc/rauc/keyring.pem`, rauc-conf's `PHOENIX_RAUC_KEYRING`). Its own key was not kept |
| `development-1.cert.pem`, `development-1.key.pem` | The development signing certificate the CA issued, and its key: phoenix-bundle signs test bundles with them (`PHOENIX_RAUC_CERT`, `PHOENIX_RAUC_KEY`) |

ECDSA P-256, valid 20 years from 28 November 2026; made by
`scripts/rauc-test-keys.sh`, which makes new ones (images built with the old
CA then refuse bundles signed with the new certificate).

A release image must trust the owner's release CA instead: set
`PHOENIX_RAUC_KEYRING` (and, for bundles signed in the build, which release
bundles are not, `PHOENIX_RAUC_CERT`/`PHOENIX_RAUC_KEY`) in `local.conf`. The
owner re-signs release bundles with `rauc resign` on a hardware token
(PLATFORM.md 7.2). Which CA and token is the owner's decision.
