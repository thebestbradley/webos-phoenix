#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""The connectors' registrations with their providers, for an image or the
simulator: /etc/palm/<name>/clients.json, which each connector reads
(apps/shared/connector-kit registeredClient, the drives' clientOf;
docs/CONNECTOR-REGISTRATIONS.md "Before any provider" 3, OPEN-QUESTIONS Q76).

The registrations are not in the repository. They come from one JSON file
outside it, named at build time (meta-phoenix phoenix-apps:
PHOENIX_CONNECTOR_CLIENTS in local.conf or site.conf), each connector's file
under its name:

    {
      "drives":    {"dropbox": {"clientId": "..."}, "box": {"clientId": "...", "relay": true}},
      "microsoft": {"microsoft": {"clientId": "..."}},
      "todoist":   {"todoist": {"clientId": "...", "relay": true}}
    }

Public client ids only. A client secret cannot ship in an image (anyone can
read it there): a provider whose token endpoint asks for one is signed in
through Phoenix's token relay ("relay": true; the secret is on the server,
docs/SYNERGY-CONNECTORS.md "The token relay"). The one exception is
Google's installed-app "secret" ("google", "googledrive"), which Google
documents as not confidential for desktop clients. A connector left out
gets no file and says "not available in this build".

    tools/connector-clients.py FILE --check     validate only
    tools/connector-clients.py FILE --into DIR  write DIR/etc/palm/<name>/clients.json
    tools/connector-clients.py FILE --sim       write runtime/connector-settings/clients/<name>/clients.json
                                                (the simulator's /etc/palm/<name>/, runtime/rootfs.json)

tools/install-rootfs.py --connector-clients FILE puts them in an image.
"""

import argparse
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIM_DIR = os.path.join(REPO, "runtime", "connector-settings", "clients")

# Every connector that reads /etc/palm/<name>/clients.json, and the
# providers its file holds (the key each one reads).
CONNECTORS = {
    "bluesky": {"bluesky"},
    "drives": {"dropbox", "onedrive", "googledrive", "box"},
    "google": {"google"},
    "linkedin": {"linkedin"},
    "microsoft": {"microsoft"},
    "slack": {"slack"},
    "todoist": {"todoist"},
    "x": {"x"},
    "zoom": {"zoom"},
}
# Google's installed-app client secret is not a secret (Google's "OAuth 2.0
# for Mobile & Desktop Apps": it "is obviously not treated as a secret").
NOT_SECRET = {"google", "googledrive"}
SECRET_KEY = re.compile(r"secret|password|passwd|private|token|apikey|api_key", re.I)
PERMITTED_KEY = re.compile(r"^(tokenEndpoint|revocationEndpoint)$")


class Invalid(Exception):
    pass


def _secrets(value, where):
    """The keys anywhere in value that name a secret."""
    found = []
    if isinstance(value, dict):
        for k, v in value.items():
            if SECRET_KEY.search(k) and not PERMITTED_KEY.match(k):
                found.append(where + "." + k)
            found.extend(_secrets(v, where + "." + k))
    elif isinstance(value, list):
        for i, v in enumerate(value):
            found.extend(_secrets(v, "%s[%d]" % (where, i)))
    return found


def files(config):
    """{device path: bytes} of the clients.json files config makes; Invalid when it is not right."""
    if not isinstance(config, dict):
        raise Invalid("the file holds an object: {\"<connector>\": {\"<provider>\": {\"clientId\": ...}}}")
    out = {}
    for name in sorted(config):
        if name.startswith("//"):
            continue
        if name not in CONNECTORS:
            raise Invalid("%s: not a connector that reads clients.json (%s)" % (name, ", ".join(sorted(CONNECTORS))))
        entries = config[name]
        if not isinstance(entries, dict) or not entries:
            raise Invalid("%s: an object of providers" % name)
        for provider, entry in entries.items():
            where = "%s.%s" % (name, provider)
            if provider not in CONNECTORS[name]:
                raise Invalid("%s: %s/clients.json holds %s" % (where, name, ", ".join(sorted(CONNECTORS[name]))))
            if not isinstance(entry, dict) or not isinstance(entry.get("clientId"), str) or not entry["clientId"].strip():
                raise Invalid("%s: a clientId is needed" % where)
            if "relay" in entry and entry["relay"] is not True:
                raise Invalid("%s: relay is true or left out" % where)
            secrets = _secrets({k: v for k, v in entry.items() if not (provider in NOT_SECRET and k == "clientSecret")}, where)
            if secrets:
                raise Invalid("%s: no secrets in an image (%s); a provider that needs its client secret signs in "
                              "through Phoenix's token relay: \"relay\": true" % (where, ", ".join(secrets)))
        out["/etc/palm/%s/clients.json" % name] = (json.dumps(entries, indent=4, sort_keys=True) + "\n").encode("utf-8")
    return out


def load(path):
    """{device path: bytes} from the file at path."""
    try:
        with open(path, encoding="utf-8") as f:
            config = json.load(f)
    except (OSError, ValueError) as e:
        raise Invalid("%s: %s" % (path, e))
    return files(config)


def write(made, root):
    """Each file under root (a device path's place), mode 0644."""
    for dev, data in sorted(made.items()):
        dst = os.path.join(root, dev.lstrip("/"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as f:
            f.write(data)
        os.chmod(dst, 0o644)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true")
    g.add_argument("--into", metavar="DIR")
    g.add_argument("--sim", action="store_true")
    args = ap.parse_args()
    try:
        made = load(args.file)
    except Invalid as e:
        sys.exit("connector-clients: " + str(e))
    if args.into:
        write(made, args.into)
    elif args.sim:
        for dev, data in sorted(made.items()):
            name = dev.split("/")[3]
            dst = os.path.join(SIM_DIR, name, "clients.json")
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, "wb") as f:
                f.write(data)
    for dev in sorted(made):
        print(dev)


if __name__ == "__main__":
    main()
