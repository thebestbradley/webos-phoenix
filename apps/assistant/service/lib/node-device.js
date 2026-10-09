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
//   speech(options)         text to speech with a program reading stdin:
//                           Kitten TTS (phoenix-tts) where the image has it,
//                           else espeak-ng, else Flite; piper and others
//                           with their own command
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

// options: {modelsDir, builtInDirs: where the image keeps the models it
// ships (default /usr/share/phoenix/models: Qwen3 0.6B, meta-phoenix's
// qwen3-0.6b-gguf; lib/models.js BUILT_IN), server: path or names to look
// for, args: extra arguments, idleMs, ramBytes, log, pidFile: where the
// running server's pid is kept (default beside the models), pdeath: the
// program to start it through (default phoenix-pdeath, else setpriv), or
// false for none (the tests)}
//
// It ends with the service, however the service ends: on exit and on
// SIGTERM, SIGINT or SIGHUP it is stopped; started through phoenix-pdeath
// (services/pdeath, Phoenix's own, in the image) or else util-linux's
// setpriv --pdeathsig, the kernel ends it when the service dies outright
// (SIGKILL, a crash); and its pid and start time are kept in pidFile, so
// a server left by a service that died anyway is stopped when the next one
// starts (as phoenix-sim's shell/native/localmodels.cpp ends its own with
// PR_SET_PDEATHSIG).
var reaping = null;
function procStart(pid) {
    try {
        var stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
        return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] || "";
    } catch (e) { return ""; }
}
function reapLeftover(pidFile, log) {
    var kept;
    try { kept = fs.readFileSync(pidFile, "utf8").trim().split(/\s+/); } catch (e) { return; }
    try { fs.unlinkSync(pidFile); } catch (e) { /* gone */ }
    var pid = Number(kept[0]);
    // The same process (its start time), not another that got its pid since.
    if (pid > 1 && kept[1] && procStart(pid) === kept[1]) {
        log("stopping llama-server " + pid + " left by an earlier service");
        try { process.kill(pid, "SIGTERM"); } catch (e) { /* gone */ }
    }
}
function llamaServer(options) {
    var dir = options.modelsDir;
    var builtInDirs = options.builtInDirs || ["/usr/share/phoenix/models"];
    var idleMs = options.idleMs || 5 * 60 * 1000;
    var log = options.log || function () {};
    var proc = null, current = "", baseUrl = "", starting = null, idleTimer = null, lastError = "";
    var download = null;   // {id, received, total, req, file}
    var pidFile = options.pidFile || path.join(dir, "llama-server.pid");
    reapLeftover(pidFile, log);
    var running = [];
    if (!reaping) {
        reaping = [];
        var end = function () { reaping.forEach(function (f) { f(); }); };
        process.on("exit", end);
        ["SIGTERM", "SIGINT", "SIGHUP"].forEach(function (sig) {
            process.on(sig, function () { end(); process.exit(128 + os.constants.signals[sig]); });
        });
    }
    reaping.push(function () {
        running.forEach(function (c) { try { c.kill("SIGTERM"); } catch (e) { /* gone */ } });
        if (running.length) try { fs.unlinkSync(pidFile); } catch (e) { /* none */ }
    });
    // [program, args] that end with the service: phoenix-pdeath, else setpriv, else as is.
    function throughPdeath(bin, args) {
        if (process.platform !== "linux" || options.pdeath === false) return [bin, args];
        var own = findProgram([].concat(options.pdeath || "phoenix-pdeath"));
        if (own) return [own, ["TERM", "--", bin].concat(args)];
        var setpriv = options.pdeath ? "" : findProgram(["setpriv"]);
        return setpriv ? [setpriv, ["--pdeathsig", "TERM", "--", bin].concat(args)] : [bin, args];
    }
    function keepPid(child) {
        try { fs.mkdirSync(path.dirname(pidFile), { recursive: true }); fs.writeFileSync(pidFile, child.pid + " " + procStart(child.pid) + "\n"); }
        catch (e) { log("llama-server pid: " + e.message); }
    }

    function server() { return options.server ? findProgram([].concat(options.server)) : findProgram(["llama-server"]); }
    // A model is here as id.gguf, or in parts, id-00001-of-0000N.gguf
    // (the names llama.cpp loads the rest by), when every part is: listed
    // once, its size all of them, its file the first.
    var PART = /^(.+)-(\d{5})-of-(\d{5})\.gguf$/;
    function partName(id, n, count) {
        var pad = function (k) { return ("0000" + k).slice(-5); };
        return count > 1 ? id + "-" + pad(n) + "-of-" + pad(count) + ".gguf" : id + ".gguf";
    }
    function ggufs(d, builtIn) {
        var names;
        try { names = fs.readdirSync(d); } catch (e) { return []; }
        var list = [];
        names.forEach(function (n) {
            var m = PART.exec(n), e = null;
            if (m) {
                if (Number(m[2]) !== 1) return;
                var count = Number(m[3]), size = 0;
                for (var k = 1; k <= count; ++k) {
                    var f = path.join(d, partName(m[1], k, count));
                    if (!fs.existsSync(f)) return;
                    size += fs.statSync(f).size;
                }
                e = { id: m[1], file: path.join(d, n), size: size };
            } else if (/\.gguf$/.test(n)) {
                e = { id: n.replace(/\.gguf$/, ""), file: path.join(d, n), size: fs.statSync(path.join(d, n)).size };
            }
            if (!e) return;
            if (builtIn) e.builtIn = true;
            list.push(e);
        });
        return list;
    }
    function installed() {
        var list = ggufs(dir, false);
        builtInDirs.forEach(function (d) {
            ggufs(d, true).forEach(function (e) { if (!list.some(function (x) { return x.id === e.id; })) list.push(e); });
        });
        return list;
    }
    // Downloads go to modelsDir; a built-in model is read where it is.
    function fileFor(m) { return path.join(dir, m.id + ".gguf"); }
    function found(m) {
        var dirs = [dir].concat(builtInDirs);
        for (var i = 0; i < dirs.length; ++i) {
            var e = ggufs(dirs[i], false).filter(function (x) { return x.id === m.id; })[0];
            if (e) return e.file;
        }
        return fileFor(m);
    }
    function removeFiles(id) {
        var names;
        try { names = fs.readdirSync(dir); } catch (e) { return; }
        names.forEach(function (n) {
            var p = PART.exec(n);
            if (n === id + ".gguf" || n === id + ".gguf.part" || (p && p[1] === id) || (/\.part$/.test(n) && PART.exec(n.slice(0, -5)) && PART.exec(n.slice(0, -5))[1] === id))
                try { fs.unlinkSync(path.join(dir, n)); } catch (e) { /* gone */ }
        });
    }

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
        var file = found(m);
        if (proc && current === m.id && baseUrl) { touch(); return Promise.resolve({ baseUrl: baseUrl }); }
        if (starting && starting.id === m.id) return starting.promise;
        if (!fs.existsSync(file)) return Promise.reject(new Error(m.name + " is not downloaded"));
        var bin = server();
        if (!bin) return Promise.reject(new Error("llama-server is not installed"));
        stop();
        var p = freePort().then(function (port) {
            return new Promise(function (resolve, reject) {
                // 4,096 tokens with the default 16-bit cache (twice as fast
                // reading a prompt as 8,192 in 8 bits, in the same memory),
                // one slot (its prompt kept between requests), flash
                // attention, prompts read 512 tokens at a time so that a
                // request given up on (the assistant's deadline) ends soon;
                // as the simulator's shell/native/localmodels.cpp, which says why.
                var args = ["-m", file, "--host", "127.0.0.1", "--port", String(port), "--jinja", "-c", "4096", "-np", "1",
                            "-fa", "on", "-b", "512"].concat(options.args || []);
                log("starting " + bin + " " + args.join(" "));
                var child = childProcess.spawn.apply(childProcess, throughPdeath(bin, args).concat([{ stdio: ["ignore", "ignore", "pipe"] }]));
                running.push(child);
                keepPid(child);
                var errText = "";
                child.stderr.on("data", function (d) { errText = (errText + d).slice(-2000); });
                proc = child;
                current = m.id;
                var url = "http://127.0.0.1:" + port;
                var deadline = Date.now() + (options.startTimeoutMs || 120000);
                var exited = false;
                child.on("exit", function (code) {
                    exited = true;
                    running = running.filter(function (c) { return c !== child; });
                    try { if (fs.readFileSync(pidFile, "utf8").split(" ")[0] === String(child.pid)) fs.unlinkSync(pidFile); } catch (e) { /* none */ }
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
        // Its sources in order (lib/models.js: the Qwen team's GGUF, then
        // Phoenix's conversion), each file checked; a source that does not
        // come whole leaves nothing behind, and the next is tried.
        download: function (m) {
            if (download) return Promise.reject(new Error("Already downloading " + download.id));
            fs.mkdirSync(dir, { recursive: true });
            var sources = m.sources && m.sources.length ? m.sources
                : [{ kind: "", files: [{ url: m.url, sha256: m.sha256, size: m.size }] }];
            download = { id: m.id, received: 0, total: 0, req: null };
            var d = download;
            var told = 0, failures = [];
            var progress = function () {
                // Subscribers (Settings) see the progress, once a second.
                if (options.onChange && Date.now() - told > 1000) { told = Date.now(); options.onChange(); }
            };
            var finish = function (err) {
                if (download === d) download = null;
                lastError = err;
                if (options.onChange) options.onChange();
            };
            (function trySource(i) {
                if (download !== d) return;
                if (i >= sources.length) return finish(m.name + ": " + failures.join("; "));
                var files = sources[i].files, count = files.length, done = 0;
                d.total = files.reduce(function (n, f) { return n + (f.size || 0); }, 0);
                d.received = 0;
                var failed = function (why) {
                    removeFiles(m.id);
                    failures.push(sources[i].kind ? sources[i].kind + ": " + why : why);
                    trySource(i + 1);
                };
                (function next(k) {
                    if (download !== d) return;
                    if (k >= count) return finish("");
                    var out = path.join(dir, partName(m.id, k + 1, count)), part = out + ".part";
                    fetchTo(files[k].url, part, function (got, total) {
                        d.received = done + got;
                        if (!d.total && total) d.total = total;
                        progress();
                    }).then(function (sha) {
                        if (download !== d) return;
                        if (files[k].sha256 && sha !== files[k].sha256) { try { fs.unlinkSync(part); } catch (e) { /* none */ } return failed("the download is damaged (SHA-256)"); }
                        fs.renameSync(part, out);
                        done += files[k].size || fs.statSync(out).size;
                        next(k + 1);
                    }, function (e) {
                        try { fs.unlinkSync(part); } catch (x) { /* none */ }
                        if (download === d) failed(e.message);
                    });
                })(0);
            })(0);
            return Promise.resolve();
        },
        cancel: function (id) {
            if (download && download.id === id) {
                var d = download;
                download = null;
                if (d.req) d.req.destroy();
                removeFiles(id);
            }
            return Promise.resolve();
        },
        remove: function (m) {
            if (current === m.id) stop();
            removeFiles(m.id);
            return Promise.resolve();
        },
        ensure: ensure,
        stop: stop
    };
}

// ---- Speech -----------------------------------------------------------------------------------

// options: {command: [program, args...] with %l for the language and %v
// for the voice, text on stdin (instead of the default), kitten: phoenix-tts
// (default: on the PATH), fallback: the command when Kitten cannot speak
// (default: espeak-ng, else Flite), log}
//
// The default is Kitten TTS (phoenix-tts, which phoenix-shell installs;
// services/tts) with its model, the dictionary and ONNX Runtime from the
// image (meta-phoenix: kitten-tts-nano, cmudict, onnxruntime) for English,
// checked once with its --check; else, and for other languages, and when
// it cannot speak after all (it exits with 3 or 4), the programs before it.
function defaultSpeechCommand() {
    var espeak = findProgram(["espeak-ng"]);
    if (espeak) return [espeak, "-v", "%l", "--stdin"];
    // Flite (BSD-3-Clause; meta-multimedia's flite, packagegroup-phoenix-
    // assistant) reads the text on stdin and plays it; English only.
    var flite = findProgram(["flite"]);
    return flite ? [flite] : null;
}

function speech(options) {
    var o = options || {};
    var log = o.log || function () {};
    var child = null, kitten;  // undefined: not checked yet; null: cannot speak
    function kittenNow() {
        if (o.command) return null;
        if (kitten !== undefined) return kitten;
        kitten = null;
        var program = o.kitten || findProgram(["phoenix-tts"]);
        if (!program) return null;
        var r = childProcess.spawnSync(program, ["--check"], { encoding: "utf8", timeout: 5000 });
        var st = null;
        try { st = JSON.parse(String(r.stdout || "").trim()); } catch (e) { /* not JSON */ }
        if (st && st.ok) kitten = { program: program, voices: Array.isArray(st.voices) ? st.voices : [] };
        else log("Kitten TTS cannot speak here: " + (st && st.error || "phoenix-tts --check failed"));
        return kitten;
    }
    function fallback() { return o.fallback !== undefined ? o.fallback : (o.command || defaultSpeechCommand()); }
    // Resolves with the exit code.
    function run(cmd, text, lang, voice) {
        if (child) { try { child.kill(); } catch (e) { /* done */ } }
        return new Promise(function (resolve, reject) {
            var args = cmd.slice(1).map(function (a) { return a.replace("%l", lang).replace("%v", voice || ""); });
            var me = childProcess.spawn(cmd[0], args, { stdio: ["pipe", "ignore", "pipe"] });
            var err = "";
            child = me;
            me.stderr.on("data", function (d) { err = (err + d).slice(-1000); });
            me.on("error", reject);
            me.on("exit", function (code) {
                if (child === me) child = null;
                if (err.trim()) log(err.trim());
                resolve(code);
            });
            me.stdin.on("error", function () { /* it ended first */ });
            me.stdin.end(String(text));
        });
    }
    return {
        speak: function (text, lang, voice) {
            var l = String(lang || "en").slice(0, 5);
            var k = /^en/.test(l) ? kittenNow() : null;
            var cmd = k ? [k.program, "--voice", "%v"] : fallback();
            if (!cmd) return Promise.reject(new Error("No text-to-speech program (Kitten TTS, Flite or espeak-ng)"));
            return run(cmd, text, l, voice).then(function (code) {
                var other = fallback();
                if (!k || (code !== 3 && code !== 4) || !other) return;
                if (code === 3) kitten = undefined;  // look again next time
                log("Kitten TTS could not speak; " + path.basename(other[0]) + " instead");
                return run(other, text, l, voice).then(function () {});
            });
        },
        stop: function () { if (child) { try { child.kill(); } catch (e) { /* done */ } } },
        status: function () {
            var k = kittenNow(), cmd = k ? [k.program] : fallback();
            return Promise.resolve({ available: !!cmd, engine: k ? "Kitten TTS" : cmd ? path.basename(cmd[0]) : "",
                                     voices: k ? k.voices : [] });
        }
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
                     howToInstall: st.available ? "" : "not in this image: a speech program (Kitten TTS, Flite or espeak-ng; " + IMAGE_HINT + ")." };
        });
        return Promise.all([recognition, wake, speaking]);
    };
}

module.exports = { fileStorage: fileStorage, fileSecrets: fileSecrets, llamaServer: llamaServer, speech: speech, voiceStatus: voiceStatus, findProgram: findProgram };
