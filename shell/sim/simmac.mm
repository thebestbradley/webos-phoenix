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

bool SimMac::activateProcess(qint64 pid)
{
    NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:(pid_t)pid];
    if (!app)
        return false;
    if (@available(macOS 14.0, *)) {
        [NSApp yieldActivationToApplication:app];
        return [app activateWithOptions:NSApplicationActivateAllWindows];
    }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    return [app activateWithOptions:NSApplicationActivateAllWindows | NSApplicationActivateIgnoringOtherApps];
#pragma clang diagnostic pop
}

void SimMac::activateSelf()
{
    if (@available(macOS 14.0, *)) {
        [NSApp activate];
        return;
    }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    [NSApp activateIgnoringOtherApps:YES];
#pragma clang diagnostic pop
}
