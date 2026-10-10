// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The connector kit's compose page (index.html; docs/SYNERGY-SDK.md,
// "Sharing to your service"). The share sheet launches the connector's
// app with
//
//   {share: {title, text, url, files: [{path, mimeType}]},
//    accountId,            the account the user picked in the sheet
//    target}               the declaration (appinfo.json shareTargets[].connector:
//                          templateId, service, accepts, audience, accountLabel)
//
// and this page posts it with <service>/share {accountId, content,
// audience, idempotencyKey}. One key per share, so "Try Again" after an
// error never posts twice. Plain script, no build: it runs in the
// connector's own app, as the original's pages ran in theirs.

"use strict";

(function () {
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

    // The declaration: from the sheet, or this app's own appinfo.json.
    function declaration(p) {
        if (p.target && p.target.service) return Promise.resolve(p.target);
        return new Promise(function (resolve) {
            var x = new XMLHttpRequest();
            x.open("GET", "appinfo.json");
            x.onload = x.onerror = function () {
                var info = {};
                try { info = JSON.parse(x.responseText); } catch (e) { info = {}; }
                document.title = info.title || document.title;
                var t = ((info.phoenix && info.phoenix.shareTargets) || []).filter(function (s) { return s && s.connector; })[0];
                resolve(t ? Object.assign({ label: t.label }, t.connector) : null);
            };
            x.send();
        });
    }

    function close() {
        try { window.close(); } catch (e) { /* the card stays */ }
    }

    function pictureUrl(path) {
        var rt = window.__phoenixRuntime;
        if (rt && rt.mediaFiles && rt.mediaFiles.url) return rt.mediaFiles.url(path);
        return Promise.resolve("file://" + path);
    }

    function label(pattern, account) {
        return String(pattern || "{username}").replace(/\{(\w+)\}/g, function (m, k) { return String(account[k] || ""); });
    }

    function kindOf(accepts, mimeType) {
        var order = /^image\//.test(mimeType) ? ["image", "file"] : /^video\//.test(mimeType) ? ["video", "file"] : ["file"];
        var defaults = { image: ["image/*"], video: ["video/*"], file: ["*/*"] };
        for (var i = 0; i < order.length; i++) {
            var l = accepts[order[i]];
            if (!l) continue;
            var types = l.mimeTypes && l.mimeTypes.length ? l.mimeTypes : defaults[order[i]];
            if (types.some(function (t) { return t === "*/*" || t === mimeType || (/\/\*$/.test(t) && mimeType.indexOf(t.slice(0, -1)) === 0); }))
                return order[i];
        }
        return null;
    }

    function mimeOf(f) {
        if (f.mimeType) return f.mimeType;
        var m = /\.([a-z0-9]+)$/i.exec(f.path || "");
        var ext = m ? m[1].toLowerCase() : "";
        return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
                 mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" }[ext] || "application/octet-stream";
    }

    var p = launchParams();
    window.PalmSystem && window.PalmSystem.stageReady && window.PalmSystem.stageReady();

    declaration(p).then(function (target) {
        if (!target) { $("none").hidden = false; $("setup").hidden = true; return; }
        var accepts = target.accepts || {};
        var share = p.share;
        var heading = "Post to " + (target.label || document.title);
        $("heading").textContent = heading;
        document.title = target.label || document.title;
        $("setup").addEventListener("click", function () {
            call("luna://com.palm.applicationManager/launch", { id: "com.palm.app.accounts", params: { templateId: target.templateId } }).then(close);
        });
        // Launched without a share: where the account is added.
        if (!share) { $("none").hidden = false; return; }

        var key = "phoenix-share-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
        var accounts = [];
        var audience = target.audience ? (target.audience["default"] || target.audience.options[0].value) : undefined;
        var textLimit = accepts.text && accepts.text.maxLength;

        // What is shared, as the declaration takes it; more than its max is left out, and the page says so.
        var counts = {}, left = 0;
        var files = (share.files || []).map(function (f) {
            var mt = mimeOf(f);
            return { path: f.path, mimeType: mt, kind: kindOf(accepts, mt) };
        }).filter(function (f) {
            if (!f.kind) { left++; return false; }
            counts[f.kind] = (counts[f.kind] || 0) + 1;
            var max = accepts[f.kind].max;
            if (max && counts[f.kind] > max) { left++; return false; }
            return true;
        });
        if (left) {
            $("trimmed").hidden = false;
            $("trimmed").textContent = left === 1 ? "One file is not posted: " + (target.label || "the service") + " takes fewer, or not this kind."
                : left + " files are not posted: " + (target.label || "the service") + " takes fewer, or not these kinds.";
        }
        var url = accepts.link ? (share.url || "") : "";
        var startText = [share.text || (share.url && !accepts.link ? share.title : ""), accepts.link ? "" : share.url].filter(Boolean).join("\n\n");

        function update() {
            var n = $("text").value.length;
            $("count").textContent = accepts.text && textLimit ? String(textLimit - n) : "";
            $("count").className = "count" + (textLimit && n > textLimit ? " over" : "");
            var something = (accepts.text && $("text").value.trim()) || url || files.length;
            $("post").disabled = !accounts.length || !something || (textLimit && n > textLimit);
        }

        if (accepts.text) {
            $("text").hidden = false;
            $("text").value = startText;
            $("text").addEventListener("input", update);
        }
        if (url) {
            $("link").hidden = false;
            $("link").textContent = url;
        }
        files.forEach(function (f, i) {
            var row = document.createElement("div");
            row.className = "file";
            if (f.kind === "image") {
                var img = document.createElement("img");
                img.alt = "";
                pictureUrl(f.path).then(function (u) { img.src = u; });
                row.appendChild(img);
            } else {
                var thumb = document.createElement("div");
                thumb.className = "thumb";
                thumb.textContent = f.kind === "video" ? "Video" : "File";
                row.appendChild(thumb);
            }
            var about = document.createElement("div");
            about.className = "about";
            about.appendChild(document.createTextNode(String(f.path).replace(/^.*\//, "")));
            var alt = accepts[f.kind].altText;
            if (alt) {
                var lab = document.createElement("label");
                lab.setAttribute("for", "alt" + i);
                lab.textContent = "Description (alt text)";
                var input = document.createElement("input");
                input.type = "text";
                input.id = "alt" + i;
                if (alt.maxLength) input.maxLength = alt.maxLength;
                input.placeholder = "What is in it, for people who cannot see it";
                about.appendChild(lab);
                about.appendChild(input);
            }
            row.appendChild(about);
            $("files").appendChild(row);
        });

        if (target.audience) {
            $("audienceBox").hidden = false;
            if (target.audience.label) $("audienceLabel").textContent = target.audience.label;
            target.audience.options.forEach(function (o) {
                var b = document.createElement("button");
                b.type = "button";
                b.setAttribute("role", "radio");
                b.setAttribute("data-v", o.value);
                b.textContent = o.label;
                b.addEventListener("click", function () { setAudience(o.value); });
                $("audience").appendChild(b);
            });
        }
        function setAudience(v) {
            audience = v;
            Array.prototype.forEach.call($("audience").querySelectorAll("button"), function (b) {
                b.setAttribute("aria-checked", b.getAttribute("data-v") === v ? "true" : "false");
            });
            var o = target.audience.options.filter(function (x) { return x.value === v; })[0];
            $("audienceHint").textContent = (o && o.hint) || "";
        }
        if (target.audience) setAudience(audience);

        function message(r) {
            if (r.errorCode === "401_UNAUTHORIZED") return "The service did not accept the account's sign-in: sign in again in Accounts.";
            if (r.errorCode === "ACCOUNT_NOT_FOUND") return "That account is no longer on this device.";
            if (r.retryAt) return "The server asked to wait. Try again after " + new Date(r.retryAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + ".";
            return "Not posted: " + (r.errorText || r.errorCode) + (r.retryable ? ". Try again." : "");
        }

        function post() {
            $("post").disabled = true;
            $("post").textContent = "Posting…";
            $("error").textContent = "";
            var content = {
                title: share.title || "",
                text: accepts.text ? $("text").value.trim() : "",
                url: url,
                files: files.map(function (f, i) {
                    var a = $("alt" + i);
                    return { path: f.path, mimeType: f.mimeType, description: a ? a.value.trim() : "" };
                })
            };
            call("luna://" + target.service + "/share", { accountId: $("account").value, content: content, audience: audience, idempotencyKey: key })
                .then(function (r) {
                    $("post").textContent = r.returnValue === false && r.retryable ? "Try Again" : "Post";
                    if (r.returnValue === false) {
                        $("error").textContent = message(r);
                        update();
                        return;
                    }
                    $("compose").hidden = true;
                    $("done").hidden = false;
                    var link = r.url || (r.posted && r.posted.url) || "";
                    $("posted").textContent = link;
                    $("posted").onclick = function (e) {
                        e.preventDefault();
                        if (link) call("luna://com.palm.applicationManager/open", { target: link });
                    };
                    setTimeout(close, 1500);
                });
        }
        $("cancel").addEventListener("click", close);
        $("post").addEventListener("click", post);

        call("luna://com.palm.service.accounts/listAccounts", { templateId: target.templateId }).then(function (r) {
            accounts = (r.results || []).filter(function (a) { return !a.beingDeleted; });
            if (!accounts.length) { $("none").hidden = false; return; }
            accounts.forEach(function (a) {
                var o = document.createElement("option");
                o.value = a._id;
                o.textContent = label(target.accountLabel, a);
                $("account").appendChild(o);
            });
            // The account picked in the sheet; still changeable when there are several.
            if (p.accountId && accounts.some(function (a) { return a._id === p.accountId; })) $("account").value = p.accountId;
            var one = accounts.length === 1;
            $("account").hidden = one;
            $("accountLabel").hidden = one;
            $("asOne").textContent = one ? "Post as " + label(target.accountLabel, accounts[0]) : "";
            $("asOne").hidden = !one;
            $("compose").hidden = false;
            update();
            if (accepts.text) $("text").focus();
        });
    });
})();
