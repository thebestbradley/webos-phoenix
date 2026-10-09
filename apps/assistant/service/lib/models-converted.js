// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phoenix's conversions of the Qwen team's weights (lib/models.js), as
// tools/convert-model.sh records them: id -> {from: {repo, revision},
// quant, llamaCommit, files: [{name, size, sha256}]}. Written by
// .github/workflows/models.yml (tools/models-converted.py add); the files
// are assets of this repository's release models-<id>.

"use strict";

module.exports = {
    "qwen3.5-2b-q8_0": {
        "files": [
            {
                "name": "Qwen3.5-2B-Q8_0-00001-of-00002.gguf",
                "sha256": "683fdc49214fdaa5152d9e04e3c21483a6e9bfd7f7be5dffaa0392463062bb24",
                "size": 1898176288
            },
            {
                "name": "Qwen3.5-2B-Q8_0-00002-of-00002.gguf",
                "sha256": "13e0ea1af68f0c4d48651079e7ec50bf8616eb18f8c2b364885b4b056ae78ee4",
                "size": 178498528
            }
        ],
        "from": {
            "repo": "Qwen/Qwen3.5-2B",
            "revision": "15852e8c16360a2fea060d615a32b45270f8a8fc"
        },
        "llamaCommit": "66e665c4276ee46f3ec9872dd7e5a496842bc44f",
        "quant": "Q8_0"
    },
    "qwen3.5-4b-q4_k_m": {
        "files": [
            {
                "name": "Qwen3.5-4B-Q4_K_M-00001-of-00002.gguf",
                "sha256": "518a4a783f5e45b0fe27efa4911b4453dbf8fec3fa7cc15b2be8dd52db518298",
                "size": 1901243264
            },
            {
                "name": "Qwen3.5-4B-Q4_K_M-00002-of-00002.gguf",
                "sha256": "27b9d49d43bbb9e1ea7e7e05ffb75eb40886edd164ddeb6c384d474ec9dceff4",
                "size": 882203424
            }
        ],
        "from": {
            "repo": "Qwen/Qwen3.5-4B",
            "revision": "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a"
        },
        "llamaCommit": "66e665c4276ee46f3ec9872dd7e5a496842bc44f",
        "quant": "Q4_K_M"
    },
    "qwen3.5-9b-q4_k_m": {
        "files": [
            {
                "name": "Qwen3.5-9B-Q4_K_M-00001-of-00004.gguf",
                "sha256": "24bec0b13d444f63de8087adf0815cfc11052c4be36fe8ddb582d1d057d6b2dd",
                "size": 1885443296
            },
            {
                "name": "Qwen3.5-9B-Q4_K_M-00002-of-00004.gguf",
                "sha256": "fe1f47d1bf5cf75432da2b488b052592402a48d3a452c1237565bb61ccd94028",
                "size": 1893279200
            },
            {
                "name": "Qwen3.5-9B-Q4_K_M-00003-of-00004.gguf",
                "sha256": "2598b229697bb55931203f604335ddcbdeaafae459e78cae374fd41dcea1d641",
                "size": 1884516928
            },
            {
                "name": "Qwen3.5-9B-Q4_K_M-00004-of-00004.gguf",
                "sha256": "cb9248244a7b50fef86ad7ea4c4d683accfe1e91e40872320aa4b5b28f4aa93f",
                "size": 116851296
            }
        ],
        "from": {
            "repo": "Qwen/Qwen3.5-9B",
            "revision": "c202236235762e1c871ad0ccb60c8ee5ba337b9a"
        },
        "llamaCommit": "66e665c4276ee46f3ec9872dd7e5a496842bc44f",
        "quant": "Q4_K_M"
    }
};
