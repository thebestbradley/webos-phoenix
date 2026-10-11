// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Unofficial Telegram account's conformance fixture (docs/SYNERGY-SDK.md
// "Testing"; phoenix-connector test): its template, the sign-in page's
// steps (the phone number, then the code) before the validator, a test app
// id as the build's setting, and the fake tdjson (fake-tdjson.cjs) as the
// system helper. Its unauthorized() is the session ended on Telegram's
// side, its throttle() FLOOD_WAIT.

"use strict";

var path = require("path");
var fs = require("fs");
var fake = require("./fake-tdjson.cjs");

var TEMPLATE = path.join(__dirname, "..", "..", "public", "accounts", "com.webosphoenix.telegram", "com.webosphoenix.telegram.json");

module.exports = {
    template: JSON.parse(fs.readFileSync(TEMPLATE, "utf8")),
    kindParents: {
        "com.palm.contact.telegram:1": "com.palm.contact:1", "com.palm.immessage.telegram:1": "com.palm.immessage:1",
        "com.palm.immessage:1": "com.palm.message:1", "com.palm.imloginstate.telegram:1": "com.palm.imloginstate:1"
    },
    validateParams: { username: "+15550100" },
    server: function () {
        return fake.createFakeTdjson({
            accounts: [{ phone: "+15550100", code: "24680", firstName: "Me" }], replyDelay: 10,
            people: [{ id: 7000001, phone: "+15550101", firstName: "Sam", lastName: "Delgado", greeting: "Hi there", replies: ["Hello"] },
                     { id: 7000002, phone: "+15550102", firstName: "Priya", greeting: "Hey" }]
        });
    },
    environment: function (server) {
        return {
            helper: function () { return Promise.resolve(server.process()); },
            settings: function () { return Promise.resolve({ apiId: 1, apiHash: "test-only-not-a-telegram-app" }); }
        };
    },
    beforeValidate: function (methods) {
        return methods.signIn({ phone: "+1 555 0100" }).then(function (r) {
            if (!r.returnValue || r.state !== "code") throw new Error("signIn(phone): " + JSON.stringify(r));
            return methods.signIn({ key: r.key, code: "24680" });
        }).then(function (r) {
            if (!r.returnValue || r.state !== "ready") throw new Error("signIn(code): " + JSON.stringify(r));
            return { config: { key: r.key } };
        });
    },
    minObjects: 3
};
