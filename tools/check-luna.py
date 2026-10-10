#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Luna calls against their providers and the callers' ACG permissions
(tools/devicecheck/luna.py; docs/PRE-IMAGE-CHECKLIST.md, "Checkers").

    tools/check-luna.py [--all] [--json] [--root DIR] [--allowlist FILE]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from devicecheck import luna  # noqa: E402

sys.exit(luna.main())
