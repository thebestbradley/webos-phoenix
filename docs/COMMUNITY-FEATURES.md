# Community features for 1.x and 2.0

What the webOS community built after HP stopped (2011 to 2026): webOS
Community Edition (HP's 2012 source release and LunaCE, and webOS Archive's
webOS CE 3.1.0 of September 2026), the Preware patches, webOS Internals'
tools, and the webOS Archive's revived apps and services. Each item says
where it came from and whether it belongs in **1.x** (the classic look:
something Palm could have shipped) or **2.0** (the modern revamp), or is
**Covered** (Phoenix has it or plans it in [ROADMAP.md](ROADMAP.md)).

This is a list of candidates, not a plan: an item becomes work when it is
added to the roadmap. 1.x items only add to 1.x; nothing here removes or
changes what 1.x already does.

Researched on 1 October 2026; every item has a source, and what could not
be verified says so.

---

## Headline finding: "webOS Community Edition" exists, under two releases with that name

1. **webOS Community Edition (2012).** HP released most of the webOS 3.0.5 source for the TouchPad (LunaSysMgr, card view, launcher, notifications) under Apache 2.0 in late June 2012. It was a step toward Open webOS. It was a source release for developers, not firmware for end users. Sources: [CNX Software, 2012-07-01](https://www.cnx-software.com/2012/07/01/webos-community-edition-release-for-hp-touchpad/), [Slashdot, 2012-06-27](https://news.slashdot.org/story/12/06/27/2024222/hp-releases-more-webos-components-for-the-touchpad), [Liliputing](https://liliputing.com/old-hp-touchpad-learns-new-tricks-webos-community-edition/). The webOS Ports community build of it was **LunaCE** (first alpha August 2012, [Liliputing](https://liliputing.com/webos-community-edition-ui-ported-to-the-hp-touchpad/)).
2. **webOS CE 3.1.0 "Community Edition" (2026).** This is the release most people mean by the name today. It is a full Doctor (flash) image for the TouchPad Wi-Fi model (`topaz`), with a separate AT&T 4G build.
   - **Who and when:** made by webOS Archive (Jon Wise / codepoet). Final release BUILDMARK 600070 on **2026-09-03**; announced on PivotCE on 2026-09-08 as "the first new webOS release in 15 years".
   - **How it was built:** HP's 3.0.5 Doctor repacked with about 14 years of community work baked into the root filesystem. It also includes a signing key for future over-the-air updates.
   - **Sources:** [README](https://github.com/webOSArchive/webOS-Community-Edition), [Release 3.1.0](https://github.com/webOSArchive/webOS-Community-Edition/releases/tag/3.1.0-CE-Release), RELEASE-NOTES.md and Docs/PLAN.md in that repo, [webOS Archive news](https://webosarchive.org/news/).

   Its feature list is the best single summary of what the community thinks matters (details in the sections below):
   - LunaCE launcher with app groups (folders), renameable tabs and add/remove tabs
   - Restart Luna and Reboot in the power menu
   - UberKernel and Govnah pre-installed
   - TLS 1.3 everywhere, 190 current Mozilla root certificates, NTP fixed
   - DuckDuckGo Lite as the default search
   - Bluetooth gamepads and mice, USB OTG with a USB Settings app, Bluetooth hands-free
   - Extra codecs (opus, ogg, vpx, matroska, speex)
   - Optional webOS Community Account instead of the HP account; first-use setup repaired and skippable
   - Synergy Revival runtime (libpurple 2.14)
   - Community App Catalog, Preware with the "modernize" feed, Maps on OpenStreetMap
   - Backup app rewritten to back up to local storage
   - Help app restored
   - Mail working with modern Exchange (EAS) servers; Photos shows file names
   - Clock and Photo exhibition improvements
   - Treo ringtone and new wallpapers
   - Developer mode on by default
   - Preloads removed: Kindle, Facebook, YouTube

Also new: **"Lunacy"** (webOS Archive, announced September 2026). It is an Android app that recreates the TouchPad's Luna shell and runs unmodified Enyo 1 webOS apps in WebView cards, using an Enyo 1.0 fork fixed for modern Chromium and a simulated `palm://` bus ([repo](https://github.com/webOSArchive/Lunacy); PivotCE post "Lunacy, and the Many Children of webOS", 2026-09-20, listed on [webosarchive.org/news](https://webosarchive.org/news/)). It matters directly to Phoenix's legacy-app runtime (see Developer).

We found no evidence of a release called "webOS 3.0.6" or "Wonderland".

---

## Top 20 recommendations, ranked by value to Phoenix users

| # | Feature | Origin | Target |
|---|---|---|---|
| 1 | Launcher app groups (folders): drag onto an icon to group, rename the group, press and hold to pop an app out | LunaCE / webOS CE 3.1.0, 2026 | 1.x |
| 2 | Launcher tab management: rename tabs, add and remove tabs (first four protected, up to six) | LunaCE / CE 3.1.0, 2026 (2010 phone patches "Named Pages", "Enable Add/Delete Pages") | 1.x |
| 3 | Power menu: hold power for Airplane mode, Restart Luna, Reboot, Shut Down | Jason Robitaille's "Advanced Reset Options" patch, 2012; built into CE 3.1.0 | 1.x |
| 4 | Card gestures: side-bezel app switching, infinite card cycling, tap-to-maximize edge cards, two-finger card zoom and stack spread, Tabbed Cards | LunaCE (Herrie82 and others), 2012 to 2013 | 1.x (bezel switch is roadmap G5); rest 2.0 |
| 5 | Battery percentage in the status bar plus a richer system menu (brightness slider, flashlight, Wi-Fi/Bluetooth/data/GPS toggles) | "Battery Percent and Icon", "Device Menu Megamix", "Advanced System Menus" patches, 2010 to 2011 | 1.x (flashlight is covered) |
| 6 | Game controller support (Bluetooth and USB) plus a USB host/OTG settings page with mount and safe unmount for storage | webOS Archive, 2026; older "USB FlashMount OTG" | 1.x |
| 7 | Exhibition / dock mode: clock faces, photo slideshow with time overlay, weather, today's agenda; autostart on dock | Stock webOS plus patches and CE 3.1.0 | Covered (roadmap R5): add these modes |
| 8 | Subscribe to a public `.ics` calendar URL (one-way sync) | WebCal Sync, webOS Archive, 2026 | 1.x (CalDAV is covered) |
| 9 | Synergy Revival connectors: messaging and cloud storage as real accounts | webOS Archive modernize feed, 2026 | Covered by SYNERGY-MODERN; compare the list |
| 10 | Sign-in through a code shown on the device and finished in another browser (device-code OAuth broker) | webOS Archive `oauth-broker-for-webos`, 2026 | 1.x infrastructure (helps the Gmail/Outlook OAuth gap in APP-GAPS) |
| 11 | Receive files from any phone or PC browser by scanning a QR code over the LAN ("LuneDrop") | webOS Archive, 2026 | 1.x |
| 12 | Mode Switcher-style automation: profiles triggered by time, Wi-Fi, charging, calendar or location | Janne Julkunen, 2010 to 2012 | 2.0 (1.x simple profiles) |
| 13 | Browser: private browsing toggle (red toolbar), find in page, content blocker, user-agent override | minego, kyle3om and others, 2012 | 1.x |
| 14 | Notification options: repeat until seen, private lock-screen previews ("New Message"), cycling email dashboard with delete and timestamp | Preware patches, 2010 to 2013 | 1.x |
| 15 | Tweaks-style "Advanced" settings: one place for power-user toggles (tap ripple, gesture sensitivity, keyboard size, card behaviour) | webOS Internals Tweaks app; LunaCE Tweaks | 1.x |
| 16 | Performance and thermal panel: CPU load, temperature and memory graphs, governor profiles, temperature warnings | Govnah, Device Temperature Warnings patch | 2.0 (developer) |
| 17 | Use the tablet as a wireless second screen for a computer, and stream its screen to a PC | webOS Archive webos-secondscreen and LuneCast, 2026 | 2.0 |
| 18 | Log viewer and service-bus monitor plus a database browser | Lumberjack, Impostah (webOS Internals) | 1.x developer options |
| 19 | VPN: OpenVPN and Tailscale as plugins inside the stock VPN settings | webOS Archive webos-vpn-profiles, 2026 | Covered (VPN); copy the plugin model |
| 20 | Keyboard: optional arrow keys and number row, extra hardware-keyboard layouts, compact size | Keyboard layout patches for 3.0.5; LunaCE small keyboard | 1.x (cursor control is covered) |

Honourable mentions: Wave Launcher (1.x); status-bar Just Type icon (1.x); mini cards (1.x); Treo ringtone and classic wallpapers (1.x, trivial); restored on-device Help (1.x); tethering (1.x on phones); Lunacy's Enyo-on-Chromium fixes (runtime).

---

## 1. System and performance

| Feature | What it does | Who / when | Source | Target |
|---|---|---|---|---|
| **Preware** | Package manager for homebrew apps, patches, kernels and services from open ipkg feeds. Now 1.9.19 with the webOS Archive "modernize" feed | webOS Internals (Rod Whitby and others), 2009 onward; maintained by webOS Archive in 2026 | [webOS Internals wiki](https://www.webos-internals.org/wiki/Application:Preware), [preware-modernize-feed](https://github.com/webOSArchive/preware-modernize-feed) | Covered (Marketplace with Preware feeds) |
| **UberKernel** | Community kernel: better memory management, overclocking, `ondemand-ng` governor. Default kernel in CE 3.1.0 (3.0.5-93) | webOS Internals, 2010 to 2012 | [PivotCE guide 2014](https://pivotce.com/2014/11/02/guide-coming-back-to-webos-in-2014-part-2/), CE RELEASE-NOTES | Not applicable (OSE kernel); idea: performance profiles, 2.0 |
| **Govnah** | CPU governor, clock and voltage control; graphs true CPU temperature, load and memory; preset profiles | webOS Internals | [Preware catalog](https://preware.pivotce.com/package/org.webosinternals.govnah) | 2.0 (developer panel) |
| **Muffle System Logging** | Stops all logging except critical errors, saving CPU and I/O | webOS Internals | [TechRadar](https://www.techradar.com/news/mobile-computing/tablets/how-to-speed-up-your-hp-touchpad-1037020), [Preware catalog](https://preware.pivotce.com/category/System) | Engineering note: ship with quiet log levels |
| **Remove Dropped Packet Logging / Quiet powerd Messages / Unset CFQ IO Scheduler** | Cuts firewall and power-daemon log noise; changes I/O scheduler | webOS Internals | [PivotCE 2014](https://pivotce.com/2014/11/02/guide-coming-back-to-webos-in-2014-part-2/) | Engineering note |
| **Unthrottle Download Manager** | Removes an artificial 64 KB/s download cap | webOS Internals | [PivotCE 2014](https://pivotce.com/2014/11/02/guide-coming-back-to-webos-in-2014-part-2/) | Engineering note: no artificial throttles |
| **Buttah** (Increase Touch Sensitivity and Smoothness) | Smaller drag radius, smoother and more precise scrolling | webOS Internals | [Preware catalog](https://preware.pivotce.com/package/org.webosinternals.patches.misc-buttah) | Engineering note: tune touch slop; maybe a 1.x Tweaks slider |
| **Faster Card Animations (HYPER) / Mojo FPS Booster / Mojo Tap Responsiveness / Mojo Flick Regulator** | Faster card animations, 60 fps Mojo, quicker taps, consistent flick speed | webOS Internals and others | [PivotCE 2014](https://pivotce.com/2014/11/02/guide-coming-back-to-webos-in-2014-part-2/), [Preware Mojo category](https://preware.pivotce.com/category/Mojo) | 1.x: "Animation speed" option (Normal / Fast) |
| **Remove Tap Ripple** (later a LunaCE tweak, "Show Tap Ripple") | Turns off the tap ripple; reduces frame-rate lag in 60 fps games | webOS Internals; LunaCE | Tweak definition in CE repo `AddToImage/LunaCE-Tweaks/tap-ripple.json` | 1.x toggle |
| **Advanced Reset Options** (TouchPad) / **Reset Options on Power Button Hold** (phones) | Holding power offers Airplane mode, Luna restart, device restart, Shut Down | Jason Robitaille, 2011 to 2012; built into CE 3.1.0 | [Preware catalog](https://preware.pivotce.com/package/org.webosinternals.patches.notifications-advanced-reset-options) | **1.x** |
| **Device Temperature Warnings** | Checks battery temperature every 5 minutes; warns at 45 °C and 50 °C | Jason Robitaille, 2011 | [Preware catalog](https://preware.pivotce.com/package/org.webosinternals.patches.notifications-device-temperature-warnings) | 1.x |
| **Tailor** | Storage tool: resize the media partition, check filesystems | webOS Internals | [Preware catalog](https://preware.pivotce.com/package/org.webosinternals.tailor) | Not needed |
| **Save/Restore** | Saves and restores app data to `/media/internal/saverestore` | webOS Internals | [Preware catalog](https://preware.pivotce.com/package/org.webosinternals.saverestore) | Covered (backup to USB/WebDAV) |
| **Backup app rewritten for local storage** | Replaces HP's cloud backup; restore validated on 115 packages | webOS Archive, 2026 (CE 3.1.0) | CE README / RELEASE-NOTES | Covered |
| **Dr. Battery / Battery Monitor** | Battery health and statistics | Various | [Preware System Utilities](https://preware.pivotce.com/category/System+Utilities) | 1.x: battery usage screen (unverified whether Phoenix has one) |

## 2. UI: launcher, cards, status bar

| Feature | What it does | Who / when | Source | Target |
|---|---|---|---|---|
| **App groups (folders)** | Drag an icon onto the centre of another to group; mini-grid tile opens an overlay; rename by tapping the title; group dissolves at one member. Saved in a format older LunaSysMgr versions ignore safely | webOS Archive, 2026 (LunaCE fork) | [webOSArchive/LunaCE](https://github.com/webOSArchive/LunaCE), CE README | **1.x** |
| **Renameable, addable and removable launcher tabs** | Press and hold a tab to rename it; press the empty strip for "+"; trash icon on user tabs; up to six; "Favorites" renamed "Games" by default | webOS Archive, 2026 | same | **1.x** |
| **Named Pages / Enable Add-Delete Pages / Wrap Pages / Launcher Page Selection Tabs** (phones) | Named launcher pages with jump menu, add/delete pages, wrap-around paging | lmorchard, Rod Whitby, lclarkjr / dBsooner, 2009 to 2010 | [Named Pages](https://preware.pivotce.com/package/org.webosinternals.patches.app-launcher-named-pages-in-the-launcher), [Add/Delete](https://preware.pivotce.com/package/org.webosinternals.patches.app-launcher-enable-add-delete-pages), [Wrap](https://preware.pivotce.com/package/org.webosinternals.patches.app-launcher-wrap-pages) | 1.x (same idea as tabs) |
| **Icon grid size patches** (4x4, 5x4, 5x5), Remove Icon Titles, Hide preinstalled apps | Denser launcher; hide unwanted apps | Various | [App Launcher category](https://preware.pivotce.com/category/App+Launcher) | 1.x: grid density and "hide app" options |
| **Side-bezel gesture app switching** | Swipe in from the left or right bezel to go to the next or previous card without opening card view. Modes: Swipe, Slide or Fluid (follows the finger) | Eric B (ekdikeo) on the 2012 CE source; LunaCE | [lgwebos.com repost of WebOS Nation](https://www.lgwebos.com/topic/1038-precentral-webos-community-edition-yields-touchpad-gesture-based-app-switching/), `slide-gestures.json` tweak | **1.x** (roadmap G5) |
| **Infinite Card Cycling** | Card view wraps from last card to first | LunaCE | `abh_features.json` tweak | 1.x |
| **Tabbed Cards** | Sideways bezel gesture inside a maximized stacked card switches between cards in that stack like tabs | LunaCE | `abh_features_tabbedCards.json` | 2.0 |
| **Card zoom / stack spread gestures** | Two-finger zoom on a card; two-finger spread fans out a stack | LunaCE (Herrie82) | `zoom-gestures.json`, `spread-gestures.json`; [LunaCE credits](https://github.com/webOSArchive/LunaCE) | 2.0 |
| **Tap-to-Maximize Edge Cards** | Tap a partly visible side card in card view to maximize it directly | LunaCE | `maximize-edges.json` | 1.x |
| **Mini Cards** | webOS 1.x-style mini cards, reached by tapping below the active card | LunaCE | `mini-cards.json` | 1.x (classic) |
| **Wave Launcher** | Upward slide on the side of the screen opens the Pre-style wave quick-launch bar | LunaCE | `wave-launcher.json` | **1.x** |
| **Virtual trackball, dynamic dashboard height, task management improvements** | Listed LunaCE improvements | LunaCE, 2013 | CE README, [webos-ports.org/wiki/About_LunaCE](https://webos-ports.org/wiki/About_LunaCE) (page returned 404 when fetched) | 1.x (virtual trackball covered by cursor control) |
| **Status bar Just Type icon** / **Just Type Command** | Search icon in the status bar opens Just Type; patch renamed the field "Command…" | LunaCE; webOS Internals 2012 | `statusbar-search.json`, [Preware](https://preware.pivotce.com/package/org.webosinternals.patches.mojo-just-type-command) | 1.x (Just Type covered) |
| **Battery percentage** (many variants) | Colour-coded percentage next to the icon | nesl247, Jason Robitaille, pcworld | [Preware](https://preware.pivotce.com/package/org.webosinternals.patches.top-bar-battery-percent-and-icon) | **1.x** |
| **Device Menu Megamix / Advanced System Menus** | System menu gains brightness, radio/data/roaming toggles, GPS, flashlight; editable menu items | Jason Robitaille; sconix (2011) | [Megamix](https://preware.pivotce.com/package/org.webosinternals.patches.top-bar-device-menu-megamix), [Advanced System Menus](https://preware.pivotce.com/package/org.webosinternals.patches.advanced-system-menus-device-menu) | **1.x** |
| **Show Wi-Fi SSID / Custom carrier string / Device name as carrier text** | Replace the carrier label with SSID, custom text or device name | Rod Whitby, zinge; LunaCE tweaks | [Preware](https://preware.pivotce.com/package/org.webosinternals.patches.top-bar-show-wifi-ssid), CE tweak files | 1.x |
| **Date in status bar / AM-PM indicator / clock position** | Status bar formatting options | Various | [Top Bar category](https://preware.pivotce.com/category/Top+Bar) | 1.x (small options) |
| **Exhibition**: Autostart Exhibition, Show Agenda from Exhibition, longer photo intervals; CE: new clock face and photo time/date overlay | Docked display modes | appsotutely (2012), others; webOS Archive 2026 | [Autostart Exhibition](https://preware.pivotce.com/package/org.webosinternals.patches.system-autostart-exhibition), CE README, [Things to Try](https://docs.webosarchive.org/thingstotry/) (AccuWeather exhibition, AgendaZ) | Covered (R5): include clock, photos with overlay, weather, agenda |
| **Profiles** | Save launcher layout, wallpaper, ringtone and notification settings as switchable profiles | diov, 2010 | [Preware](https://preware.pivotce.com/package/com.diov.profiles-device) | 2.0 (or part of Mode Switcher) |
| **Brightness Unlinked** | Separate screen and keyboard backlight; screen off on Touchstone | zinge, 2010 | [Preware](https://preware.pivotce.com/package/com.palm.app.brightnessunlinked) | Not applicable |
| **Haptic Feedback Manager** | Vibrate on any tap | fritos1406, 2010 | [Preware](https://preware.pivotce.com/package/org.webosinternals.patches.mojo-haptic-feedback-manager) | 1.x (phones) |
| **Classic wallpapers, Treo ringtone** | Nostalgia assets | webOS Archive, 2026 | CE README | 1.x (trivial) |

Names we were given that we could not verify as Preware packages: "Remove the drag handle", "Enable keyboard swipe", a patch literally named "Launcher Pages". They may exist under other names; they do not appear in the PivotCE Preware catalog categories we checked.

## 3. Notifications

| Feature | What it does | Who / when | Source | Target |
|---|---|---|---|---|
| **Notification Repeat** (Messaging, Email, Phone, Calendar) | Repeats the alert every 2 minutes until seen or dismissed | lclarkjr, 2009 to 2010 | [Preware](https://preware.pivotce.com/package/org.webosinternals.patches.messaging-notification-repeat) | **1.x** setting |
| **Messaging Notification Private / Messaging Dashboard Private** | Hides message content in banners and dashboard ("New Message") | flatland, 2011 | [Preware](https://preware.pivotce.com/package/org.webosinternals.patches.notifications-messaging-notification-private) | **1.x** (lock-screen privacy) |
| **Uber Cycling Email Dashboard / Cycling Email Notifications / Delete Email from Dashboard** | Dashboard cycles through new emails with timestamps; delete straight from the dashboard | 60RH, 2013 | [Preware](https://preware.pivotce.com/package/org.webosinternals.patches.email-uber-cycling-email-dashboard) | **1.x** (dashboard actions) |
| **Quick USB Dashboard / Just Charge By Default / No Charging Banner on AC or Touchstone** | Skip the charging banner on USB; default to "just charge" | Jason Robitaille, 2011 | [Preware](https://preware.pivotce.com/package/org.webosinternals.patches.notifications-quick-usb-dashboard), [Notifications category](https://preware.pivotce.com/category/Notifications) | 1.x |
| **Custom Low-Battery Notification Sounds / My Notification** | Choose sounds per event type | various; Michael Pule | [Preware](https://preware.pivotce.com/package/com.michaelpule.mynotification) | 1.x (per-app sounds) |
| **SMS Tone per Contact / Ringtone for Unknown Callers** | Per-contact tones | various | [Messaging](https://preware.pivotce.com/category/Messaging), [Phone](https://preware.pivotce.com/category/Phone) categories | 1.x (phones) |
| **Disable Captive Portal Notifications**; CE fixed connectivity check | Old check hit dead HP servers and asked for hotspot sign-in on normal Wi-Fi | community; webOS Archive 2026 | [Notifications category](https://preware.pivotce.com/category/Notifications); CE RELEASE-NOTES / Docs/HOTSPOTS.md | Covered (OSE): make sure the probe URL is Phoenix-controlled |

## 4. Keyboard and input

| Feature | What it does | Who / when | Source | Target |
|---|---|---|---|---|
| **TouchPad keyboard layout patches with arrow keys / number row** | Arrow keys beside the number row; alternative layouts, updated for 3.0.5 | forum community, 2011 to 2012 | [WebOS Nation thread (archived)](https://forums.webosnation.com/touchpad-patches/297295-virtual-keyboard-layouts-patches-arrow-keys-print.html), [Changing keyboard layout on TouchPad](https://www.webos-internals.org/wiki/Changing_keyboard_layout_on_Touchpad) | 1.x option (cursor control covered) |
| **Hardware keyboard layouts** (Hebrew, Russian, Greek, Georgian, Arabic, Korean IME, Chinese Pinyin) | Language support for Bluetooth and slider keyboards | various | [Mojo](https://preware.pivotce.com/category/Mojo) and [System](https://preware.pivotce.com/category/System) categories | 1.x (localisation; OSE IME) |
| **Small default keyboard** | LunaCE ships a smaller default size | LunaCE, CE 3.1.0 | CE RELEASE-NOTES | Covered (sizes); check the default |
| **Three-finger tap to show or hide the keyboard** (Xecutah/XTerm) | Keyboard toggle in X11 and terminal cards | webOS Internals | [docs.webosarchive.org/bash](https://docs.webosarchive.org/bash/) | Covered (terminal) |
| **Autoreplace word lists** (100 / 3000 words) | Bigger autocorrect dictionaries | various | [Mojo category](https://preware.pivotce.com/category/Mojo) | Covered (prediction) |
| **Bluetooth keyboard** | Works through Palm's stack on stock 3.0.5; no verified community "Bluetooth keyboard improvements" patch found. Community work added Bluetooth **gamepads and mice** instead (below) | webOS Archive | [webos-touchpad-accessories](https://github.com/webOSArchive/webos-touchpad-accessories) | Covered (OSE) |
| **Virtual Keyboard** (phones) | On-screen keyboard for the keyboard-slider Pre | webOS Internals | [Mojo category](https://preware.pivotce.com/category/Mojo) | Covered |

## 5. Apps and services revived (mostly webOS Archive, 2020 to 2026)

| Feature | What it does | Who / when | Source | Target |
|---|---|---|---|---|
| **App Museum II / community App Catalog** | About 4,000 archived apps plus new ones; web catalog; replaced HP's catalog in CE 3.1.0 (6.1.2923) | webOS Archive (codepoet and others) | [appcatalog.webosarchive.org](https://appcatalog.webosarchive.org/), [webos-catalog-service](https://github.com/webOSArchive/webos-catalog-service) | Covered |
| **Restored HP App Catalog apps** (TouchPad and phones) | The original catalog apps pointed at the new back end | webOS Archive, 2026 | [webos-appcatalog-touchpad](https://github.com/webOSArchive/webos-appcatalog-touchpad) | Covered |
| **App Scanner / App Inventory** | Lists installed apps that are not yet archived, so the community can rescue them | webOS Archive | [App Scanner](https://appcatalog.webosarchive.org/app/webOSAppScanner), [docs/appinventory](https://docs.webosarchive.org/appinventory/) | Community tool (not a Phoenix feature) |
| **Maps revival** | Stock Maps repointed to OSM tiles, Nominatim and OSRM through `maps-proxy` | webOS Archive, 2026 | [maps-proxy](https://github.com/webOSArchive/maps-proxy), [webos-maps](https://github.com/webOSArchive/webos-maps) | Covered (maps) |
| **Help app restored** | On-device help loads from webOS Archive mirrors | webOS Archive | CE README, [help.palm.com archive](https://github.com/webOSArchive/help.palm.com) | 1.x: offline Help / Tips app |
| **MeTube** | YouTube client using two self-hostable back-end services | codepoet | [Things to Try](https://docs.webosarchive.org/thingstotry/), [service wrapper](https://github.com/codepoet80/metube-php-servicewrapper) | Covered via web apps / Android |
| **Podcast Directory** (service and app) | Search, plus HTTPS-to-HTTP bridging so old devices can fetch feeds; works with drPodder and others | codepoet | [podcasts.webosarchive.org](http://podcasts.webosarchive.org), [webos-podcastdirectory](https://github.com/webOSArchive/webos-podcastdirectory) | Covered (podcasts) |
| **FeedSpider** (RSS, e.g. InoReader) | News reading | codepoet | [docs](https://docs.webosarchive.org/thingstotry/), [feedspider.wosa.link](https://feedspider.wosa.link) | 2.0 / catalog |
| **Papyrus eReader** | DRM-free ePub reader derived from Kindle and pReader; released 2026 | webOS Archive | [Papyrus](https://appcatalog.webosarchive.org/app/PapyruseReader) | 1.x (Phoenix has PDF/doc viewers; an ePub reader may be a gap) |
| **FlixNet** | Public-domain movies from archive.org | webOS Archive | [enyo1-flixnet](https://github.com/webOSArchive/enyo1-flixnet) | Catalog |
| **ReadOnTouch for Instapaper plus instapaper-auth** | Read-it-later client with device-code auth | webOS Archive, 2026 | [repo](https://github.com/webOSArchive/webos-readontouch-instapaper) | Catalog |
| **WebCal Sync** | One-way sync of public `.ics` calendars into Calendar, every 30 min / 15 min per docs | webOS Archive, 2026 | [webos-webcal-synergy](https://github.com/webOSArchive/webos-webcal-synergy), [docs/email](https://docs.webosarchive.org/email/) | **1.x** |
| **C+Dav** (CalDAV/CardDAV Synergy) | Two-way sync with Nextcloud and ownCloud; updated 2026 | webOS Ports, updated by codepoet | [releases](https://github.com/codepoet80/org.webosports.service.contacts.carddav/releases) | Covered |
| **Synergy Revival** | libpurple 2.14 runtime plus connectors as real accounts: WhatsApp, Telegram, Signal, Teams, Discord, Google Chat, Facebook, Dropbox, Google Drive, OneDrive, Box, MEGA, pCloud, Koofr, kDrive, HiDrive, Yandex Disk, S3, Flickr, CalDAV/CardDAV. Marked "experimental" | webOS Archive, 2026 | [preware-modernize-feed README](https://github.com/webOSArchive/preware-modernize-feed) | Covered (SYNERGY-MODERN); compare the connector list |
| **iMessage via BlueBubbles / iMessage Bridge Synergy** | iMessage in the Messaging app | webOS Archive, 2026 | [bluebubbles](https://github.com/webOSArchive/webos-bluebubbles-synergy), [imessage](https://github.com/webOSArchive/webos-imessage-synergy) (READMEs empty when fetched; descriptions only) | 2.0 (unverified maturity) |
| **Messaging Plugins** (2010 era) | Extra IM protocols via libpurple: Jabber, ICQ, IRC, Sametime, GroupWise, Office Communicator, Gadu-Gadu, QQ | webOS Internals | [WebOS Nation thread](https://forums.webosnation.com/webos-homebrew-apps/233983-messaging-plugins-add-more-im-options-your-pre-13.html), [messaging-accounts](https://github.com/webOS-ports/messaging-accounts) | Covered (Synergy) |
| **Share Space / sharing-service** | Simple sharing for old devices | webOS Archive, 2026 | [webos-sharespace](https://github.com/webOSArchive/webos-sharespace) | 1.x (see LuneDrop) |
| **LuneDrop** | AirDrop-style receiving: the tablet shows a QR code and URL; any browser on the LAN uploads into `/media/internal/Drop/`; no cloud | webOS Archive, 2026 | [LuneDrop](https://github.com/webOSArchive/LuneDrop) | **1.x** |
| **webOS Second Screen** | Tablet becomes a wireless extended display for a Mac (about 20 to 25 fps, touch controls the cursor) | webOS Archive, 2026 | [webos-secondscreen](https://github.com/webOSArchive/webos-secondscreen) | 2.0 |
| **LuneCast / Screen Share** | Streams the tablet screen to a PC over USB as MJPEG | webOS Archive, 2026 | [LuneCast](https://github.com/webOSArchive/LuneCast), [webos-screenshare](https://github.com/webOSArchive/webos-screenshare) | 2.0 (screen casting / recording) |
| **PWA Installer** | Fetches a site's manifest and icon and creates a launcher shortcut | webOS Archive, 2026 | [webos-pwa-installer](https://github.com/webOSArchive/webos-pwa-installer) | Covered (Add to Launcher, PWA catalog) |
| **Claude Chat** (Enyo 2) | AI chat client with history and model choice | webOS Archive, 2026 | [enyo2-claudechat](https://github.com/webOSArchive/enyo2-claudechat) | Covered (AI-AND-MCP) |
| **One Night Stand** | Bedside clock that becomes a Philips Hue controller | codepoet | [Things to Try](https://docs.webosarchive.org/thingstotry/) | 2.0 (smart-home controls in exhibition) |
| **Retune, Splashtop, Remote Desktop, mVNC, Kookaroo (Roku), Plex** | Remote controls and media (archived apps still working) | various | [Things to Try](https://docs.webosarchive.org/thingstotry/) | Catalog |
| **Clock Sync app / fix-ntp.sh / ntpdate-sync** | Fixes clock drift after HP's time servers died; built into the TLS bundle and CE | community (dkirker 2018); webOS Archive | [docs/timesync](https://docs.webosarchive.org/timesync/) | Covered (OSE NTP) |
| **Games**: Half-Life (xash3d), Quake HD with controller, Android NDK games | New ports | webOS Archive, 2026 | [webos-half-life](https://github.com/webOSArchive/webos-half-life), [Android-to-webOS-Ports](https://github.com/webOSArchive/Android-to-webOS-Ports) | Catalog |
| **Classic emulator** (Palm OS) on 2.x/3.x | Runs Palm OS apps | Arthur Thornton (container) and community | [Things to Try](https://docs.webosarchive.org/thingstotry/) | 2.0 / catalog (licensing unclear) |

Apps we were given that we could **not** verify: "Retro Weather", "NOAA", "Glimpse", "Music Remix", "Tweeted", a Mastodon client, "HNApp", "Dr. Podder" as a revived release.
- What we did find: IAmA Reddit (archived, still works), drPodder (archived player linked in the docs), AccuWeather and aniWeather (codepoet listings; we could not open the author page).
- webOS Archive does run a Mastodon *account*, not a client app.

## 6. Connectivity and security

| Feature | What it does | Who / when | Source | Target |
|---|---|---|---|---|
| **TLS 1.3 Updates** (TouchPad and phone bundles) | OpenSSL 1.1.1w for browser, app WebKit, download manager, mail and curl; current root certificates; automatic NTP; restored App Catalog. TouchPad bundle adds Help, USB Settings and Bluetooth gamepad. Replaces older root-cert updaters and proxy workarounds | webOS Archive (OpenSSL-legacyWebOS), 2026 | [docs/modern-tls](https://docs.webosarchive.org/modern-tls/), [OpenSSL-legacyWebOS](https://github.com/webOSArchive/OpenSSL-legacyWebOS) | Covered (OSE); lesson: ship CA bundle updates with system updates |
| **Gmail IMAP fix** (ECDSA certificate, error 4010) plus App Password guidance | Mail patch so Gmail IMAP works with an App Password | webOS Archive, 2026 | [docs/email](https://docs.webosarchive.org/email/) | Covered |
| **Mail with modern Exchange (EAS); IMAP tag fix** | | webOS Archive, 2026 | CE README | Covered |
| **Squid SSL Bump** (on-device or Raspberry Pi) **plus Proxy Set / ProxySwitch** | Older route to modern TLS through a proxy; system-wide proxy control panel | nizovn (2019); codepoet | [Squid](https://preware.pivotce.com/package/com.nizovn.squid), [webos-proxyset](https://github.com/webOSArchive/webos-proxyset), [squid-for-webos](https://github.com/webOSArchive/squid-for-webos) | 1.x: system proxy setting in Wi-Fi settings (verify Phoenix has it) |
| **OAuth Broker** | Device shows a short code; user finishes OAuth on another device; broker holds the secrets. Generalised from instapaper-auth to Box and others | webOS Archive, 2026 | [oauth-broker-for-webos](https://github.com/webOSArchive/oauth-broker-for-webos) | **1.x infrastructure** (device-code style sign-in for Phoenix accounts) |
| **OpenVPN and Tailscale agents for the stock VPN panel** | OpenVPN 2.5.9 / OpenSSL 1.1.1w plugin and a Tailscale agent with exit nodes, managed in Settings > VPN | webOS Archive, 2026 | [webos-vpn-profiles](https://github.com/webOSArchive/webos-vpn-profiles) | Covered (VPN); add Tailscale/WireGuard presets |
| **freeTether** | USB, Bluetooth and Wi-Fi tethering of the phone's mobile data | Ryan Hope, Eric Gaudet (webOS Internals) | [Preware](https://preware.pivotce.com/package/org.webosinternals.freetether) | 1.x (phones; hardware-dependent) |
| **Atlas browser** | Modern WPE WebKit browser for TouchPad (about 103 MB); "make default" or "Open in Atlas" patches | webOS Ports | [docs/browsers](https://docs.webosarchive.org/browsers/) | Covered (2.0 Chromium browser) |
| **QupZilla / Qt WebBrowser** | Qt5 browsers for TouchPad and Pre3 (TouchPad build updated late 2025) | nizovn | [docs/browsers](https://docs.webosarchive.org/browsers/) | Historical |
| **DuckDuckGo Lite as default search** | Google search no longer renders in the old browser | webOS Archive (CE) | CE README | 1.x: offer a search-engine choice |
| **Browser patches**: Private Browsing, Find in Page, Ad Blocker / Max Blocker, User Agent Override, View Source, Add Download Link, Fullscreen Mode | Browser power features | minego, kyle3om and others, 2012 | [Private Browsing](https://preware.pivotce.com/package/org.webosinternals.patches.browser-private-browsing), [Find in Page](https://preware.pivotce.com/package/org.webosinternals.patches.browser-find-in-page), [Browser category](https://preware.pivotce.com/category/Browser) | **1.x** |
| **WiFi Fix for TouchPad 3.0.4/5** | Rolls back a DHCP client config that caused intermittent Wi-Fi drops | GuyFromNam, 2012 | [Preware](https://preware.pivotce.com/package/org.webosinternals.patches.system-wifi-fix-for-touchpad-304) | Not applicable |
| **EOM Overlord Monitoring** | Stopped uploads of installed apps and access points to Palm | webOS Internals | [PivotCE 2014](https://pivotce.com/2014/11/02/guide-coming-back-to-webos-in-2014-part-2/) | Principle: no telemetry by default (Covered under privacy) |
| **Activation bypass / community account** | Then: Impostah, devicetool and the "Bypassing Activation" patch. Now: CE 3.1.0's first-use setup creates an optional webOS Community Account (skippable), backed by the App Museum account system | webOS Internals; webOS Archive 2026 | [Bypassing Activation wiki](https://www.webos-internals.org/wiki/Patch_webOS_Bypassing_Activation), [docs/activate](https://docs.webosarchive.org/activate/), [webos-community-account](https://github.com/webOSArchive/webos-community-account) | 1.x: optional account, never required |
| **Hosts entries for archived Palm hosts** | Redirect dead Palm/Preware hostnames | community | [docs/hosts](https://docs.webosarchive.org/hosts/) | Not applicable |

## 7. Android

| Feature | What it does | Who / when | Source | Target |
|---|---|---|---|---|
| **CyanogenMod and later ROMs with moboot dual-boot; TPToolbox** | Boot menu to choose webOS or Android; ROMs from ICS up to Android 7 to 9 builds by the community; TPToolbox makes install and repartitioning easy | CM team, jcsullins (TPToolbox 2014 to 2015) | [TPToolbox (XDA)](https://xdaforums.com/t/tools-touchpad-toolbox-updated-2015-02-25.2756314/), [ROM guide](https://xdaforums.com/t/rom-guide-how-to-install-android-9-0-pie-to-4-4-4-kitkat-on-the-hp-touchpad.3512182/) | Not applicable (Phoenix uses a container) |
| **OpenMobile ACL** | Android 2.3 apps ran **inside webOS cards** with launcher icons and the AppMall/Amazon Appstore; Kickstarter revival attempt in 2013 by Phoenix International Communications | OpenMobile, 2013 | [PivotCE review 2013-10-22](https://pivotce.com/2013/10/22/review-acl-for-webos-beta-0-6-0-4/), [Engadget 2013](https://www.engadget.com/2013-04-28-openmobile-acl-for-webos-resurrected-on-kickstarter.html) | Covered (Android container); keep the "Android apps as ordinary cards" idea |
| **ACL Revival Edition** | Offline activation patch (TurboActivate stub) so ACL 1.2.5 works without dead licence servers; boot-time uninstaller; ACL AppMall back end re-implemented (patched APK, works over HTTP, no login) | webOS Archive, January 2026 | [acl](https://github.com/webOSArchive/acl), [acl-appmall](https://github.com/webOSArchive/acl-appmall), [acl-manager](https://github.com/webOSArchive/acl-manager) | Covered |
| **Android-to-webOS NDK game ports** | apkenv-style shim (Gingerbread linker, fake JNI, SDL/PDL back end) runs native Android games such as Plants vs. Zombies HD and Temple Run 2 | webOS Archive, 2026 | [Android-to-webOS-Ports](https://github.com/webOSArchive/Android-to-webOS-Ports) | Not applicable |
| **Lunacy / WCL** (the reverse direction) | Runs legacy webOS Enyo apps on Android in a TouchPad-faithful shell | webOS Archive, 2026 | [Lunacy](https://github.com/webOSArchive/Lunacy), [wcl](https://github.com/webOSArchive/wcl) | See Developer |

## 8. Developer and power user

| Feature | What it does | Who / when | Source | Target |
|---|---|---|---|---|
| **Internalz Pro** | Root file manager with text editor, image viewer, ipk installer and patcher | Jason Robitaille | [Preware](https://preware.pivotce.com/package/ca.canucksoftware.internalz) | Covered |
| **Terminal / wTerm / Xecutah (X11 server in a card, XTerm, Debian session)** | Shell and X apps | webOS Internals; Ryan Hope | [Xecutah](https://preware.pivotce.com/package/org.webosinternals.xecutah), [docs/bash](https://docs.webosarchive.org/bash/) | Covered (terminal); X11 not needed |
| **Tweaks** | One settings app that drives patch options. Patches with Tweaks support show a green plus in Preware. LunaCE ships its Tweaks definitions | webOS Internals | [Tweaks wiki](https://www.webos-internals.org/wiki/Application:Tweaks) | **1.x: "Advanced" settings page** |
| **Lumberjack** | Log follower and search, D-Bus capture, resource monitor, email a log | webOS Internals | [Preware](https://preware.pivotce.com/package/org.webosinternals.lumberjack) | 1.x developer options |
| **Impostah** | Device, profile and database inspector (db8), activation helper | webOS Internals | [Preware](https://preware.pivotce.com/package/org.webosinternals.impostah) | 1.x developer options (database browser) |
| **Mode Switcher** | Automation: modes with triggers (time, location, Wi-Fi, charger, calendar, apps) that change settings, wallpaper, ringtone; export and import | Janne Julkunen, to about 2012 | [Preware](https://preware.pivotce.com/package/org.webosinternals.modeswitcher) | **2.0** (1.x: Do Not Disturb schedule) |
| **Easy Samba / WiFi File Sharing / FTPit / WebDAV Client HD** | Network file access | various | [System Utilities](https://preware.pivotce.com/category/System+Utilities) | Covered (WebDAV); 1.x: SMB browse |
| **Wake-on-LAN, Netstat, What Is My IP** | Network utilities | various | same | Catalog |
| **Developer mode on by default; restored SDK/PDK and docs; webos-sdk-redux** (novacom for modern macOS/Windows/Linux) | Developer access | webOS Archive | [sdk.webosarchive.org](http://sdk.webosarchive.org), [webos-sdk-redux](https://github.com/webOSArchive/webos-sdk-redux) | Covered |
| **webOS MCP server** | MCP server with legacy webOS development knowledge | webOS Archive, 2026 | [webos-mcp](https://github.com/webOSArchive/webos-mcp) | Covered (AI-AND-MCP); worth wiring into Phoenix dev tooling |
| **Lunacy's Enyo 1 fork fixed for modern Chromium** | One fix in the framework covers every Enyo 1 app; `palm://` calls mapped to native services; deltas documented in `Docs/luna-deltas.md` | webOS Archive, 2026 | [Lunacy](https://github.com/webOSArchive/Lunacy) | **Covered (APP-RUNTIME): high value to reuse or compare** |
| **Bluetooth Gamepad and USB Settings** | Bluetooth Classic HID gamepads (DS4 etc.) as real evdev devices; OTG host mode, high-power budget bypass, USB storage mount/unmount. Bluetooth LE not supported on the 2011 stack | webOS Archive, 2026 | [webos-touchpad-accessories](https://github.com/webOSArchive/webos-touchpad-accessories) | **1.x**: controllers and USB storage UI |
| **Hardware mods**: USB-C port conversion; "original barrel" charging cable that stops the charger warning | Hardware guides | Alan Morford, 2024 | [docs/patches](https://docs.webosarchive.org/patches/) (links to PivotCE guides) | Not applicable (HARDWARE.md note) |
| **Doctors and recovery** | webOS Doctor archive, meta-doctor / "Super Doctor" builds, TouchPad rescue guide | webOS Internals; webOS Archive | [archive.org webOSDoctors](https://archive.org/details/webOSDoctors), [meta-doctor](https://github.com/webos-internals/meta-doctor/), [docs/tprestore](https://docs.webosarchive.org/tprestore/) | Covered (system updates); 1.x: a recovery-mode "reflash" flow |

## 9. LuneOS (briefly; see [LUNEOS.md](LUNEOS.md))

- **What it is:** webOS Ports' open successor (Luna Next / Qt). Card multitasking, gestures, Enyo apps, Preware 2.
- **Releases:** last stable "Eiskaffee" on 2024-02-15; TouchPad (`tenderloin`) test images still built as of September 2026.
- **Where its work shows up in TouchPad features:** LunaCE (2012 to 2013), the Atlas WPE browser, the C+Dav connector, and the dual-boot LuneOS + Android setup.
- **Sources:** [webos-ports.org](https://webos-ports.org/), [luneos-testing releases](https://github.com/webOS-ports/luneos-testing/releases/), [PivotCE / webOS Archive news](https://webosarchive.org/news/).

## Verification notes

- All CE 3.1.0 details come from the repo's README, RELEASE-NOTES.md, Docs/PLAN.md, Docs/SCOPE-3.1-CE.md and the shipped LunaCE Tweaks JSON files (cloned 2026-10-01).
- Preware patch descriptions come from the PivotCE Preware catalog (archived 2018). Dates are each package's "Updated" field, which is not always the original release date.
- Several webOS Nation forum links now redirect elsewhere. The gesture-switching credit to "Eric B (ekdikeo)" comes from a repost on lgwebos.com.
- Not verified: iMessage and BlueBubbles Synergy maturity (empty READMEs), the 2013 LunaCE wiki page (404), and the apps listed as not found in section 5.

