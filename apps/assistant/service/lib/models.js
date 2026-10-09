// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The on-device models Settings > Assistant offers (layer 3 of
// docs/M6-PLAN.md F3), run by llama.cpp's llama-server: the Qwen team's own
// GGUF builds (huggingface.co/Qwen, pinned revisions), Apache-2.0 each (its
// repository's LICENSE and model card, checked 9 October 2026), tool
// calling with Qwen3's chat template (thinking turned off per request,
// lib/providers.js). Qwen3 0.6B is built in: the device image ships it in
// /usr/share/phoenix/models and ./phoenix puts it in build/models for the
// simulator; it is the one in use until another is chosen, and it cannot
// be removed. The others are downloads, one per size, the smallest quant
// the Qwen team publishes, with their SHA-256 (Hugging Face's LFS
// metadata) checked.
//
// Where a model comes from, in order (the owner's rule): the Qwen team's
// own GGUF when they publish one; otherwise Phoenix's conversion of the
// Qwen team's own weights at a pinned revision (tools/convert-model.sh,
// llama.cpp at ./phoenix's LLAMA_COMMIT; .github/workflows/models.yml
// publishes it as a release of this repository, in parts under 2 GiB,
// and records it in models-converted.js). A download tries each source
// in turn until one comes whole (lib/node-device.js, the simulator's
// shell/native/localmodels.cpp). A model with no source yet is not
// offered, and one that replaces an older model of its size hides it once
// it can be downloaded (unless the older one is installed: assistant.js).
//
// The newest official GGUFs are Qwen3's (May 2025). Qwen3.5 (2B, 4B, 9B),
// Qwen3.6 35B-A3B and Qwen3.8 27B (2026) have only safetensors from the
// Qwen team (checked 9 October 2026), so theirs are Phoenix's conversions
// until Qwen publishes GGUFs (the models workflow checks every week). All
// Apache-2.0 (each repository's model card, checked 9 October 2026).
//
// ram: the device memory to run it well (the file, a 4,096-token cache,
// as big as 8,192 in 8 bits was, and the rest of the system): the list
// offers what fits and recommends the largest that does. By device: 4 GB
// or less, the built-in model only; 6-8 GB, 1.7B or 4B; 12-16 GB, 8B or
// 14B; 32 GB and more, 30B-A3B.

"use strict";

var HF = "https://huggingface.co/";
var GiB = 1024 * 1024 * 1024;
// Phoenix's conversions: a release of this repository a model
// (models-<id>), its parts as assets.
var RELEASES = "https://github.com/thebestbradley/webos-phoenix/releases/download/";
var CONVERTED = require("./models-converted");

// Qwen3 0.6B: built in.
var BUILT_IN = "qwen3-0.6b-q8_0";

var MODELS = [
    { id: BUILT_IN, name: "Qwen3 0.6B", family: "Qwen3", params: "0.6B", builtIn: true,
      licence: "Apache-2.0", source: "Qwen/Qwen3-0.6B-GGUF", revision: "23749fefcc72300e3a2ad315e1317431b06b590a",
      file: "Qwen3-0.6B-Q8_0.gguf", size: 639446688,
      sha256: "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031",
      ram: 3 * GiB, note: "Built in; commands and short answers" },
    { id: "qwen3-1.7b-q8_0", name: "Qwen3 1.7B", family: "Qwen3", params: "1.7B",
      licence: "Apache-2.0", source: "Qwen/Qwen3-1.7B-GGUF", revision: "90862c4b9d2787eaed51d12237eafdfe7c5f6077",
      file: "Qwen3-1.7B-Q8_0.gguf", size: 1834426016,
      sha256: "061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a",
      ram: 6 * GiB, note: "Better commands and answers; for 6 GB phones" },
    { id: "qwen3-4b-q4_k_m", name: "Qwen3 4B", family: "Qwen3", params: "4B",
      licence: "Apache-2.0", source: "Qwen/Qwen3-4B-GGUF", revision: "bc640142c66e1fdd12af0bd68f40445458f3869b",
      file: "Qwen3-4B-Q4_K_M.gguf", size: 2497280256,
      sha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
      ram: 8 * GiB, note: "Good answers; for 8 GB phones and tablets" },
    { id: "qwen3-8b-q4_k_m", name: "Qwen3 8B", family: "Qwen3", params: "8B",
      licence: "Apache-2.0", source: "Qwen/Qwen3-8B-GGUF", revision: "7c41481f57cb95916b40956ab2f0b139b296d974",
      file: "Qwen3-8B-Q4_K_M.gguf", size: 5027783488,
      sha256: "d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785",
      ram: 12 * GiB, note: "Very good answers; for 12-16 GB devices" },
    { id: "qwen3-14b-q4_k_m", name: "Qwen3 14B", family: "Qwen3", params: "14B",
      licence: "Apache-2.0", source: "Qwen/Qwen3-14B-GGUF", revision: "530227a7d994db8eca5ab5ced2fb692b614357fd",
      file: "Qwen3-14B-Q4_K_M.gguf", size: 9001752960,
      sha256: "500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0",
      ram: 16 * GiB, note: "Excellent answers; for 16 GB devices and computers" },
    { id: "qwen3-30b-a3b-q4_k_m", name: "Qwen3 30B-A3B", family: "Qwen3", params: "30B (3B active)",
      licence: "Apache-2.0", source: "Qwen/Qwen3-30B-A3B-GGUF", revision: "e4d4bafdfb96a411a163846265362aceb0b9c63a",
      file: "Qwen3-30B-A3B-Q4_K_M.gguf", size: 18556685824,
      sha256: "0d003f6662faee786ed5da3e31b29c978de5ae5d275c8794c606a7f3c01aa8f5",
      ram: 32 * GiB, note: "The best, and quick for its size; for computers with 32 GB or more" },
    // Newer models, as Phoenix converts them (no official GGUF yet): from
    // Qwen's repositories at these revisions.
    { id: "qwen3.5-2b-q8_0", name: "Qwen3.5 2B", family: "Qwen3.5", params: "2B", replaces: "qwen3-1.7b-q8_0",
      licence: "Apache-2.0", weights: { repo: "Qwen/Qwen3.5-2B", revision: "15852e8c16360a2fea060d615a32b45270f8a8fc" }, quant: "Q8_0",
      ram: 6 * GiB, note: "Better commands and answers; for 6 GB phones" },
    { id: "qwen3.5-4b-q4_k_m", name: "Qwen3.5 4B", family: "Qwen3.5", params: "4B", replaces: "qwen3-4b-q4_k_m",
      licence: "Apache-2.0", weights: { repo: "Qwen/Qwen3.5-4B", revision: "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a" }, quant: "Q4_K_M",
      ram: 8 * GiB, note: "Good answers; for 8 GB phones and tablets" },
    { id: "qwen3.5-9b-q4_k_m", name: "Qwen3.5 9B", family: "Qwen3.5", params: "9B", replaces: "qwen3-8b-q4_k_m",
      licence: "Apache-2.0", weights: { repo: "Qwen/Qwen3.5-9B", revision: "c202236235762e1c871ad0ccb60c8ee5ba337b9a" }, quant: "Q4_K_M",
      ram: 12 * GiB, note: "Very good answers; for 12-16 GB devices" },
    { id: "qwen3.8-27b-q4_k_m", name: "Qwen3.8 27B", family: "Qwen3.8", params: "27B",
      licence: "Apache-2.0", weights: { repo: "Qwen/Qwen3.8-27B", revision: "1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0" }, quant: "Q4_K_M",
      ram: 32 * GiB, slow: true, note: "The most capable, but slow (all 27B work on every word); for computers with 32 GB or more" },
    { id: "qwen3.6-35b-a3b-q4_k_m", name: "Qwen3.6 35B-A3B", family: "Qwen3.6", params: "35B (3B active)", replaces: "qwen3-30b-a3b-q4_k_m",
      licence: "Apache-2.0", weights: { repo: "Qwen/Qwen3.6-35B-A3B", revision: "995ad96eacd98c81ed38be0c5b274b04031597b0" }, quant: "Q4_K_M",
      ram: 32 * GiB, note: "The best, and quick for its size; for computers with 32 GB or more" }
];

// The catalogue with these conversions (converted: models-converted.js's
// form; tests give their own): each model's sources, in order, the Qwen
// team's GGUF (source, revision, file), then Phoenix's conversion when one
// was made from the same weights. url, sha256 and size: the first
// source's (its first file's address; its sha256 when it is one file; the
// size of all its files).
function catalog(converted) {
    var list = MODELS.map(function (base) {
        var m = Object.assign({}, base), sources = [];
        if (m.source && m.file && m.sha256)
            sources.push({ kind: "official", files: [{ url: HF + m.source + "/resolve/" + (m.revision || "main") + "/" + m.file,
                                                       sha256: m.sha256, size: m.size }] });
        var c = converted[m.id];
        if (c && m.weights && c.from && c.from.repo === m.weights.repo && c.from.revision === m.weights.revision && c.files && c.files.length)
            sources.push({ kind: "phoenix", files: c.files.map(function (f) {
                return { url: RELEASES + "models-" + m.id + "/" + f.name, sha256: f.sha256, size: f.size };
            }) });
        m.sources = sources;
        if (sources.length) {
            m.url = sources[0].files[0].url;
            m.sha256 = sources[0].files.length === 1 ? sources[0].files[0].sha256 : "";
            m.size = sources[0].files.reduce(function (n, f) { return n + f.size; }, 0);
            if (!m.source) m.source = m.weights.repo;
        }
        return m;
    });

    function find(id) {
        for (var i = 0; i < list.length; ++i) if (list[i].id === id) return list[i];
        return null;
    }

    // The models offered: those with a source, less those a newer one of
    // their size replaces (keep: the ids installed, which stay listed).
    function offered(keep) {
        keep = keep || [];
        var have = list.filter(function (m) { return m.sources.length; });
        var replaced = {};
        have.forEach(function (m) { if (m.replaces) replaced[m.replaces] = true; });
        return have.filter(function (m) { return !replaced[m.id] || keep.indexOf(m.id) >= 0; });
    }

    // The list with what fits this device (ramBytes: 0 if unknown: all fit)
    // and the one to recommend: the largest that fits and is not slow for
    // its size (the built-in one when nothing larger does).
    function forDevice(ramBytes, keep) {
        // A device sold as 8 GB reports 7.3 to 7.7 GiB: 15% of room.
        var all = offered(keep).sort(function (a, b) { return a.ram - b.ram || (a.size || 0) - (b.size || 0); })
            .map(function (m) { return Object.assign({}, m, { fits: !ramBytes || m.ram <= ramBytes * 1.15 }); });
        // Not a dense 27B: the MoE beside it answers as well, far sooner.
        var quick = all.filter(function (m) { return m.fits && !m.slow; });
        var best = quick.length ? quick[quick.length - 1] : all[0];
        all.forEach(function (m) { m.recommended = m === best; });
        return all;
    }

    return { MODELS: list, BUILT_IN: BUILT_IN, find: find, offered: offered, forDevice: forDevice, catalog: catalog };
}

module.exports = catalog(CONVERTED);
