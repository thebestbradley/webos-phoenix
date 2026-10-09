// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What AppKit says about phoenix-sim on a Mac (simmac.mm), for
// --check-chrome (SimChrome::checkChrome): the menus the menu bar at
// the top of the screen shows, and whether the program is a foreground
// app (a Dock icon, a menu bar of its own) and the active one.

#pragma once

#include <QStringList>

namespace SimMac {
// The titles of NSApp.mainMenu's menus, the application menu first,
// without the hidden ones (Qt's hidden window menu).
QStringList mainMenuTitles();
// NSApplicationActivationPolicyRegular: an app with a Dock icon and the
// menu bar while it is active (Qt makes a plain program one; an
// LSUIElement in its Info.plist would not).
bool isForegroundApp();
// The active app, whose menus the menu bar shows.
bool isActive();
}
