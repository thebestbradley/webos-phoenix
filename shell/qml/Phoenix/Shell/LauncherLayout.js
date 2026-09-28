// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Where each launcher entry sits: the order of the icons on each launcher
// page (Apps, Downloads, Settings) and in the quick launch dock. Pure
// functions over plain objects, so the shell can persist the layout and the
// tests can check the rules. The layout is
//   { pages: [[id, ...], [id, ...], [id, ...]], dock: [id, ...], removed: [id, ...] }
// where ids are launcher entry ids (apps and launch points), as in the
// launcher3 reorderable pages and quick launch bar of luna-sysmgr
// (Src/lunaui/launcher/elements/page/reorderablepage.cpp,
// elements/bars/quicklaunchbar.cpp).

.pragma library

// entries: [{id, title, tab (-1 hidden), quickLaunch (0, or dock slot 1..)}]
// saved:   a layout from an earlier session, or null.
// Apps keep the page and place they had; new apps go to their default page,
// after the others, alphabetically; apps that are gone drop out.
function build(entries, pageCount, saved) {
    var byId = {}, i;
    for (i = 0; i < entries.length; ++i)
        byId[entries[i].id] = entries[i];
    var removed = saved && saved.removed ? saved.removed.filter(function(id) { return byId[id]; }) : [];
    var isRemoved = function(id) { return removed.indexOf(id) >= 0; };
    var placed = {};
    var pages = [];
    for (var p = 0; p < pageCount; ++p) {
        var kept = saved && saved.pages && saved.pages[p] ? saved.pages[p] : [];
        pages.push(kept.filter(function(id) {
            var ok = byId[id] && byId[id].tab >= 0 && !placed[id] && !isRemoved(id);
            if (ok)
                placed[id] = true;
            return ok;
        }));
    }
    var fresh = entries.filter(function(e) { return e.tab >= 0 && !placed[e.id] && !isRemoved(e.id); });
    fresh.sort(function(a, b) { return a.title.localeCompare(b.title); });
    fresh.forEach(function(e) { pages[Math.min(e.tab, pageCount - 1)].push(e.id); });

    var dock;
    if (saved && saved.dock) {
        dock = saved.dock.filter(function(id) { return byId[id] && !isRemoved(id); });
    } else {
        dock = entries.filter(function(e) { return e.quickLaunch > 0; })
                      .sort(function(a, b) { return a.quickLaunch - b.quickLaunch; })
                      .map(function(e) { return e.id; });
    }
    return { pages: pages, dock: dock, removed: removed };
}

function copy(layout) {
    return {
        pages: layout.pages.map(function(pg) { return pg.slice(); }),
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
