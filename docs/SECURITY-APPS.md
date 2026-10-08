# Apps that hold secrets: Passwords and Authenticator

This page is the threat model and security design of the two Phoenix apps
that keep secrets:

- **Passwords** (`apps/passwords`, `org.webosphoenix.passwords`): a KeePass
  password manager. Databases are KDBX 4 files that KeePassXC and KeePassDX
  open too.
- **Authenticator** (`apps/authenticator`, `org.webosphoenix.authenticator`):
  two-factor one-time codes (TOTP, RFC 6238; HOTP, RFC 4226).

Both use `@phoenix/secrets` (`apps/shared/secrets`): TOTP/HOTP, sealing with
WebCrypto, the clipboard that clears itself and the auto-lock.

Status: both run in the simulator and in a desktop browser. **Neither has run
on a webOS OSE device yet** (Milestone 1). Where the device differs, this page
says so.

## Summary

| | Passwords | Authenticator |
| --- | --- | --- |
| What is secret | Every entry (titles, user names, passwords, URLs, notes, TOTP keys) and the master password | The TOTP/HOTP shared secrets and the account names |
| At rest | A KDBX 4 file: AES-256 (ChaCha20 files open too), HMAC-checked blocks, with a key from the master password through **Argon2id** (64 MiB, 2 passes, 2 lanes for new files) | A sealed record: AES-256-GCM with a random data key; the data key wrapped (AES-GCM) with a key from the **device passcode** through PBKDF2-SHA256 (600 000 iterations) |
| Where | `/media/internal/passwords/*.kdbx` (Files, USB, and later WebDAV see the encrypted file) | The app page's `localStorage` (`phoenix:org.webosphoenix.authenticator:vault`) |
| Unlocked copy | The decrypted database, in the page's memory only | Each secret as a non-extractable WebCrypto HMAC key; names in memory |
| Locks when | The screen locks; the card is minimized (at once by default; 30 s, 2 min or never); idle 5 min (1 to 30); by hand | The same (no "never" for minimized) |
| Clipboard | Cleared after 30 s (10 to 90), if it still holds what was copied; at once on a screen, idle or manual lock | The same |
| Just Type, db8 | Nothing indexed, nothing in db8 | Nothing indexed, nothing in db8 |
| Logs | Nothing about entries, passwords or keys | Nothing about codes, secrets or the passcode |

## Assets and the people we protect them from

Assets: the master password and the passwords in the database; the TOTP
secrets (with them anyone can make your codes forever); the fact of which
accounts you have (entry titles, issuers).

| Attacker | Protected? | How / why not |
| --- | --- | --- |
| Someone who picks up the **locked phone** | Yes | Both apps lock when the screen locks and ask for the master password or the device passcode. The card thumbnail in card view shows the lock screen, not the entries (checked in phoenix-sim: `docs/screenshots/passwords-card-view.png`). |
| Someone who picks up the **unlocked phone** a while later | Mostly | Idle lock (5 min by default) and lock on minimize. The window before the idle lock is the gap. |
| Someone who **copies the files** (USB mass storage, a backup, a stolen SD card, a sync server) | Passwords: yes, as far as the master password is strong. Authenticator: **only as far as the device passcode is strong** | A KDBX file is as strong as its master password against Argon2id. The Authenticator record is protected by the device passcode through PBKDF2: a 4-digit PIN is only 10 000 guesses, which an attacker with the record tries in minutes. The Phoenix key store (below) is what fixes this on a device. |
| **Another app** on the device | Partly | On a device WebAppMgr keeps each app's `localStorage` apart, and the files are encrypted. But `/media/internal` is readable by apps with file access, and every app can read the clipboard while a secret is on it. In the simulator all apps share one origin (see "Simulator"). |
| A **malicious QR code or app** launching Authenticator with `{otpauth}` | Yes | The code is shown for confirmation after unlocking ("Only add codes for an account you are setting up right now"); never added silently. Parsing refuses anything but TOTP/HOTP with sane parameters. |
| A **crafted .kdbx file** (Files "Open with", Downloads) | Yes, within kdbxweb's robustness | Argon2 memory is capped at 1 GiB (a file cannot make the card allocate more), only Argon2 v1.3 is accepted, parsing errors become "damaged or unsupported", and nothing from the file runs as code. |
| A **crafted import file** | Yes | Aegis, andOTP and otpauth:// lists are parsed as data; every entry is validated; bad ones are skipped and counted. Encrypted Aegis vaults are refused with advice rather than half-read. |
| **Script injection** into the app page | Yes (defence in depth) | A strict Content-Security-Policy in each `index.html`: `default-src 'none'`, scripts only from the app itself, no inline scripts, no `eval` (Passwords allows `'wasm-unsafe-eval'` so that Argon2 compiles its WebAssembly; Authenticator allows no WebAssembly), no network (`connect-src 'self'` only reaches the runtime's own files), no frames, no form posts, no plugins. React escapes all text; no `innerHTML`. Checked in headless Chromium (e2e) and in phoenix-sim's QtWebEngine 6.4 / Chromium 102. |
| The **network** | Yes | Neither app talks to the network. Passwords' "Open Website" hands the URL to the browser app. |
| **Shoulder surfing** | Partly | Passwords hides passwords and protected fields until "Show"; Authenticator shows the current codes (they are short-lived by design). |
| Malware with **root**, or a compromised web runtime | No | It can read the page's memory while unlocked, log keystrokes (including the master password), or replace the app. Out of scope for an app. |
| Forensic recovery of **memory** | No | JavaScript cannot wipe strings. kdbxweb keeps protected fields XOR-masked (`ProtectedValue`) until shown or copied, and Authenticator turns secrets into non-extractable CryptoKeys, but plaintext copies of what was shown, typed or copied may stay in the heap until garbage-collected. |

## What is implemented now, and what the device needs

The design documents plan one key store for the whole system
([SYNERGY.md 2.9](SYNERGY.md#29-where-credentials-live),
[SYNERGY-MODERN.md 4.5](SYNERGY-MODERN.md), [AI-AND-MCP.md "API keys"](AI-AND-MCP.md)):
`org.webosphoenix.service.keystore`, implementing the legacy
`com.palm.keymanager` calls, encrypting with a device key (TPM or TEE where
the board has one, else a key file readable only by the service's user),
with access checked per caller. **That service does not exist yet.** So:

| | Now (simulator and, until the key store exists, the device) | With the key store (device) |
| --- | --- | --- |
| Authenticator's data key | Wrapped by the app with a key derived from the device passcode (PBKDF2-SHA256, 600 000 iterations); the wrapped key and the sealed data sit in the app's `localStorage` (`apps/authenticator/src/vault.ts`) | The key store holds the data key, wrapped with the device key (hardware-bound where possible) **and** released only after `matchDevicePasscode` succeeds, under the device's retry limit (`retriesLeft`, then wipe or lockout). Offline guessing of a short PIN then needs the device key too. The app keeps the same `Vault` interface; only the wrap/unwrap moves into the service |
| Checking the passcode | `com.palm.systemmanager/matchDevicePasscode` (simulated in `runtime/phoenix-runtime.js`; OSE has no passcode service yet, APP-GAPS "Lock screen PIN") before the key derivation; the app slows down repeated failures (after 5, waits of 1, 2, 4 ... 60 s). The real limit must come from the service | The same call, with the retry count enforced by the service |
| Device passcode changes | Detected (the passcode matches but does not open the vault): the app asks for the previous one once and re-wraps the data key | The key store re-wraps on `setDevicePasscode` itself |
| No device passcode | Authenticator refuses to start without one and opens Screen & Lock. If the passcode is later removed, the vault still needs the old one | The same |
| Passwords | Needs nothing from the key store: the master password protects the file (the KeePass model). A later option: remember the master password in the key store behind the device passcode ("quick unlock", as KeePassDX does), off by default | |

### Simulator-only notes (the "clear stand-in")

- The simulated `com.palm.systemmanager` stores a **djb2 hash of the device
  passcode** in `localStorage` (`runtime/phoenix-runtime.js`: "Not a secure
  hash"). Anyone with the simulator profile can brute-force it instantly, and
  with it open the Authenticator vault. The simulator is for development:
  never put real secrets in it.
- Every app page in the simulator shares one origin, so any app page can read
  the Authenticator record (ciphertext) and the simulated file system
  (`files:vfs` in `localStorage`, where the `.kdbx` files live, also
  ciphertext).
- The e2e tests (`tools/test-passwords.cjs`, `tools/test-authenticator.cjs`)
  scan the whole simulated device storage after use and fail if any entry
  text, password, TOTP secret, account name or passcode appears in it.

## Locking

`@phoenix/secrets` `AutoLock` (`apps/shared/secrets/src/autolock.ts`) locks an
unlocked vault when:

1. **The screen locks.** `com.palm.systemmanager/getLockStatus {subscribe}`
   reports `locked` (the shell tells the service; in the simulator the shell
   calls `__phoenixRuntime.applyHostStatus({deviceLocked})`). New in
   `@phoenix/luna`: `deviceLock.watchLocked()`.
2. **The card leaves the front.** A card minimized to card view is still
   drawn (as a thumbnail), so the page's `visibilityState` stays `visible`
   (measured in phoenix-sim). The simulator's window source now tells the page
   when its card gains or loses the front (`SimWindowSource.onFocusedUidChanged`
   → `__phoenixRuntime.cardActivated(active)` → a `phoenixcardactivation`
   event, `runtime/phoenix-runtime.js` "Card activation"), as LunaSysMgr's
   stage deactivation did. `visibilitychange` to `hidden` counts too. On a
   device, WebAppMgr must send the same (the OSE equivalent is the
   `webOSSystem` visibility / `relaunch` lifecycle; to be checked on a device).
   Opening another app from Passwords (Open Website) therefore locks it too,
   unless the user chose a grace period.
3. **Nobody touches it** for the idle time. Timers in hidden pages are
   throttled, so every touch and every return to the front compares clock
   times first: an expired vault locks before the touch does anything.

Locking drops the session: the database object or the CryptoKeys become
unreachable, React unmounts every view that showed them, and a pending save
finishes first (Passwords) so no edit is half-written.

## Clipboard

`SecretClipboard` (`apps/shared/secrets/src/clipboard.ts`) copies with
`navigator.clipboard.writeText` (phoenix-sim enables
`javascriptCanAccessClipboard`) or `execCommand("copy")`, and clears after
the chosen time **only if the clipboard still holds what it copied** (it reads
it back; when it cannot, it clears anyway). A manual, screen or idle lock
clears at once; a lock because the card was minimized does not (the user is
usually pasting into another app). Closing the card clears it too
(`pagehide`). Limits: any app can read the clipboard while the secret is on
it. `SecretClipboard` marks what it copies as a secret for Phoenix's
clipboard history, which keeps it encrypted and masked (or not at all, as
the user chooses): see [Clipboard history](#clipboard-history).

## Clipboard history

Phoenix keeps every copy (`org.webosphoenix.clipboard`,
[APP-RUNTIME.md](APP-RUNTIME.md#clipboard-history)), so it keeps the
secrets that pass through the clipboard too. What it does about them:

- **Which clips are secrets**: a copy from a password field; a copy an app
  marks (`SecretClipboard` in Passwords and Authenticator); with "Recognize
  secrets" on, text that looks like a one-time code, an `otpauth://` link,
  a TOTP key or a password. Detection by look is a heuristic: a password
  that looks like a sentence is not caught, and some ordinary strings are.
- **At rest**: AES-256-GCM (a fresh 96-bit IV per clip) under one key the
  runtime generates and keeps in IndexedDB as a **non-extractable**
  `CryptoKey` (database `phoenix-clipboard`, store `keys`, key `clips`;
  IndexedDB's `add` refuses a second key, so pages starting together agree
  on one). Only the ciphertext, the kind and the length go to
  `localStorage`; `tools/test-clipboard.cjs` scans the stored data for the
  secrets. Where IndexedDB is missing (the unit tests' jsdom) the key's
  bytes are kept in the store instead.
- **Shown**: masked (`••••`) in the keyboard strip and the app, and left
  out of search; revealed in the app only after `reveal {id, passCode}`,
  which the service checks with `matchDevicePasscode`; hidden again when
  the screen locks. The keyboard pastes one only into a password field,
  without showing it; `paste` gives a secret's text to the system UI page
  only.
- **Choices** (Settings > Clipboard): "Passwords and codes: Don't keep"
  records none; "Clear when locked"; apps never kept; Clear All Clips.

What this protects against, honestly:

| Attacker | Protected? | Why |
| --- | --- | --- |
| Someone looking at the screen, or at a card thumbnail | Yes | Secrets are masked until the passcode is given. |
| Someone with a copy of the profile's `localStorage` only (a backup of it, a sync of web data) | Yes | Ciphertext only; the key is in IndexedDB. |
| Someone with the **whole profile** (`localStorage` and the IndexedDB files) | **Partly** | The key cannot be exported by JavaScript, but Chromium keeps it in the IndexedDB files in a form an attacker with the files can recover. It is not wrapped by a device secret yet. |
| **Another app** in the simulator | **No** | All apps share one origin there: any page can call `reveal` with a guessed passcode (a 4-digit PIN; the simulated service has no retry limit for it) or use the key itself. `PalmSystem.appIdentifier`, which `paste` checks, can be set by a page. |
| Memory forensics while unlocked | No | Decrypted text lives in page memory while shown or pasted, as with Passwords. |

On a device the plan is Authenticator's: the key wrapped by the Phoenix
key store (hardware-bound where the board allows) and released after
`matchDevicePasscode` under the device's retry limit, with the service on
the bus, checking its caller, giving secrets' text only to the keyboard.

## Assistant

The assistant ([APP-RUNTIME.md](APP-RUNTIME.md#assistant)) holds
cloud provider API keys and can act on the device.

- **Keys** are sealed at once by the service (AES-GCM; in the simulator
  under a non-extractable WebCrypto key in IndexedDB, as clipboard secrets
  are; on a device under a key file only the service reads). No reply
  carries a key: pages see `hasKey` and at most its last four characters.
  A key leaves the device only in the request to its own provider, made by
  the service (the simulator's proxy runs in phoenix-sim's process). In the
  simulator any page of the shared origin could in principle use the
  sealing key, as with the clipboard; on a device the service is a process
  of its own.
- **Who may call**: `ask`, `choose` and `confirm` only the system UI, the
  Assistant app and Settings (a request can spend cloud tokens and run
  commands); provider changes, connection tests and model lists only
  Settings; `allowCloudControl` can be turned on only by Settings.
- **Cloud models** chat; they get the commands as tools only with
  "Allow cloud models to control the device" (off by default), and a tool
  call from a cloud model without it is refused, not run. Anything that
  sends, calls or deletes waits for the user's Send / Call / Yes, whichever
  layer (grammar, on-device model, cloud model) chose it.
- **What leaves the device**: nothing for the grammar and the on-device
  model (weather asks Open-Meteo for a place); the conversation's recent
  turns (at most 20) for a cloud model the user chose to ask.
- **The app's CSP** allows no network but its own origin and no frames;
  it allows `unsafe-eval` because the simulator runs the service in the
  page. Answers are shown as text, never as HTML, and links are not loaded.

## Just Type and db8

Neither app declares `universalSearch` in `appinfo.json` (the fields are
there as comments saying why), and neither writes a db8 kind, so Just Type
cannot index or show entries, titles or accounts. Just Type finds the apps by
title and keywords only. Preferences (clipboard time, lock times) and the
paths of recently opened `.kdbx` files are the only things the apps put in
`localStorage` unencrypted.

## Passwords specifics

- **Format**: KDBX 4.0 through [kdbxweb](https://github.com/keeweb/kdbxweb)
  2.1.1 (MIT). New databases: Argon2id, 64 MiB, 2 iterations, parallelism 2
  (about 0.35 s in phoenix-sim's QtWebEngine on a desktop; expect a few
  seconds on a phone), recycle bin on, protected password field. Existing
  files keep their settings (AES-KDF, Argon2d, KDBX 3.1 all open). Argon2
  comes from [hash-wasm](https://github.com/Daninet/hash-wasm) 4.12.0 (MIT,
  WebAssembly); it runs in Chromium 102 (phoenix-sim) and Chromium 120 (OSE)
  with `'wasm-unsafe-eval'`, supported since Chromium 97.
- **Compatibility, checked both ways**: a KDBX 4 / Argon2d file written by
  pykeepass (`apps/passwords/src/fixtures/`) opens, with its `otp` URI and the
  older KeePassXC `TOTP Seed` / `TOTP Settings` fields; a database Passwords
  wrote was opened by pykeepass with its groups, entries, TOTP URI and notes
  intact.
- **Saving** is atomic (`NAME.kdbx.tmp`, then moved over `NAME.kdbx`). If the
  file changed since it was opened (a sync, KeePassXC on a computer over USB),
  Passwords merges the other copy first with kdbxweb's CRDT merge (both sides'
  edits survive); if that copy has another master password, it saves a
  `NAME (conflict DATE).kdbx` beside it instead of overwriting.
- **Key files and YubiKey challenge-response** are not supported yet: such a
  database fails with "Wrong master password (or the database also needs a
  key file ...)".
- **Search** covers title, user name, URL, notes and tags; never passwords or
  protected custom fields; not the recycle bin.
- **Generator**: `crypto.getRandomValues` with rejection sampling (no modulo
  bias), at least one character of each chosen kind, Fisher-Yates shuffle
  from the same source; 8 to 64 characters.
- **Dependencies not shipped**: kdbxweb pulls in `@xmldom/xmldom` 0.7.13,
  which has open advisories (npm audit: high). kdbxweb uses it only when the
  page has no `DOMParser`/`XMLSerializer`, that is under Node.js (unit tests).
  The app build replaces it and Node's `crypto` with a stub that throws
  (`apps/passwords/vite.config.ts`, `src/node-stub.ts`), so neither is in the
  app. Bundled licences: `apps/passwords/public/THIRD-PARTY-LICENSES.txt`.

## Authenticator specifics

- **TOTP/HOTP**: a small implementation on WebCrypto HMAC
  (`apps/shared/secrets/src/otp.ts`), tested against all RFC 4226 appendix D
  and RFC 6238 appendix B vectors (SHA-1, SHA-256, SHA-512, 8 digits, up to
  T = 20000000000), plus RFC 4648 base32 vectors. 6 to 10 digits, periods
  1 to 3600 s. Steam, mOTP and Yandex codes are not supported.
- **HOTP**: the counter is saved before the code is shown, so a code is never
  shown twice.
- **Adding**: a typed setup key (at least 80 bits), a pasted `otpauth://`
  link, or launch params `{otpauth: "otpauth://..."}` from the QR scanner,
  always confirmed.
- **Backups**: "Export Backup" writes
  `/media/internal/Documents/Authenticator backup DATE.json`: the codes as
  `otpauth://` URIs, sealed with a passphrase (PBKDF2-SHA256 600 000 +
  AES-256-GCM; at least 8 characters). Import reads it back, and reads Aegis
  plain JSON, andOTP plain JSON and `otpauth://` lists after a warning that
  the file holds secrets in clear, then offers to delete it. Codes already
  present are not doubled.

## Out of scope: autofill into other apps

Filling passwords into other apps' login forms is not done. The path:

1. **A fill request** from the page: the web runtime (WebAppMgr's injection on
   a device, `phoenix-runtime.js` in the simulator) already tells the shell
   which field has focus and its type (`password`, `email`, ...) for the
   virtual keyboard. It would add the page's origin (for the browser, the
   site's; for an app, its app id).
2. **The keyboard** shows a "Passwords" key when a login field has focus
   (designed together with the IME work, APP-GAPS "Keyboard").
3. **A Passwords service** (a headless page of the app or a small Luna
   service) that, while the database is unlocked, answers "entries for this
   origin" with titles only; the user picks one, and only then is the user
   name and password sent to the keyboard, which types them into the field
   (as a keyboard would, so no app gets an API to read the vault).
4. Matching by URL (with the public-suffix list) and by app id stored in the
   entry (`AndroidApp` custom fields as KeePassDX does, a `webOSApp`
   field for Phoenix apps), never by fuzzy title.
5. The fill goes through the shell, which checks the target field is still
   focused and belongs to the requesting app, so a background page cannot
   ask for passwords.

## Checking

- Unit tests: `apps/shared/secrets` (RFC vectors, sealing, auto-lock),
  `apps/passwords/src/*.test.ts` (KDBX create/open/save/merge, the pykeepass
  file, the generator), `apps/authenticator/src/vault.test.ts` (the vault,
  passcode change, HOTP counters, Aegis/andOTP/URI import, encrypted
  backups).
- End-to-end in headless Chromium: `node tools/test-passwords.cjs [--tablet]`
  and `node tools/test-authenticator.cjs [--tablet]` (at rest, logs, CSP,
  clipboard, all the lock triggers).
- By hand in phoenix-sim (QtWebEngine 6.4.2 / Chromium 102): the CSP is
  enforced (an injected inline script is refused), Argon2's WebAssembly runs,
  and minimizing the card locks it.
