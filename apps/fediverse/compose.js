// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The share sheet's Fediverse target (index.html): what is shared
// ({share: {title, text, url, files}, accountId}, docs/SHARE-AND-FILES.md;
// the sheet lists one entry per signed-in account and gives the one picked)
// posted to that account by org.webosphoenix.service.fediverse/share, the
// connector kit's share method (docs/SYNERGY-SDK.md "Sharing to your
// service"), which checks it against the connector's declaration: the text
// with the link, up to four pictures each with its description (alt text,
// which the server shows to people who cannot see the picture), and who may
// see it: public, unlisted, followers only, or only the people mentioned
// (Mastodon's visibilities: https://docs.joinmastodon.org/entities/Status/#visibility).
// One key per share (Idempotency-Key), so a retry never posts twice.

"use strict";

(function () {
    var SERVICE = "luna://org.webosphoenix.service.fediverse/";
    var TEMPLATE = "com.webosphoenix.fediverse";
    var LIMIT = 500;
    var HINTS = {
        "public": "Everyone, and it shows in public timelines.",
        "unlisted": "Everyone, but it stays out of public timelines.",
        "private": "Only your followers.",
        "direct": "Only the people you mention. Not end-to-end encrypted: their servers' admins can read it."
    };
    var $ = function (id) { return document.getElementById(id); };

    function call(uri, params) {
        return new Promise(function (resolve) {
            var bridge = new PalmServiceBridge();
            bridge.onservicecallback = function (text) { resolve(JSON.parse(text)); };
            bridge.call(uri, JSON.stringify(params || {}));
        });
    }

    function launchParams() {
        var raw = window.PalmSystem && window.PalmSystem.launchParams;
        try { return (raw && JSON.parse(raw)) || {}; } catch (e) { return {}; }
    }

    function close() {
        try { window.close(); } catch (e) { /* the card stays */ }
    }

    function pictureUrl(path) {
        var rt = window.__phoenixRuntime;
        if (rt && rt.mediaFiles && rt.mediaFiles.url) return rt.mediaFiles.url(path);
        return Promise.resolve("file://" + path);
    }

    var p = launchParams();
    window.PalmSystem && window.PalmSystem.stageReady && window.PalmSystem.stageReady();

    // A notification tapped: its post or profile, in the browser.
    if (p.open) {
        call("luna://com.palm.applicationManager/open", { target: String(p.open) }).then(close);
        return;
    }

    var share = p.share || {};
    var files = (share.files || []).filter(function (f) { return /^image\//.test(f.mimeType || "") || /\.(jpe?g|png|gif|webp)$/i.test(f.path); }).slice(0, 4);
    var visibility = "public";
    var key = "phoenix-share-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    var accounts = [];

    function setVisibility(v) {
        visibility = v;
        Array.prototype.forEach.call($("visibility").querySelectorAll("button"), function (b) {
            b.setAttribute("aria-checked", b.getAttribute("data-v") === v ? "true" : "false");
        });
        $("visibilityHint").textContent = HINTS[v];
    }

    function update() {
        var n = $("text").value.length;
        $("count").textContent = (LIMIT - n) + "";
        $("count").className = "count" + (n > LIMIT ? " over" : "");
        $("post").disabled = !accounts.length || (!$("text").value.trim() && !files.length) || n > LIMIT;
    }

    function showPictures() {
        files.forEach(function (f, i) {
            var row = document.createElement("div");
            row.className = "picture";
            var img = document.createElement("img");
            img.alt = "";
            pictureUrl(f.path).then(function (u) { img.src = u; });
            var alt = document.createElement("div");
            alt.className = "alt";
            alt.innerHTML = "<label for=\"alt" + i + "\">Description (alt text)</label>";
            var input = document.createElement("input");
            input.type = "text";
            input.id = "alt" + i;
            input.maxLength = 1500;
            input.placeholder = "What is in the picture, for people who cannot see it";
            input.setAttribute("data-path", f.path);
            alt.appendChild(input);
            row.appendChild(img);
            row.appendChild(alt);
            $("pictures").appendChild(row);
        });
    }

    function post() {
        $("post").disabled = true;
        $("post").textContent = "Posting…";
        $("error").textContent = "";
        var media = files.map(function (f, i) {
            return { path: f.path, mimeType: f.mimeType || "", description: $("alt" + i).value.trim() };
        });
        call(SERVICE + "share", { accountId: $("account").value, content: { text: $("text").value.trim(), files: media },
                                  audience: visibility, idempotencyKey: key }).then(function (r) {
            // A retry keeps the key: the server posts it once (Idempotency-Key).
            $("post").textContent = !r.returnValue && r.retryable ? "Try Again" : "Post";
            if (!r.returnValue) {
                $("error").textContent = r.errorCode === "401_UNAUTHORIZED" ? "Your server did not accept the account's sign-in: sign in again in Accounts."
                    : r.retryAt ? "Your server asked to wait. Try again after " + new Date(r.retryAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "."
                    : "Not posted: " + (r.errorText || r.errorCode) + (r.retryable ? ". Try again." : "");
                update();
                return;
            }
            $("compose").hidden = true;
            $("done").hidden = false;
            $("link").textContent = r.url;
            $("link").href = r.url;
            $("link").onclick = function (e) {
                e.preventDefault();
                call("luna://com.palm.applicationManager/open", { target: r.url });
            };
            setTimeout(close, 1500);
        });
    }

    $("text").value = [share.text || (share.url ? share.title : ""), share.url].filter(Boolean).join("\n\n");
    $("text").addEventListener("input", update);
    $("visibility").addEventListener("click", function (e) {
        var v = e.target && e.target.getAttribute && e.target.getAttribute("data-v");
        if (v) setVisibility(v);
    });
    $("cancel").addEventListener("click", close);
    $("post").addEventListener("click", post);
    $("setup").addEventListener("click", function () {
        call("luna://com.palm.applicationManager/launch", { id: "com.palm.app.accounts", params: { templateId: TEMPLATE } }).then(close);
    });
    setVisibility("public");
    showPictures();

    call("luna://com.palm.service.accounts/listAccounts", { templateId: TEMPLATE }).then(function (r) {
        accounts = (r.results || []).filter(function (a) { return !a.beingDeleted; });
        if (!accounts.length) { $("none").hidden = false; return; }
        accounts.forEach(function (a) {
            var o = document.createElement("option");
            o.value = a._id;
            o.textContent = "@" + a.username;
            $("account").appendChild(o);
        });
        // The account picked in the share sheet; still changeable when there are several.
        if (p.accountId && accounts.some(function (a) { return a._id === p.accountId; })) $("account").value = p.accountId;
        var one = accounts.length === 1;
        $("account").hidden = one;
        $("accountLabel").hidden = one;
        $("asOne").textContent = one ? "Post as @" + accounts[0].username : "";
        $("asOne").hidden = !one;
        $("compose").hidden = false;
        update();
        $("text").focus();
    });
})();
