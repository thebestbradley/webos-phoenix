// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Device > Capture Keyboard (SimChrome): the keys the computer keeps for
// itself go to the device's screen instead, as a virtual machine's window
// takes them. On a Mac: ⌘Tab, ⌘Space, ⌘H, ⌘Q, Mission Control's keys, the
// screenshot keys (macOS's app switcher and shortcuts act on a key before
// any app sees it). On Linux under X11: the window manager's (Alt+Tab, the
// workspace keys). The simulator's own keys keep working.
//
// ⌃⌥ on a Mac, Ctrl+Alt elsewhere, pressed together and let go with no
// other key, turns it on and off (UTM's and Parallels' ⌃⌥ lets go of a
// virtual machine's keyboard). It also lets go when the simulator is no
// longer the active app.
//
// How:
// - macOS: an event tap (simkeycapture_mac.mm) takes the keyboard's keys
//   while the simulator's window is the key window and hands them to that
//   window, as QEMU's -display cocoa,full-grab=on. macOS lets a program tap
//   the keyboard only with Accessibility access (System Settings > Privacy
//   & Security > Accessibility), given to the app the simulator was started
//   from (Terminal, iTerm, …): it is a program without an app bundle.
//   ⌘⌥Esc (Force Quit) is never taken.
// - X11: a keyboard grab on the screen's window (QWindow::
//   setKeyboardGrabEnabled, XGrabKeyboard). Wayland has no grab a program
//   may take.

#pragma once

#include <QObject>
#include <QPointer>
#include <QSet>
#include <QString>

#include <functional>

class QWindow;

class SimKeyCapture : public QObject
{
    Q_OBJECT
public:
    // What a start that did not happen needed.
    enum class Failure { None, Permission, Unsupported, Refused };
    Q_ENUM(Failure)

    // screen: the device's screen, whose keys are watched for the chord
    // (and which takes the X11 grab). window: the window around it, whose
    // key window the Mac's keys go to (its native handle).
    SimKeyCapture(QWindow *screen, QWindow *window, QObject *parent = nullptr);
    ~SimKeyCapture() override;

    bool isActive() const { return m_active; }
    // On; false if it could not be (failure(), error()).
    bool start();
    void stop();
    void toggle();

    Failure failure() const { return m_failure; }
    QString error() const { return m_error; }
    // Where the Mac asks for Accessibility access: the app the simulator was
    // started from ("Terminal"), or "" when it cannot tell.
    QString launchingApp() const;

    // The chord, as people read it: "⌃⌥" on a Mac, "Ctrl+Alt" elsewhere.
    static QString chordText();

#ifdef Q_OS_MACOS
    // --check-chrome: ⌘Tab pressed or let go of, handed to the window the
    // way the tap hands it a key it took (without the tap, which needs
    // Accessibility access); false without a native window.
    static bool sendCommandTabForCheck(QWindow *window, bool press);
    // Whether the simulator may tap the keyboard now (Accessibility access).
    static bool permitted();
#endif

    // The tests: what starting and stopping does, instead of the platform's
    // tap or grab (true: on).
    using Backend = std::function<bool(bool on, Failure *failure, QString *error)>;
    void setBackendForTest(Backend backend) { m_testBackend = std::move(backend); }

signals:
    void activeChanged(bool active);
    // A start that did not happen (toggled on by the chord or the menu).
    void startFailed(Failure failure, const QString &error);

protected:
    bool eventFilter(QObject *watched, QEvent *event) override;

private:
    bool platformStart(Failure *failure, QString *error);
    void platformStop();
    void setActive(bool on);

    QPointer<QWindow> m_screen;
    QPointer<QWindow> m_window;
    bool m_active = false;
    Failure m_failure = Failure::None;
    QString m_error;
    Backend m_testBackend;
    // The chord: the modifier keys held, and whether it has been only the
    // chord's two since they went down.
    QSet<int> m_held;
    bool m_armed = false;
#ifdef Q_OS_MACOS
    void *m_tap = nullptr;      // simkeycapture_mac.mm's
#endif
};
