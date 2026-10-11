#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""The decision model, Laya (docs/AI-AND-MCP.md "A decision model: Laya"),
over HTTP for the evaluation on a computer (tools/eval-assistant.cjs
--decider tools/decider-laya.cjs). Not part of the device: there the
assistant's service runs the ONNX export itself.

    pip install laya            (in a venv; CPU torch is enough)
    tools/laya-server.py [--port 8093] [--onnx laya-int8.onnx] [--checkpoint DIR]

POST /predict {"state": ..., "questions": {...}} -> Laya's answers, as
laya's Agent.predict gives them (choice: {choice, probabilities,
confidence}). --onnx runs an exported graph with laya's ONNXAgent (the
tokenizer and config from --checkpoint or the Hub).
"""

import argparse
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("USE_TF", "0")

REPO = "convaiinnovations/laya"
# The English checkpoint at the revision measured (docs/AI-AND-MCP.md).
REVISION = "7b928d828b7b0e022f929d9bd2e44165aa270148"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8093)
    ap.add_argument("--onnx", default="")
    ap.add_argument("--checkpoint", default=REPO)
    args = ap.parse_args()
    t0 = time.time()
    if args.onnx:
        from laya.onnx_agent import ONNXAgent
        agent = ONNXAgent(args.checkpoint, onnx_path=args.onnx, revision=None if os.path.isdir(args.checkpoint) else REVISION)
    else:
        import laya
        agent = laya.load(args.checkpoint, revision=None if os.path.isdir(args.checkpoint) else REVISION)
    print("loaded in %.1f s" % (time.time() - t0), file=sys.stderr, flush=True)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
            t = time.time()
            try:
                r = agent.predict(body.get("state", ""), body.get("questions", {}))
                out = {"answers": r.get("answers", {}), "ms": round((time.time() - t) * 1000)}
                code = 200
            except Exception as e:  # the caller reads why
                out, code = {"error": str(e)}, 400
            data = json.dumps(out).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
