// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Jabber account's conformance fixture (docs/SYNERGY-SDK.md "Testing";
// phoenix-connector test): its template, what its sign-in page sends, and
// the fake XMPP server (fake-xmpp.cjs) as the sockets the kit gives
// (Environment.net): SRV, STARTTLS and SCRAM, a roster of three. Its 401
// is a SASL failure and a stream error; its 429 a policy-violation, which
// the connector keeps as a 15-minute backoff.

"use strict";

var path = require("path");
var fs = require("fs");
var fake = require("./fake-xmpp.cjs");

var TEMPLATE = path.join(__dirname, "..", "..", "public", "accounts", "com.webosphoenix.xmpp", "com.webosphoenix.xmpp.json");

module.exports = {
    template: JSON.parse(fs.readFileSync(TEMPLATE, "utf8")),
    kindParents: {
        "com.palm.contact.xmpp:1": "com.palm.contact:1", "com.palm.immessage.xmpp:1": "com.palm.immessage:1",
        "com.palm.immessage:1": "com.palm.message:1", "com.palm.imloginstate.xmpp:1": "com.palm.imloginstate:1"
    },
    validateParams: { username: "me@chat.test", password: "pw" },
    server: function () {
        return fake.createFakeXmpp({
            domain: "chat.test", users: { me: "pw" }, replyDelay: 20,
            buddies: [{ jid: "ada@chat.test", name: "Ada Palmer", replies: ["Hi"] }, { jid: "bo@chat.test", name: "Bo", show: "away" },
                      { jid: "cy@chat.test", name: "Cy", online: false }]
        });
    },
    environment: function (server) { return { net: server.net({ websocket: false }) }; },
    minObjects: 4
};
