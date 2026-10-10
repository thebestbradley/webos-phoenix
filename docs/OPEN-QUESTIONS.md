# Questions for the owner

Decisions the work needs from the owner, kept here so the work goes on
meanwhile (the owner, 10 October 2026: "if you have questions or issues
defer them until I can answer but keep the army moving forward"). Each says
what was chosen in the meantime; answering one may mean a change.

| # | Question | Meanwhile | Where |
| --- | --- | --- | --- |
| Q1 | Where is the catalog server hosted, and under which address (domain)? Devices read the Marketplace's catalog and the system update feed there. | `http://127.0.0.1:8088/` (this computer, the simulator's Services > Marketplace Catalog) in `/etc/palm/updates.json` and the Marketplace's sources | APP-STORE.md 6 Q3, APP-RUNTIME.md "System updates" |
| Q2 | Which device for the first image? | The image is built for the targets meta-phoenix has (qemux86-64, Raspberry Pi 4); device-side code is written and tested without hardware | HARDWARE.md |
| Q3 | Synergy: new capabilities `FEEDS`, `MEDIA`, `PODCASTS`, `BOOKMARKS` as Phoenix additions? | Not defined yet; Connections lists today's capabilities | SYNERGY-CONNECTORS.md 5 |
| Q4 | Synergy: which connectors do we build ourselves, which are left to developers? | The Fediverse first (the owner), then the C3 list | SYNERGY-CONNECTORS.md 5, 6 |
| Q5 | Synergy: are connectors' privacy labels the developer's word checked in review, or checked technically? | Developer's word, checked in review | SYNERGY-CONNECTORS.md 5 |
| Q6 | A curated directory of holiday and sports calendars: may we list feeds whose terms we check one by one? | Held back: no list until each feed's terms are checked | SYNERGY-CONNECTORS.md 2.2 |
| Q7 | Messaging's reply bar: the report from M6-PLAN.md F0 | Unchanged | M6-PLAN.md F0 |
| Q8 | Live Activities: 1.x or 2.0? | As built (in the simulator) | ROADMAP.md M4 |
| Q9 | The gesture bar's end buttons and `setButton` | As built | GESTURE-BAR.md, open questions |
| Q10 | Notifications beyond the original (webOS grouped by app or account with dashboard layers, had no quick reply and no force touch): add Quick Reply (Messaging, Email), Email's Mark as Read / Archive / Delete and a missed call's Call Back / Message as notification buttons, and per-conversation lines in a big group? | Not built; suggested for 1.0: Quick Reply and the action buttons (the notification buttons exist: `actions`, Notifications.qml `runAction`) | APP-RUNTIME.md (notification actions) |
