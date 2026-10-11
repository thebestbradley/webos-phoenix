// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.index's pieces on a device, around
// indexservice.js (service.js puts them on the bus; services/index/
// device.test.ts runs them with a temporary folder):
//
//   fileStore(dir)          the index files, written whole and atomically
//                           (a new file renamed over the old), 0600 in a
//                           0700 folder of the service's own
//   jsonStorage(dir)        settings and progress (the Assistant's fileStorage)
//   modelServer(o)          the model through the Assistant's llamaServer
//                           (apps/assistant/service/lib/node-device.js): its
//                           downloads, and llama-server --embedding, with
//                           --mmproj when pictures and recordings are
//                           embedded (a server of the other kind is stopped
//                           first); -c, -b and -ub 8192 (the model's context:
//                           a recording of up to 5 minutes at once), two
//                           slots (-np 2: a search is not queued behind a
//                           pass's batch), one thread (a background job:
//                           the cores are the user's; and on a busy 4-core
//                           computer, load average 40, one thread embedded
//                           a 200-token passage in 0.44-0.62 s and a query
//                           in 50 ms, two in 2.1-3.6 s and 115-340 ms,
//                           their threads waiting on each other)
//   conditions(call)        {charging, battery, idle, saver}: the charger
//                           and battery (com.palm.power), the screen
//                           (com.palm.display: off is idle), and a battery
//                           saver's switch (the system preference
//                           batterySaver, when Phoenix has one: GAPS)
//   assistantLib(name)      a module of the Assistant's service, where the
//                           image installs it (or, in a checkout, beside)

"use strict";

var fs = require("fs");
var path = require("path");

var ASSISTANT = "/usr/palm/services/org.webosphoenix.assistant/lib/";

function assistantLib(name) {
    var installed = path.join(ASSISTANT, name);
    if (fs.existsSync(installed)) return require(installed);
    return require(path.join(__dirname, "..", "..", "apps", "assistant", "service", "lib", name));
}

function fileStore(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    function file(name) {
        if (!/^[a-z0-9-]+\.idx$/.test(name)) throw new Error("bad index file name " + name);
        return path.join(dir, name);
    }
    return {
        read: function (name) {
            return new Promise(function (resolve) {
                fs.readFile(file(name), function (e, b) { resolve(e ? null : new Uint8Array(b.buffer, b.byteOffset, b.byteLength)); });
            });
        },
        write: function (name, bytes) {
            var f = file(name), tmp = f + "." + process.pid + ".tmp";
            return new Promise(function (resolve, reject) {
                fs.writeFile(tmp, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { mode: 0o600 }, function (e) {
                    if (e) return reject(e);
                    fs.rename(tmp, f, function (e2) { if (e2) reject(e2); else resolve(); });
                });
            });
        },
        remove: function (name) {
            return new Promise(function (resolve) { fs.unlink(file(name), function () { resolve(); }); });
        }
    };
}

function jsonStorage(dir) { return assistantLib("node-device.js").fileStorage(dir); }

// o: {modelsDir, pidFile, log, onChange, llamaServer (tests)}
function modelServer(o) {
    var mediaNow = null;
    var llama = (o.llamaServer || assistantLib("node-device.js").llamaServer)({
        modelsDir: o.modelsDir, builtInDirs: [], pidFile: o.pidFile, idleMs: o.idleMs || 2 * 60 * 1000, log: o.log, onChange: o.onChange,
        args: function (m) {
            var a = ["--embedding", "-c", "16384", "-np", "2", "-b", "8192", "-ub", "8192", "-t", "1"];
            // A picture as the model card's default 280 tokens (llama.cpp would take up to 1,120 with this batch).
            if (m.mediaFile) a.push("--mmproj", path.join(o.modelsDir, m.mediaFile.id + ".gguf"), "--image-max-tokens", "280");
            return a;
        }
    });
    return {
        status: function () { return llama.status(); },
        download: function (m) { return llama.download(m); },
        cancel: function (id) { return llama.cancel(id); },
        remove: function (m) { return llama.remove(m); },
        ensure: function (m, media) {
            if (mediaNow !== null && mediaNow !== !!media) llama.stop();
            mediaNow = !!media;
            return llama.ensure(m);
        },
        stop: function () { llama.stop(); }
    };
}

// call(uri, params) -> Promise<payload>
function conditions(call) {
    return function () {
        var get = function (uri, params) { return Promise.resolve(call(uri, params || {})).catch(function () { return {}; }); };
        return Promise.all([
            get("luna://com.palm.power/com/palm/power/chargerStatusQuery"),
            get("luna://com.palm.power/com/palm/power/batteryStatusQuery"),
            get("luna://com.palm.display/control/status"),
            get("luna://com.webos.service.systemservice/getPreferences", { keys: ["batterySaver"] })
        ]).then(function (r) {
            var charger = r[0] || {}, battery = r[1] || {}, display = r[2] || {}, prefs = r[3] || {};
            var pct = typeof battery.percent_ui === "number" ? battery.percent_ui : battery.percent;
            return { charging: !!(charger.Charging || charger.charging),
                     battery: typeof pct === "number" ? pct : 100, idle: display.state === "off", saver: prefs.batterySaver === true };
        });
    };
}

module.exports = { fileStore: fileStore, jsonStorage: jsonStorage, modelServer: modelServer, conditions: conditions, assistantLib: assistantLib };
