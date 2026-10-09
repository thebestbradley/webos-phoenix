#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Fetches the whisper.cpp model the simulator's speech recognition uses
(dictation, Voice Memos, Voice Dial and the assistant): OpenAI's Whisper
base.en converted to ggml (MIT; huggingface.co/ggerganov/whisper.cpp),
checked against its SHA-256. Safe to run again: a model already there is
kept.

    tools/get-whisper-model.py [--dest build/whisper] [--model base.en|tiny.en]

phoenix-sim uses build/whisper/ggml-base.en.bin beside itself when
PHOENIX_WHISPER_MODEL is not set. whisper-cli itself comes from Homebrew
(whisper-cpp) or scripts/linux-setup.sh. On a device meta-phoenix installs
both (whisper-cpp, whisper-cpp-model-base-en; docs/AI-AND-MCP.md).
"""

import argparse
import os
import sys

BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/"
# name -> (file, bytes, SHA-256), as the meta-phoenix recipe pins them.
MODELS = {
    "base.en": ("ggml-base.en.bin", 147964211, "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"),
    "tiny.en": ("ggml-tiny.en.bin", 77704715, "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f"),
}


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dest", default=os.path.join(here, "..", "build", "whisper"))
    ap.add_argument("--model", default="base.en", choices=sorted(MODELS))
    args = ap.parse_args()
    name, size, sha = MODELS[args.model]
    dest = os.path.abspath(args.dest)
    os.makedirs(dest, exist_ok=True)
    out = os.path.join(dest, name)
    if os.path.exists(out) and os.path.getsize(out) == size:
        print("model:", out, "(already there)")
        return
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from fetch import download
    download(BASE + name, out, sha, size, "whisper " + name)
    print("model:", out)


if __name__ == "__main__":
    main()
