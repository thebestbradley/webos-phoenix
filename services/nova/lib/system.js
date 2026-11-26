// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What novad runs on a device (service.js): the commands of the overlay
// and the restart map (mount, mknod, systemctl, ls-control, pkill), the
// journal for nova log, and luna-send for nova luna-send. The tests put
// stand-ins in their place (test/fake-system.cjs).

"use strict";

var childProcess = require("child_process");

// cmd, args -> Promise<{stdout}>; rejects with {exitCode, message}.
function run(cmd, args) {
    return new Promise(function (resolve, reject) {
        childProcess.execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024, timeout: 120000 }, function (e, stdout, stderr) {
            if (e) {
                var err = new Error(cmd + " " + args.join(" ") + ": " + (String(stderr).trim().split("\n").pop() || e.message));
                err.exitCode = typeof e.code === "number" ? e.code : null;
                return reject(err);
            }
            resolve({ stdout: String(stdout) });
        });
    });
}

// nova log [-f] [ID] (6.1): the journal as JSON lines (journalctl -o json),
// never a shell. filter: an app or service id (its messages, wherever they
// are logged), or a unit name ending in .service. -> stop()
function journal(follow, filter, onLine, onEnd) {
    var args = ["-o", "json", "--no-pager", "-n", "300"];
    if (follow) args.push("-f");
    if (filter && /\.service$/.test(filter)) args.push("-u", filter);
    else if (filter) args.push("--grep", filter.replace(/[^A-Za-z0-9._-]/g, ""));
    var p = childProcess.spawn("journalctl", args);
    var buf = "";
    p.stdout.on("data", function (c) {
        buf += c;
        var lines = buf.split("\n");
        buf = lines.pop();
        lines.forEach(function (l) {
            if (!l) return;
            try {
                var j = JSON.parse(l);
                onLine({ time: j.__REALTIME_TIMESTAMP ? new Date(Number(j.__REALTIME_TIMESTAMP) / 1000).toISOString() : null,
                         unit: j._SYSTEMD_UNIT || j.SYSLOG_IDENTIFIER || null, priority: j.PRIORITY ? Number(j.PRIORITY) : null,
                         message: Array.isArray(j.MESSAGE) ? Buffer.from(j.MESSAGE).toString("utf8") : j.MESSAGE });
            } catch (e) { /* not JSON */ }
        });
    });
    var ended = false;
    function end(e) { if (!ended) { ended = true; onEnd(e || null); } }
    p.on("error", function (e) { end(e); });
    p.on("close", function () { end(null); });
    return function () { p.kill(); };
}

// nova luna-send URI JSON: one call with luna-send as the developer role
// (luna-send -n 1 -f; on the image under the `user` account Developer Mode
// adds: P3 to set its role file). -> Promise<reply>
function lunaSend(uri, params) {
    return run("luna-send", ["-n", "1", "-a", "org.webosphoenix.nova.developer", uri, JSON.stringify(params || {})]).then(function (r) {
        var line = r.stdout.trim().split("\n").pop() || "{}";
        try { return JSON.parse(line); } catch (e) { return { returnValue: false, errorText: line }; }
    });
}

module.exports = { run: run, journal: journal, lunaSend: lunaSend };
