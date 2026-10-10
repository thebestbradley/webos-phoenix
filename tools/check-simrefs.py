#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""See tools/devicecheck/simrefs.py and docs/PRE-IMAGE-CHECKLIST.md, "Checkers"."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from devicecheck import simrefs  # noqa: E402

sys.exit(simrefs.main())
