// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// @phoenix/synckit: the shared sync layer of Phoenix's Synergy transports
// (docs/SYNERGY-MODERN.md 4.2), extracted from the CardDAV / CalDAV
// transport (apps/dav). Plain CommonJS without dependencies, so the same
// files run in a device's run-js-service, in the simulator's page loader
// (runtime/phoenix-runtime.js nodeServiceLoader) and in the tests. The
// connector kit (@phoenix/connector-kit) is built on it; docs/SYNERGY-SDK.md
// explains both.
//
//   luna        createLuna(luna): db8, tempdb, credentials, account info
//   errors      errorCodeOf, fail, syncError: the accounts library's codes
//   syncstate   com.palm.account.syncstate:1 records
//   schedule    the periodic activity per account; one sync at a time
//   http        HTTP with host allow-list, Retry-After backoff, retries
//   items       item records with a base copy; merge3 (three-way merge)
//   linker      com.palm.person:1 for synced contacts (the linker's rules)
//   vcard, ical, datetime, contentline   vCard and iCalendar mappers
//   createRequest   request() on Node's http / https (device only:
//                   required when called, as the simulator has no "http")

"use strict";

var luna = require("./luna");
var errors = require("./errors");
var syncstate = require("./syncstate");
var schedule = require("./schedule");
var http = require("./http");
var items = require("./items");
var linker = require("./linker");
var vcard = require("./vcard");
var ical = require("./ical");
var datetime = require("./datetime");
var contentline = require("./contentline");

module.exports = {
    createLuna: luna.createLuna,
    errorCodeOf: errors.errorCodeOf,
    fail: errors.fail,
    syncError: errors.syncError,
    syncstate: syncstate,
    setSyncState: syncstate.setSyncState,
    createScheduler: schedule.createScheduler,
    createSerializer: schedule.createSerializer,
    intervalSeconds: schedule.seconds,
    createHttp: http.createHttp,
    retryAfterMs: http.retryAfterMs,
    hostMatches: http.hostMatches,
    linkNext: http.linkNext,
    createItemStore: items.createItemStore,
    merge3: items.merge3,
    sameValue: items.same,
    linker: linker,
    vcard: vcard,
    ical: ical,
    datetime: datetime,
    contentline: contentline,
    createRequest: function (options) { return require("./node-http").createRequest(options); }
};
