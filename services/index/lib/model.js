// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The index's model: Google's EmbeddingGemma 2 (6 October 2026; Apache-2.0,
// its model card at google/embeddinggemma-2 and the Gemma 4 licence page it
// links, checked 11 October 2026), as llama.cpp's own conversion publishes
// it (ggml-org/embeddinggemma-2-GGUF, converted with llama.cpp b11451; its
// convert.log), at a pinned revision, each file's SHA-256 from Hugging
// Face's LFS metadata checked when it is downloaded:
//
//   TEXT   the 270M text and code model (130M transformer, 140M
//          embeddings), Q8_0: 310 MB on disk; text, code, and every
//          source's words. Needed for the index at all.
//   MEDIA  its vision (170M) and audio (300M) encoders in one projector
//          (mmproj), Q8_0: 555 MB; with "Include photos and voice memos",
//          pictures and recordings are embedded themselves, in the same
//          space as text ("a photo of the beach" finds the picture of a
//          beach that is called IMG_2041). llama-server reads it with
//          --mmproj (tools/mtmd: Gemma 4's vision and audio towers,
//          which EmbeddingGemma 2 shares).
//
// Not float16: the model card's "Numerical Precision" says its
// activations overflow float16, which llama.cpp's CPU backend does not
// use for them (Q8_0 weights, float32 arithmetic).
//
// llama.cpp knows the model ("gemma-embedding2") from b11451 (2026-10-06):
// ./phoenix and meta-phoenix's llama-cpp build b11552, which has it and
// multimodal input to /v1/embeddings.

"use strict";

var HF = "https://huggingface.co/";
var REPO = "ggml-org/embeddinggemma-2-GGUF";
var REVISION = "bfcd298762cc34d0357ece5ebdd31791a3a374d8";

function hosted(m) {
    var url = HF + REPO + "/resolve/" + REVISION + "/" + m.file;
    return Object.assign({ licence: "Apache-2.0", source: REPO, revision: REVISION, url: url,
                           sources: [{ kind: "official", files: [{ url: url, sha256: m.sha256, size: m.size }] }] }, m);
}

var TEXT = hosted({ id: "embeddinggemma-2-q8_0", name: "EmbeddingGemma 2", file: "embeddinggemma-2-Q8_0.gguf", size: 309855456,
                    sha256: "2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135", ram: 400 * 1024 * 1024 });
var MEDIA = hosted({ id: "mmproj-embeddinggemma-2-q8_0", name: "EmbeddingGemma 2 vision and audio", file: "mmproj-embeddinggemma-2-Q8_0.gguf", size: 554821024,
                     sha256: "c4a8a52691ecef40618438928bdf9e68379b854e24166f292592353db0aab64f", ram: 700 * 1024 * 1024 });

module.exports = { TEXT: TEXT, MEDIA: MEDIA, REPO: REPO, REVISION: REVISION };
