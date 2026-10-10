// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Luna calls every Synergy transport makes, over one injected function,
// luna.call(uri, params) -> Promise<reply>: webos-service's call on a device
// (apps/dav/service/service.js), the simulated bus in the simulator
// (runtime/phoenix-runtime.js nodeServiceLuna), a fake bus in tests
// (test/memdb.js). Extracted from apps/dav/service/davservice.js.
//
//   createLuna(luna) -> {
//     call(uri, params)          the reply, or throws when returnValue is
//                                false (error.errorCode, error.errorText)
//     db, tempdb                 db8 as the sync engines want it: find(query)
//                                -> every result (pages followed unless the
//                                query has a limit), get(ids), put(objects) /
//                                merge(objects) -> [{id, rev}], del(ids),
//                                delQuery(query)
//     credentials(accountId, name?)   com.palm.service.accounts readCredentials
//                                ("common" by default) -> the credentials
//     writeCredentials(accountId, credentials)
//     accountInfo(accountId)     getAccountInfo -> the account, annotated
//                                with its template (capabilityProviders)
//   }

"use strict";

function createLuna(luna) {
    function call(uri, params) {
        return Promise.resolve(luna.call(uri, params || {})).then(function (r) {
            if (!r || r.returnValue === false) {
                var e = new Error((r && (r.errorText || r.errorMessage)) || ("call failed: " + uri));
                e.errorCode = r && r.errorCode;
                throw e;
            }
            return r;
        });
    }

    function dbApi(service) {
        var base = "luna://" + service + "/";
        return {
            find: function (query) {
                var all = [];
                function page(p) {
                    var q = Object.assign({}, query);
                    if (p) q.page = p;
                    return call(base + "find", { query: q }).then(function (r) {
                        all = all.concat(r.results || []);
                        if (r.next && !query.limit) return page(r.next);
                        return all;
                    });
                }
                return page(null);
            },
            get: function (ids) { return call(base + "get", { ids: ids }).then(function (r) { return r.results || []; }); },
            put: function (objects) { return call(base + "put", { objects: objects }).then(function (r) { return r.results; }); },
            merge: function (objects) { return call(base + "merge", { objects: objects }).then(function (r) { return r.results; }); },
            del: function (ids) { return call(base + "del", { ids: ids }).then(function (r) { return r.results; }); },
            delQuery: function (query) { return call(base + "del", { query: query }); }
        };
    }

    return {
        call: call,
        db: dbApi("com.palm.db"),
        tempdb: dbApi("com.palm.tempdb"),
        credentials: function (accountId, name) {
            return call("luna://com.palm.service.accounts/readCredentials", { accountId: accountId, name: name || "common" })
                .then(function (r) { return r.credentials || {}; });
        },
        writeCredentials: function (accountId, credentials) {
            return call("luna://com.palm.service.accounts/writeCredentials", { accountId: accountId, credentials: credentials });
        },
        accountInfo: function (accountId) {
            return call("luna://com.palm.service.accounts/getAccountInfo", { accountId: accountId })
                .then(function (r) { return r.result; });
        }
    };
}

module.exports = { createLuna: createLuna };
