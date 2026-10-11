// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The start of a WAV recording (Voice Memos saves 16 kHz mono PCM:
// apps/voicememos), as a WAV of its own: the audio encoder reads 25 tokens
// a second (EmbeddingGemma 2's model card, "Context Limits"), and the
// simulator's llama-server takes 512 tokens at a time, so there a memo's
// first 18 seconds are what is embedded; a device's server takes 8,192
// (5 minutes).

"use strict";

// -> Uint8Array, or null when it is not a PCM WAV this can cut.
function clip(bytes, seconds) {
    if (!bytes || bytes.length < 44) return null;
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    function tag(at) { return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]); }
    if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
    var at = 12, fmt = null, data = -1, dataLen = 0;
    while (at + 8 <= bytes.length) {
        var id = tag(at), len = view.getUint32(at + 4, true);
        if (id === "fmt ") fmt = { format: view.getUint16(at + 8, true), channels: view.getUint16(at + 10, true), rate: view.getUint32(at + 12, true),
                                   byteRate: view.getUint32(at + 16, true), block: view.getUint16(at + 20, true), bits: view.getUint16(at + 22, true) };
        if (id === "data") { data = at + 8; dataLen = Math.min(len, bytes.length - data); break; }
        at += 8 + len + (len % 2);
    }
    if (!fmt || fmt.format !== 1 || data < 0 || !fmt.byteRate) return null;
    var keep = Math.min(dataLen, Math.floor(seconds * fmt.byteRate / fmt.block) * fmt.block);
    if (keep >= dataLen) return bytes;
    var out = new Uint8Array(44 + keep), o = new DataView(out.buffer);
    out.set([82, 73, 70, 70], 0); o.setUint32(4, 36 + keep, true); out.set([87, 65, 86, 69], 8);
    out.set([102, 109, 116, 32], 12); o.setUint32(16, 16, true); o.setUint16(20, 1, true); o.setUint16(22, fmt.channels, true);
    o.setUint32(24, fmt.rate, true); o.setUint32(28, fmt.byteRate, true); o.setUint16(32, fmt.block, true); o.setUint16(34, fmt.bits, true);
    out.set([100, 97, 116, 97], 36); o.setUint32(40, keep, true);
    out.set(bytes.subarray(data, data + keep), 44);
    return out;
}

module.exports = { clip: clip };
