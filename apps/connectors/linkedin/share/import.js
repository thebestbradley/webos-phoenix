// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The LinkedIn page's import (index.html, beside the kit's compose page):
// launched without a share, with a LinkedIn account, it offers to import the
// connections of LinkedIn's own data export (Settings, Data privacy, Get a
// copy of your data: Connections), a Connections.csv on the device, picked
// with the system's file picker (org.webosphoenix.filepicker) and read by
// the account's service (importConnections). Plain script, no build.

"use strict";

(function () {
    var $ = function (id) { return document.getElementById(id); };
    var SERVICE = "luna://org.webosphoenix.service.linkedin/";
    var TEMPLATE = "com.webosphoenix.linkedin";

    function call(uri, params) {
        return new Promise(function (resolve) {
            var bridge = new PalmServiceBridge();
            bridge.onservicecallback = function (text) { resolve(JSON.parse(text)); };
            bridge.call(uri, JSON.stringify(params || {}));
        });
    }
    var raw = window.PalmSystem && window.PalmSystem.launchParams;
    var params = {};
    try { params = (raw && JSON.parse(raw)) || {}; } catch (e) { params = {}; }
    if (params.share) return;

    call("luna://com.palm.service.accounts/listAccounts", { templateId: TEMPLATE }).then(function (r) {
        var account = ((r && r.results) || [])[0];
        if (!account) return;
        // Signed in: no "add your account" (the compose page's), the import instead.
        $("none").hidden = true;
        $("import").hidden = false;
        $("importAs").textContent = "Into Contacts, for " + account.username + ".";
        $("importButton").addEventListener("click", function () {
            $("importResult").textContent = "";
            call("luna://org.webosphoenix.filepicker/pick", { kinds: ["file"], extensions: ["csv"], title: "Connections.csv" }).then(function (p) {
                var file = p && p.files && p.files[0];
                if (!file) return null;
                $("importResult").textContent = "Importing…";
                return call(SERVICE + "importConnections", { accountId: account._id, path: file.fullPath || file.path }).then(function (x) {
                    $("importResult").textContent = x.returnValue === false ? (x.errorText || "Not imported")
                        : x.imported === 1 ? "1 connection imported." : x.imported + " connections imported.";
                });
            });
        });
    });
})();
