// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The shell's side of the clipboard history (org.webosphoenix.clipboard,
// M6 F2): what the keyboard's clip strip shows and does, through the
// window source's lunaCall (in phoenix-sim the runtime's simulated service
// in the system UI page; on a device the bus). Copies the shell makes
// itself (Just Type, Copy Link) are recorded here too.
//
// The strip reads clips and categories; keyAvailable says whether the
// keyboard shows the clipboard key (the history on, the key on, not over
// the lock screen, and the service answering).

import QtQuick

QtObject {
    id: client

    // The window source (lunaCall).
    property var source: null
    // The lock screen is up: no key (the lock screen's password panel has the keyboard).
    property bool locked: false
    // App id -> title, for the cards' captions.
    property var titleOf: null

    // org.webosphoenix.clipboard getSettings, as last read.
    property var settings: ({ enabled: true, keyboardKey: true })
    // The service did not answer (no page yet, or none on the bus).
    property bool missing: false
    readonly property bool keyAvailable: !locked && !missing && settings.enabled !== false && settings.keyboardKey !== false

    property var clips: []
    property var categories: []
    property string category: "recent"

    // The Clipboard app, asked for from the strip.
    signal openAppRequested()

    readonly property string service: "luna://org.webosphoenix.clipboard/"

    function _call(method, params, done) {
        if (!source || typeof source.lunaCall !== "function") {
            missing = true;
            if (done)
                done(null);
            return;
        }
        source.lunaCall(service + method, params || {}, function (r) {
            var good = r !== null && r !== undefined && r.returnValue !== false;
            // Not there at all (no page, or nothing on the bus with that name).
            if (r === null || r === undefined || (!good && /not available|Unknown service|not found/i.test(String(r.errorText || ""))))
                missing = true;
            else
                missing = false;
            if (done)
                done(good ? r : null);
        });
    }

    function refreshSettings() {
        _call("getSettings", {}, function (r) {
            if (r && r.settings)
                client.settings = r.settings;
        });
    }

    // The clips of a tab: "recent", "pinned" or a category id.
    function refresh(cat) {
        if (cat !== undefined)
            category = cat;
        var asked = category;
        _call("history", { category: asked, limit: 60 }, function (r) {
            if (!r || asked !== client.category)
                return;
            client.clips = r.clips || [];
            client.categories = r.categories || [];
            if (r.settings)
                client.settings = r.settings;
        });
    }

    // A clip's text to paste (a sensitive one decrypted: the service gives
    // it to the system UI only). done(text), or done(null).
    function paste(clip, done) {
        _call("paste", { id: clip.id }, function (r) {
            done(r && r.clip ? r.clip.text : null);
        });
    }

    function setPinned(clip, on) {
        _call(on ? "pin" : "unpin", { id: clip.id }, function () { client.refresh(); });
    }
    function setCategory(clip, id) {
        _call("setCategory", { id: clip.id, category: id || "" }, function () { client.refresh(); });
    }
    function remove(clip) {
        _call("delete", { id: clip.id }, function () { client.refresh(); });
    }
    function openApp() {
        openAppRequested();
    }
    function appTitle(appId) {
        return titleOf ? titleOf(appId) : "";
    }

    // Text the shell put on the clipboard itself.
    function record(text, appId) {
        if (!text)
            return;
        _call("add", { text: String(text), source: appId || "com.palm.systemui" }, null);
    }
}
