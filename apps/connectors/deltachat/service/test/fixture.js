// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Delta Chat account's conformance fixture (docs/SYNERGY-SDK.md
// "Testing"; phoenix-connector test): its template, what its sign-in page
// sends, and the fake deltachat-rpc-server (fake-rpc-server.cjs) as the
// system helper. Its unauthorized() is a password the mail server refuses,
// its throttle() a server's rate limit, both as Delta Chat's connectivity
// view reports them.

"use strict";

var path = require("path");
var fs = require("fs");
var fake = require("./fake-rpc-server.cjs");

var TEMPLATE = path.join(__dirname, "..", "..", "public", "accounts", "com.webosphoenix.deltachat", "com.webosphoenix.deltachat.json");

module.exports = {
    template: JSON.parse(fs.readFileSync(TEMPLATE, "utf8")),
    kindParents: {
        "com.palm.contact.deltachat:1": "com.palm.contact:1", "com.palm.immessage.deltachat:1": "com.palm.immessage:1",
        "com.palm.immessage:1": "com.palm.message:1", "com.palm.imloginstate.deltachat:1": "com.palm.imloginstate:1"
    },
    validateParams: { username: "me@chat.test", password: "pw" },
    server: function () {
        return fake.createFakeRpcServer({
            domain: "chat.test", users: { "me@chat.test": "pw" }, replyDelay: 10,
            people: [{ addr: "sam@chat.test", name: "Sam Delgado", greeting: "Hi there", replies: ["Hello"] },
                     { addr: "priya@chat.test", name: "Priya Nair", greeting: "Hey" }]
        });
    },
    environment: function (server) {
        return { helper: function () { return Promise.resolve(server.process()); } };
    },
    minObjects: 3
};
