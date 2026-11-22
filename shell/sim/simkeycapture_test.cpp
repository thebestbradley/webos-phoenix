// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// simkeycapture-test: Device > Capture Keyboard's switch (SimKeyCapture),
// with a stand-in for the platform's tap or grab. The chord (⌃⌥ on a Mac,
// Ctrl+Alt elsewhere) pressed and let go of alone turns it on and off; with
// another key in between (Ctrl+Alt+P), after another modifier, repeated or
// half seen it does nothing; a start that cannot happen says why; another
// app in front lets go. Linux: without X11 it says it cannot. The Mac's
// tap handing a key to the window: phoenix-sim --check-chrome.
//
//   QT_QPA_PLATFORM=offscreen build/simkeycapture-test

#include "simkeycapture.h"

#include <QGuiApplication>
#include <QKeyEvent>
#include <QWindow>

#include <cstdio>

static int failures = 0;
static void check(bool ok, const QString &what)
{
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", qPrintable(what));
    std::fflush(stdout);
    if (!ok)
        ++failures;
}

#ifdef Q_OS_MACOS
static const int kA = Qt::Key_Meta;     // ⌃
#else
static const int kA = Qt::Key_Control;
#endif
static const int kB = Qt::Key_Alt;

static void key(QWindow *w, int k, bool press, bool repeat = false)
{
    QKeyEvent e(press ? QEvent::KeyPress : QEvent::KeyRelease, k, Qt::NoModifier, QString(), repeat);
    QCoreApplication::sendEvent(w, &e);
}

static void chord(QWindow *w)
{
    key(w, kA, true);
    key(w, kB, true);
    key(w, kB, false);
    key(w, kA, false);
}

int main(int argc, char **argv)
{
    QGuiApplication app(argc, argv);
    QWindow screen, window;

    {
        SimKeyCapture capture(&screen, &window);
        int calls = 0;
        bool backendOn = false;
        capture.setBackendForTest([&](bool on, SimKeyCapture::Failure *, QString *) {
            ++calls;
            backendOn = on;
            return true;
        });
        QList<bool> changes;
        QObject::connect(&capture, &SimKeyCapture::activeChanged, [&](bool on) { changes << on; });

        chord(&screen);
        check(capture.isActive() && backendOn && calls == 1, "the chord alone turns it on");
        // Let go of in the other order too.
        key(&screen, kB, true);
        key(&screen, kA, true);
        key(&screen, kA, false);
        key(&screen, kB, false);
        check(!capture.isActive() && !backendOn && calls == 2, "and off again");
        check(changes == QList<bool>({ true, false }), "activeChanged each time");

        // Ctrl+Alt+P (the screen capture), ⌃⌥ and a key: the device's.
        key(&screen, kA, true);
        key(&screen, kB, true);
        key(&screen, Qt::Key_P, true);
        key(&screen, Qt::Key_P, false);
        key(&screen, kB, false);
        key(&screen, kA, false);
        check(!capture.isActive() && calls == 2, "with another key in between: nothing");

        // Shift first, then the chord's two.
        key(&screen, Qt::Key_Shift, true);
        key(&screen, kA, true);
        key(&screen, kB, true);
        key(&screen, kB, false);
        key(&screen, kA, false);
        key(&screen, Qt::Key_Shift, false);
        check(!capture.isActive() && calls == 2, "with another modifier: nothing");

        // One of them held down repeats: still the chord.
        key(&screen, kA, true);
        key(&screen, kA, true, true);
        key(&screen, kB, true);
        key(&screen, kB, true, true);
        key(&screen, kB, false);
        key(&screen, kA, false);
        check(capture.isActive() && calls == 3, "autorepeat changes nothing");
        capture.stop();

        // Only one of them seen going down (the other before the window had
        // the keyboard; its going away lost): nothing, and the next chord
        // works.
        key(&screen, kA, true);
        QFocusEvent out(QEvent::FocusOut);
        QCoreApplication::sendEvent(&screen, &out);
        key(&screen, kB, true);
        key(&screen, kB, false);
        check(!capture.isActive(), "half the chord seen: nothing");
        chord(&screen);
        check(capture.isActive(), "the next chord works");

        // Another app in front: the keyboard is the computer's again.
        emit app.applicationStateChanged(Qt::ApplicationInactive);
        check(!capture.isActive() && !backendOn, "another app in front lets go");

        // Keys of another window: not watched.
        chord(&window);
        check(!capture.isActive(), "another window's keys: nothing");

        // The menu's toggle.
        capture.toggle();
        check(capture.isActive(), "toggle: on");
        capture.toggle();
        check(!capture.isActive(), "toggle: off");
    }

    {
        // A start that cannot happen: why, once, and not on.
        SimKeyCapture capture(&screen, &window);
        capture.setBackendForTest([](bool on, SimKeyCapture::Failure *failure, QString *error) {
            if (on) {
                *failure = SimKeyCapture::Failure::Permission;
                *error = QStringLiteral("needs Accessibility access");
            }
            return false;
        });
        int failed = 0;
        SimKeyCapture::Failure why = SimKeyCapture::Failure::None;
        QObject::connect(&capture, &SimKeyCapture::startFailed, [&](SimKeyCapture::Failure f, const QString &) {
            ++failed;
            why = f;
        });
        chord(&screen);
        check(!capture.isActive() && failed == 1 && why == SimKeyCapture::Failure::Permission
              && capture.error() == QLatin1String("needs Accessibility access"), "a start that cannot happen says why");
    }

#ifdef Q_OS_MACOS
    check(SimKeyCapture::chordText() == QStringLiteral("⌃⌥"), "the chord reads ⌃⌥");
#else
    check(SimKeyCapture::chordText() == QLatin1String("Ctrl+Alt"), "the chord reads Ctrl+Alt");
    if (QGuiApplication::platformName() != QLatin1String("xcb")) {
        // The real thing without X11: it cannot, and says so.
        SimKeyCapture capture(&screen, &window);
        check(!capture.start() && capture.failure() == SimKeyCapture::Failure::Unsupported
              && !capture.error().isEmpty(), "without X11 it says it cannot (" + QGuiApplication::platformName() + ")");
    }
#endif

    std::printf("%s\n", failures ? "simkeycapture-test: FAILED" : "simkeycapture-test: all passed");
    return failures ? 1 : 0;
}
