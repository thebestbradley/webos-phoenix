#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Fetches what the Assistant's voice, Kitten TTS (phoenix-tts), needs on a
computer (phoenix-sim and the tts-test), each checked against its SHA-256:

  the model    KittenML's kitten-tts-nano-0.2 (config.json, the 24 MB
               .onnx file, voices.npz), Apache-2.0, from Hugging Face at a
               pinned revision
  the words    the CMU Pronouncing Dictionary (cmudict.dict, 3.6 MB),
               BSD-2-Clause, at a pinned commit; phoenix-tts's permissive
               phonemizer
  the runtime  ONNX Runtime 1.30.0's libonnxruntime (MIT), Microsoft's own
               Linux build (x86-64, aarch64; an 11 MB download, 29 MB);
               on a Mac Homebrew's onnxruntime (./phoenix installs it)

    tools/get-kitten.py [--dest build/kitten]

phoenix-tts looks in kitten/ beside itself (or PHOENIX_TTS_MODEL and
PHOENIX_ONNXRUNTIME). On a device meta-phoenix installs all three
(docs/AI-AND-MCP.md, "What's installed where").
"""

import argparse
import hashlib
import io
import os
import platform
import sys
import tarfile
import urllib.request

HF = "https://huggingface.co/KittenML/kitten-tts-nano-0.2/resolve/9c81564aa56c6fb79f83780e87099357b88d6617/"
MODEL = [
    ("config.json", HF + "config.json", "010e4433f375686c65b6bff1469ab51e9ee0f77a3f4af1aa89079200126b21ba"),
    ("kitten_tts_nano_v0_2.onnx", HF + "kitten_tts_nano_v0_2.onnx", "42fa8809db319cd7c4c83b3c501e2313bf90edf610235291cad605e4adcb242d"),
    ("voices.npz", HF + "voices.npz", "77258f1fa40dc0801ce69acda1e9d7461c4bcec5af28e73c1880f0fb4e91882e"),
]
CMUDICT = "https://raw.githubusercontent.com/cmusphinx/cmudict/74790861f652b15e4ac49015a90074ad62a27690/"
WORDS = [
    ("cmudict.dict", CMUDICT + "cmudict.dict", "81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22"),
    ("cmudict.LICENSE", CMUDICT + "LICENSE", "bd4ce8e44170a5f9f481310ca85c51de3c4f851a65e679b40e603b143bd3542a"),
]
ORT_VERSION = "1.30.0"
ORT = {
    "x86_64": ("https://github.com/microsoft/onnxruntime/releases/download/v1.30.0/onnxruntime-linux-x64-1.30.0.tgz",
               "a5ed5a3cac51fbb2e90da632ae43d19212faaa20e76484e62bcb7c23ddb3b3fd"),
    "aarch64": ("https://github.com/microsoft/onnxruntime/releases/download/v1.30.0/onnxruntime-linux-aarch64-1.30.0.tgz",
                "e16a27a8ed330bbc698df7330b0cf56e722f354e3bcc92118682c74ef3c3e3da"),
}


def fetch(url, sha256):
    with urllib.request.urlopen(url) as r:
        size = int(r.headers.get("Content-Length") or 0)
        print("downloading", url, f"({size / 1e6:.1f} MB)" if size else "")
        data = r.read()
    got = hashlib.sha256(data).hexdigest()
    if got != sha256:
        sys.exit(f"{url}: SHA-256 {got}, expected {sha256}")
    return data


def write(path, data):
    with open(path + ".part", "wb") as f:
        f.write(data)
    os.replace(path + ".part", path)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dest", default=os.path.join(here, "..", "build", "kitten"))
    args = ap.parse_args()
    dest = os.path.abspath(args.dest)
    os.makedirs(dest, exist_ok=True)

    for name, url, sha in MODEL + WORDS:
        path = os.path.join(dest, name)
        if not os.path.exists(path):
            write(path, fetch(url, sha))

    system, machine = platform.system(), platform.machine().lower()
    machine = {"amd64": "x86_64", "arm64": "aarch64"}.get(machine, machine)
    lib = os.path.join(dest, "libonnxruntime.so.1")
    if system == "Darwin":
        print("ONNX Runtime: Homebrew's onnxruntime (brew install onnxruntime; ./phoenix does it)")
    elif system != "Linux" or machine not in ORT:
        print(f"no ONNX Runtime build for {system} {machine}: install libonnxruntime and set PHOENIX_ONNXRUNTIME")
    elif not os.path.exists(lib):
        url, sha = ORT[machine]
        with tarfile.open(fileobj=io.BytesIO(fetch(url, sha)), mode="r:gz") as t:
            top = os.path.commonpath(t.getnames())
            write(lib, t.extractfile(f"{top}/lib/libonnxruntime.so.{ORT_VERSION}").read())
            os.chmod(lib, 0o755)
            write(os.path.join(dest, "onnxruntime.LICENSE"), t.extractfile(f"{top}/LICENSE").read())
            write(os.path.join(dest, "onnxruntime.ThirdPartyNotices.txt"), t.extractfile(f"{top}/ThirdPartyNotices.txt").read())
    size = sum(os.path.getsize(os.path.join(dest, f)) for f in os.listdir(dest))
    print("Kitten TTS:", dest, f"({size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
