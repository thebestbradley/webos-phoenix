#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Laya's English checkpoint (docs/AI-AND-MCP.md "A decision model: Laya")
as ONNX for ONNX Runtime on a CPU, and quantized to int8: the graph laya's
own ONNXAgent runs (inputs input_ids, attention_mask, marker_pos,
marker_mask, qtype; outputs logits, act_logits), so the assistant runs it
as it runs Kitten TTS (ONNX Runtime, CPU).

    pip install "laya[onnx]"   (in a venv; CPU torch)
    tools/export-laya-onnx.py --out DIR [--keep-fp32]

DIR gets laya-int8.onnx and the checkpoint's tokenizer and config
(rl_agent_config.json, tokenizer/, encoder/config.json) the runtime reads.
The fp32 export (1.7 GB) is removed once read for quantizing, unless --keep-fp32.
Prints the sizes, the load time and a forward pass's time.
"""

import argparse
import os
import shutil
import sys
import time

os.environ.setdefault("USE_TF", "0")

REPO = "convaiinnovations/laya"
REVISION = "7b928d828b7b0e022f929d9bd2e44165aa270148"


def export(ckpt, fp32):
    """The checkpoint as an fp32 ONNX graph."""
    import torch
    import laya
    agent = laya.load(ckpt)
    model = agent.model.eval().float()

    class Graph(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, input_ids, attention_mask, marker_pos, marker_mask, qtype):
            return self.m(input_ids, attention_mask, marker_pos, marker_mask, qtype)

    # A row of the shape laya builds (the values only trace the graph).
    seq_len = 64
    said = agent.tok("hello there", add_special_tokens=True)["input_ids"]
    ids = torch.zeros((1, seq_len), dtype=torch.long)
    ids[0, :len(said)] = torch.tensor(said)
    att = torch.ones((1, seq_len), dtype=torch.long)
    mpos = torch.tensor([[10, 20]], dtype=torch.long)
    mmask = torch.tensor([[True, True]])
    qtype = torch.tensor([0], dtype=torch.long)
    t0 = time.time()
    torch.onnx.export(Graph(model), (ids, att, mpos, mmask, qtype), fp32, dynamo=False,
                      input_names=["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"],
                      output_names=["logits", "act_logits"],
                      dynamic_axes={"input_ids": {0: "batch", 1: "seq"}, "attention_mask": {0: "batch", 1: "seq"},
                                    "marker_pos": {0: "batch", 1: "options"}, "marker_mask": {0: "batch", 1: "options"},
                                    "qtype": {0: "batch"}, "logits": {0: "batch", 1: "options"}, "act_logits": {0: "batch"}},
                      opset_version=17)
    print("exported in %.0f s: %.0f MB" % (time.time() - t0, os.path.getsize(fp32) / 1e6), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--keep-fp32", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    import numpy as np
    import onnx
    from huggingface_hub import snapshot_download

    ckpt = snapshot_download(REPO, revision=REVISION, allow_patterns=["rl_agent_config.json", "tokenizer/*", "encoder/*", "config.json", "model.safetensors"])
    fp32 = os.path.join(args.out, "laya-fp32.onnx")
    if not os.path.exists(fp32):
        export(ckpt, fp32)

    from onnxruntime.quantization import QuantType, quantize_dynamic
    qz = sys.modules["onnxruntime.quantization.quantize"]
    # In memory: the quantizer would first write a shape-inferred copy (another
    # 1.7 GB on disk); quantizing the weights dynamically does not need it.
    graph = onnx.load(fp32)
    if not args.keep_fp32:
        os.remove(fp32)
    qz.save_and_reload_model_with_shape_infer = lambda m: m
    qz.load_model_with_shape_infer = lambda path: onnx.load(str(path))
    int8 = os.path.join(args.out, "laya-int8.onnx")
    quantize_dynamic(graph, int8, weight_type=QuantType.QInt8)
    del graph
    print("int8: %.0f MB" % (os.path.getsize(int8) / 1e6), flush=True)
    # What the runtime reads beside the graph.
    for name in ["rl_agent_config.json", "config.json"]:
        shutil.copy(os.path.join(ckpt, name), os.path.join(args.out, name))
    for d in ["tokenizer", "encoder"]:
        shutil.copytree(os.path.join(ckpt, d), os.path.join(args.out, d), dirs_exist_ok=True)

    import onnxruntime as ort
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    t0 = time.time()
    sess = ort.InferenceSession(int8, sess_options=so, providers=["CPUExecutionProvider"])
    print("int8 load: %.1f s" % (time.time() - t0), flush=True)
    feed = {"marker_pos": np.array([[10, 20]], dtype=np.int64), "marker_mask": np.array([[True, True]]), "qtype": np.array([0], dtype=np.int64)}
    for n in (64, 256):
        feed["input_ids"] = np.zeros((1, n), dtype=np.int64)
        feed["attention_mask"] = np.ones((1, n), dtype=np.int64)
        sess.run(None, feed)
        t0 = time.time()
        for _ in range(3):
            sess.run(None, feed)
        print("int8 forward, %d tokens: %.0f ms" % (n, (time.time() - t0) / 3 * 1000), flush=True)


if __name__ == "__main__":
    sys.exit(main())
