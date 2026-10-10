// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Scheduler glue (docs/SYNERGY-CONNECTORS.md 3.2 rule 6): one periodic
// activity per account through com.palm.activitymanager, with the
// internet requirement, calling the transport's sync method; cancelled
// when the account's last capability is turned off or the account goes.
// The activity's run is reported done ("complete", restart: true) when
// the sync ends, as the legacy activity manager wants. Extracted from
// apps/dav/service/davservice.js.
//
//   createScheduler({call (luna.js call), service, log}) -> {
//     schedule(accountId, {every: "1h", description, requirements?})
//     cancel(accountId)
//     complete($activity)      the sync's {$activity} parameter, if any
//     activityName(accountId)
//   }
//
// "every" is the activity manager's interval ("15m", "1h", "1d"). Shorter
// than 15 minutes is refused: rule 6 of the connector contract.

"use strict";

var UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

function seconds(every) {
    var m = /^(\d+)([smhd])$/.exec(String(every || ""));
    return m ? Number(m[1]) * UNITS[m[2]] : NaN;
}

function createScheduler(options) {
    var call = options.call, service = options.service, log = options.log || function () {};

    function activityName(accountId) { return service + ".sync." + accountId; }

    return {
        activityName: activityName,
        schedule: function (accountId, opts) {
            opts = opts || {};
            var every = opts.every || "1h";
            if (!(seconds(every) >= 15 * 60)) return Promise.reject(new Error("sync interval " + every + ": 15m or more"));
            return call("luna://com.palm.activitymanager/create", {
                activity: {
                    name: activityName(accountId),
                    description: opts.description || "Sync for account " + accountId,
                    type: { background: true, persist: true, explicit: true },
                    schedule: { interval: every },
                    requirements: opts.requirements || { internet: true },
                    callback: { method: "luna://" + service + "/sync", params: { accountId: accountId } }
                },
                start: true,
                replace: true
            }).catch(function (e) { log("periodic sync not scheduled: " + e.message); });
        },
        cancel: function (accountId) {
            return call("luna://com.palm.activitymanager/cancel", { activityName: activityName(accountId) })
                .catch(function () { /* none scheduled */ });
        },
        complete: function (activity) {
            var id = activity && activity.activityId;
            if (!id) return Promise.resolve();
            return call("luna://com.palm.activitymanager/complete", { activityId: id, restart: true }).catch(function () {});
        }
    };
}

// One job at a time per key: a second request while one runs gets the
// running one's result (the DAV service's "one sync at a time per account").
function createSerializer() {
    var running = {};
    return function (key, fn) {
        if (running[key]) return running[key];
        var job = Promise.resolve().then(fn).then(function (r) { delete running[key]; return r; },
                                                  function (e) { delete running[key]; throw e; });
        running[key] = job;
        return job;
    };
}

module.exports = { createScheduler: createScheduler, createSerializer: createSerializer, seconds: seconds };
