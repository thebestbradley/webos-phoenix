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
// The newest official GGUFs are Qwen3's (May 2025). Qwen3.5, 3.6 and 3.8
// (2026) and the Qwen3 2507 instruct updates have no GGUF from the Qwen
// team (checked 9 October 2026), so they are not offered (docs/AI-AND-MCP.md).
//
// ram: the device memory to run it well (the file, an 8,192-token cache and
// the rest of the system): the list offers what fits and recommends the
// largest that does. By device: 4 GB or less, the built-in model only;
// 6-8 GB, 1.7B or 4B; 12-16 GB, 8B or 14B; 32 GB and more, 30B-A3B.

"use strict";

var HF = "https://huggingface.co/";
var GiB = 1024 * 1024 * 1024;

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
      ram: 32 * GiB, note: "The best, and quick for its size; for computers with 32 GB or more" }
];
MODELS.forEach(function (m) { m.url = HF + m.source + "/resolve/" + (m.revision || "main") + "/" + m.file; });

function find(id) {
    for (var i = 0; i < MODELS.length; ++i) if (MODELS[i].id === id) return MODELS[i];
    return null;
}

// The list with what fits this device (ramBytes: 0 if unknown: all fit)
// and the one to recommend: the largest that fits (the built-in one when
// nothing larger does).
function forDevice(ramBytes) {
    // A device sold as 8 GB reports 7.3 to 7.7 GiB: 15% of room.
    var list = MODELS.map(function (m) { return Object.assign({}, m, { fits: !ramBytes || m.ram <= ramBytes * 1.15 }); });
    var fitting = list.filter(function (m) { return m.fits; });
    var best = fitting.length ? fitting[fitting.length - 1] : list[0];
    list.forEach(function (m) { m.recommended = m === best; });
    return list;
}

module.exports = { MODELS: MODELS, BUILT_IN: BUILT_IN, find: find, forDevice: forDevice };
