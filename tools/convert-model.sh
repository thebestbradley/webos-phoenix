#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# A GGUF of an on-device model, made from the Qwen team's own weights, for
# the models Qwen publishes no GGUF of (apps/assistant/service/lib/models.js:
# a model's official GGUF comes first, this conversion when there is none).
# llama.cpp at the commit ./phoenix and meta-phoenix pin (LLAMA_COMMIT):
# convert_hf_to_gguf.py to bf16, llama-quantize to the quant asked for,
# llama-gguf-split into parts a GitHub release takes (under 2 GiB each).
# Text only: a multimodal model's vision tower is left out.
#
#   tools/convert-model.sh --id ID --repo Qwen/NAME --revision SHA --quant Q8_0|Q4_K_M --out DIR [--keep]
#
# Writes DIR/<parts>.gguf and DIR/ID.json, the entry for
# apps/assistant/service/lib/models-converted.js (tools/models-converted.py add):
#   {id, from: {repo, revision}, quant, llamaCommit, files: [{name, size, sha256}]}
# Needs python3 (3.10+), cmake, a C++ compiler and git; about three times
# the model's weights in free disk while it runs (the weights, bf16, the
# quant), and the weights are removed once converted unless --keep.
# PHOENIX_CONVERT_CACHE (default ~/.cache/phoenix-convert): llama.cpp's
# tree and tools, and the Python environment, kept between runs.

set -eu

ID= REPO= REV= QUANT= OUT= KEEP=0
while [ $# -gt 0 ]; do
    case $1 in
        --id) ID=$2; shift 2 ;;
        --repo) REPO=$2; shift 2 ;;
        --revision) REV=$2; shift 2 ;;
        --quant) QUANT=$2; shift 2 ;;
        --out) OUT=$2; shift 2 ;;
        --keep) KEEP=1; shift ;;
        -h|--help) sed -n '2,23p' "$0"; exit 0 ;;
        *) echo "convert-model: unknown argument: $1" >&2; exit 2 ;;
    esac
done
for v in ID REPO REV QUANT OUT; do
    eval "[ -n \"\${$v}\" ]" || { echo "convert-model: --$(echo $v | tr A-Z a-z | sed 's/rev/revision/') is needed" >&2; exit 2; }
done
case $REV in
    *[!0-9a-f]*|"") echo "convert-model: --revision: a commit's full SHA (a pinned revision)" >&2; exit 2 ;;
esac
[ ${#REV} -eq 40 ] || { echo "convert-model: --revision: a commit's full SHA (40 characters)" >&2; exit 2; }

ROOT=$(cd "$(dirname "$0")/.." && pwd)
LLAMA_COMMIT=$(sed -n 's/^LLAMA_COMMIT=\([0-9a-f]*\).*/\1/p' "$ROOT/phoenix")
[ -n "$LLAMA_COMMIT" ] || { echo "convert-model: LLAMA_COMMIT not found in ./phoenix" >&2; exit 1; }
CACHE=${PHOENIX_CONVERT_CACHE:-$HOME/.cache/phoenix-convert}
LLAMA=$CACHE/llama.cpp-$LLAMA_COMMIT
VENV=$CACHE/venv-$LLAMA_COMMIT
mkdir -p "$CACHE" "$OUT"
OUT=$(cd "$OUT" && pwd)
WORK=$OUT/.work-$ID
mkdir -p "$WORK"

say() { printf '%s\n' "convert-model: $*" >&2; }

# ---- llama.cpp at the pinned commit, and its two tools ---------------------------------
if [ ! -f "$LLAMA/convert_hf_to_gguf.py" ]; then
    say "llama.cpp $LLAMA_COMMIT"
    rm -rf "$LLAMA"
    git init -q "$LLAMA"
    git -C "$LLAMA" fetch -q --depth 1 https://github.com/ggml-org/llama.cpp.git "$LLAMA_COMMIT"
    git -C "$LLAMA" checkout -q FETCH_HEAD
fi
if [ ! -x "$LLAMA/build/bin/llama-quantize" ] || [ ! -x "$LLAMA/build/bin/llama-gguf-split" ]; then
    say "building llama-quantize and llama-gguf-split"
    cmake -S "$LLAMA" -B "$LLAMA/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
        -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_SERVER=OFF -DLLAMA_CURL=OFF -DLLAMA_OPENSSL=OFF >/dev/null
    cmake --build "$LLAMA/build" --target llama-quantize llama-gguf-split -j "$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)" >/dev/null
fi

# ---- Python: the converter's requirements (torch for CPU) ------------------------------
if [ ! -x "$VENV/bin/python" ]; then
    say "Python environment (the converter's requirements)"
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install -q --upgrade pip
    "$VENV/bin/pip" install -q -r "$LLAMA/requirements/requirements-convert_hf_to_gguf.txt" "huggingface_hub>=0.34"
fi
PY=$VENV/bin/python

# ---- The weights, at the pinned revision ----------------------------------------------
say "$REPO at $REV"
SNAP=$("$PY" -I - "$REPO" "$REV" "$WORK/hf" <<'EOF'
import sys
from huggingface_hub import snapshot_download
repo, rev, cache = sys.argv[1:4]
print(snapshot_download(repo_id=repo, revision=rev, cache_dir=cache,
                        allow_patterns=["*.json", "*.safetensors", "*.txt", "*.model", "*.jinja", "tokenizer*"]))
EOF
)

# ---- Convert, quantize, split -----------------------------------------------------------
NAME=$(basename "$REPO")-$QUANT
BF16=$WORK/$NAME-bf16.gguf
say "converting to bf16"
"$PY" "$LLAMA/convert_hf_to_gguf.py" "$SNAP" --outtype bf16 --outfile "$BF16" >/dev/null
[ $KEEP = 1 ] || rm -rf "$WORK/hf"
say "quantizing to $QUANT"
"$LLAMA/build/bin/llama-quantize" "$BF16" "$WORK/$NAME.gguf" "$QUANT" >/dev/null 2>&1
rm -f "$BF16"
# Under 2 GiB a part (a GitHub release's limit for a file); one file when it fits.
rm -f "$OUT/$NAME".gguf "$OUT/$NAME"-0*-of-0*.gguf
"$LLAMA/build/bin/llama-gguf-split" --split --split-max-size 1900M "$WORK/$NAME.gguf" "$OUT/$NAME" >/dev/null
rm -f "$WORK/$NAME.gguf"
set -- "$OUT/$NAME"-0*-of-0*.gguf
if [ $# -eq 1 ]; then
    mv "$1" "$OUT/$NAME.gguf"
    set -- "$OUT/$NAME.gguf"
fi
rmdir "$WORK" 2>/dev/null || rm -rf "$WORK"

# ---- The entry for models-converted.js -----------------------------------------------------
"$PY" -I - "$ID" "$REPO" "$REV" "$QUANT" "$LLAMA_COMMIT" "$OUT/$ID.json" "$@" <<'EOF'
import hashlib, json, os, sys
mid, repo, rev, quant, llama, dest = sys.argv[1:7]
files = []
for p in sys.argv[7:]:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    files.append({"name": os.path.basename(p), "size": os.path.getsize(p), "sha256": h.hexdigest()})
entry = {"id": mid, "from": {"repo": repo, "revision": rev}, "quant": quant, "llamaCommit": llama, "files": files}
with open(dest, "w") as f:
    json.dump(entry, f, indent=2)
    f.write("\n")
print(json.dumps(entry, indent=2))
EOF
