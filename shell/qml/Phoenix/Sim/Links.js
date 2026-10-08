// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Where a link in a web app's window goes (WebAppWindow.qml). Pure
// functions, so the window and the tests (tst_links.qml) share them.
//
// On webOS a page of an app did not load other sites in the app's card:
// WebAppMgr handed what the page should not show to the application
// manager, applicationManager/open {target} (WebAppManager::mimeHandoffUrl,
// webappmanager Src/webbase/WebAppManager.cpp:1747-1773), which launched
// the app for it (the browser for web pages, Email for mailto:, ...). The
// pages of the browser (and Email's message bodies) are BrowserAdapter
// views, which hand links matching the app's redirects back to the app
// (BrowserAdapter.cpp js_addUrlRedirect :1945-1981, msgUrlRedirected
// :4760-4767; enyo BasicWebView urlRedirected).

.pragma library

// Schemes a page loads itself; any other (mailto:, tel:, spotify:...)
// belongs to an app.
var LOCAL = /^(phoenix|file|data|blob|about|qrc|javascript|chrome|devtools):/i;
var WEB = /^https?:/i;

function isWeb(url) { return WEB.test(String(url)); }
function isLocal(url) { return LOCAL.test(String(url)); }

// The part of the web a site (an installed web app) covers: its manifest's
// scope, else its start page's origin.
function scopeOf(main, scope) {
    if (scope)
        return String(scope);
    var m = /^(https?:\/\/[^\/?#]+)/i.exec(String(main || ""));
    return m ? m[1] + "/" : "";
}

function _escape(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&"); }

// The scope as a redirect pattern: http or https, and the site with or
// without its "www." or "m." (a link to www.youtube.com is the m.youtube.com
// web app's). The same pattern the application manager uses for the site's
// handler (urlHandlers in runtime/phoenix-runtime.js).
function scopePattern(scope) {
    var m = /^https?:\/\/(?:www\.|m\.)?([^\/?#]+)(.*)$/i.exec(String(scope || ""));
    if (!m)
        return "";
    var path = m[2] || "/";
    if (path.charAt(0) !== "/")
        path = "/" + path;
    // ".../app/" also covers ".../app" itself (and "/" the bare site).
    var tail = path.charAt(path.length - 1) === "/"
        ? _escape(path.slice(0, -1)) + "(?:[/?#]|$)" : _escape(path);
    return "^https?://(?:www\\.|m\\.)?" + _escape(m[1]) + "(?::\\d+)?" + tail;
}

function inScope(url, scope) {
    var p = scopePattern(scope);
    return p !== "" && new RegExp(p, "i").test(String(url));
}

// A navigation of a window's own page. kind: "link" (a link was followed),
// "typed" (the shell loaded it), "form", "backforward", "reload", "redirect",
// "other" (script). site: the window shows a site; scope its scope.
// -> "accept" (load it here) or "route" (the app for it opens it).
function navigation(url, kind, mainFrame, site, scope) {
    url = String(url);
    if (!mainFrame || isLocal(url))
        return "accept";
    if (!isWeb(url))
        return "route";
    // What the shell itself loads, and history, stay.
    if (kind === "typed" || kind === "backforward" || kind === "reload")
        return "accept";
    // A site follows its own links and whatever its pages do by script or
    // by redirect (sign-in pages on other domains): only links out of its
    // scope go to the app for them (the browser, another web app).
    if (site)
        return kind === "link" && !inScope(url, scope) ? "route" : "accept";
    // An app's page leaving the app.
    return "route";
}

// A page asking for a new window (window.open, a link with target=_blank).
// dialog: a pop-up window with features (a site's sign-in pop-up, which
// talks back to its opener). -> "window" (a card of the same app, as
// before) or "route".
function newWindow(url, dialog, site, scope) {
    url = String(url);
    // The runtime's alerts and dashboards, and windows of the app's own pages.
    if (url === "" || isLocal(url) || /[#&]phoenixWindow=/.test(url))
        return "window";
    if (!isWeb(url))
        return "route";
    if (site)
        return dialog || inScope(url, scope) ? "window" : "route";
    return "route";
}

// BrowserAdapter's redirects ([{regex, enable, cookie}], in the order the
// page added them; a later one for the same regex replaces it): the cookie
// of the first that matches when it is enabled, else null. A disabled one
// keeps what it matches in the view (Email's "^file:" before ".*").
function redirectFor(url, redirects) {
    url = String(url);
    for (var i = 0; redirects && i < redirects.length; ++i) {
        var r = redirects[i], re;
        try { re = new RegExp(r.regex, "i"); } catch (e) { continue; }
        if (re.test(url))
            return r.enable ? String(r.cookie || "") : null;
    }
    return null;
}

// Pages without the runtime (sites, the browser's page views): a link to a
// scheme Chromium does not load (mailto:, tel:...) would just be refused
// (unknownUrlSchemePolicy), with nothing for the shell to hear. This
// script, in a world of its own, tells the window instead.
var LINK_PREFIX = "__phoenix_link__";
var linkScript =
    "(function () {" +
    " var LOCAL = /^(https?|phoenix|file|data|blob|about|javascript):/i;" +
    " window.addEventListener('click', function (e) {" +
    "  if (e.defaultPrevented || e.button !== 0) return;" +
    "  var a = e.target && e.target.closest && e.target.closest('a[href]');" +
    "  if (!a || LOCAL.test(a.href)) return;" +
    "  e.preventDefault();" +
    "  console.log('" + LINK_PREFIX + "' + a.href);" +
    " }, false);" +
    "})();";
