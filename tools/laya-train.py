#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Fine-tune Laya on the Assistant's own decisions (docs/AI-AND-MCP.md "A decision model").

The rows are the evaluation's main set (apps/assistant/eval/cases.json) as tools/laya-curve.cjs
writes them (--rows): the request, the options the service offered, and which is right (an
option, or "else": something no option is). Each becomes a laya training row: the state and
the one choice question the service asks (apps/assistant/service/lib/decider-laya.js), with the
right option as the expected answer. Options are shuffled each epoch (laya's option-order
augmentation), so no position is learnt. Measure the result only on the sets it never saw:
apps/assistant/eval/held-out.json and apps/assistant/service/test/model-eval.json.

    tools/laya-train.py --rows rows-main.json --base CHECKPOINT_DIR --out OUT_DIR
        [--freeze-encoder] [--epochs 4] [--loss soft-ce]

Needs the laya package (pip install laya==0.4.2: Apache-2.0) and a local checkpoint
(convaiinnovations/laya at the revision in tools/laya-server.py). The output, a whole
checkpoint in fp16 (some 850 MB), loads with tools/laya-server.py --checkpoint OUT_DIR.
"""
import argparse
import json
import os
import sys
import tempfile

ELSE = "Something else: another request, a question, or chat"
NONE = "None of these: unclear, ask what they mean"
INSTRUCTIONS = "Which of these does the user ask their phone's assistant to do?"


def question(options):
    criteria = {"o%d" % i: o for i, o in enumerate(options[:8])}
    criteria["else"] = ELSE
    criteria["none"] = NONE
    return {"pick": {"type": "choice", "instructions": INSTRUCTIONS, "criteria": criteria}}


def training_rows(rows):
    out = []
    for r in rows:
        right = r["right"][0]
        out.append({"state": {"request": r["text"]}, "questions": question(r["options"]),
                    "expected": {"pick": "o%d" % right if isinstance(right, int) else right}})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True)
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=4)
    ap.add_argument("--loss", default="soft-ce")
    ap.add_argument("--freeze-encoder", action="store_true")
    ap.add_argument("--micro-batch", type=int, default=8)
    ap.add_argument("--grad-accum", type=int, default=2)
    args = ap.parse_args()

    from laya.train import TrainConfig, finetune

    rows = training_rows(json.load(open(args.rows)))
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
        data = f.name
    config = TrainConfig(epochs=args.epochs, loss=args.loss, freeze_encoder=args.freeze_encoder,
                         micro_batch=args.micro_batch, grad_accum=args.grad_accum,
                         shuffle_options=("choice",), log_every=10)
    try:
        summary = finetune(data, args.base, args.out, config, device="cpu")
    finally:
        os.unlink(data)
    print(json.dumps(summary, indent=1, default=str)[:4000])


if __name__ == "__main__":
    sys.exit(main())
