// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.transcriber on a device: speech to text with whisper.cpp
// (github.com/ggml-org/whisper.cpp, MIT). service.js puts these methods on
// the Luna bus; each takes the request payload and resolves to a webOS
// style reply (returnValue, and errorCode / errorText on failure). The
// simulator implements the same calls in runtime/phoenix-runtime.js
// ("Voice memos"); the codes are TRANSCRIBE_ERRORS in
// apps/shared/luna/src/transcriber.ts.
//
//   transcribe {path, language?, prompt?} -> {state: "done", progress: 100, text,
//       segments: [{start, end, text}] (seconds), language, engine}; while
//       it works, onProgress gets {state: "queued" | "converting" |
//       "transcribing", progress} (service.js sends them to subscribers)
//   getStatus {} -> {engine, installed, binary, model, modelInstalled, converter}
//
// How a file is transcribed:
//   1. whisper-cli reads 16 kHz WAV (what Voice Memos records) as it is;
//      anything else is converted with ffmpeg first. Without ffmpeg, recent
//      whisper-cli builds still read MP3, Ogg and FLAC themselves.
//   2. whisper-cli -m MODEL -f WAV -l LANG -oj -of TMP -pp [--prompt TEXT]
//      (prompt: words to expect, whisper's initial prompt; Voice Dial
//      passes the contacts' names): the result is
//      TMP.json ("transcription": [{offsets: {from, to} (ms), text}]) and
//      the progress lines ("whisper_print_progress_callback: progress = 40%")
//      come on stderr.
//   One file at a time: the rest wait in a queue (whisper uses every core).
//
// Configuration, first found wins: the options createTranscriber() gets
// (tests), the environment (PHOENIX_WHISPER_CLI, PHOENIX_WHISPER_MODEL,
// PHOENIX_FFMPEG, PHOENIX_WHISPER_THREADS), then /etc/phoenix/transcriber.json
// ({"whisper": path, "model": path, "ffmpeg": path, "threads": n}). The
// model defaults to /usr/share/whisper/ggml-base.en.bin, and the programs
// are looked up on the PATH (whisper-cli, then whisper-cpp and the old name
// "main" in /usr/share/whisper). meta-phoenix's whisper-cpp recipe stub
// describes how they get onto the image.

"use strict";

const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const E = { BAD_PARAMS: -1, NOT_FOUND: 1, ENGINE_NOT_INSTALLED: 2, MODEL_NOT_INSTALLED: 3, UNSUPPORTED_FORMAT: 4, FAILED: 5 };
const METHODS = ["transcribe", "getStatus"];
const CONFIG_FILE = "/etc/phoenix/transcriber.json";
const DEFAULT_MODEL = "/usr/share/whisper/ggml-base.en.bin";
const WHISPER_NAMES = ["whisper-cli", "whisper-cpp"];
const WHISPER_FALLBACKS = ["/usr/share/whisper/whisper-cli", "/usr/share/whisper/main"];
// Formats recent whisper-cli builds decode themselves (examples/common-whisper.cpp).
const SELF_DECODED = [".wav", ".mp3", ".ogg", ".oga", ".flac"];

class TranscribeError extends Error {
    constructor(code, text) {
        super(text);
        this.code = code;
    }
}

function ok(extra) {
    return Object.assign({ returnValue: true }, extra);
}

function failure(e) {
    if (e instanceof TranscribeError) return { returnValue: false, errorCode: e.code, errorText: e.message };
    return { returnValue: false, errorCode: E.FAILED, errorText: String(e && e.message || e) };
}

function readConfig(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8")) || {};
    } catch (e) {
        return {};
    }
}

function isExecutable(p) {
    try {
        fs.accessSync(p, fs.constants.X_OK);
        return fs.statSync(p).isFile();
    } catch (e) {
        return false;
    }
}

/** The first of `names` on the PATH, or of `fallbacks`, that can be run. */
function which(names, fallbacks, envPath) {
    const dirs = String(envPath || "").split(path.delimiter).filter(Boolean);
    for (const n of names)
        for (const d of dirs)
            if (isExecutable(path.join(d, n))) return path.join(d, n);
    return (fallbacks || []).find(isExecutable) || null;
}

/** Is this a WAV whisper-cli can read unconverted: PCM, 16-bit, mono or stereo, 16 kHz? */
function isWhisperWav(buf) {
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return false;
    // Walk the chunks to "fmt ".
    for (let at = 12; at + 8 <= buf.length;) {
        const id = buf.toString("ascii", at, at + 4), size = buf.readUInt32LE(at + 4);
        if (id === "fmt ") {
            if (at + 24 > buf.length) return false;
            const format = buf.readUInt16LE(at + 8), channels = buf.readUInt16LE(at + 10);
            const rate = buf.readUInt32LE(at + 12), bits = buf.readUInt16LE(at + 22);
            return format === 1 && (channels === 1 || channels === 2) && rate === 16000 && bits === 16;
        }
        at += 8 + size + (size & 1);
    }
    return false;
}

/** "whisper_print_progress_callback: progress =  40%" -> 40 (the last one in the text), or null. */
function parseProgress(text) {
    const all = String(text).match(/progress\s*=\s*(\d+)\s*%/g);
    if (!all) return null;
    return Math.min(100, parseInt(/(\d+)\s*%$/.exec(all[all.length - 1])[1], 10));
}

/** whisper-cli's -oj output -> {text, segments, language}. */
function parseWhisperJson(json, fallbackLanguage) {
    const segments = (json.transcription || []).map((s) => ({
        start: Math.round(((s.offsets && s.offsets.from) || 0) / 10) / 100,
        end: Math.round(((s.offsets && s.offsets.to) || 0) / 10) / 100,
        text: String(s.text || "").trim(),
    })).filter((s) => s.text && !/^\[(BLANK_AUDIO|MUSIC|SOUND)[^\]]*\]$/i.test(s.text));
    return {
        text: segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim(),
        segments,
        language: (json.result && json.result.language) || fallbackLanguage,
    };
}

/** Run a program; resolves {code, stderr}. onStderr sees stderr as it comes. */
function run(spawn, file, env, args, onStderr, onChild) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(file, args, { stdio: ["ignore", "ignore", "pipe"], env });
        } catch (e) {
            reject(e);
            return;
        }
        if (onChild) onChild(child);
        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (d) => {
            stderr += d;
            if (stderr.length > 64 * 1024) stderr = stderr.slice(-32 * 1024);
            if (onStderr) onStderr(d);
        });
        child.on("error", reject);
        child.on("close", (code, signal) => resolve({ code: code === null ? -1 : code, signal, stderr }));
    });
}

/**
 * The methods. options: {whisper, model, ffmpeg, threads, configFile, env,
 * spawn, tmpDir} (tests pass fakes; the defaults are the device's).
 */
function createTranscriber(options) {
    const o = options || {};
    const env = o.env || process.env;
    const spawn = o.spawn || childProcess.spawn;
    const tmpRoot = o.tmpDir || os.tmpdir();
    let queue = Promise.resolve();

    function config() {
        const file = readConfig(o.configFile || CONFIG_FILE);
        const pick = (opt, envName, key) => o[opt] || env[envName] || file[key] || null;
        return {
            whisper: pick("whisper", "PHOENIX_WHISPER_CLI", "whisper") || which(WHISPER_NAMES, WHISPER_FALLBACKS, env.PATH),
            model: pick("model", "PHOENIX_WHISPER_MODEL", "model") || DEFAULT_MODEL,
            ffmpeg: pick("ffmpeg", "PHOENIX_FFMPEG", "ffmpeg") || which(["ffmpeg"], [], env.PATH),
            threads: parseInt(pick("threads", "PHOENIX_WHISPER_THREADS", "threads"), 10) || Math.max(1, Math.min(4, os.cpus().length)),
        };
    }

    function engineMissing(c) {
        if (!c.whisper || !isExecutable(c.whisper))
            return new TranscribeError(E.ENGINE_NOT_INSTALLED,
                "Speech recognition is not installed: whisper.cpp's whisper-cli was not found" +
                (c.whisper ? " at " + c.whisper : " on the PATH") + ". Install the whisper-cpp package.");
        if (!fs.existsSync(c.model))
            return new TranscribeError(E.MODEL_NOT_INSTALLED,
                "The speech recognition model is not installed: " + c.model + " is missing. Install a whisper.cpp model (e.g. ggml-base.en.bin) there.");
        return null;
    }

    async function transcribeNow(p, onProgress, onChild) {
        const c = config();
        const missing = engineMissing(c);
        if (missing) throw missing;
        const english = /\.en\.bin$/.test(c.model);
        const language = english ? "en" : (p.language || "auto");
        const tmp = await fsp.mkdtemp(path.join(tmpRoot, "phoenix-transcribe-"));
        try {
            let input = p.path;
            const head = Buffer.alloc(4096);
            const fd = await fsp.open(p.path, "r");
            let n;
            try { n = (await fd.read(head, 0, head.length, 0)).bytesRead; } finally { await fd.close(); }
            if (!isWhisperWav(head.subarray(0, n))) {
                if (c.ffmpeg && isExecutable(c.ffmpeg)) {
                    onProgress({ state: "converting", progress: 0 });
                    input = path.join(tmp, "audio.wav");
                    const r = await run(spawn, c.ffmpeg, env, ["-nostdin", "-loglevel", "error", "-y", "-i", p.path,
                                                          "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", input], null, onChild);
                    if (r.code !== 0)
                        throw new TranscribeError(E.UNSUPPORTED_FORMAT, "Could not convert the audio: " + (r.stderr.trim().split("\n").pop() || "ffmpeg failed"));
                } else if (SELF_DECODED.indexOf(path.extname(p.path).toLowerCase()) < 0) {
                    throw new TranscribeError(E.UNSUPPORTED_FORMAT,
                        "This audio (" + (path.extname(p.path) || "no extension") + ") has to be converted, and ffmpeg is not installed.");
                }
            }
            onProgress({ state: "transcribing", progress: 0 });
            const outBase = path.join(tmp, "result");
            let last = 0;
            const r = await run(spawn, c.whisper, env, ["-m", c.model, "-f", input, "-l", language, "-t", String(c.threads),
                                                   "-oj", "-of", outBase, "-pp"].concat(p.prompt ? ["--prompt", p.prompt] : []), (chunk) => {
                const pr = parseProgress(chunk);
                if (pr !== null && pr > last) {
                    last = pr;
                    onProgress({ state: "transcribing", progress: pr });
                }
            }, onChild);
            if (r.signal) throw new TranscribeError(E.FAILED, "Transcription was stopped");
            let json;
            try {
                json = JSON.parse(await fsp.readFile(outBase + ".json", "utf8"));
            } catch (e) {
                const why = r.stderr.split("\n").filter((l) => /error|failed/i.test(l)).pop();
                throw new TranscribeError(E.FAILED, "whisper-cli failed" + (r.code ? " (exit " + r.code + ")" : "") + (why ? ": " + why.trim() : ""));
            }
            const result = parseWhisperJson(json, language);
            return ok(Object.assign({ state: "done", progress: 100, engine: "whisper.cpp" }, result));
        } finally {
            await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
        }
    }

    return {
        /**
         * transcribe {path, language}: onProgress(reply) for each progress
         * step, onChild(child process) to be able to stop it (cancel).
         */
        async transcribe(p, onProgress, onChild) {
            const progress = onProgress || (() => {});
            try {
                if (!p || typeof p.path !== "string" || !p.path.startsWith("/") || p.path.includes("\0"))
                    throw new TranscribeError(E.BAD_PARAMS, "path must be an absolute path");
                if (p.language !== undefined && (typeof p.language !== "string" || !/^(auto|[a-z]{2,3})$/.test(p.language)))
                    throw new TranscribeError(E.BAD_PARAMS, "language must be a language code such as \"en\", or \"auto\"");
                if (p.prompt !== undefined && (typeof p.prompt !== "string" || p.prompt.length > 1000 || p.prompt.includes("\0")))
                    throw new TranscribeError(E.BAD_PARAMS, "prompt must be text of up to 1000 characters");
                let st;
                try { st = await fsp.stat(p.path); } catch (e) { st = null; }
                if (!st || !st.isFile()) throw new TranscribeError(E.NOT_FOUND, "No such file: " + p.path);
                // Say at once when it cannot run, rather than after the queue.
                const missing = engineMissing(config());
                if (missing) throw missing;
                progress(ok({ state: "queued", progress: 0 }));
                const job = queue.then(() => transcribeNow(p, (s) => progress(ok(s)), onChild));
                queue = job.catch(() => {});
                return await job;
            } catch (e) {
                return failure(e);
            }
        },
        async getStatus() {
            const c = config();
            return ok({
                engine: "whisper.cpp",
                installed: !!(c.whisper && isExecutable(c.whisper)) && fs.existsSync(c.model),
                binary: c.whisper || null,
                model: c.model,
                modelInstalled: fs.existsSync(c.model),
                converter: !!(c.ffmpeg && isExecutable(c.ffmpeg)),
            });
        },
    };
}

module.exports = { createTranscriber, METHODS, ERRORS: E, DEFAULT_MODEL, isWhisperWav, parseProgress, parseWhisperJson };
