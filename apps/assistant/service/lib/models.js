// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The on-device models Settings > Assistant offers (layer 3 of
// docs/M6-PLAN.md F3), run by llama.cpp's llama-server. Small instruct
// models with tool calling, under permissive licences only (all three
// Apache-2.0, per their Hugging Face model cards, checked 7 October 2026),
// in the Qwen team's own GGUF builds. None is shipped: the user downloads
// one, and its SHA-256 (from Hugging Face's LFS metadata) is checked.
//
// ram: the device memory a model wants (the file, its context and the rest
// of the system); the list offers what fits and recommends the largest.

"use strict";

var HF = "https://huggingface.co/";

var MODELS = [
    { id: "qwen2.5-0.5b-instruct-q4_k_m", name: "Qwen2.5 0.5B Instruct", family: "Qwen2.5", params: "0.5B",
      licence: "Apache-2.0", source: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
      file: "qwen2.5-0.5b-instruct-q4_k_m.gguf", size: 491400032,
      sha256: "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",
      ram: 2 * 1024 * 1024 * 1024, note: "Fast; commands and short answers" },
    { id: "qwen2.5-1.5b-instruct-q4_k_m", name: "Qwen2.5 1.5B Instruct", family: "Qwen2.5", params: "1.5B",
      licence: "Apache-2.0", source: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
      file: "qwen2.5-1.5b-instruct-q4_k_m.gguf", size: 1117320736,
      sha256: "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e",
      ram: 4 * 1024 * 1024 * 1024, note: "Better answers; for phones with 4 GB or more" },
    { id: "qwen3-4b-q4_k_m", name: "Qwen3 4B", family: "Qwen3", params: "4B",
      licence: "Apache-2.0", source: "Qwen/Qwen3-4B-GGUF",
      file: "Qwen3-4B-Q4_K_M.gguf", size: 2497280256,
      sha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
      ram: 8 * 1024 * 1024 * 1024, note: "Best; for 8 GB devices and computers" }
];
MODELS.forEach(function (m) { m.url = HF + m.source + "/resolve/main/" + m.file; });

function find(id) {
    for (var i = 0; i < MODELS.length; ++i) if (MODELS[i].id === id) return MODELS[i];
    return null;
}

// The list with what fits this device (ramBytes: 0 if unknown: all fit)
// and the one to recommend: the largest that fits.
function forDevice(ramBytes) {
    var list = MODELS.map(function (m) { return Object.assign({}, m, { fits: !ramBytes || m.ram <= ramBytes * 1.05 }); });
    var fitting = list.filter(function (m) { return m.fits; });
    var best = fitting.length ? fitting[fitting.length - 1] : list[0];
    list.forEach(function (m) { m.recommended = m === best; });
    return list;
}

module.exports = { MODELS: MODELS, find: find, forDevice: forDevice };
