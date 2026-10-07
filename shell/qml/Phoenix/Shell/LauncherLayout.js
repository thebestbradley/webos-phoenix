// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Where each launcher entry sits: the order of the icons on each launcher
// page (Apps, Downloads, Favorites, Settings) and in the quick launch
// dock. Pure functions over plain objects, so the shell can persist the
// layout and the tests can check the rules. The layout is
//   { pages: [[id, ...], ...], designators: ["apps", ...], dock: [id, ...], removed: [id, ...] }
// where ids are launcher entry ids (apps and launch points), as in the
// launcher3 reorderable pages and quick launch bar of luna-sysmgr
// (Src/lunaui/launcher/elements/page/reorderablepage.cpp,
// elements/bars/quicklaunchbar.cpp).

.pragma library

// The pages, by designator, in order. The static configurator makes apps,
// downloads and prefs from conf/default-launcher-page-layout.json; then
// LauncherObject::initPages creates the Favorites page, which must exist,
// at FavoritesPageIndex 2 (dimensionslauncher.cpp:270-291, 352-357;
// operationalsettings.cpp:192-197: system 0, installed 1, favorites 2,
// settings 3). "prefs" is named "settings"
// (conf/launcher3/app-keywords-to-designator-map.txt [designators]).
var PAGES = ["apps", "downloads", "favorites", "prefs"];
var PAGE_TITLES = { apps: "Apps", downloads: "Downloads", favorites: "Favorites", prefs: "Settings" };
// A layout saved before Favorites had three pages.
var LEGACY_PAGES = ["apps", "downloads", "prefs"];

// appinfo.json "phoenix": {"launcherTab"} numbers (docs/APP-RUNTIME.md).
var TAB_DESIGNATORS = ["apps", "downloads", "prefs", "favorites"];

// conf/launcher3/app_blacklist.conf: apps the launcher never shows
// (AppMonitor skips them, appmonitor.cpp:252-256).
var BLACKLIST = ["com.palm.sysapp.launchermode0"];

// conf/launcher3/app-keywords-to-designator-map.txt [keywords]: an app's
// category, else the first of its appinfo.json keywords found here, names
// its page (AppMonitor::pageDesignatorForWebOSApp). The release ships only
// a placeholder (EXAMPLE_DUMMY to a "system" page that does not exist, so
// it never applies); Phoenix adds "settings" and "preferences", so an app
// someone installs that calls itself one lands on the Settings page.
var KEYWORDS = { "example_dummy": "system", "settings": "prefs", "preferences": "prefs" };

// OperationalSettings appCatalogAppId (operationalsettings.cpp:194), and
// the Marketplace that takes its place.
var APP_CATALOGS = ["com.palm.app.enyo-findapps", "org.webosphoenix.marketplace"];
// settingsAppCategoryDesignator (operationalsettings.cpp:196).
var SETTINGS_CATEGORY = "Settings";

function isBlacklisted(id) {
    return BLACKLIST.indexOf(id) >= 0;
}

// The page an entry's keywords name, or "" (pageDesignatorForWebOSApp:
// the category first, then each keyword; only pages that exist count,
// pageIndexForAppByLoadedMappings).
function keywordPage(entry) {
    var words = [entry.category || ""].concat(entry.keywords || []);
    for (var i = 0; i < words.length; ++i) {
        var d = KEYWORDS[String(words[i] || "").toLowerCase()];
        if (d && PAGES.indexOf(d) >= 0)
            return d;
    }
    return "";
}

// The page a new entry goes to:
//  - a launch point an app added (addLaunchPoint): Favorites
//    (LauncherObject::slotAppAuxiliaryIconAdd, dimensionslauncher.cpp:2840-2870);
//  - the page its appinfo.json names (phoenix.launcherTab: Phoenix's own
//    placement for its built-in apps and their launch points);
//  - the page its category or keywords name (above);
//  - else LauncherObject::pageIndexForAppByPredefinedDesignators
//    (dimensionslauncher.cpp:2726-2785): the app catalog and apps the user
//    installed go to Downloads, a built-in app of category Settings to
//    Settings, the rest to Apps.
// entry: {id, appId?, page?, tab?, dynamic?, category?, keywords?, installed?}
function pageFor(entry) {
    if (entry.dynamic)
        return "favorites";
    if (entry.page && PAGES.indexOf(entry.page) >= 0)
        return entry.page;
    var k = keywordPage(entry);
    if (k)
        return k;
    if (APP_CATALOGS.indexOf(entry.appId || entry.id) >= 0)
        return "downloads";
    if (!entry.installed && entry.category === SETTINGS_CATEGORY)
        return "prefs";
    if (entry.installed)
        return "downloads";
    if (typeof entry.tab === "number" && entry.tab >= 0 && entry.tab < TAB_DESIGNATORS.length)
        return TAB_DESIGNATORS[entry.tab];
    return "apps";
}

// Not in the launcher: hidden (tab -1) or blacklisted.
function isHidden(entry) {
    return entry.tab < 0 || isBlacklisted(entry.id) || isBlacklisted(entry.appId || "");
}

// The saved pages by designator (older layouts had three pages).
function _savedPages(saved) {
    var out = {};
    if (!saved || !saved.pages)
        return out;
    var names = saved.designators && saved.designators.length === saved.pages.length ? saved.designators
              : saved.pages.length === LEGACY_PAGES.length ? LEGACY_PAGES : PAGES;
    for (var i = 0; i < saved.pages.length && i < names.length; ++i)
        out[names[i]] = saved.pages[i] || [];
    return out;
}

// entries: [{id, title, tab (-1 hidden), quickLaunch (0, or dock slot 1..),
//            page, dynamic, category, keywords, installed}]
// saved:   a layout from an earlier session, or null.
// Apps keep the page and place they had; new apps go to their page
// (pageFor), after the others, alphabetically; apps that are gone drop out.
function build(entries, saved) {
    var byId = {}, i;
    for (i = 0; i < entries.length; ++i)
        byId[entries[i].id] = entries[i];
    var shown = function(id) { return byId[id] && !isHidden(byId[id]); };
    var removed = saved && saved.removed ? saved.removed.filter(function(id) { return byId[id]; }) : [];
    var isRemoved = function(id) { return removed.indexOf(id) >= 0; };
    var placed = {};
    var kept = _savedPages(saved);
    var pages = PAGES.map(function(d) {
        return (kept[d] || []).filter(function(id) {
            var ok = shown(id) && !placed[id] && !isRemoved(id);
            if (ok)
                placed[id] = true;
            return ok;
        });
    });
    var fresh = entries.filter(function(e) { return !isHidden(e) && !placed[e.id] && !isRemoved(e.id); });
    fresh.sort(function(a, b) { return a.title.localeCompare(b.title); });
    fresh.forEach(function(e) { pages[PAGES.indexOf(pageFor(e))].push(e.id); });

    var dock;
    if (saved && saved.dock) {
        dock = saved.dock.filter(function(id) { return shown(id) && !isRemoved(id); });
    } else {
        dock = entries.filter(function(e) { return e.quickLaunch > 0 && !isHidden(e); })
                      .sort(function(a, b) { return a.quickLaunch - b.quickLaunch; })
                      .map(function(e) { return e.id; });
    }
    return { pages: pages, designators: PAGES.slice(), dock: dock, removed: removed };
}

function copy(layout) {
    return {
        pages: layout.pages.map(function(pg) { return pg.slice(); }),
        designators: (layout.designators || PAGES).slice(),
        dock: layout.dock.slice(),
        removed: (layout.removed || []).slice()
    };
}

function pageOf(layout, id) {
    for (var p = 0; p < layout.pages.length; ++p)
        if (layout.pages[p].indexOf(id) >= 0)
            return p;
    return -1;
}

// The page index of a designator ("favorites" -> 2).
function pageIndex(designator) {
    return PAGES.indexOf(designator);
}

// Move id to page toPage at index (clamped; -1 = the end).
function move(layout, id, toPage, index) {
    var l = copy(layout);
    var from = pageOf(l, id);
    if (from < 0 || toPage < 0 || toPage >= l.pages.length)
        return l;
    l.pages[from].splice(l.pages[from].indexOf(id), 1);
    var pg = l.pages[toPage];
    var at = index < 0 || index > pg.length ? pg.length : index;
    pg.splice(at, 0, id);
    return l;
}

// Put id in the dock at index. A full dock (max apps) swaps out the app at
// that slot, as dropping on an occupied slot did. Already there: moves.
function addToDock(layout, id, index, max) {
    var l = copy(layout);
    var was = l.dock.indexOf(id);
    if (was >= 0)
        l.dock.splice(was, 1);
    var at = Math.max(0, Math.min(index, l.dock.length));
    if (was < 0 && l.dock.length >= max) {
        at = Math.min(at, max - 1);
        l.dock.splice(at, 1, id);
    } else {
        l.dock.splice(at, 0, id);
    }
    return l;
}

function removeFromDock(layout, id) {
    var l = copy(layout);
    var i = l.dock.indexOf(id);
    if (i >= 0)
        l.dock.splice(i, 1);
    return l;
}

// The app was deleted: off the pages and the dock, and not back next time.
function remove(layout, id) {
    var l = copy(layout);
    var p = pageOf(l, id);
    if (p >= 0)
        l.pages[p].splice(l.pages[p].indexOf(id), 1);
    var d = l.dock.indexOf(id);
    if (d >= 0)
        l.dock.splice(d, 1);
    if (l.removed.indexOf(id) < 0)
        l.removed.push(id);
    return l;
}

// A launch point an app removed (removeLaunchPoint) or that the user
// removed: off the pages and the dock. It is gone for good (its id is
// never used again), so it need not be remembered as removed.
function drop(layout, id) {
    var l = copy(layout);
    var p = pageOf(l, id);
    if (p >= 0)
        l.pages[p].splice(l.pages[p].indexOf(id), 1);
    var d = l.dock.indexOf(id);
    if (d >= 0)
        l.dock.splice(d, 1);
    return l;
}

// ---- The icon menu (press and hold; docs/M6-PLAN.md F1) -----------------------

// Favorite: the app goes to the Favorites page (the TouchPad's own place
// for the apps the user picks, LauncherObject::initPages), at its end;
// Unfavorite sends it back to the page it would have had (pageFor).
function isFavorite(layout, id) {
    return pageOf(layout, id) === pageIndex("favorites");
}

function favorite(layout, id) {
    return move(layout, id, pageIndex("favorites"), -1);
}

// entry: as for pageFor. A launch point an app added belongs on Favorites
// (pageFor), so it goes to Apps instead.
function unfavorite(layout, id, entry) {
    var d = entry ? pageFor(entry) : "apps";
    if (d === "favorites")
        d = "apps";
    return move(layout, id, pageIndex(d), -1);
}

// The dock holds max apps beside the launcher button.
function dockFull(layout, max) {
    return layout.dock.length >= max;
}
