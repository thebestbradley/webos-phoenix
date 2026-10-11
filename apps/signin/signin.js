// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Sign In card's page: {session} from the launch, the address from the
// OAuth service (pending {session}: only this app may ask, and only for the
// sign-in that is open), then the provider's page in place of this one.
// Nothing of the sign-in is kept here, and this page's scripts are gone
// once the provider's page loads: the redirect goes to the OAuth service's
// loopback listener, never back to a page of this app.

(function () {
    "use strict";
    var SERVICE = "luna://org.webosphoenix.service.oauth/";
    var bridges = [];

    function launchParams() {
        try {
            var raw = window.PalmSystem && PalmSystem.launchParams;
            var p = typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
            return p && typeof p === "object" ? p : {};
        } catch (e) {
            return {};
        }
    }

    function call(uri, params, done) {
        var b = new PalmServiceBridge();
        bridges.push(b);
        b.onservicecallback = function (text) {
            var r;
            try { r = JSON.parse(text); } catch (e) { r = { returnValue: false, errorText: String(text) }; }
            bridges.splice(bridges.indexOf(b), 1);
            done(r || {});
        };
        b.call(uri, JSON.stringify(params || {}));
    }

    // The provider's page: https, or http on this device's own loopback (a
    // developer's test server). Anything else is not opened.
    function allowed(url) {
        var m = /^(https?):\/\/(?:[^@\/?#]*@)?(\[[^\]]+\]|[^:\/?#]+)/i.exec(String(url || ""));
        if (!m) return false;
        if (m[1].toLowerCase() === "https") return true;
        return /^(127\.0\.0\.1|localhost|\[::1\])$/i.test(m[2]);
    }

    function show(text, canClose) {
        document.getElementById("message").textContent = text;
        document.getElementById("spinner").hidden = !!canClose;
        document.getElementById("close").hidden = !canClose;
    }

    document.getElementById("close").onclick = function () { window.close(); };

    var asked = "";
    function open() {
        var session = String(launchParams().session || "");
        if (!session) return show("There is no sign-in to show.", true);
        if (session === asked) return;
        asked = session;
        call(SERVICE + "pending", { session: session }, function (r) {
            if (session !== asked) return;
            if (!r.returnValue) return show(r.errorCode === "NOT_FOUND" ? "This sign-in has ended." : "The sign-in page could not be opened.", true);
            if (!allowed(r.url)) return show("The sign-in page's address is not a secure one.", true);
            show("Opening " + (r.host || "the sign-in page") + "…", false);
            // replace: Back in the provider's page does not come back here.
            window.location.replace(r.url);
        });
    }

    // Launched again for another sign-in while this page still shows.
    document.addEventListener("webOSRelaunch", open);
    open();
    if (window.PalmSystem && PalmSystem.stageReady) PalmSystem.stageReady();
})();
