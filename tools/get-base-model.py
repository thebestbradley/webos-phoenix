#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Fetches the Assistant's built-in on-device model for the simulator:
Qwen3 0.6B, the Qwen team's own GGUF (Q8_0, 639 MB, Apache-2.0, at a
pinned revision), checked against its SHA-256,
into build/models, where phoenix-sim's LocalModels finds models that come
with the system. The same file and hash as apps/assistant/service/lib/
models.js (BUILT_IN; a test there checks they agree); on a device
meta-phoenix's qwen3-0.6b-gguf puts it in /usr/share/phoenix/models.

    tools/get-base-model.py [--dest build/models]
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import download  # noqa: E402

ID = "qwen3-0.6b-q8_0"
URL = "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/23749fefcc72300e3a2ad315e1317431b06b590a/Qwen3-0.6B-Q8_0.gguf"
SHA256 = "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031"
SIZE = 639446688


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dest", default=os.path.join(here, "..", "build", "models"))
    args = ap.parse_args()
    dest = os.path.abspath(args.dest)
    os.makedirs(dest, exist_ok=True)
    path = os.path.join(dest, ID + ".gguf")
    if os.path.exists(path) and os.path.getsize(path) == SIZE:
        print("model:", path)
        return
    download(URL, path, SHA256, SIZE, "Qwen3 0.6B")
    print("model:", path)


if __name__ == "__main__":
    main()
