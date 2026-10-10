// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sync state records: com.palm.account.syncstate:1 in tempdb, one per
// account and capability provider, as the legacy transports kept them
// (docs/SYNERGY-CONNECTORS.md 3.2 rule 5): syncState "INITIAL_SYNC",
// "INCREMENTAL_SYNC", "IDLE" or "ERROR" with errorCode / errorText. The
// Accounts app reads them (enyo lib/accounts accounts-list.js lines
// 118-150: "401_UNAUTHORIZED" or "CREDENTIALS_NOT_FOUND" put the warning
// on the account). Extracted from apps/dav/service/lib/sync.js.

"use strict";

var errors = require("./errors");

var KIND = "com.palm.account.syncstate:1";
var STATES = ["INITIAL_SYNC", "INCREMENTAL_SYNC", "IDLE", "ERROR"];

// tempdb: the db API of luna.js. error: a thrown error (its errorCode,
// message and retryAt are kept). Never throws: a missing sync state must
// not fail a sync.
function setSyncState(tempdb, accountId, capabilityProvider, state, error, log) {
    if (!tempdb) return Promise.resolve();
    if (STATES.indexOf(state) < 0) return Promise.reject(new Error("unknown sync state " + state));
    return tempdb.delQuery({ from: KIND, where: [{ prop: "accountId", op: "=", val: accountId },
                                                 { prop: "capabilityProvider", op: "=", val: capabilityProvider }] })
        .then(function () {
            var o = { _kind: KIND, accountId: accountId, capabilityProvider: capabilityProvider, syncState: state };
            if (error) {
                o.errorCode = error.errorCode || errors.errorCodeOf(error);
                o.errorText = String(error.message || error);
                if (error.retryAt) o.retryAt = error.retryAt;
            }
            return tempdb.put([o]);
        })
        .catch(function (e) { if (log) log("sync state not written: " + e.message); });
}

function getSyncStates(tempdb, accountId) {
    return tempdb.find({ from: KIND, where: [{ prop: "accountId", op: "=", val: accountId }] });
}

function clearSyncStates(tempdb, accountId) {
    return tempdb.delQuery({ from: KIND, where: [{ prop: "accountId", op: "=", val: accountId }] })
        .catch(function () { /* none */ });
}

module.exports = { KIND: KIND, STATES: STATES, setSyncState: setSyncState, getSyncStates: getSyncStates,
                   clearSyncStates: clearSyncStates };
