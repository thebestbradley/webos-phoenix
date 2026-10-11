// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The home, through the user's Home Assistant (docs/AI-AND-MCP.md,
// "Everyday features"): Settings > Assistant > Smart Home keeps its address
// and a long-lived access token (made in Home Assistant under the user's
// profile, Security), the token sealed as the model providers' keys are.
// Home Assistant's REST API (https://developers.home-assistant.io/docs/api/rest/):
//
//   GET  /api/                       {"message": "API running."}: connected
//   GET  /api/states                 every entity: {entity_id, state, attributes: {friendly_name, ...}}
//   GET  /api/states/<entity_id>     one, read back after a change
//   POST /api/services/<domain>/<service> {entity_id, ...}
//
//   home       "turn off the living room lights", "turn on the fan", "dim
//              the bedroom light to 30%", "set the thermostat to 70", "lock
//              the front door", "open the garage door", "is the front door
//              locked": the entity named by its friendly name (or, for
//              "the lights", every light); lights, switches, fans, climate,
//              locks and covers. Unlocking a lock and opening a cover (a
//              garage door) are read back first.
//   homeScene  "activate movie night", "turn on the relax scene": scene.turn_on
//
// Without Home Assistant connected, the grammar leaves these words alone (the
// "I can't control other devices" answer, which says where to connect it).
//
// The service's methods (Settings): homeAssistant {} -> {url, connected,
// entities}, setHomeAssistant {url, token} (checked against /api/ first),
// removeHomeAssistant {}.

"use strict";

var KEY = "assistant:homeAssistant";
var DOMAINS = ["light", "switch", "fan", "climate", "lock", "cover", "scene", "input_boolean"];
// A device slower to say it did (a Z-Wave lock): read again after this.
var READ_AGAIN_MS = 1500;

var COMMANDS = [
    { id: "home", title: "Smart home", risk: "change",
      description: "Control a device in the user's Home Assistant by its name: lights, switches, fans, the thermostat, locks, garage doors and blinds; or say how one is.",
      parameters: { type: "object", properties: {
          action: { type: "string", enum: ["on", "off", "set", "up", "down", "lock", "unlock", "open", "close", "status"] },
          target: { type: "string", description: "The device as said: \"living room lights\", \"thermostat\", \"front door\"" },
          value: { type: "number", description: "set: a light's brightness (percent) or the thermostat's temperature" } }, required: ["action", "target"] },
      examples: ["kill the kitchen lights", "make it warmer, set the heat to 72", "is the garage closed"] },
    { id: "homeScene", title: "Smart home scenes", risk: "change",
      description: "Turn on one of the user's Home Assistant scenes by its name.",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      examples: ["set the mood for movie night", "start the dinner scene"] }
];

function fold(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(?:the|my|all|our|of|in|at)\b/g, " ").replace(/\blights\b/g, "light")
        .replace(/\blamps\b/g, "lamp").replace(/\s+/g, " ").trim();
}
function domainOf(id) { return String(id).split(".")[0]; }

module.exports = function (h) {
    function conf(env) { return env.storage.get(KEY) || null; }
    function token(env, c) { return c && c.tokenEnc && env.secrets ? Promise.resolve(env.secrets.unseal(c.tokenEnc)) : Promise.resolve(""); }
    function api(env, c, tok, method, path, body) {
        return env.request({ method: method, url: c.url + path, headers: Object.assign({ Authorization: "Bearer " + tok, Accept: "application/json" },
                                                                                       body ? { "Content-Type": "application/json" } : {}),
                             body: body ? JSON.stringify(body) : undefined }).then(function (r) {
            if (r.status === 401 || r.status === 403) throw Object.assign(new Error("HTTP " + r.status), { auth: true });
            if (r.status < 200 || r.status >= 300) throw new Error("HTTP " + r.status);
            return r.body ? JSON.parse(r.body) : null;
        });
    }
    // The entities a person names, by friendly name and kind, kept for the grammar (context).
    function states(env, c, tok) {
        return api(env, c, tok, "GET", "/api/states").then(function (list) {
            var mine = (Array.isArray(list) ? list : []).filter(function (s) { return s && s.entity_id && DOMAINS.indexOf(domainOf(s.entity_id)) >= 0; });
            var kept = env.storage.get(KEY);
            if (kept && kept.url === c.url)
                env.storage.set(KEY, Object.assign(kept, { entities: mine.slice(0, 300).map(function (s) { return { name: nameOf(s), domain: domainOf(s.entity_id) }; }) }));
            return mine;
        });
    }
    function nameOf(s) { return String((s.attributes && s.attributes.friendly_name) || s.entity_id.split(".")[1].replace(/_/g, " ")); }
    // The entities the words name: by friendly name (all its words in what
    // was said, or what was said in it), the domains the action fits first.
    function pick(list, target, domains) {
        var t = fold(target), fit = list.filter(function (s) { return domains.indexOf(domainOf(s.entity_id)) >= 0; });
        var exact = fit.filter(function (s) { return fold(nameOf(s)) === t; });
        if (exact.length) return exact;
        // "The lights": every light, the lamps too.
        if (t === "light") return fit.filter(function (s) { return domainOf(s.entity_id) === "light"; });
        var words = t.split(" ").filter(Boolean);
        var named = fit.filter(function (s) {
            var n = " " + fold(nameOf(s)) + " ";
            return words.every(function (w) { return n.indexOf(" " + w + " ") >= 0; });
        });
        if (named.length) return named;
        // "The lights", "the thermostat": every one of its kind.
        if (/^(?:light|lamp)$/.test(t)) return fit.filter(function (s) { return domainOf(s.entity_id) === "light"; });
        if (/^(?:door|doors|lock|locks)$/.test(t)) return fit.filter(function (s) { return domainOf(s.entity_id) === "lock"; });
        if (/^(?:fan|fans)$/.test(t)) return fit.filter(function (s) { return domainOf(s.entity_id) === "fan"; });
        if (/^(?:thermostat|heat|heating|temperature|ac|air conditioning|air conditioner)$/.test(t)) return fit.filter(function (s) { return domainOf(s.entity_id) === "climate"; });
        return [];
    }
    function domainsFor(action) {
        if (action === "lock" || action === "unlock") return ["lock"];
        if (action === "open" || action === "close") return ["cover"];
        if (action === "set") return ["light", "climate", "fan"];
        if (action === "up" || action === "down") return ["climate"];
        if (action === "status") return DOMAINS;
        return ["light", "switch", "fan", "input_boolean", "climate"];
    }
    // The call for an action on one entity: [domain, service, data, (the
    // state read back after) -> "done" | "moving" | "" (not yet)]. A lock and
    // a garage door take a while: "locking", "opening" say the call was taken.
    function serviceFor(action, s, value) {
        var d = domainOf(s.entity_id), data = { entity_id: s.entity_id };
        function is(done, moving) { return function (now) { return now.state === done ? "done" : moving && now.state === moving ? "moving" : ""; }; }
        if (action === "lock") return ["lock", "lock", data, is("locked", "locking")];
        if (action === "unlock") return ["lock", "unlock", data, function (now) { return /^(?:unlocked|open)$/.test(now.state) ? "done" : now.state === "unlocking" ? "moving" : ""; }];
        if (action === "open") return ["cover", "open_cover", data, is("open", "opening")];
        if (action === "close") return ["cover", "close_cover", data, is("closed", "closing")];
        if (action === "set" && d === "climate")
            return ["climate", "set_temperature", Object.assign(data, { temperature: value }), function (now) { return Number(now.attributes && now.attributes.temperature) === value ? "done" : ""; }];
        if (action === "set" && d === "light") return ["light", "turn_on", Object.assign(data, { brightness_pct: Math.max(1, Math.min(100, Math.round(value))) }), is("on")];
        if (action === "set" && d === "fan") return ["fan", "set_percentage", Object.assign(data, { percentage: Math.max(0, Math.min(100, Math.round(value))) }), function () { return "done"; }];
        if (d === "climate") return ["climate", action === "off" ? "turn_off" : "turn_on", data, function (now) { return (now.state === "off") === (action === "off") ? "done" : ""; }];
        return [d, action === "off" ? "turn_off" : "turn_on", data, is(action === "off" ? "off" : "on")];
    }
    // What puts an entity back as it was (undo): lights, switches, fans and
    // the thermostat; never a lock or a garage door (an undone "lock the
    // door" would unlock it unasked).
    function backTo(s) {
        var d = domainOf(s.entity_id), a = s.attributes || {}, data = { entity_id: s.entity_id };
        if (d === "lock" || d === "cover" || d === "scene") return null;
        if (d === "climate") return a.temperature !== undefined && s.state !== "off" ? ["climate", "set_temperature", Object.assign(data, { temperature: a.temperature })]
                                                                                       : ["climate", s.state === "off" ? "turn_off" : "turn_on", data];
        if (s.state === "off") return [d, "turn_off", data];
        if (d === "light" && a.brightness !== undefined) return ["light", "turn_on", Object.assign(data, { brightness_pct: Math.max(1, Math.round(a.brightness / 2.55)) })];
        return s.state === "on" ? [d, "turn_on", data] : null;
    }
    function post(env, k, call) { return api(env, k.c, k.tok, "POST", "/api/services/" + call[0] + "/" + call[1], call[2]); }
    // Read back: once, and once more a moment later for a device slower to say.
    function readBack(env, k, id, check) {
        function once() {
            return api(env, k.c, k.tok, "GET", "/api/states/" + id).then(function (now) { return now ? check(now) : ""; }, function () { return ""; });
        }
        return once().then(function (r) {
            return r ? r : new Promise(function (resolve) { setTimeout(resolve, READ_AGAIN_MS); }).then(once);
        });
    }

    function connected(env) {
        var say = env.lang.say, c = conf(env);
        if (!c || !c.url || !c.tokenEnc) return Promise.resolve({ reply: say.homeNotConnected() });
        return token(env, c).then(function (tok) { return { c: c, tok: tok }; });
    }
    function home(args, env) {
        var say = env.lang.say;
        return connected(env).then(function (k) {
            if (k.reply) return { text: k.reply, open: settingsOpen() };
            return states(env, k.c, k.tok).then(function (list) {
                var found = pick(list, args.target, domainsFor(args.action));
                if (!found.length) return { text: say.noSuchDevice(args.target) };
                if (args.action === "status") return { text: say.deviceState(found.map(function (s) { return { name: nameOf(s), state: s.state, attributes: s.attributes || {} }; })) };
                // "Turn up the heat": two degrees (Fahrenheit) or one (Celsius) from where it is set.
                var step = args.action === "up" ? 1 : args.action === "down" ? -1 : 0, action = step ? "set" : args.action;
                var values = found.map(function (s) {
                    if (!step) return Number(args.value);
                    var a = s.attributes || {}, at = Number(a.temperature !== undefined && a.temperature !== null ? a.temperature : a.current_temperature);
                    return at + step * (at > 40 ? 2 : 1);
                });
                if (action === "set" && values.some(function (v) { return !(v > 0); })) return { text: say.homeSetWhat(nameOf(found[0])) };
                var calls = found.map(function (s, i) { return serviceFor(action, s, values[i]); });
                var back = found.map(backTo).filter(Boolean);
                return calls.reduce(function (p, call) {
                    return p.then(function () { return post(env, k, call); });
                }, Promise.resolve()).then(function () {
                    // Read back: a light on, the thermostat at 70, a door locked (or locking).
                    return Promise.all(found.map(function (s, i) { return readBack(env, k, s.entity_id, calls[i][3]); }));
                }).then(function (got) {
                    var names = found.map(nameOf);
                    if (got.some(function (x) { return !x; })) return { text: say.homeNotConfirmed(names, action), failed: true };
                    var moving = got.some(function (x) { return x === "moving"; });
                    return Object.assign({ text: say.homeDone(names, action, values[0], moving, found.some(function (s) { return domainOf(s.entity_id) === "climate"; })) },
                                         back.length === found.length ? { undo: { kind: "home", calls: back, what: say.undoHome(names) } } : {});
                });
            });
        }).catch(function (e) {
            return { text: e && e.auth ? say.homeAuth() : say.homeUnreachable(), failed: true, open: settingsOpen() };
        });
    }
    function scene(args, env) {
        var say = env.lang.say;
        return connected(env).then(function (k) {
            if (k.reply) return { text: k.reply, open: settingsOpen() };
            return states(env, k.c, k.tok).then(function (list) {
                var found = pick(list, args.name, ["scene"]);
                if (!found.length) return { text: say.noSuchScene(args.name) };
                return api(env, k.c, k.tok, "POST", "/api/services/scene/turn_on", { entity_id: found[0].entity_id }).then(function () {
                    return { text: say.sceneOn(nameOf(found[0])) };
                });
            });
        }).catch(function (e) { return { text: e && e.auth ? say.homeAuth() : say.homeUnreachable(), failed: true, open: settingsOpen() }; });
    }
    function settingsOpen() { return { appId: "org.webosphoenix.settings", params: { page: "assistant", section: "home" }, title: "Settings" }; }

    function service(s) {
        function ok(o) { return Object.assign({ returnValue: true }, o || {}); }
        function fail(t) { return { returnValue: false, errorCode: -1, errorText: t }; }
        return {
            homeAssistant: function () {
                var c = conf(s.env());
                return Promise.resolve(ok({ url: c ? c.url : "", connected: !!(c && c.tokenEnc), entities: c && c.entities ? c.entities.length : 0 }));
            },
            // Checked first: the address answers and the token is taken.
            setHomeAssistant: function (p) {
                if (!s.privileged()) return Promise.resolve(fail("Not allowed"));
                var e = s.env(), url = String(p.url || "").trim().replace(/\/+$/, ""), tok = String(p.token || "").trim();
                if (!/^https?:\/\/[^\s/]+(?::\d+)?(?:\/[^\s]*)?$/i.test(url)) return Promise.resolve(fail(e.lang.say.homeBadUrl()));
                if (!tok) return Promise.resolve(fail(e.lang.say.homeNeedsToken()));
                var c = { url: url };
                return api(e, c, tok, "GET", "/api/").then(function () {
                    return Promise.resolve(e.secrets.seal(tok)).then(function (enc) {
                        c.tokenEnc = enc;
                        e.storage.set(KEY, c);
                        return states(e, c, tok).then(function (list) { return ok({ url: url, connected: true, entities: list.length }); },
                                                      function () { return ok({ url: url, connected: true, entities: 0 }); });
                    });
                }, function (err) { return fail(err && err.auth ? e.lang.say.homeAuth() : e.lang.say.homeUnreachable()); });
            },
            removeHomeAssistant: function () {
                if (!s.privileged()) return Promise.resolve(fail("Not allowed"));
                s.env().storage.remove(KEY);
                return Promise.resolve(ok());
            }
        };
    }

    return {
        COMMANDS: COMMANDS,
        METHODS: ["homeAssistant", "setHomeAssistant", "removeHomeAssistant"],
        service: service,
        // The grammar's: {home: {entities: [{name, domain}]}} once Home Assistant is connected.
        context: function (env) {
            var c = conf(env);
            return c && c.url && c.tokenEnc ? { home: { entities: c.entities || [] } } : {};
        },
        // Unlocking a door, and opening a garage door or blinds: read back
        // first, by the names Home Assistant has for them (the user's own
        // words for them are "home" in a model's choice too: never on a guess).
        prepare: function (cmd, args, env) {
            if (cmd.id !== "home" || (args.action !== "unlock" && args.action !== "open")) return null;
            var say = env.lang.say;
            return connected(env).then(function (k) {
                if (k.reply) return { args: args, reply: k.reply };
                return states(env, k.c, k.tok).then(function (list) {
                    var found = pick(list, args.target, domainsFor(args.action));
                    if (!found.length) return { args: args, reply: say.noSuchDevice(args.target) };
                    return { args: args, confirm: say.confirmHome(args.action, found.map(nameOf)) };
                });
            }).catch(function (e) { return { args: args, reply: e && e.auth ? say.homeAuth() : say.homeUnreachable() }; });
        },
        run: function (cmd, args, env) {
            if (cmd.id === "home") return home(args, env);
            if (cmd.id === "homeScene") return scene(args, env);
            return null;
        },
        // "Undo": each device put back as it was (backTo).
        undo: function (u, env) {
            if (u.kind !== "home") return null;
            return connected(env).then(function (k) {
                if (k.reply) throw new Error(k.reply);
                return (u.calls || []).reduce(function (p, call) { return p.then(function () { return post(env, k, call); }); }, Promise.resolve());
            });
        }
    };
};
