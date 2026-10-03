# Previous launcher icons (archive)

The launcher icons Phoenix's own apps shipped until October 2026, kept as
they were when the icon set moved to the webOS platter style
([docs/spec/app-icons.md](../../docs/spec/app-icons.md)). Nothing here is
installed: `runtime/rootfs.json` and `tools/install-rootfs.py` never read
`art/`.

One folder per app id, holding the files its `appinfo.json` named: `icon.png`
(64 px), its `splashicon` `icon-256x256.png` and, for Settings, the launch
points' `icons/<name>.png` and `icons/<name>-256x256.png`.

The `render-icon*.cjs` beside them are the scripts that drew them, moved here
unchanged from each app's `tools/` folder (Settings drew all its launch points
in `render-icons.cjs`; Photos drew the Camera, Photos and Music icons in its
`render-icons.cjs`). They still compute their output paths relative to their
old place, so they no longer run as they are; they are kept as the record of
how each picture was made.

All of it is original Phoenix artwork, Apache-2.0 like the rest of the
repository (see the scripts' headers and [docs/LEGAL.md](../../docs/LEGAL.md)).
The Notes demos' (Enact, Flutter, Ionic), the Enyo 2 demo's and the DAV
service's icons had no script; their PNGs are kept as committed.
