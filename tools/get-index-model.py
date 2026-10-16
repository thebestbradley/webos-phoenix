#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Fetches what Search your phone (services/index) needs on a computer for
tools/test-index-sim.cjs, each checked against its SHA-256:

  the model        EmbeddingGemma 2's text model as llama.cpp publishes it
                   (embeddinggemma-2-Q8_0.gguf, 310 MB, Apache-2.0), the
                   file, revision and checksum services/index/lib/model.js
                   names
  llama-server     on Linux x86-64, llama.cpp's own build (MIT) of the
                   release ./phoenix pins (LLAMA_BUILD, an 18 MB download):
                   its llama-server with the libraries beside it. On a Mac
                   Homebrew's llama.cpp, elsewhere the one ./phoenix builds

    tools/get-index-model.py [--dest build/index]

tools/test-index-sim.cjs looks in build/index (embeddinggemma-2-Q8_0.gguf,
llama.cpp/llama-server) when it is not given --model and --llama-server.
The simulator itself downloads the model when Search your phone is turned
on (Settings > Assistant); on a device meta-phoenix installs llama-server
(docs/AI-AND-MCP.md).
"""

import argparse
import io
import os
import platform
import re
import shutil
import sys
import tarfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# llama.cpp's Linux x86-64 build of each release this script knows (the
# release's llama-b<N>-bin-ubuntu-x64.tar.gz). ./phoenix's LLAMA_BUILD must
# be one of them: a new pin there needs its archive's checksum here.
LLAMA = {
    "11552": ("https://github.com/ggml-org/llama.cpp/releases/download/b11552/llama-b11552-bin-ubuntu-x64.tar.gz",
              "a45a6afda05d08028bd37998072ab602c96799bccde126835941623cb99bb727"),
}


def model_source():
    """(url, file, size, sha256) of the index's text model, from services/index/lib/model.js."""
    with open(os.path.join(REPO, "services", "index", "lib", "model.js"), encoding="utf-8") as f:
        js = f.read()
    hf = re.search(r'var HF = "([^"]+)";', js).group(1)
    repo = re.search(r'var REPO = "([^"]+)";', js).group(1)
    rev = re.search(r'var REVISION = "([0-9a-f]+)";', js).group(1)
    text = re.search(r'var TEXT = hosted\(\{(.*?)\}\);', js, re.S).group(1)
    file = re.search(r'file: "([^"]+)"', text).group(1)
    size = int(re.search(r'size: (\d+)', text).group(1))
    sha = re.search(r'sha256: "([0-9a-f]{64})"', text).group(1)
    return hf + repo + "/resolve/" + rev + "/" + file, file, size, sha


def llama_build():
    """./phoenix's LLAMA_BUILD (the llama.cpp release it builds)."""
    with open(os.path.join(REPO, "phoenix"), encoding="utf-8") as f:
        return re.search(r"^LLAMA_BUILD=(\d+)", f.read(), re.M).group(1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dest", default=os.path.join(REPO, "build", "index"))
    args = ap.parse_args()
    dest = os.path.abspath(args.dest)
    os.makedirs(dest, exist_ok=True)
    sys.path.insert(0, HERE)
    from fetch import download, fetch_bytes

    url, file, size, sha = model_source()
    model = os.path.join(dest, file)
    if not os.path.exists(model):
        download(url, model, sha, size, label=file)
    print("model:", model, f"({os.path.getsize(model) / 1e6:.0f} MB)")

    build = llama_build()
    system, machine = platform.system(), platform.machine().lower()
    machine = {"amd64": "x86_64"}.get(machine, machine)
    server_dir = os.path.join(dest, "llama.cpp")
    if system == "Darwin":
        print("llama-server: Homebrew's llama.cpp (brew install llama.cpp; ./phoenix does it)")
        return
    if system != "Linux" or machine != "x86_64":
        print(f"llama-server: llama.cpp publishes no build for {system} {machine} here; ./phoenix builds it")
        return
    if build not in LLAMA:
        sys.exit(f"./phoenix pins llama.cpp b{build}; this script knows "
                 + ", ".join("b" + b for b in LLAMA) + ": add b" + build + "'s archive and its SHA-256 to LLAMA")
    stamp = os.path.join(server_dir, ".build")
    have = open(stamp).read().strip() if os.path.exists(stamp) else ""
    if have != build:
        archive_url, archive_sha = LLAMA[build]
        tmp = server_dir + ".part"
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp)
        # Python's "data" filter (3.12, and 3.11.4 on) refuses links and
        # paths that leave the folder.
        safe = {"filter": "data"} if hasattr(tarfile, "data_filter") else {}
        with tarfile.open(fileobj=io.BytesIO(fetch_bytes(archive_url, archive_sha)), mode="r:gz") as t:
            top = "llama-b" + build + "/"
            for m in t.getmembers():
                # The release's own folder, its files moved up to llama.cpp/.
                if not m.name.startswith(top) or m.name == top or ".." in m.name.split("/"):
                    continue
                m.name = m.name[len(top):]
                t.extract(m, tmp, **safe)
        with open(os.path.join(tmp, ".build"), "w") as f:
            f.write(build + "\n")
        shutil.rmtree(server_dir, ignore_errors=True)
        os.replace(tmp, server_dir)
    print("llama-server:", os.path.join(server_dir, "llama-server"), f"(llama.cpp b{build})")


if __name__ == "__main__":
    main()
