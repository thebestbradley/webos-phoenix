// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The everyday features other assistants have (docs/AI-AND-MCP.md,
// "Everyday features"), each area in a file of its own, registered here
// with lib/commands.js's helpers (require("./commands-everyday")(h)):
//
//   commands-notify.js     what did I miss, announcing messages, driving mode
//
// Each area: (h) -> {COMMANDS (as lib/commands.js BUILT_IN, with their
// examples, and whenLocked: may run when asked over the lock screen),
// prepare?(cmd, args, env) -> Promise | null, run(cmd, args, env) ->
// Promise | null, METHODS?, service?(s) -> the service's own methods
// (assistant.js adds them)}. Their words are in lib/lang/en-everyday.js.

"use strict";

var AREAS = [require("./commands-notify")];

module.exports = function (h) {
    var areas = AREAS.map(function (make) { return make(h); });
    var owner = {}, COMMANDS = [], METHODS = [];
    areas.forEach(function (a) {
        (a.COMMANDS || []).forEach(function (c) { owner[c.id] = a; COMMANDS.push(c); });
        METHODS = METHODS.concat(a.METHODS || []);
    });
    return {
        COMMANDS: COMMANDS,
        METHODS: METHODS,
        // -> Promise<{args, reply?, confirm?, awaiting?}> | null (not one of these)
        prepare: function (cmd, args, env) {
            var a = owner[cmd.id];
            return a && a.prepare ? a.prepare(cmd, args, env) : null;
        },
        run: function (cmd, args, env) {
            var a = owner[cmd.id];
            return a ? a.run(cmd, args, env) : null;
        },
        // The service's own methods, each (params) -> Promise<reply>.
        service: function (s) {
            var out = {};
            areas.forEach(function (a) { if (a.service) Object.assign(out, a.service(s)); });
            return out;
        }
    };
};
