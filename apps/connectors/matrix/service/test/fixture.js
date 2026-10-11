// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Matrix account's conformance fixture (docs/SYNERGY-SDK.md "Testing";
// phoenix-connector test): its template, what its sign-in page sends, and
// the fake homeserver (fake-homeserver.cjs) behind the kit's HTTP, its long
// polls short. Its 401 is M_UNKNOWN_TOKEN, its 429 M_LIMIT_EXCEEDED with
// Retry-After.

"use strict";

var path = require("path");
var fs = require("fs");
var fake = require("./fake-homeserver.cjs");

var TEMPLATE = path.join(__dirname, "..", "..", "public", "accounts", "com.webosphoenix.matrix", "com.webosphoenix.matrix.json");

module.exports = {
    template: JSON.parse(fs.readFileSync(TEMPLATE, "utf8")),
    kindParents: {
        "com.palm.contact.matrix:1": "com.palm.contact:1", "com.palm.immessage.matrix:1": "com.palm.immessage:1",
        "com.palm.immessage:1": "com.palm.message:1", "com.palm.imloginstate.matrix:1": "com.palm.imloginstate:1"
    },
    validateParams: { username: "@me:matrix.test", password: "pw" },
    server: function () {
        return fake.createFakeHomeserver({
            serverName: "matrix.test", users: { me: "pw" }, replyDelay: 20, maxWaitMs: 50,
            people: [{ userId: "@sam:matrix.test", displayname: "Sam Delgado", greeting: "Hi there", replies: ["Hello"] },
                     { userId: "@priya:matrix.test", displayname: "Priya Nair", encrypted: true, greeting: "x" }]
        });
    },
    minObjects: 3
};
