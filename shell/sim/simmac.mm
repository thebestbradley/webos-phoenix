// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "simmac.h"

#import <AppKit/AppKit.h>

#include <QString>

QStringList SimMac::mainMenuTitles()
{
    QStringList titles;
    for (NSMenuItem *item in NSApp.mainMenu.itemArray) {
        if (item.hidden)
            continue;
        // The application menu's item has no title of its own: its menu's.
        NSString *title = item.submenu.title.length ? item.submenu.title : item.title;
        titles << QString::fromNSString(title);
    }
    return titles;
}

bool SimMac::isForegroundApp()
{
    return NSApp.activationPolicy == NSApplicationActivationPolicyRegular;
}

bool SimMac::isActive()
{
    return NSRunningApplication.currentApplication.active;
}
