# Enyo 2 Demo (temporary)

A sampler of Enyo 2.5.2's Onyx widgets and Layout kinds, and of enyo-webos's
`webOS.js` calls (device info, a Luna service, a banner), to show what Enyo 2
apps look like and to check that they run on Phoenix's runtime. It is in the
launcher's Downloads tab and will be removed once Enyo 2 catalog apps are
tested directly (see [docs/ROADMAP.md](../../docs/ROADMAP.md)).

On a tablet the list and the page show side by side (the Panels kind's
CollapsingArranger); on a phone one at a time, and Back or the back gesture
returns to the list.

The framework is not part of the app: `index.html` loads it from
`/usr/palm/frameworks/enyo2/`, mounted from `third_party/enyo-2` and
`third_party/enyo-webos` ([docs/APP-RUNTIME.md](../../docs/APP-RUNTIME.md#enyo-2-apps)).
