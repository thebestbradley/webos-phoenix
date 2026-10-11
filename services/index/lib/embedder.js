// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// EmbeddingGemma 2 through llama.cpp's llama-server started with
// --embedding (its OpenAI-style POST /v1/embeddings, tools/server
// server-context.cpp handle_embeddings_impl), the vectors cut and
// normalized as the index keeps them (lib/vectors.js prepare):
//
//   createEmbedder({ensure(media) -> Promise<{baseUrl}>, request, dim, batch (4 passages a
//                  request), gate() -> Promise (waited for before each of a pass's requests), log})
//     .documents([text]) -> Promise<[Float32Array | null]>   passages, already
//                                                    written as documents (lib/chunk.js);
//                                                    null for one the model refused
//     .query(words) -> Promise<Float32Array>          a search, its prefix added;
//                                                    the last QUERY_CACHE kept
//     .media([{type: "image" | "audio", base64, mime}]) -> Promise<[Float32Array]>
//                                                    a picture or a recording itself
//                                                    (the server started with
//                                                    --mmproj: ensure(true)), no prefix
//                                                    (the model card: "Pass images,
//                                                    video, and audio without any prefix")
//
// request is the service's HTTP ({method, url, headers, body, timeoutMs} ->
// Promise<{status, body}>): Node's on a device, the simulator's proxy in a page.

"use strict";

var chunk = require("./chunk");
var vectors = require("./vectors");

var QUERY_CACHE = 64;

function createEmbedder(o) {
    var dim = o.dim || vectors.DIM, batch = o.batch || 4, log = o.log || function () {};
    var cache = new Map();

    function post(input, media) {
        return o.ensure(!!media).then(function (srv) {
            return o.request({ method: "POST", url: srv.baseUrl.replace(/\/+$/, "") + "/embeddings", headers: { "Content-Type": "application/json" },
                               body: JSON.stringify({ input: input, encoding_format: "float" }), timeoutMs: o.timeoutMs || 120000 });
        }).then(function (r) {
            var body = null;
            try { body = typeof r.body === "string" ? JSON.parse(r.body) : r.body; } catch (e) { body = null; }
            if (r.status !== 200 || !body || !Array.isArray(body.data)) {
                var why = body && body.error ? (body.error.message || JSON.stringify(body.error)) : "HTTP " + r.status;
                throw new Error("the embedding model: " + why);
            }
            var out = [];
            body.data.forEach(function (d, i) { out[typeof d.index === "number" ? d.index : i] = vectors.prepare(d.embedding, dim); });
            if (out.length !== input.length || out.some(function (v) { return !v; })) throw new Error("the embedding model answered " + out.length + " of " + input.length);
            return out;
        });
    }
    // A pass's batches, each after the gate (o.gate: searches go first).
    function inBatches(list, media) {
        var out = [], i = 0;
        function next() {
            if (i >= list.length) return Promise.resolve(out);
            var part = list.slice(i, i + (media ? 1 : batch));
            i += part.length;
            return Promise.resolve(o.gate ? o.gate() : null).then(function () { return post(part, media); })
                .catch(function (e) {
                    // One the model refuses (too long for its batch): the rest of
                    // the batch alone, and null for that one, which is left out.
                    if (part.length === 1) { log("left out: " + e.message); return [null]; }
                    return part.reduce(function (p, x) {
                        return p.then(function (got) {
                            return post([x], media).then(function (v) { return got.concat(v); }, function (e2) { log("left out: " + e2.message); return got.concat([null]); });
                        });
                    }, Promise.resolve([]));
                })
                .then(function (v) { out.push.apply(out, v); return next(); });
        }
        return next();
    }

    return {
        documents: function (texts) { return inBatches(texts, false); },
        media: function (list) {
            return inBatches(list.map(function (x) {
                var part = x.type === "audio"
                    ? { type: "input_audio", input_audio: { data: x.base64, format: /mp3|mpeg/.test(x.mime || "") ? "mp3" : "wav" } }
                    : { type: "image_url", image_url: { url: "data:" + (x.mime || "image/jpeg") + ";base64," + x.base64 } };
                return { content: [part] };
            }), true);
        },
        query: function (words) {
            var key = chunk.clean(words).toLowerCase();
            if (cache.has(key)) {
                var v = cache.get(key);
                cache.delete(key);
                cache.set(key, v);
                return Promise.resolve(v);
            }
            return post([chunk.queryInput(words)], false).then(function (got) {
                cache.set(key, got[0]);
                if (cache.size > QUERY_CACHE) cache.delete(cache.keys().next().value);
                return got[0];
            });
        },
        forget: function () { cache.clear(); },
        log: log
    };
}

module.exports = { createEmbedder: createEmbedder, QUERY_CACHE: QUERY_CACHE };
