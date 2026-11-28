# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The activity manager answers and calls back whoever creates an activity:
# apps (Calendar, Clock, Contacts, Accounts, Email, Weather, ...), the shell,
# and the services that keep themselves alive or run scheduled work through
# it (webos-service's keep-alive and $activity adoption: systemmanager,
# gamepads, the assistant, Hardware, the account service, ...). Its role
# (activitymanager's files/sysbus/com.webos.service.activitymanager.role.json.in,
# the same on OSE and LuneOS) lets the main name reach only the power service
# and the .client name only the platform services it calls itself, so
# ls-hubd refuses every connection back toward a creator
# (LSHUB_NO_OUT_PERMS): replies, a subscription's updates and callbacks never
# arrive. On Palm's webOS the activity manager could reach any caller.
#
# Decided by the owner on 27 November 2026 ("Allow replies": the activity
# manager may reply to the apps and services that call it, as webOS
# normally does). Every permission in the role gets the outbound list
# PHOENIX_ACTIVITYMANAGER_OUTBOUND, "*" (any name), as the platform's other
# services that answer any caller have it (the power, battery, alarm and
# settings services, the application manager). A caller still needs the
# method's group: an outbound entry only lets the connection through.

PHOENIX_ACTIVITYMANAGER_OUTBOUND ?= "*"

python phoenix_activitymanager_outbound () {
    import glob, json, os
    outbound = (d.getVar("PHOENIX_ACTIVITYMANAGER_OUTBOUND") or "").split()
    if not outbound:
        bb.fatal("activitymanager: PHOENIX_ACTIVITYMANAGER_OUTBOUND is empty")
    rolesd = os.path.join(d.getVar("D") + d.getVar("datadir"), "luna-service2", "roles.d")
    paths = sorted(glob.glob(os.path.join(rolesd, "*activitymanager*.role.json")))
    if not paths:
        bb.fatal("activitymanager: its role (%s/*activitymanager*.role.json) is not installed" % rolesd)
    for path in paths:
        with open(path) as f:
            role = json.load(f)
        perms = role.get("permissions") or []
        if not perms:
            bb.fatal("activitymanager: %s has no permissions" % os.path.basename(path))
        for perm in perms:
            perm["outbound"] = list(outbound)
        with open(path, "w") as f:
            json.dump(role, f, indent=4)
            f.write("\n")
        bb.note("activitymanager: outbound %s for %s in %s" % (
            outbound, ", ".join(p.get("service", "?") for p in perms), os.path.basename(path)))
}
do_install[postfuncs] += "phoenix_activitymanager_outbound"
