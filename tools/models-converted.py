#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# apps/assistant/service/lib/models-converted.js, Phoenix's conversions of
# the Qwen team's weights (lib/models.js):
#
#   tools/models-converted.py add ENTRY.json...   record conversions (tools/convert-model.sh's)
#   tools/models-converted.py wanted              the ids models.js wants converted and has not
#                                                 (one a line: id repo revision quant)
#   tools/models-converted.py official            models whose Qwen repository now has a GGUF
#                                                 repository beside it (exit 1 if any)
import json
import os
import re
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "apps", "assistant", "service", "lib")
DATA = os.path.join(LIB, "models-converted.js")


def read():
    text = open(DATA, encoding="utf-8").read()
    head, _, body = text.partition("module.exports = ")
    return head, json.loads(body.rstrip().rstrip(";") or "{}")


def write(head, data):
    body = json.dumps(data, indent=4, sort_keys=True)
    with open(DATA, "w", encoding="utf-8") as f:
        f.write(head + "module.exports = " + body + ";\n")


def models():
    js = ("var m = require(%s);" % json.dumps(os.path.join(LIB, "models.js"))
          + "console.log(JSON.stringify(m.MODELS.filter(function (x) { return x.weights; })"
          + ".map(function (x) { return {id: x.id, weights: x.weights, quant: x.quant, sources: x.sources.length}; })));")
    return json.loads(subprocess.check_output(["node", "-e", js]))


def main(argv):
    if not argv:
        print(__doc__ if __doc__ else "add | wanted | official", file=sys.stderr)
        return 2
    cmd = argv[0]
    if cmd == "add":
        head, data = read()
        for path in argv[1:]:
            e = json.load(open(path, encoding="utf-8"))
            if not re.fullmatch(r"[a-z0-9._-]+", e.get("id", "")) or not e.get("files"):
                print("models-converted: not an entry: " + path, file=sys.stderr)
                return 1
            data[e["id"]] = {k: e[k] for k in ("from", "quant", "llamaCommit", "files")}
        write(head, data)
        return 0
    if cmd == "wanted":
        _, data = read()
        for m in models():
            c = data.get(m["id"])
            if not c or c.get("from") != m["weights"]:
                print(m["id"], m["weights"]["repo"], m["weights"]["revision"], m["quant"])
        return 0
    if cmd == "official":
        found = 0
        for m in models():
            repo = m["weights"]["repo"] + "-GGUF"
            try:
                with urllib.request.urlopen("https://huggingface.co/api/models/" + repo, timeout=30) as r:
                    if r.status == 200:
                        print("%s: the Qwen team publishes %s; add it to lib/models.js as the official source" % (m["id"], repo))
                        found += 1
            except urllib.error.HTTPError as e:
                if e.code not in (401, 404):
                    raise
        return 1 if found else 0
    print("models-converted: add | wanted | official", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
