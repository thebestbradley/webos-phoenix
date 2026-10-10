// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// com.palm.systemmanager on a device: what LunaSysMgr's SystemService
// answered the apps that the shell (luna-surfacemanager) does not, since
// OSE has no com.palm.systemmanager. Written against injected dependencies
// (createSystemManager), so it runs anywhere (systemmanager.test.ts);
// service.js puts it on the bus.
//
// The device lock (legacy webOS API; luna-sysmgr Security.cpp and
// EASPolicyManager.cpp, ported as the simulator's runtime does, the same
// methods, replies and errors: runtime/phoenix-runtime.js
// "com.palm.systemmanager: device lock"):
//   getDeviceLockMode {subscribe} -> {lockMode: "none" | "pin" | "password",
//       policyState: "none" | "active" | "pending", retriesLeft}
//   getSecurityPolicy {} -> {policy: {password: {enabled, minLength,
//       maxRetries, alphaNumeric, allowSimplePassword?}, inactivityInSeconds,
//       id, status: {enforced, retriesLeft}}}, or returnValue false without
//       one (SystemService.cpp:2295-2400)
//   setDevicePasscode {lockMode, passCode, oldPasscode}
//   matchDevicePasscode {passCode} -> {succeeded}, or {succeeded: false,
//       lockedOut, retriesLeft} (Security::matchPasscode, Security.cpp:325-385)
// The passcode is kept as scrypt (Node's crypto) with a salt of its own,
// never as itself; what a security policy needs to know of it (its mode,
// length, letters and digits, strength) is kept beside it, as the original
// decrypted it to check (Security::passcodeSatisfiesPolicy, :400-418).
// The policies are db8's com.palm.securitypolicy:1 objects (an Exchange
// account puts them there), merged into the strictest
// (EASPolicyManager.cpp:300-384, EASPolicy::merge :968-1012).
//
// The shell's state, for the apps (the shell reports it to /phoenix/report;
// only the shell may):
//   getLockStatus {subscribe}      -> {locked}
//   getDockModeStatus {subscribe}  -> {enabled}       (SystemService.cpp:1913-1990)
//   getSystemStatus {subscribe}    -> {ime: {visible}, orientation: {ui, device},
//                                      learnedWords}
// The words the keyboard learned (GAPS V5: the Phoenix keyboard, a Maliit
// plugin in maliit-server, reports them to /phoenix/learnedWords; only the
// keyboard may), for Settings > Text Assist > Personal Dictionary, as the
// simulator's runtime keeps them (getSystemStatus learnedWords).
//
// The shell's start-up preferences: the shell must know Settings > Advanced
// (its start-up animation) and the rotation lock before its first frame, and
// cannot wait for the bus then; this keeps them in a file it reads
// synchronously (shell/qml/Phoenix/Lsm/LsmStatus.js startupFile, startupKeys),
// following the system service's preferences.
//
// STATUS: written against luna-sysmgr's sources and the runtime's tests;
// not yet run on a device.

"use strict";

var SERVICE = "com.palm.systemmanager";
var POLICY_KIND = "com.palm.securitypolicy:1";
// Security.cpp:43-44: s_defaultMaxRetries, s_deviceLockOutDuration.
var DEFAULT_RETRIES = 3;
var LOCKOUT_MS = 15000;

// What the shell reads before its first frame (LsmStatus.js startupKeys:
// its tweakKeys, which are the runtime's TWEAK_KEYS, and rotationLock;
// systemmanager.test.ts checks the three lists agree).
var STARTUP_KEYS = ["infiniteCardCyclingEnabled", "sysUiEnableMaximizeEdges", "sysUiEnableWaveLauncher", "showReticleAnimation",
                    "animationSpeed", "gestureSensitivity", "hapticFeedback", "launcherGridDensity", "showBatteryPercent",
                    "keyboardNumberRow", "keyboardStyle", "startupAnimation",
                    "keyboardButton", "keyboardButtonSide", "keyboardButtonY", "keyboardButtonHintShown",
                    "rotationLock"];

var METHODS = ["getDeviceLockMode", "getSecurityPolicy", "setDevicePasscode", "matchDevicePasscode",
               "getLockStatus", "getDockModeStatus", "getSystemStatus", "phoenix/report", "phoenix/learnedWords"];

function ok(o) {
    var r = { returnValue: true };
    for (var k in o || {}) r[k] = o[k];
    return r;
}
function fail(code, text) {
    return { returnValue: false, errorCode: code, errorText: text };
}

// ---- The security policy (EASPolicyManager) -----------------------------------------

// EASPolicy::maxInactivityInSeconds (:943-956).
function maxInactivity(sec) {
    if (sec < 60) return sec - sec % 30;
    if (sec < 9999) return sec - sec % 60;
    return 0;
}

// EASPolicy::fromNewJSON (:867-938) for each, merged into an aggregate that
// starts as EASPolicy(true) (EASPolicyManager.h:40-46). null: no policy.
function aggregatePolicy(docs) {
    docs = (docs || []).filter(function (d) { return d && !d._del; });
    if (!docs.length) return null;
    var a = { passwordRequired: false, maxRetries: 0, minLength: 1, alphaNumeric: false, allowSimple: true, inactivity: 9998, id: "" };
    docs.forEach(function (d) {
        var n = { passwordRequired: !!d.devicePasswordEnabled, alphaNumeric: !!d.alphanumericDevicePasswordRequired,
                  minLength: d.minDevicePasswordLength !== undefined ? d.minDevicePasswordLength | 0 : 1,
                  maxRetries: d.maxDevicePasswordFailedAttempts !== undefined ? d.maxDevicePasswordFailedAttempts | 0 : 1,
                  inactivity: d.maxInactivityTimeDeviceLock !== undefined ? d.maxInactivityTimeDeviceLock | 0 : 0,
                  allowSimple: d.allowSimpleDevicePassword !== undefined ? !!d.allowSimpleDevicePassword : true };
        if (!a.passwordRequired && n.passwordRequired) {
            a.passwordRequired = true;
            a.maxRetries = n.maxRetries;
            a.minLength = n.minLength;
            a.alphaNumeric = n.alphaNumeric;
            a.allowSimple = n.allowSimple;
            a.inactivity = maxInactivity(n.inactivity);
        } else if (a.passwordRequired && n.passwordRequired) {
            if (n.inactivity < a.inactivity) a.inactivity = maxInactivity(n.inactivity);
            if (n.maxRetries > 1 && (!(a.maxRetries > 1) || n.maxRetries < a.maxRetries)) a.maxRetries = n.maxRetries;
            if (n.alphaNumeric) a.alphaNumeric = true;
            if (!n.allowSimple) a.allowSimple = false;
            if (n.minLength > 1 && n.minLength > a.minLength) a.minLength = n.minLength;
        }
        if (!a.id && d._id) a.id = String(d._id);
    });
    return a;
}
// EASPolicy::validMaxRetries / validMinLength (EASPolicyManager.h:70-71).
function validMaxRetries(a) { return !!a && a.passwordRequired && a.maxRetries > 1; }
function validMinLength(a) { return !!a && a.passwordRequired && a.minLength > 1; }

// Security::validateStrength (Security.cpp:540-590): no run of repeated or
// consecutive characters longer than half the passcode.
function strength(pass) {
    var max = Math.floor(pass.length / 2), j = 0;
    for (var i = 0; i < pass.length - 1; i++) {
        var cur = pass.charCodeAt(i), next = pass.charCodeAt(i + 1), dir = next - cur;
        if (dir > -2 && dir < 2) {
            var n = 2;
            cur = next;
            for (j = i + 2; j < pass.length; j++) {
                next = pass.charCodeAt(j);
                if (next - cur !== dir) break;
                if (++n > max) return dir === 0 ? -8 : -9;
                cur = next;
            }
            i = j - 1;
        }
    }
    return 0;
}
function traits(mode, pass) {
    return { mode: mode, length: pass.length, letters: /[A-Za-zÀ-￿]/.test(pass), digits: /[0-9]/.test(pass),
             digitsOnly: /^[0-9]*$/.test(pass), strength: strength(pass) };
}
// Security::validatePasscode (:466-512).
function validate(a, t) {
    if (!a || !a.passwordRequired) return 0;
    if (t.mode === "none" || !t.length) return -1;
    if (validMinLength(a) && t.length < a.minLength) return -2;
    if (a.alphaNumeric) {
        if (t.mode !== "password") return -3;
        if (!t.letters || !t.digits) return -4;
    } else if (t.mode === "pin" && !t.digitsOnly) {
        return -5;
    }
    return a.allowSimple ? 0 : t.strength || 0;
}
// Security::setPasscode's texts (:180-205).
function passcodeError(code, mode) {
    return { "-1": "Passcode is empty", "-2": "Passcode not minimum length", "-3": "Alphanumeric characters required",
             "-4": "Alphanumeric characters required", "-5": "Pin invalid",
             "-8": mode === "pin" ? "No repeating numbers (3333)" : "No repeating characters (aaaa)",
             "-9": mode === "pin" ? "No sequential numbers (1234)" : "No sequential characters (abcd)" }[String(code)]
        || "Passcode general failure";
}

// deps:
//   state     {load() -> object | null, save(object)}   the lock (0600 on a device)
//   policies  () -> Promise<[com.palm.securitypolicy:1 objects]>
//   kdf       {hash(pass) -> string, verify(pass, stored) -> bool}
//   now       () -> ms
//   wipe      () -> void   the last of a policy's tries (Security::eraseDevice, :420-432)
//   startup   {write(prefs)}   the start-up preferences file
//   isShell   (sender) -> bool
//   isKeyboard (sender) -> bool   the Phoenix keyboard (maliit-server)
function createSystemManager(deps) {
    var watchers = { lockMode: [], lock: [], dock: [], system: [] };
    var shell = { deviceLocked: true, dockMode: false, orientation: { ui: "up", device: "up" }, ime: { visible: false },
                  learnedWords: [] };
    var startupPrefs = {};

    function load() {
        var s = deps.state.load() || {};
        if (!s.lock) s.lock = { lockMode: "none", hash: "" };
        return s;
    }
    function save(s) { deps.state.save(s); }

    // The lock, with the policy brought up to date: a new or changed policy
    // is enforced at once when the passcode satisfies it
    // (EASPolicyManager::notifyPolicyChanged, :692-700), and its retries
    // start again when it allows another number (:358-372).
    function lockState(s, docs) {
        var l = s.lock, a = aggregatePolicy(docs);
        if (l.numRetries === undefined) l.numRetries = DEFAULT_RETRIES;
        var sig = a ? JSON.stringify(a) : "";
        if (sig !== (l.policy ? l.policy.sig : "")) {
            var old = l.policy;
            if (!a) {
                l.policy = null;
                l.numRetries = DEFAULT_RETRIES;   // Security::slotPolicyChanged (:387-397)
            } else {
                var enforced = validate(a, l.traits || traits(l.lockMode, "")) === 0;
                l.policy = { sig: sig, enforced: enforced, maxRetries: a.maxRetries,
                             retriesLeft: old && old.maxRetries === a.maxRetries ? old.retriesLeft : a.maxRetries };
                if (!validMaxRetries(a) && enforced) l.numRetries = 0;
            }
            save(s);
        }
        return { a: a, l: l, pending: !!(a && !l.policy.enforced) };
    }
    function policyState(st) { return !st.a ? "none" : st.pending ? "pending" : "active"; }
    // EASPolicyManager::retriesLeft (:741-746).
    function easRetriesLeft(st) {
        return validMaxRetries(st.a) && !st.pending ? st.l.policy.retriesLeft : 0;
    }
    function withLock(fn) {
        return Promise.resolve(deps.policies()).catch(function () { return []; }).then(function (docs) {
            var s = load();
            return fn(s, lockState(s, docs));
        });
    }
    function lockModeReply(st) {
        return ok({ lockMode: st.l.lockMode, policyState: policyState(st), retriesLeft: easRetriesLeft(st) });
    }
    function notify(kind, reply) {
        watchers[kind].slice().forEach(function (fn) { fn(reply); });
    }
    function notifyLockMode() {
        withLock(function (s, st) { notify("lockMode", lockModeReply(st)); });
    }

    var methods = {
        getDeviceLockMode: function () {
            return withLock(function (s, st) { return lockModeReply(st); });
        },
        getSecurityPolicy: function () {
            return withLock(function (s, st) {
                var a = st.a;
                if (!a) return { returnValue: false };
                var password = { enabled: a.passwordRequired, minLength: a.minLength, maxRetries: a.maxRetries, alphaNumeric: a.alphaNumeric };
                if (a.passwordRequired && !a.alphaNumeric) password.allowSimplePassword = a.allowSimple;
                return ok({ policy: { password: password, inactivityInSeconds: a.inactivity, id: a.id,
                                      status: { enforced: !st.pending, retriesLeft: st.l.policy.retriesLeft } } });
            });
        },
        // Phoenix asks for the old passcode when one is set, except while a
        // policy is pending: the lock screen then sets the one the policy
        // asks for, as LockWindow did (LockWindow.cpp:1427-1530).
        setDevicePasscode: function (p) {
            return withLock(function (s, st) {
                var mode = p.lockMode, pass = typeof p.passCode === "string" ? p.passCode : "";
                if (st.l.lockMode !== "none" && !st.pending && !deps.kdf.verify(String(p.oldPasscode || ""), st.l.hash))
                    return fail(-1, "Incorrect passcode");
                if (["none", "pin", "password"].indexOf(mode) < 0) return fail(-1, "Invalid lock mode");
                var t = traits(mode, mode === "none" ? "" : pass);
                if (st.a && st.a.passwordRequired) {
                    var code = validate(st.a, t);
                    if (code < 0) return fail(code, passcodeError(code, mode));
                } else {
                    if (mode === "pin" && !/^[0-9]{4,}$/.test(pass)) return fail(-1, "A PIN needs at least 4 digits");
                    if (mode === "password" && pass.length < 4) return fail(-1, "Passwords need at least 4 characters");
                }
                s.lock.lockMode = mode;
                s.lock.hash = mode === "none" ? "" : deps.kdf.hash(pass);
                s.lock.traits = t;
                // EASPolicyManager::passwordEnforced (:728-738).
                if (st.pending && mode !== "none") {
                    s.lock.policy.enforced = true;
                    s.lock.policy.retriesLeft = st.a.maxRetries;
                }
                save(s);
                notifyLockMode();
                return ok();
            });
        },
        matchDevicePasscode: function (p) {
            return withLock(function (s, st) {
                var l = s.lock, now = deps.now();
                var counted = validMaxRetries(st.a) && !st.pending;
                if ((!st.a || st.pending) && l.numRetries === 0) {
                    if (now - (l.lastFailure || 0) < LOCKOUT_MS)
                        return ok({ succeeded: false, lockedOut: true, retriesLeft: 0 });
                    l.numRetries = DEFAULT_RETRIES;
                }
                var good = l.lockMode === "none" || deps.kdf.verify(String(p.passCode || ""), l.hash);
                var wipe = false;
                if (!good) {
                    if (l.numRetries > 0) l.numRetries--;
                    if (counted) {
                        if (l.policy.retriesLeft > 0) l.policy.retriesLeft--;
                        l.numRetries = l.policy.retriesLeft;
                        wipe = l.numRetries === 0;
                    }
                    l.lastFailure = now;
                } else if (st.a && !st.pending) {
                    if (counted) l.policy.retriesLeft = st.a.maxRetries;
                    l.numRetries = counted ? st.a.maxRetries : 0;
                } else {
                    l.numRetries = DEFAULT_RETRIES;
                }
                save(s);
                if (counted)
                    notifyLockMode();
                if (wipe)
                    deps.wipe();
                return good ? ok({ succeeded: true }) : ok({ succeeded: false, lockedOut: false, retriesLeft: l.numRetries });
            });
        },
        getLockStatus: function () { return Promise.resolve(ok({ locked: shell.deviceLocked })); },
        getDockModeStatus: function () { return Promise.resolve(ok({ enabled: shell.dockMode })); },
        getSystemStatus: function () {
            return Promise.resolve(ok({ ime: { visible: shell.ime.visible }, orientation: { ui: shell.orientation.ui, device: shell.orientation.device },
                                        learnedWords: shell.learnedWords.slice() }));
        },
        // The shell's state: {deviceLocked, dockMode, orientation: {ui,
        // device}, ime: {visible}}, any of them.
        "phoenix/report": function (p, sender) {
            if (!deps.isShell(sender))
                return Promise.resolve(fail(-1, "Only the shell reports its state"));
            var changed = { lock: false, dock: false, system: false };
            if (typeof p.deviceLocked === "boolean" && p.deviceLocked !== shell.deviceLocked) {
                shell.deviceLocked = p.deviceLocked;
                changed.lock = true;
            }
            if (typeof p.dockMode === "boolean" && p.dockMode !== shell.dockMode) {
                shell.dockMode = p.dockMode;
                changed.dock = true;
            }
            var four = ["up", "down", "left", "right", "faceup", "facedown"];
            if (p.orientation && typeof p.orientation === "object") {
                ["ui", "device"].forEach(function (k) {
                    if (four.indexOf(p.orientation[k]) >= 0 && p.orientation[k] !== shell.orientation[k]) {
                        shell.orientation[k] = p.orientation[k];
                        changed.system = true;
                    }
                });
            }
            if (p.ime && typeof p.ime.visible === "boolean" && p.ime.visible !== shell.ime.visible) {
                shell.ime.visible = p.ime.visible;
                changed.system = true;
            }
            if (changed.lock) methods.getLockStatus().then(function (r) { notify("lock", r); });
            if (changed.dock) methods.getDockModeStatus().then(function (r) { notify("dock", r); });
            if (changed.system) methods.getSystemStatus().then(function (r) { notify("system", r); });
            return Promise.resolve(ok());
        },
        // The keyboard's learned words: {words: [string]} (at most 5000,
        // each a word of at most 48 characters).
        "phoenix/learnedWords": function (p, sender) {
            if (!deps.isKeyboard || !deps.isKeyboard(sender))
                return Promise.resolve(fail(-1, "Only the keyboard reports its words"));
            if (!Array.isArray(p.words))
                return Promise.resolve(fail(-1, "words must be a list"));
            var words = p.words.filter(function (w) { return typeof w === "string" && w.length > 0 && w.length <= 48; }).slice(0, 5000);
            if (JSON.stringify(words) !== JSON.stringify(shell.learnedWords)) {
                shell.learnedWords = words;
                methods.getSystemStatus().then(function (r) { notify("system", r); });
            }
            return Promise.resolve(ok());
        }
    };

    // Subscriptions: the method's later replies. Returns a function that ends it.
    var subscribable = { getDeviceLockMode: "lockMode", getLockStatus: "lock", getDockModeStatus: "dock", getSystemStatus: "system" };
    function watch(method, fn) {
        var kind = subscribable[method];
        if (!kind) return null;
        watchers[kind].push(fn);
        return function () { watchers[kind] = watchers[kind].filter(function (f) { return f !== fn; }); };
    }

    // The system service's preferences (getPreferences {keys: STARTUP_KEYS,
    // subscribe}: all at first, then one key at a time, PrefsFactory.cpp:370):
    // the file is written when something in it changes.
    function preferences(reply) {
        if (!reply || reply.returnValue === false)
            return;
        var changed = false;
        STARTUP_KEYS.forEach(function (k) {
            if (reply[k] !== undefined && JSON.stringify(reply[k]) !== JSON.stringify(startupPrefs[k])) {
                startupPrefs[k] = reply[k];
                changed = true;
            }
        });
        if (changed)
            deps.startup.write({ prefs: JSON.parse(JSON.stringify(startupPrefs)) });
    }

    return { methods: methods, watch: watch, preferences: preferences };
}

// The passcode's hash: scrypt (RFC 7914, Node's crypto) with a salt of its
// own, N 2^15 (cost) unless params say otherwise; "scrypt$N$r$p$salt$key".
function scryptKdf(crypto, params) {
    var P = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
    for (var k in params || {}) P[k] = params[k];
    return {
        hash: function (pass) {
            var salt = crypto.randomBytes(16);
            var key = crypto.scryptSync(String(pass), salt, 32, P);
            return ["scrypt", P.N, P.r, P.p, salt.toString("base64"), key.toString("base64")].join("$");
        },
        verify: function (pass, stored) {
            var f = String(stored || "").split("$");
            if (f.length !== 6 || f[0] !== "scrypt")
                return false;
            var want = Buffer.from(f[5], "base64");
            var key = crypto.scryptSync(String(pass), Buffer.from(f[4], "base64"), want.length,
                                        { N: +f[1], r: +f[2], p: +f[3], maxmem: P.maxmem });
            return key.length === want.length && crypto.timingSafeEqual(key, want);
        }
    };
}

module.exports = {
    SERVICE: SERVICE, POLICY_KIND: POLICY_KIND, METHODS: METHODS, STARTUP_KEYS: STARTUP_KEYS,
    createSystemManager: createSystemManager, aggregatePolicy: aggregatePolicy, strength: strength, scryptKdf: scryptKdf
};
