#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Write a device image's /etc/palm/phoenix/servers.json: where the Phoenix
platform is and which keys the device trusts (docs/PLATFORM-CLIENT.md, "The
configuration"; schema docs/platform-api/servers.schema.json).

meta-phoenix's phoenix-apps recipe runs it after tools/install-rootfs.py
(which installs the simulator's servers.json from services/account) with the
image's PHOENIX_* settings; the production hosts are the recipe's defaults,
not this script's, so they are named in one place.

    tools/servers-json.py OUT --feeds URL [--api URL] [--name TEXT]
        [--channel stable|beta|dev] [--channels stable,beta,dev]
        [--catalog-key B64] [--catalog-root B64] [--updates-key B64] [--updates-root B64]
        [--drivers-key B64] [--account-key B64] [--issuer URL] [--push URL]
        [--catalog-path catalog/v1/] [--updates-path updates/] [--revocations-path ...]
        [--drivers-path drivers/v1/] [--report-path drivers/v1/report]
        [--assistant-path v1/assistant/] [--probe URL]
    tools/servers-json.py --check FILE     checks a file as a device reads it

An empty value leaves the field null ("not set up", or nothing pinned).
"""

import argparse
import base64
import json
import os
import re
import sys

CHANNELS = ("stable", "beta", "dev")


def key(v, what):
    if not v:
        return None
    try:
        raw = base64.b64decode(v, validate=True)
    except Exception:
        raw = b""
    if len(raw) != 32:
        sys.exit("servers-json: %s is not a base64 Ed25519 public key (32 bytes)" % what)
    return v


def url(v, what, base=False):
    if not v:
        return None
    if not re.match(r"^https://[^/\s]+", v) and not re.match(r"^http://(127\.|localhost)", v):
        sys.exit("servers-json: %s must be an https address (got %s)" % (what, v))
    return v if not base or v.endswith("/") else v + "/"


def build(a):
    channels = [c for c in (a.channels or ",".join(CHANNELS)).split(",") if c]
    bad = [c for c in channels + [a.channel] if c not in CHANNELS]
    if bad:
        sys.exit("servers-json: unknown channel %s (stable, beta, dev)" % ", ".join(bad))
    feeds = url(a.feeds, "--feeds", True)
    api = url(a.api, "--api", True)
    issuer = a.issuer if a.issuer is not None else (api.rstrip("/") if api else None)
    return {
        "//": "Written when this image was built (tools/servers-json.py, meta-phoenix PHOENIX_* settings). "
              "docs/PLATFORM-CLIENT.md says what each field is for.",
        "format": 1,
        "name": a.name,
        "feeds": feeds,
        "api": api,
        "catalog": {"url": a.catalog_path, "key": key(a.catalog_key, "--catalog-key"), "root": key(a.catalog_root, "--catalog-root")},
        "updates": {"url": a.updates_path, "channel": a.channel, "channels": channels,
                    "key": key(a.updates_key, "--updates-key"), "root": key(a.updates_root, "--updates-root")},
        "revocations": {"url": a.revocations_path},
        "drivers": {"url": a.drivers_path, "key": key(a.drivers_key, "--drivers-key"), "reportUrl": a.report_path if api else None},
        "account": {"issuer": url(issuer, "--issuer") if issuer else None, "clientId": "phoenix-device",
                    "scope": "openid account backup push reviews assistant", "key": key(a.account_key, "--account-key")},
        "push": {"server": url(a.push, "--push", True)},
        "assistant": {"url": a.assistant_path if api else None},
        "connectivity": {"probe": url(a.probe, "--probe") if a.probe else None},
    }


def check(path):
    """What a device would make of it: the same rules as @phoenix/platform servers.js, in short."""
    with open(path, encoding="utf-8") as f:
        c = json.load(f)
    problems = []
    if c.get("format") != 1:
        problems.append("format is not 1")
    for k in ("feeds", "api"):
        v = c.get(k)
        if v and not (v.startswith("https://") or re.match(r"^http://(127\.|localhost)", v)):
            problems.append("%s is not https: %s" % (k, v))
    for sec in ("catalog", "updates", "drivers", "account"):
        for f in ("key", "root"):
            v = (c.get(sec) or {}).get(f)
            if v:
                try:
                    ok = len(base64.b64decode(v)) == 32
                except Exception:
                    ok = False
                if not ok:
                    problems.append("%s.%s is not an Ed25519 key" % (sec, f))
    u = c.get("updates") or {}
    if u.get("channel") and u["channel"] not in CHANNELS:
        problems.append("updates.channel %s" % u["channel"])
    for p in problems:
        print("servers.json: " + p)
    pinned = [s for s in ("catalog", "updates") if (c.get(s) or {}).get("key") or (c.get(s) or {}).get("root")]
    print("servers.json: feeds %s, api %s; keys pinned for: %s" % (c.get("feeds"), c.get("api"), ", ".join(pinned) or "none"))
    return 1 if problems else 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("out", nargs="?")
    p.add_argument("--check", metavar="FILE")
    p.add_argument("--name", default="")
    p.add_argument("--feeds")
    p.add_argument("--api", default="")
    p.add_argument("--issuer", default=None)
    p.add_argument("--push", default="")
    p.add_argument("--probe", default="")
    p.add_argument("--channel", default="stable")
    p.add_argument("--channels", default="")
    for k in ("catalog-key", "catalog-root", "updates-key", "updates-root", "drivers-key", "account-key"):
        p.add_argument("--" + k, default="")
    p.add_argument("--catalog-path", default="catalog/v1/")
    p.add_argument("--updates-path", default="updates/")
    p.add_argument("--revocations-path", default="revocations/v1/revoked.json")
    p.add_argument("--drivers-path", default="drivers/v1/")
    p.add_argument("--report-path", default="drivers/v1/report")
    p.add_argument("--assistant-path", default="v1/assistant/")
    a = p.parse_args(argv)
    if a.check:
        return check(a.check)
    if not a.out or not a.feeds:
        p.error("OUT and --feeds are required")
    data = build(a)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)
        f.write("\n")
    return check(a.out)


if __name__ == "__main__":
    sys.exit(main())
