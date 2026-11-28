#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The shell as a screen reader sees it: the accessibility tree a running
# phoenix-sim gives AT-SPI (Linux's accessibility bus, which Orca reads),
# dumped as an indented list of role, name and description, and every
# control on screen without a name reported (exit status 1 if there is one).
#
#   tools/a11y-tree.py [--app phoenix-sim] [--all] [--timeout S]
#
# Run phoenix-sim with QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 in the same D-Bus
# session first (dbus-run-session; needs python3-pyatspi and at-spi2-core):
#
#   dbus-run-session -- sh -c 'QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 \
#       QTWEBENGINE_DISABLE_SANDBOX=1 xvfb-run -a -s "-screen 0 1920x1200x24" \
#       ./build/phoenix-sim --phone --scene launcher & sleep 12; tools/a11y-tree.py'
#
# --all prints the whole tree (default: the shell's own, without the web
# pages' documents, which are the apps' and Chromium's).

import argparse
import sys
import time

import pyatspi

CONTROLS = {
    pyatspi.ROLE_PUSH_BUTTON, pyatspi.ROLE_TOGGLE_BUTTON, pyatspi.ROLE_CHECK_BOX, pyatspi.ROLE_RADIO_BUTTON,
    pyatspi.ROLE_MENU_ITEM, pyatspi.ROLE_PAGE_TAB, pyatspi.ROLE_SLIDER, pyatspi.ROLE_ENTRY,
    pyatspi.ROLE_PASSWORD_TEXT, pyatspi.ROLE_COMBO_BOX, pyatspi.ROLE_LINK, pyatspi.ROLE_SPIN_BUTTON,
}
DOCUMENTS = {pyatspi.ROLE_DOCUMENT_WEB, pyatspi.ROLE_DOCUMENT_FRAME}


def find_app(name, timeout):
    until = time.time() + timeout
    while time.time() < until:
        desktop = pyatspi.Registry.getDesktop(0)
        for i in range(desktop.childCount):
            a = desktop.getChildAtIndex(i)
            if a is not None and name in (a.name or ""):
                return a
        time.sleep(0.5)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--app", default="phoenix-sim")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--timeout", type=float, default=20)
    args = ap.parse_args()

    app = find_app(args.app, args.timeout)
    if app is None:
        print(f"no application named {args.app} on the accessibility bus", file=sys.stderr)
        return 2
    unnamed = []
    counts = {"nodes": 0, "controls": 0}

    def walk(node, depth):
        if node is None or depth > 60:
            return
        try:
            role = node.getRole()
            states = node.getState()
            name, desc = node.name or "", node.description or ""
        except Exception:
            return
        showing = states.contains(pyatspi.STATE_SHOWING) or states.contains(pyatspi.STATE_VISIBLE)
        if role in DOCUMENTS and not args.all:
            print("  " * depth + f"[{node.getRoleName()}] {name!r} (web content, the app's)")
            return
        counts["nodes"] += 1
        line = "  " * depth + f"[{node.getRoleName()}] {name!r}" + (f" -- {desc}" if desc else "")
        if role in CONTROLS:
            counts["controls"] += 1
            if showing and not name.strip():
                unnamed.append(line.strip())
                line += "   <-- NO NAME"
        print(line)
        for i in range(node.childCount):
            walk(node.getChildAtIndex(i), depth + 1)

    walk(app, 0)
    print(f"\n{counts['nodes']} nodes, {counts['controls']} controls, {len(unnamed)} without a name")
    for u in unnamed:
        print("  unnamed:", u)
    return 1 if unnamed else 0


if __name__ == "__main__":
    sys.exit(main())
