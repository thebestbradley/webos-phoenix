#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The transcriber from the command line: transcribe-cli.js FILE [LANGUAGE [PROMPT]]
// prints transcribe's reply (JSON: {returnValue, text, ...} or
// {returnValue: false, errorCode, errorText}) and exits 1 on an error.
// phoenix-sim's dictation runs this on the computer it runs on, so the
// keyboard's microphone uses whisper.cpp as the device does (the same
// configuration: PHOENIX_WHISPER_CLI, PHOENIX_WHISPER_MODEL, ...).

"use strict";

const path = require("path");
const { createTranscriber } = require("./transcriber");

const file = process.argv[2];
if (!file) {
    process.stderr.write("usage: transcribe-cli.js FILE [LANGUAGE [PROMPT]]\n");
    process.exit(2);
}
const p = { path: path.resolve(file) };
if (process.argv[3]) p.language = process.argv[3];
if (process.argv[4]) p.prompt = process.argv[4];        // words to expect (Dictation's prompt)
createTranscriber().transcribe(p).then((r) => {
    process.stdout.write(JSON.stringify(r) + "\n");
    process.exit(r.returnValue === false ? 1 : 0);
});
