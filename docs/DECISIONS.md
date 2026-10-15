# Decisions

Directions the owner gave that are not answers to a question in
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) (those are recorded there, in their
rows). Newest first; each says what was decided, why, what was done and
what is still open.

## 15 October 2026: the current Chrome version, the newest engine

**The owner**: "Is there a reason we are not using or reporting the latest
Chromium? Is there anything stopping us from updating? I would prefer that
we use the most current for both systems. If possible let's make that
happen. The user agent should be modern and working with the latest
browsers; webOS is centered around the web to function, this is a top
priority."

**Decided**:

1. **Every web page is told Chrome's current version.** One user agent
   policy for every web surface (the apps' cards, installed web apps, the
   browser's normal and private views): Chrome on an Android phone or
   tablet by the device's form factor, Chrome on Linux for the browser's
   Desktop Site, in Chrome's own reduced form, with client hints and
   `navigator.platform` that agree. The version follows Chrome's four-week
   release cadence from the date (anchored at Chrome 155, stable 6 October
   2026), so it stays current without a change; the environment can
   override it, and a feed can re-anchor it later. The engine's real
   version is said where people look (the simulator's start-up line,
   Settings > Device Info).
2. **The newest engine available on every platform.** The simulator moves
   from Qt 6.8.1 (Chromium 122) to Qt 6.11.3, whose Qt WebEngine is the
   newest Qt has: Chromium 140, the newest base, with security fixes to
   153.0.8010.52. Qt 6.12.0 (the LTS release LuneOS's device stack uses)
   has the same base but an older build of it, with fixes only to
   147.0.7727.138, so 6.11.3 it is until a 6.12 release carries newer ones.
   Qt 6.8 stays the oldest the QML must run on, the device's, and CI checks
   it.

**Why nothing stopped it before**: the simulator used Qt 6.8.1 because a
webOS OSE image ships it, and its QML must run there; that holds with the
QML tested on both. The user agent named the engine's own Chromium, which
sites such as Slack refuse ("Please update your browser").

**Done** (branch `wp/modern-web`): `shell/sim/useragent.h` and its tests,
applied to every profile, the engine in Settings > Device Info, Qt 6.11.3
in `./phoenix`, CI and the docs. Slack's web app, installed from the
Marketplace in the simulator, now opens on Slack's sign-in page where it
said "Please update your browser". Details: APP-RUNTIME.md, "The web engine
and the user agent".

**Open**:

- The device's engine and user agent move with the device stack (OSE's
  WebAppMgr runs Chromium 120; LuneOS's forward port is on Chromium 151):
  the device stack's work, planned separately. The same policy
  (`useragent.h`) is what it should apply.
- Move to Qt 6.12.1 (its branch already carries newer fixes), or to
  whichever release carries the newest security fixes, when it ships;
  check with `strings` on its `libQt6WebEngineCore` (APP-RUNTIME.md).
  Homebrew's `qtwebengine` (6.11.2, fixes to 151) keeps a Mac a little
  behind until Homebrew moves.
- The update or catalog feed giving the current Chrome release
  (`UserAgent::setFeedAnchor`), for when the cadence slips.
