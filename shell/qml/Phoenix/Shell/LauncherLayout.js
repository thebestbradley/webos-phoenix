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
//
// The community's launcher (LunaCE, in webOS CE 3.1.0; docs/M6-PLAN.md F4)
// adds to it, in keys an older layout simply lacks:
//   groups: {"group:1": {title, members: [id, ...]}, ...}  app groups
//           (folders): a group's id stands on a page where an app would;
//           its members are on no page themselves
//   titles: {designator: title}  tabs the user renamed
// and tabs the user added, after the four built-in ones, as designators
// "user:1", "user:2", ... (at most MAX_TABS pages in all).

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

// LunaCE: the first four tabs are protected (other parts of webOS expect
// them), and there are at most six.
var MAX_TABS = 6;
// What a new group is called, and the prefix of a group's id.
var GROUP_TITLE = "Group";
var GROUP_PREFIX = "group:";
var USER_PREFIX = "user:";

function isGroup(id) {
    return String(id).indexOf(GROUP_PREFIX) === 0;
}

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

// The tabs the user added, in their order, from a saved layout.
function _savedUserTabs(saved) {
    if (!saved || !saved.designators)
        return [];
    return saved.designators.filter(function(d) { return String(d).indexOf(USER_PREFIX) === 0; })
                            .slice(0, MAX_TABS - PAGES.length);
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
    var designators = PAGES.concat(_savedUserTabs(saved));
    // Groups keep the members that are still there; one left takes the
    // group's place on its page (the group dissolves), none: it goes.
    var groups = {}, savedGroups = saved && saved.groups ? saved.groups : {};
    var pages = designators.map(function(d) {
        var out = [];
        (kept[d] || []).forEach(function(id) {
            if (isGroup(id)) {
                var g = savedGroups[id];
                if (!g || placed[id])
                    return;
                placed[id] = true;
                var members = (g.members || []).filter(function(m) {
                    var ok = !isGroup(m) && shown(m) && !placed[m] && !isRemoved(m);
                    if (ok)
                        placed[m] = true;
                    return ok;
                });
                if (members.length >= 2) {
                    groups[id] = { title: String(g.title || GROUP_TITLE), members: members };
                    out.push(id);
                } else if (members.length === 1) {
                    out.push(members[0]);
                }
                return;
            }
            if (shown(id) && !placed[id] && !isRemoved(id)) {
                placed[id] = true;
                out.push(id);
            }
        });
        return out;
    });
    var fresh = entries.filter(function(e) { return !isHidden(e) && !placed[e.id] && !isRemoved(e.id); });
    fresh.sort(function(a, b) { return a.title.localeCompare(b.title); });
    fresh.forEach(function(e) { pages[PAGES.indexOf(pageFor(e))].push(e.id); });
    var titles = {};
    if (saved && saved.titles)
        designators.forEach(function(d) { if (typeof saved.titles[d] === "string" && saved.titles[d] !== "") titles[d] = saved.titles[d]; });

    var dock;
    if (saved && saved.dock) {
        dock = saved.dock.filter(function(id) { return shown(id) && !isRemoved(id); });
    } else {
        dock = entries.filter(function(e) { return e.quickLaunch > 0 && !isHidden(e); })
                      .sort(function(a, b) { return a.quickLaunch - b.quickLaunch; })
                      .map(function(e) { return e.id; });
    }
    return { pages: pages, designators: designators, dock: dock, removed: removed, groups: groups, titles: titles };
}

function copy(layout) {
    var groups = {}, g;
    for (g in (layout.groups || {}))
        groups[g] = { title: layout.groups[g].title, members: layout.groups[g].members.slice() };
    var titles = {};
    for (g in (layout.titles || {}))
        titles[g] = layout.titles[g];
    return {
        pages: layout.pages.map(function(pg) { return pg.slice(); }),
        designators: (layout.designators || PAGES).slice(),
        dock: layout.dock.slice(),
        removed: (layout.removed || []).slice(),
        groups: groups,
        titles: titles
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
    var l = _outOfGroup(copy(layout), id);
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
    var l = _outOfGroup(copy(layout), id);
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

// ---- App groups (folders; LunaCE, docs/M6-PLAN.md F4) ---------------------------

// The group an app is in, or "".
function groupOf(layout, id) {
    var groups = layout.groups || {};
    for (var g in groups)
        if (groups[g].members.indexOf(id) >= 0)
            return g;
    return "";
}

// The page an app is on, itself or in its group; -1 for none.
function entryPage(layout, id) {
    var p = pageOf(layout, id);
    if (p >= 0)
        return p;
    var g = groupOf(layout, id);
    return g ? pageOf(layout, g) : -1;
}

function _newGroupId(layout) {
    var n = 1;
    while ((layout.groups || {})[GROUP_PREFIX + n])
        ++n;
    return GROUP_PREFIX + n;
}

// A group down to one member gives it the group's place; down to none, the
// group goes (LunaCE: "a group dissolves when one member is left").
function _settle(l, g) {
    var grp = l.groups[g];
    if (!grp || grp.members.length >= 2)
        return l;
    var p = pageOf(l, g);
    if (p >= 0) {
        var at = l.pages[p].indexOf(g);
        if (grp.members.length === 1)
            l.pages[p].splice(at, 1, grp.members[0]);
        else
            l.pages[p].splice(at, 1);
    }
    delete l.groups[g];
    return l;
}

// Takes id out of its group (in place on l), the group settling.
function _outOfGroup(l, id) {
    var g = groupOf(l, id);
    if (!g)
        return l;
    l.groups[g].members.splice(l.groups[g].members.indexOf(id), 1);
    return _settle(l, g);
}

// Dragged onto the centre of target: dragged joins target's group, or the
// two make a new one ("Group") where target was. Groups do not nest; an
// app already in a group leaves it first.
function makeGroup(layout, dragged, target) {
    if (dragged === target || isGroup(dragged) || entryPage(layout, target) < 0 || groupOf(layout, dragged) === target)
        return copy(layout);
    var l = _outOfGroup(copy(layout), dragged);
    var from = pageOf(l, dragged);
    if (from >= 0)
        l.pages[from].splice(l.pages[from].indexOf(dragged), 1);
    if (isGroup(target)) {
        l.groups[target].members.push(dragged);
        return l;
    }
    var tp = pageOf(l, target);
    if (tp < 0)
        return copy(layout);
    var g = _newGroupId(l);
    l.groups[g] = { title: GROUP_TITLE, members: [target, dragged] };
    l.pages[tp].splice(l.pages[tp].indexOf(target), 1, g);
    return l;
}

// Out of its group onto a page: toPage at index (-1, or no toPage: just
// after the group on its page).
function removeFromGroup(layout, id, toPage, index) {
    var g = groupOf(layout, id);
    if (!g)
        return copy(layout);
    var l = copy(layout);
    var gp = pageOf(l, g);
    var page = toPage === undefined || toPage < 0 ? gp : toPage;
    var at = toPage === undefined || toPage < 0 ? l.pages[gp].indexOf(g) + 1 : index;
    l.groups[g].members.splice(l.groups[g].members.indexOf(id), 1);
    var pg = l.pages[page];
    pg.splice(at < 0 || at > pg.length ? pg.length : at, 0, id);
    return _settle(l, g);
}

function renameGroup(layout, g, title) {
    var l = copy(layout);
    if (l.groups[g] && String(title).trim() !== "")
        l.groups[g].title = String(title).trim();
    return l;
}

// Members reordered inside the group's overlay.
function moveInGroup(layout, id, index) {
    var l = copy(layout);
    var g = groupOf(l, id);
    if (!g)
        return l;
    var m = l.groups[g].members;
    m.splice(m.indexOf(id), 1);
    m.splice(Math.max(0, Math.min(index, m.length)), 0, id);
    return l;
}

// ---- Tabs (LunaCE, docs/M6-PLAN.md F4) --------------------------------------------

function tabTitle(layout, i) {
    var d = (layout.designators || PAGES)[i];
    if (layout.titles && typeof layout.titles[d] === "string" && layout.titles[d] !== "")
        return layout.titles[d];
    return PAGE_TITLES[d] || "";
}

function isUserTab(layout, i) {
    return i >= PAGES.length && i < layout.pages.length;
}

function canAddTab(layout) {
    return layout.pages.length < MAX_TABS;
}

// A new tab at the end, named title; the layout unchanged when there are
// MAX_TABS already.
function addTab(layout, title) {
    var l = copy(layout);
    if (!canAddTab(l))
        return l;
    var n = 1;
    while (l.designators.indexOf(USER_PREFIX + n) >= 0)
        ++n;
    var d = USER_PREFIX + n;
    l.designators.push(d);
    l.pages.push([]);
    var t = String(title || "").trim();
    if (t !== "")
        l.titles[d] = t;
    return l;
}

function renameTab(layout, i, title) {
    var l = copy(layout);
    var t = String(title || "").trim();
    if (i < 0 || i >= l.pages.length || t === "")
        return l;
    l.titles[l.designators[i]] = t;
    return l;
}

// A tab the user added goes; its icons (and groups) go to the end of Apps.
// The first four stay.
function removeTab(layout, i) {
    var l = copy(layout);
    if (!isUserTab(l, i))
        return l;
    var ids = l.pages[i];
    l.pages[PAGES.indexOf("apps")] = l.pages[PAGES.indexOf("apps")].concat(ids);
    delete l.titles[l.designators[i]];
    l.pages.splice(i, 1);
    l.designators.splice(i, 1);
    return l;
}
