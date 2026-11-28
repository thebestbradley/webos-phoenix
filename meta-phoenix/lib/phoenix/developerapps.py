# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Developer apps Phoenix does not own, marked as such in an image's rootfs
# (phoenix-developer-apps.bbclass, at the end of do_rootfs). Phoenix's own
# developer apps say so in their appinfo.json, "phoenix": {"developer": true}
# (docs/APP-RUNTIME.md, "Developer apps"); the platform's test and example
# apps cannot, so meta-phoenix/conf/developer-apps.json lists them and this
# writes the same flag into each one's appinfo.json. Whatever reads the apps
# (SAM's listApps: the shell's launcher, the dock and Just Type, the
# application manager's search, the apps' pickers) then treats them as
# Phoenix's own: out of sight while Developer Mode is off.

import json
import os
import re

APPS_DIR = "usr/palm/applications"
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def load(path):
    """The list's {id: why}. ValueError for a malformed list."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    apps = data.get("apps") if isinstance(data, dict) else None
    if not isinstance(apps, dict):
        raise ValueError("%s: no \"apps\" object" % path)
    for app_id, why in apps.items():
        if not ID.match(app_id):
            raise ValueError("%s: %r is not an app id" % (path, app_id))
        if app_id.startswith("org.webosphoenix."):
            raise ValueError("%s: %s is Phoenix's own: its appinfo.json says \"phoenix\": {\"developer\": true}" % (path, app_id))
        if not isinstance(why, str) or not why.strip():
            raise ValueError("%s: %s needs a reason" % (path, app_id))
    return apps


def mark(rootfs, ids):
    """Writes "phoenix": {"developer": true} into each listed app's
    appinfo.json under rootfs. Returns (marked, missing, failed): the ids
    marked (or already marked), the ids not in the image, and (id, why) for
    an appinfo.json that could not be read or written."""
    marked, missing, failed = [], [], []
    for app_id in ids:
        path = os.path.join(rootfs, APPS_DIR, app_id, "appinfo.json")
        if not os.path.isfile(path):
            missing.append(app_id)
            continue
        try:
            with open(path, encoding="utf-8") as f:
                info = json.load(f)
        except (OSError, ValueError) as e:
            failed.append((app_id, "unreadable appinfo.json: %s" % e))
            continue
        if not isinstance(info, dict):
            failed.append((app_id, "appinfo.json is not an object"))
            continue
        phoenix = info.get("phoenix", {})
        if not isinstance(phoenix, dict):
            failed.append((app_id, "its \"phoenix\" is not an object"))
            continue
        if phoenix.get("developer") is not True:
            phoenix["developer"] = True
            info["phoenix"] = phoenix
            try:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(info, f, indent=4, ensure_ascii=False)
                    f.write("\n")
            except OSError as e:
                failed.append((app_id, "cannot write appinfo.json: %s" % e))
                continue
        marked.append(app_id)
    return marked, missing, failed
