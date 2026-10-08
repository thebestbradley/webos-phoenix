#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Fetches what the assistant's wake word needs on a computer (phoenix-sim
and the wakeword-test): Vosk's library (libvosk, Apache-2.0, from the vosk
wheel on PyPI) and its small English model (vosk-model-small-en-us-0.15,
Apache-2.0, from alphacephei.com), both checked against their SHA-256.

    tools/get-wakeword.py [--dest build/wakeword]

phoenix-sim looks in build/wakeword beside itself (or --wake-model and
--vosk-library). On a device meta-phoenix installs both
(docs/AI-AND-MCP.md, Voice).
"""

import argparse
import hashlib
import io
import os
import platform
import shutil
import sys
import urllib.request
import zipfile

MODEL = ("vosk-model-small-en-us-0.15",
         "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip",
         "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498")
# The wheels' libvosk (0.3.45 has no macOS wheel; 0.3.44 has every call used).
WHEELS = {
    ("Linux", "x86_64"): ("https://files.pythonhosted.org/packages/py3/v/vosk/vosk-0.3.45-py3-none-manylinux_2_12_x86_64.manylinux2010_x86_64.whl",
                          "25e025093c4399d7278f543568ed8cc5460ac3a4bf48c23673ace1e25d26619f", "vosk/libvosk.so", "libvosk.so"),
    ("Linux", "aarch64"): ("https://files.pythonhosted.org/packages/py3/v/vosk/vosk-0.3.45-py3-none-manylinux2014_aarch64.whl",
                           "54efb47dd890e544e9e20f0316413acec7f8680d04ec095c6140ab4e70262704", "vosk/libvosk.so", "libvosk.so"),
    ("Darwin", "*"): ("https://files.pythonhosted.org/packages/py3/v/vosk/vosk-0.3.44-py3-none-macosx_10_6_universal2.whl",
                      "029d0b3d6a5cff874c575b8a5814a4cccfb37608cff52e846c02a8c67a882801", "vosk/libvosk.dyld", "libvosk.dylib"),
}


def fetch(url, sha256):
    with urllib.request.urlopen(url) as r:
        size = int(r.headers.get("Content-Length") or 0)
        print("downloading", url, f"({size / 1e6:.0f} MB)" if size else "")
        data = r.read()
    got = hashlib.sha256(data).hexdigest()
    if got != sha256:
        sys.exit(f"{url}: SHA-256 {got}, expected {sha256}")
    return data


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dest", default=os.path.join(here, "..", "build", "wakeword"))
    args = ap.parse_args()
    dest = os.path.abspath(args.dest)
    os.makedirs(dest, exist_ok=True)

    system, machine = platform.system(), platform.machine().lower()
    machine = {"amd64": "x86_64", "arm64": "aarch64"}.get(machine, machine)
    wheel = WHEELS.get((system, machine)) or WHEELS.get((system, "*"))
    if not wheel:
        sys.exit(f"no libvosk for {system} {machine}; build Vosk (https://github.com/alphacep/vosk-api) and pass --vosk-library")
    url, sha, member, name = wheel
    lib = os.path.join(dest, name)
    if not os.path.exists(lib):
        with zipfile.ZipFile(io.BytesIO(fetch(url, sha))) as z, open(lib + ".part", "wb") as out:
            out.write(z.read(member))
        os.replace(lib + ".part", lib)
    model_dir = os.path.join(dest, MODEL[0])
    if not os.path.isdir(model_dir):
        with zipfile.ZipFile(io.BytesIO(fetch(MODEL[1], MODEL[2]))) as z:
            tmp = model_dir + ".part"
            shutil.rmtree(tmp, ignore_errors=True)
            z.extractall(tmp)
            os.replace(os.path.join(tmp, MODEL[0]), model_dir)
            shutil.rmtree(tmp, ignore_errors=True)
    print("library:", lib, f"({os.path.getsize(lib) / 1e6:.0f} MB)")
    print("model:", model_dir)


if __name__ == "__main__":
    main()
