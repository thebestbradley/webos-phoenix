// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// SimKeyCapture on a Mac: an event tap on the keyboard (simkeycapture.h).
// macOS acts on its own shortcuts (⌘Tab's app switcher, Spotlight's ⌘Space,
// Mission Control) before the app in front sees the key, so a program
// gets them only by taking them earlier: a tap where the keyboard's events
// enter the window server (kCGHIDEventTap), as QEMU's cocoa display does
// with full-grab=on. The keys it takes go to the simulator's window as
// AppKit would have sent them, and on into Qt.

#include "simkeycapture.h"

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

#include <QCoreApplication>
#include <QPointer>
#include <QWindow>

#include <sys/sysctl.h>
#include <unistd.h>

namespace {

// The macOS key codes used here (HIToolbox's kVK_Tab, kVK_Escape).
constexpr CGKeyCode kKeyTab = 48;
constexpr CGKeyCode kKeyEscape = 53;

struct Tap {
    CFMachPortRef port = nullptr;
    CFRunLoopSourceRef source = nullptr;
    QPointer<QWindow> window;
};

NSWindow *nativeWindow(QWindow *window)
{
    if (!window)
        return nil;
    NSView *view = reinterpret_cast<NSView *>(window->winId());
    return view.window;
}

// A key the tap took, straight to the view with the window's keyboard focus
// (Qt's QNSView), which hands it on to Qt (its shortcuts, then the window
// with the focus). Not through the window's sendEvent: AppKit gives a ⌘
// key that way to no view's keyDown (only its key-up reached Qt), and not
// through NSApp's, whose menus would take ⌘Q and ⌘H first. Later, from Qt's
// event queue, in the order taken: the tap's callback returns at once (the
// window server waits for it, and turns a slow tap off), stopping the tap
// (the chord let go of) happens outside it, and Qt's own loop runs it
// (processEvents does not run blocks on the main dispatch queue).
void deliver(NSWindow *window, CGEventRef event)
{
    NSEvent *key = [NSEvent eventWithCGEvent:event];
    if (!window || !key)
        return;
    CFTypeRef held = CFRetain((__bridge CFTypeRef)key);
    CFTypeRef to = CFRetain((__bridge CFTypeRef)window);
    QMetaObject::invokeMethod(qApp, [held, to]() {
        NSEvent *key = (__bridge NSEvent *)held;
        NSWindow *window = (__bridge NSWindow *)to;
        NSResponder *view = window.firstResponder;
        if (![view isKindOfClass:[NSView class]])
            [window sendEvent:key];
        else if (key.type == NSEventTypeKeyDown)
            [view keyDown:key];
        else if (key.type == NSEventTypeKeyUp)
            [view keyUp:key];
        else if (key.type == NSEventTypeFlagsChanged)
            [view flagsChanged:key];
        CFRelease(held);
        CFRelease(to);
    }, Qt::QueuedConnection);
}

CGEventRef tapped(CGEventTapProxy, CGEventType type, CGEventRef event, void *info)
{
    auto *tap = static_cast<Tap *>(info);
    // macOS turns off a tap that was slow or after secure input: on again.
    if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
        if (tap->port)
            CGEventTapEnable(tap->port, true);
        return event;
    }
    if (type != kCGEventKeyDown && type != kCGEventKeyUp && type != kCGEventFlagsChanged)
        return event;
    @autoreleasepool {
        // Only while the simulator's window is the active app's key window:
        // its own dialogs, and other apps, keep the keys as always.
        NSWindow *window = nativeWindow(tap->window);
        if (!window || !NSApp.active || NSApp.keyWindow != window)
            return event;
        // Force Quit (⌘⌥Esc) stays macOS's.
        const CGEventFlags flags = CGEventGetFlags(event);
        if (type != kCGEventFlagsChanged && CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode) == kKeyEscape
            && (flags & kCGEventFlagMaskCommand) && (flags & kCGEventFlagMaskAlternate))
            return event;
        deliver(window, event);
    }
    return nullptr;
}

} // namespace

bool SimKeyCapture::platformStart(Failure *failure, QString *error)
{
    // A tap that takes keys needs Accessibility access, given to the
    // program macOS holds responsible: the app the simulator was started
    // from. Asking puts it in the list (and macOS offers to open it).
    if (!AXIsProcessTrusted()) {
        NSDictionary *options = @{ (id)kAXTrustedCheckOptionPrompt: @YES };
        AXIsProcessTrustedWithOptions((CFDictionaryRef)options);
        *failure = Failure::Permission;
        const QString app = launchingApp();
        *error = app.isEmpty()
            ? tr("macOS lets a program take the keyboard's shortcuts only with Accessibility access. "
                 "Turn it on for the app you started the simulator from (or phoenix-sim) in System Settings > "
                 "Privacy & Security > Accessibility, then choose Capture Keyboard again.")
            : tr("macOS lets a program take the keyboard's shortcuts only with Accessibility access, and asks it of "
                 "the app the simulator was started from: %1. Turn on %1 in System Settings > Privacy & Security > "
                 "Accessibility, then choose Capture Keyboard again. If it still does not work, quit %1 and start "
                 "the simulator again.").arg(app);
        return false;
    }
    auto *tap = new Tap;
    tap->window = m_window;
    const CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp)
                           | CGEventMaskBit(kCGEventFlagsChanged);
    tap->port = CGEventTapCreate(kCGHIDEventTap, kCGHeadInsertEventTap, kCGEventTapOptionDefault, mask, tapped, tap);
    if (!tap->port) {
        delete tap;
        *failure = Failure::Refused;
        *error = tr("macOS did not let the simulator tap the keyboard.");
        return false;
    }
    tap->source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap->port, 0);
    CFRunLoopAddSource(CFRunLoopGetMain(), tap->source, kCFRunLoopCommonModes);
    CGEventTapEnable(tap->port, true);
    m_tap = tap;
    return true;
}

void SimKeyCapture::platformStop()
{
    auto *tap = static_cast<Tap *>(m_tap);
    if (!tap)
        return;
    m_tap = nullptr;
    CGEventTapEnable(tap->port, false);
    CFRunLoopRemoveSource(CFRunLoopGetMain(), tap->source, kCFRunLoopCommonModes);
    CFRelease(tap->source);
    CFMachPortInvalidate(tap->port);
    CFRelease(tap->port);
    delete tap;
}

// The first app up the simulator's parents (Terminal, iTerm2, Visual Studio
// Code): the one macOS asks Accessibility access of, the simulator being a
// program without an app bundle.
QString SimKeyCapture::launchingApp() const
{
    pid_t pid = getppid();
    for (int i = 0; i < 32 && pid > 1; ++i) {
        NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
        if (app.bundleURL && app.localizedName.length)
            return QString::fromNSString(app.localizedName);
        struct kinfo_proc info = {};
        size_t size = sizeof info;
        int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, pid };
        if (sysctl(mib, 4, &info, &size, nullptr, 0) != 0 || size == 0)
            break;
        pid = info.kp_eproc.e_ppid;
    }
    return QString();
}

bool SimKeyCapture::permitted()
{
    return AXIsProcessTrusted();
}

bool SimKeyCapture::sendCommandTabForCheck(QWindow *window, bool press)
{
    NSWindow *ns = nativeWindow(window);
    if (!ns)
        return false;
    CGEventRef event = CGEventCreateKeyboardEvent(nullptr, kKeyTab, press);
    if (!event)
        return false;
    CGEventSetFlags(event, kCGEventFlagMaskCommand);
    deliver(ns, event);
    CFRelease(event);
    return true;
}
