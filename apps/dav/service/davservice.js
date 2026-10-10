// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.dav: the methods com.palm.service.accounts and
// the apps call on a Synergy transport, for the CardDAV / CalDAV account
// template com.webosphoenix.dav
// (apps/dav/public/accounts/com.webosphoenix.dav/com.webosphoenix.dav.json).
// The names and parameters are the ones app-services uses:
//
//   checkCredentials {username, password, templateId, config: {serverUrl}, accountId?}
//       the template's validator (enyo lib/accounts login-utils.js
//       createValidatorParams; accounts service handlers/create.js
//       checkPassword). -> {credentials: {common: {password, serverUrl}},
//       config: {serverUrl, principalUrl, ...}} or errorCode
//       ("401_UNAUTHORIZED", "HOST_NOT_FOUND", ... from enyo lib/accounts/source/errors.js)
//   onCreate {accountId, config}           handlers/notify-created.js
//   onEnabled {accountId, capabilityProviderId, enabled}
//                                          notify-created.js, handlers/modify.js
//   onCredentialsChanged {accountId}       handlers/credentials.js, modify.js
//   onDelete {accountId}                   handlers/notify-deleted.js
//   sync {accountId, capability?}          the capability's "sync" method, which
//       the apps' "Sync now" and the periodic activity call through
//       com.palm.activitymanager (core-apps Contacts app/Prefs.js,
//       Calendar app/shared/CalendarsManager.js syncAccount)
//   accountSettings {accountId}            Phoenix: the server address, for
//       the account wizard (apps/dav/accounts/) when a password is changed
//
// The same service is the transport of the Subscribed Calendar account
// (template com.webosphoenix.webcal; lib/webcal.js): a public .ics address
// read one way into a read-only calendar, every 30 minutes. Its validator
// is checkCredentials {templateId: "com.webosphoenix.webcal", config:
// {url}}, which reads the file; the address is the account's credentials
// (common.url).
//
// It is written against a luna.call(uri, params) -> Promise<reply>
// function so it runs unchanged on a device (service.js, webos-service),
// in the simulator (runtime/phoenix-runtime.js) and in tests.

"use strict";

var synckit = require("@phoenix/synckit");
var syncLib = require("./lib/sync");
var davclient = require("./lib/davclient");
var webcalLib = require("./lib/webcal");

var SERVICE = "org.webosphoenix.service.dav";
var PROVIDER_CAPABILITY = {
    "com.webosphoenix.dav.contacts": "CONTACTS",
    "com.webosphoenix.dav.calendar": "CALENDAR",
    "com.webosphoenix.webcal.calendar": "CALENDAR"
};
var WEBCAL = "com.webosphoenix.webcal";
// A subscribed calendar is read again this often (WebCal Sync's 30 minutes).
var WEBCAL_INTERVAL = "30m";

// A thrown error -> an error code the Accounts app can show (@phoenix/synckit errors.js).
var errorCodeOf = synckit.errorCodeOf;
var fail = synckit.fail;

// options: { luna: {call(uri, params) -> Promise<reply>}, request, log?, localTz?,
//            savePhoto?, linkPersons?, periodicSync? ("1h"; false for none) }
function createDavService(options) {
    var log = options.log || function () {};
    // Luna, db8 and the accounts service, the scheduler and the "one sync
    // at a time per account" rule come from the shared sync layer.
    var luna = options.luna;
    var bus = synckit.createLuna(luna);
    var db = bus.db;
    var tempdb = bus.tempdb;
    var credentials = bus.credentials;
    var accountInfo = bus.accountInfo;
    var scheduler = synckit.createScheduler({ call: bus.call, service: SERVICE, log: log });
    var serialize = synckit.createSerializer();

    function engine(accountId, creds, username) {
        return syncLib.createEngine({
            db: db, tempdb: tempdb, request: options.request, accountId: accountId,
            username: username, password: creds.password, localTz: options.localTz, log: log,
            linkPersons: options.linkPersons, savePhoto: options.savePhoto
        });
    }

    function enabledCapabilities(account) {
        return (account.capabilityProviders || []).map(function (c) { return PROVIDER_CAPABILITY[c.id]; }).filter(Boolean);
    }

    function isWebcal(accountId) {
        return accountInfo(accountId).then(function (a) { return a && a.templateId === WEBCAL; }, function () { return false; });
    }

    function schedulePeriodic(accountId) {
        if (options.periodicSync === false) return Promise.resolve();
        return isWebcal(accountId).then(function (webcal) {
            return scheduler.schedule(accountId, {
                every: webcal ? WEBCAL_INTERVAL : options.periodicSync || "1h",
                description: (webcal ? "Subscribed calendar refresh for account " : "CardDAV / CalDAV sync for account ") + accountId
            });
        });
    }

    function cancelPeriodic(accountId) { return scheduler.cancel(accountId); }

    // A sync started by the service itself goes through the bus like any
    // other, so whoever serializes syncs (the simulator's cross-page lock)
    // sees it too.
    function syncOverBus(accountId, capability) {
        var params = { accountId: accountId };
        if (capability) params.capability = capability;
        return Promise.resolve(luna.call("luna://" + SERVICE + "/sync", params)).then(function (r) {
            if (r && r.returnValue === false) log("sync of " + accountId + " failed: " + (r.errorText || r.errorCode));
        }, function (e) { log("sync of " + accountId + " failed: " + e.message); });
    }

    var methods = {
        checkCredentials: function (p) {
            if (p.templateId === WEBCAL) {
                return Promise.resolve().then(function () {
                    return webcalLib.createWebcal({ db: db, request: options.request, log: log }).check((p.config || {}).url || p.username);
                }).then(function (found) {
                    return {
                        returnValue: true,
                        username: (p.config && p.config.name) || found.name,
                        credentials: { common: { password: "", url: found.url } },
                        config: { url: found.url, name: (p.config && p.config.name) || found.name, events: found.events }
                    };
                }, fail);
            }
            var config = p.config || {};
            var serverUrl = config.serverUrl || config.server || "";
            return Promise.resolve().then(function () {
                // Changing the password of an existing account also refreshes its server record.
                if (p.accountId) {
                    return syncLib.createEngine({ db: db, request: options.request, accountId: p.accountId,
                                                  username: p.username, password: p.password, log: log }).setup(serverUrl);
                }
                return davclient.createClient({ request: options.request, serverUrl: serverUrl, username: p.username,
                                                password: p.password, log: log }).discover();
            }).then(function (found) {
                return {
                    returnValue: true,
                    username: p.username,
                    credentials: { common: { password: p.password, serverUrl: found.serverUrl } },
                    config: { serverUrl: found.serverUrl, principalUrl: found.principalUrl || "",
                              addressbooks: found.addressbooks.length, calendars: found.calendars.length }
                };
            }, fail);
        },

        onCreate: function (p) {
            // A subscribed calendar keeps nothing but its address (in its credentials).
            if (p.config && p.config.url && !p.config.serverUrl) return Promise.resolve({ returnValue: true });
            return credentials(p.accountId).then(function (creds) {
                var serverUrl = (p.config && p.config.serverUrl) || creds.serverUrl;
                return accountInfo(p.accountId).then(function (account) {
                    // No network here: the account record from what the validator found.
                    return db.find({ from: syncLib.KINDS.account, where: [{ prop: "accountId", op: "=", val: p.accountId }] })
                        .then(function (r) {
                            var rec = Object.assign(r[0] || { _kind: syncLib.KINDS.account, accountId: p.accountId }, {
                                serverUrl: davclient.normalizeServer(serverUrl), username: account.username,
                                principalUrl: (p.config && p.config.principalUrl) || ""
                            });
                            return db.put([rec]);
                        });
                });
            }).then(function () { return { returnValue: true }; }, fail);
        },

        onEnabled: function (p) {
            var capability = PROVIDER_CAPABILITY[p.capabilityProviderId];
            if (!capability) return Promise.resolve({ returnValue: false, errorCode: "UNSUPPORTED_CAPABILITY" });
            if (p.enabled) {
                // Reply now; the first sync runs in the background.
                schedulePeriodic(p.accountId).then(function () { return syncOverBus(p.accountId, capability); });
                return Promise.resolve({ returnValue: true });
            }
            return credentials(p.accountId).catch(function () { return {}; }).then(function (creds) {
                return engine(p.accountId, creds, "").removeData(capability);
            }).then(function () {
                return accountInfo(p.accountId).then(function (account) {
                    var left = enabledCapabilities(account).filter(function (c) { return c !== capability; });
                    if (!left.length) return cancelPeriodic(p.accountId);
                }, function () { return cancelPeriodic(p.accountId); });
            }).then(function () { return { returnValue: true }; }, fail);
        },

        // For the account wizard's "modify" mode: the server it signed in to.
        accountSettings: function (p) {
            return db.find({ from: syncLib.KINDS.account, where: [{ prop: "accountId", op: "=", val: p.accountId }] })
                .then(function (r) {
                    var rec = r[0];
                    return rec ? { returnValue: true, serverUrl: rec.serverUrl, username: rec.username, lastSync: rec.lastSync || 0 }
                               : { returnValue: false, errorCode: "400_BAD_REQUEST", errorText: "unknown account" };
                }, fail);
        },

        onCredentialsChanged: function (p) {
            syncOverBus(p.accountId);
            return Promise.resolve({ returnValue: true });
        },

        onDelete: function (p) {
            return cancelPeriodic(p.accountId).then(function () {
                return engine(p.accountId, {}, "").removeData();
            }).then(function () { return { returnValue: true }; }, fail);
        },

        // One sync at a time per account: a second request waits for the
        // running one and gets its result.
        sync: function (p) {
            var accountId = p.accountId;
            if (!accountId) return Promise.resolve({ returnValue: false, errorCode: "400_BAD_REQUEST", errorText: "accountId is required" });
            return serialize(accountId, function () {
                return Promise.all([credentials(accountId), accountInfo(accountId)]).then(function (r) {
                    var creds = r[0], account = r[1];
                    var caps = enabledCapabilities(account);
                    if (p.capability) caps = caps.filter(function (c) { return c === p.capability; });
                    if (!caps.length) return { returnValue: true, skipped: "no enabled capability" };
                    if (account.templateId === WEBCAL) {
                        return webcalLib.createWebcal({ db: db, request: options.request, accountId: accountId, localTz: options.localTz, log: log })
                            .sync(creds.url, account.username).then(function (stats) { return { returnValue: true, stats: stats }; });
                    }
                    return engine(accountId, creds, account.username).sync({ capabilities: caps }).then(function (stats) {
                        return { returnValue: true, stats: stats };
                    });
                }).then(null, fail).then(function (reply) {
                    // A periodic activity is told the run is over (legacy activity manager "complete").
                    scheduler.complete(p.$activity);
                    return reply;
                });
            });
        }
    };
    return methods;
}

var METHODS = ["checkCredentials", "onCreate", "onEnabled", "onCredentialsChanged", "onDelete", "sync", "accountSettings"];

module.exports = { createDavService: createDavService, METHODS: METHODS, SERVICE: SERVICE, errorCodeOf: errorCodeOf };
