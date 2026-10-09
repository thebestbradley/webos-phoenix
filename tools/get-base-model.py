#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Fetches the Assistant's built-in on-device model for the simulator:
Qwen3 0.6B in Q4_K_M (397 MB, Apache-2.0; Unsloth's quantization of the
Qwen team's weights, at a pinned revision), checked against its SHA-256,
into build/models, where phoenix-sim's LocalModels finds models that come
with the system. The same file and hash as apps/assistant/service/lib/
models.js (BUILT_IN; a test there checks they agree); on a device
meta-phoenix's qwen3-0.6b-gguf puts it in /usr/share/phoenix/models.

    tools/get-base-model.py [--dest build/models]
"""

import argparse
import hashlib
import os
import sys
import urllib.request

ID = "qwen3-0.6b-q4_k_m"
URL = "https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/50968a4468ef4233ed78cd7c3de230dd1d61a56b/Qwen3-0.6B-Q4_K_M.gguf"
SHA256 = "ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a"
SIZE = 396705472


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
    print("downloading", URL, f"({SIZE / 1e6:.0f} MB)")
    part = path + ".part"
    h = hashlib.sha256()
    # In pieces: 400 MB need not be in memory at once.
    with urllib.request.urlopen(URL) as r, open(part, "wb") as out:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            h.update(chunk)
            out.write(chunk)
    if h.hexdigest() != SHA256:
        os.remove(part)
        sys.exit(f"{URL}: SHA-256 {h.hexdigest()}, expected {SHA256}")
    os.replace(part, path)
    print("model:", path)


if __name__ == "__main__":
    main()
