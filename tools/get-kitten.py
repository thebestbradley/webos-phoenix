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
               Linux build (x86-64, aarch64; 29 MB), from Microsoft's
               NuGet package Microsoft.ML.OnnxRuntime (a 157 MB download
               for every platform's build; only the library, its LICENSE
               and ThirdPartyNotices.txt are kept); on a Mac Homebrew's
               onnxruntime (./phoenix installs it)

    tools/get-kitten.py [--dest build/kitten]

phoenix-tts looks in kitten/ beside itself (or PHOENIX_TTS_MODEL and
PHOENIX_ONNXRUNTIME). On a device meta-phoenix installs all three
(docs/AI-AND-MCP.md, "What's installed where").
"""

import argparse
import os
import platform
import sys
import zipfile

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
# ONNX Runtime's release archives were on GitHub (microsoft/onnxruntime),
# which has answered 404 since about 17 November 2026, with no word from
# Microsoft of a new home. Its NuGet package is Microsoft's own C/C++
# distribution (onnxruntime.ai/docs/install, "C#/C/C++/WinML"), signed by
# Microsoft and immutable on nuget.org, and holds the same Linux builds
# (libonnxruntime.so, soname libonnxruntime.so.1, glibc 2.28) as the
# archives did. Its SHA-512 is nuget.org's catalog's packageHash.
ORT = ("https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/1.30.0/microsoft.ml.onnxruntime.1.30.0.nupkg",
       "30df119bd9164eaa187666d93147448fdd4a9a1a3caf83f1505daf7af2d1c5d2", 157230753)
ORT_LIB = {
    "x86_64": "runtimes/linux-x64/native/libonnxruntime.so",
    "aarch64": "runtimes/linux-arm64/native/libonnxruntime.so",
}


def fetch(url, sha256):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from fetch import fetch_bytes
    return fetch_bytes(url, sha256)


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
    elif system != "Linux" or machine not in ORT_LIB:
        print(f"no ONNX Runtime build for {system} {machine}: install libonnxruntime and set PHOENIX_ONNXRUNTIME")
    elif not os.path.exists(lib):
        sys.path.insert(0, here)
        from fetch import download
        url, sha, size = ORT
        nupkg = os.path.join(dest, f"onnxruntime-{ORT_VERSION}.nupkg")
        download(url, nupkg, sha, size)
        try:
            with zipfile.ZipFile(nupkg) as z:
                write(lib, z.read(ORT_LIB[machine]))
                os.chmod(lib, 0o755)
                write(os.path.join(dest, "onnxruntime.LICENSE"), z.read("LICENSE"))
                write(os.path.join(dest, "onnxruntime.ThirdPartyNotices.txt"), z.read("ThirdPartyNotices.txt"))
        finally:
            os.remove(nupkg)
    size = sum(os.path.getsize(os.path.join(dest, f)) for f in os.listdir(dest))
    print("Kitten TTS:", dest, f"({size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
