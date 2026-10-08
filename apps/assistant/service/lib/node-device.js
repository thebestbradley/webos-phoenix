// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What assistant.js needs on a device, on Node.js (service.js):
//
//   fileStorage(dir)        one JSON file per key, written atomically
//   fileSecrets(keyFile)    AES-256-GCM with a device key in a file only the
//                           service's user can read (docs/AI-AND-MCP.md
//                           "API keys": the key store until Phoenix has one)
//   llamaServer(options)    the on-device model: downloads GGUF files (with
//                           their SHA-256 checked) into modelsDir and runs
//                           llama.cpp's llama-server on 127.0.0.1 for the one
//                           in use; stopped after idleMs without requests
//                           to give the memory back
//   speech(options)         text to speech with a program reading stdin
//                           (espeak-ng where the image has it, else Flite,
//                           which meta-phoenix's image ships; piper and
//                           others with their own command)
//   voiceStatus(options)    what the voice needs and what is missing, for
//                           assistant.js's voice: whisper.cpp (the
//                           transcriber's getStatus), the wake word's
//                           program, library and model, and speech
//
// The simulator does the same in the shell (shell/native/localmodels.cpp,
// shell/native/speech.cpp); the runtime passes the service's calls there.

"use strict";

var fs = require("fs");
var path = require("path");
var os = require("os");
var crypto = require("crypto");
var http = require("http");
var https = require("https");
var childProcess = require("child_process");

// ---- Storage --------------------------------------------------------------------------------

function fileStorage(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    function file(key) { return path.join(dir, encodeURIComponent(key) + ".json"); }
    return {
        get: function (key) {
            try { return JSON.parse(fs.readFileSync(file(key), "utf8")); } catch (e) { return null; }
        },
        set: function (key, value) {
            var f = file(key), tmp = f + "." + process.pid + ".tmp";
            fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
            fs.renameSync(tmp, f);
        },
        remove: function (key) { try { fs.unlinkSync(file(key)); } catch (e) { /* gone already */ } },
        keys: function (prefix) {
            return fs.readdirSync(dir).filter(function (n) { return /\.json$/.test(n); })
                .map(function (n) { return decodeURIComponent(n.slice(0, -5)); })
                .filter(function (k) { return k.indexOf(prefix) === 0; });
        }
    };
}

// ---- Secrets -------------------------------------------------------------------------------

function fileSecrets(keyFile) {
    var key = null;
    function deviceKey() {
        if (key) return key;
        try { key = fs.readFileSync(keyFile); } catch (e) { key = null; }
        if (!key || key.length !== 32) {
            key = crypto.randomBytes(32);
            fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
            fs.writeFileSync(keyFile, key, { mode: 0o600 });
        }
        return key;
    }
    return {
        seal: function (text) {
            return Promise.resolve().then(function () {
                var iv = crypto.randomBytes(12);
                var c = crypto.createCipheriv("aes-256-gcm", deviceKey(), iv);
                var data = Buffer.concat([c.update(String(text), "utf8"), c.final(), c.getAuthTag()]);
                return { iv: iv.toString("base64"), data: data.toString("base64") };
            });
        },
        unseal: function (enc) {
            return Promise.resolve().then(function () {
                var all = Buffer.from(enc.data, "base64");
                var d = crypto.createDecipheriv("aes-256-gcm", deviceKey(), Buffer.from(enc.iv, "base64"));
                d.setAuthTag(all.subarray(all.length - 16));
                return Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]).toString("utf8");
            });
        }
    };
}

// ---- The on-device model -----------------------------------------------------------------------

// The first of these that exists, else the name (found on PATH by spawn).
function findProgram(names) {
    var dirs = String(process.env.PATH || "").split(path.delimiter);
    for (var i = 0; i < names.length; ++i) {
        if (path.isAbsolute(names[i])) { if (fs.existsSync(names[i])) return names[i]; continue; }
        for (var j = 0; j < dirs.length; ++j) {
            var p = path.join(dirs[j], names[i]);
            try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (e) { /* not here */ }
        }
    }
    return "";
}

function freePort() {
    return new Promise(function (resolve, reject) {
        var s = require("net").createServer();
        s.unref();
        s.on("error", reject);
        s.listen(0, "127.0.0.1", function () { var p = s.address().port; s.close(function () { resolve(p); }); });
    });
}

function getOnce(url) {
    return new Promise(function (resolve) {
        var r = http.get(url, function (res) { res.resume(); resolve(res.statusCode); });
        r.on("error", function () { resolve(0); });
        r.setTimeout(2000, function () { r.destroy(); resolve(0); });
    });
}

// options: {modelsDir, server: path or names to look for, args: extra
// arguments, idleMs, ramBytes, log}
function llamaServer(options) {
    var dir = options.modelsDir;
    var idleMs = options.idleMs || 5 * 60 * 1000;
    var log = options.log || function () {};
    var proc = null, current = "", baseUrl = "", starting = null, idleTimer = null, lastError = "";
    var download = null;   // {id, received, total, req, file}

    function server() { return options.server ? findProgram([].concat(options.server)) : findProgram(["llama-server"]); }
    function installed() {
        try {
            return fs.readdirSync(dir).filter(function (n) { return /\.gguf$/.test(n); })
                .map(function (n) { return { id: n.replace(/\.gguf$/, ""), file: path.join(dir, n), size: fs.statSync(path.join(dir, n)).size }; });
        } catch (e) { return []; }
    }
    function fileFor(m) { return path.join(dir, m.id + ".gguf"); }

    function stop() {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        if (proc) { try { proc.kill("SIGTERM"); } catch (e) { /* gone */ } }
        proc = null; current = ""; baseUrl = "";
    }
    function touch() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(function () { log("idle: stopping llama-server"); stop(); }, idleMs);
        if (idleTimer.unref) idleTimer.unref();
    }

    function ensure(m) {
        var file = fileFor(m);
        if (proc && current === m.id && baseUrl) { touch(); return Promise.resolve({ baseUrl: baseUrl }); }
        if (starting && starting.id === m.id) return starting.promise;
        if (!fs.existsSync(file)) return Promise.reject(new Error(m.name + " is not downloaded"));
        var bin = server();
        if (!bin) return Promise.reject(new Error("llama-server is not installed"));
        stop();
        var p = freePort().then(function (port) {
            return new Promise(function (resolve, reject) {
                var args = ["-m", file, "--host", "127.0.0.1", "--port", String(port), "--jinja", "-c", "4096"].concat(options.args || []);
                log("starting " + bin + " " + args.join(" "));
                var child = childProcess.spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
                var errText = "";
                child.stderr.on("data", function (d) { errText = (errText + d).slice(-2000); });
                proc = child;
                current = m.id;
                var url = "http://127.0.0.1:" + port;
                var deadline = Date.now() + (options.startTimeoutMs || 120000);
                var exited = false;
                child.on("exit", function (code) {
                    exited = true;
                    if (proc === child) { proc = null; current = ""; baseUrl = ""; }
                    lastError = "llama-server exited (" + code + "): " + errText.trim().split("\n").pop();
                });
                (function poll() {
                    if (exited) return reject(new Error(lastError));
                    getOnce(url + "/health").then(function (status) {
                        if (status === 200) { baseUrl = url + "/v1"; lastError = ""; touch(); return resolve({ baseUrl: baseUrl }); }
                        if (Date.now() > deadline) { stop(); return reject(new Error("llama-server did not start")); }
                        setTimeout(poll, 250);
                    });
                })();
            });
        });
        starting = { id: m.id, promise: p };
        var clear = function () { if (starting && starting.promise === p) starting = null; };
        p.then(clear, clear);
        return p;
    }

    // Following redirects (Hugging Face sends its files from a CDN).
    function fetchTo(url, out, onProgress, hops) {
        return new Promise(function (resolve, reject) {
            var mod = /^https:/.test(url) ? https : http;
            var req = mod.get(url, { headers: { "User-Agent": "webOS-Phoenix-Assistant/0.1" } }, function (res) {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    if ((hops || 0) > 5) return reject(new Error("too many redirects"));
                    return resolve(fetchTo(new URL(res.headers.location, url).href, out, onProgress, (hops || 0) + 1));
                }
                if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
                var total = Number(res.headers["content-length"]) || 0, got = 0;
                var hash = crypto.createHash("sha256"), ws = fs.createWriteStream(out);
                res.on("data", function (c) { got += c.length; hash.update(c); onProgress(got, total); });
                res.pipe(ws);
                ws.on("finish", function () { resolve(hash.digest("hex")); });
                res.on("error", reject);
                ws.on("error", reject);
            });
            req.on("error", reject);
            if (download) download.req = req;
        });
    }

    return {
        status: function () {
            return Promise.resolve({
                available: !!server(), server: server(), running: !!proc, model: current, error: lastError,
                installed: installed(), ramBytes: options.ramBytes || os.totalmem(),
                downloading: download ? { id: download.id, received: download.received, total: download.total } : null
            });
        },
        download: function (m) {
            if (download) return Promise.reject(new Error("Already downloading " + download.id));
            fs.mkdirSync(dir, { recursive: true });
            var part = fileFor(m) + ".part";
            download = { id: m.id, received: 0, total: m.size, req: null };
            var d = download;
            var told = 0;
            fetchTo(m.url, part, function (got, total) {
                d.received = got;
                if (total) d.total = total;
                // Subscribers (Settings) see the progress, once a second.
                if (options.onChange && Date.now() - told > 1000) { told = Date.now(); options.onChange(); }
            }).then(function (sha) {
                if (download !== d) return;
                download = null;
                if (m.sha256 && sha !== m.sha256) { fs.unlinkSync(part); lastError = m.name + ": the download is damaged (SHA-256)"; return; }
                fs.renameSync(part, fileFor(m));
                lastError = "";
                if (options.onChange) options.onChange();
            }, function (e) {
                if (download === d) download = null;
                try { fs.unlinkSync(part); } catch (x) { /* none */ }
                lastError = m.name + ": " + e.message;
                if (options.onChange) options.onChange();
            });
            return Promise.resolve();
        },
        cancel: function (id) {
            if (download && download.id === id) {
                var d = download;
                download = null;
                if (d.req) d.req.destroy();
                try { fs.unlinkSync(path.join(dir, id + ".gguf.part")); } catch (e) { /* none */ }
            }
            return Promise.resolve();
        },
        remove: function (m) {
            if (current === m.id) stop();
            try { fs.unlinkSync(fileFor(m)); } catch (e) { /* none */ }
            return Promise.resolve();
        },
        ensure: ensure,
        stop: stop
    };
}

// ---- Speech -----------------------------------------------------------------------------------

// options: {command: [program, args...] with %l for the language; text on stdin}
function defaultSpeechCommand() {
    var espeak = findProgram(["espeak-ng"]);
    if (espeak) return [espeak, "-v", "%l", "--stdin"];
    // Flite (BSD-3-Clause; meta-multimedia's flite, packagegroup-phoenix-
    // assistant) reads the text on stdin and plays it; English only.
    var flite = findProgram(["flite"]);
    return flite ? [flite] : null;
}

function speech(options) {
    var cmd = options && options.command ? options.command : defaultSpeechCommand();
    var child = null;
    return {
        speak: function (text, lang) {
            if (!cmd) return Promise.reject(new Error("No text-to-speech program (espeak-ng)"));
            if (child) { try { child.kill(); } catch (e) { /* done */ } }
            return new Promise(function (resolve, reject) {
                var args = cmd.slice(1).map(function (a) { return a.replace("%l", String(lang || "en").slice(0, 5)); });
                child = childProcess.spawn(cmd[0], args, { stdio: ["pipe", "ignore", "ignore"] });
                child.on("error", reject);
                child.on("exit", function () { child = null; resolve(); });
                child.stdin.end(String(text));
            });
        },
        stop: function () { if (child) { try { child.kill(); } catch (e) { /* done */ } } },
        status: function () { return Promise.resolve({ available: !!cmd, engine: cmd ? path.basename(cmd[0]) : "" }); }
    };
}

// ---- What the voice needs ---------------------------------------------------------------------

// Where meta-phoenix's packagegroup-phoenix-assistant puts the wake word
// (recipes-support/vosk) and what the shell runs (PhoenixViewsRoot.qml).
var WAKE_MODEL = "/usr/share/phoenix/wakeword/vosk-model-small-en-us-0.15";
var IMAGE_HINT = "meta-phoenix's packagegroup-phoenix-assistant adds it to the image";

// options: {luna: {call(uri, params) -> Promise<payload>}, tts: speech(),
// wakeModel?, libDirs?}
function voiceStatus(options) {
    var o = options || {};
    var libDirs = o.libDirs || ["/usr/lib", "/usr/lib64", "/lib", "/usr/local/lib"];
    function hasVosk() {
        return libDirs.some(function (d) { return fs.existsSync(path.join(d, "libvosk.so")); });
    }
    return function () {
        var recognition = o.luna.call("luna://org.webosphoenix.transcriber/getStatus", {}).then(function (r) {
            r = r || {};
            var missing = r.returnValue === false ? "the transcriber service is not installed"
                : !r.binary ? "whisper.cpp's whisper-cli is not installed"
                : r.modelInstalled === false ? "its model " + (r.model || "") + " is not installed" : "";
            return { id: "recognition", available: !missing && r.installed !== false, engine: r.engine || "whisper.cpp",
                     howToInstall: missing ? "not in this image: " + missing + " (whisper-cpp, whisper-cpp-model-base-en; " + IMAGE_HINT + ")." : "" };
        }, function () {
            return { id: "recognition", available: false, howToInstall: "not in this image: the transcriber service (" + IMAGE_HINT + ")." };
        });
        var model = o.wakeModel || WAKE_MODEL;
        var wakeMissing = !findProgram(["phoenix-wakeword"]) ? "phoenix-wakeword (phoenix-shell)"
            : !hasVosk() ? "libvosk (libvosk)"
            : !fs.existsSync(model) ? "the Vosk model " + model + " (vosk-model-small-en-us)" : "";
        var wake = { id: "wakeWord", available: !wakeMissing, engine: "Vosk",
                     howToInstall: wakeMissing ? "not in this image: " + wakeMissing + "; " + IMAGE_HINT + "." : "" };
        var speaking = Promise.resolve(o.tts ? o.tts.status() : { available: false, engine: "" }).then(function (st) {
            return { id: "speech", available: !!st.available, engine: st.engine || "",
                     howToInstall: st.available ? "" : "not in this image: a speech program (Flite or espeak-ng; " + IMAGE_HINT + ")." };
        });
        return Promise.all([recognition, wake, speaking]);
    };
}

module.exports = { fileStorage: fileStorage, fileSecrets: fileSecrets, llamaServer: llamaServer, speech: speech, voiceStatus: voiceStatus, findProgram: findProgram };
