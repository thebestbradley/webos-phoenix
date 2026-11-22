// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "simkeycapture.h"

#include <QGuiApplication>
#include <QKeyEvent>
#include <QWindow>

namespace {

#ifdef Q_OS_MACOS
// Qt's keys on a Mac: ⌃ is Meta, ⌘ Control (Qt::AA_MacDontSwapCtrlAndMeta off).
constexpr int kChordA = Qt::Key_Meta;
#else
constexpr int kChordA = Qt::Key_Control;
#endif
constexpr int kChordB = Qt::Key_Alt;

bool isModifier(int key)
{
    switch (key) {
    case Qt::Key_Shift:
    case Qt::Key_Control:
    case Qt::Key_Meta:
    case Qt::Key_Alt:
    case Qt::Key_AltGr:
    case Qt::Key_Super_L:
    case Qt::Key_Super_R:
    case Qt::Key_Hyper_L:
    case Qt::Key_Hyper_R:
        return true;
    default:
        return false;
    }
}

} // namespace

SimKeyCapture::SimKeyCapture(QWindow *screen, QWindow *window, QObject *parent)
    : QObject(parent)
    , m_screen(screen)
    , m_window(window)
{
    // The screen's keys, watched for the whole program: before the shell's
    // own filters, which take some keys at the window (SystemKeys).
    qApp->installEventFilter(this);
    // Another app in front: the keyboard is the computer's again (and with
    // it the way back to the simulator, ⌘Tab).
    connect(qApp, &QGuiApplication::applicationStateChanged, this, [this](Qt::ApplicationState state) {
        if (state != Qt::ApplicationActive)
            stop();
    });
}

SimKeyCapture::~SimKeyCapture()
{
    if (m_active && !m_testBackend)
        platformStop();
}

QString SimKeyCapture::chordText()
{
#ifdef Q_OS_MACOS
    return QStringLiteral("⌃⌥");    // ⌃⌥
#else
    return QStringLiteral("Ctrl+Alt");
#endif
}

bool SimKeyCapture::start()
{
    if (m_active)
        return true;
    Failure failure = Failure::None;
    QString error;
    const bool ok = m_testBackend ? m_testBackend(true, &failure, &error) : platformStart(&failure, &error);
    if (!ok) {
        m_failure = failure == Failure::None ? Failure::Refused : failure;
        m_error = error;
        emit startFailed(m_failure, m_error);
        return false;
    }
    m_failure = Failure::None;
    m_error.clear();
    setActive(true);
    return true;
}

void SimKeyCapture::stop()
{
    if (!m_active)
        return;
    if (m_testBackend)
        m_testBackend(false, nullptr, nullptr);
    else
        platformStop();
    setActive(false);
}

void SimKeyCapture::toggle()
{
    if (m_active)
        stop();
    else
        start();
}

void SimKeyCapture::setActive(bool on)
{
    if (m_active == on)
        return;
    m_active = on;
    emit activeChanged(on);
}

// The chord: its two modifier keys down together and let go with no other
// key in between, so ⌃⌥ or Ctrl+Alt with a key (Ctrl+Alt+P, the screen
// capture; Ctrl+Alt+L, lock) stays the device's. The keys themselves go on
// to the device as always.
bool SimKeyCapture::eventFilter(QObject *watched, QEvent *event)
{
    if (watched != m_screen)
        return QObject::eventFilter(watched, event);
    // Keys let go of elsewhere are not seen: start again.
    if (event->type() == QEvent::FocusOut) {
        m_held.clear();
        m_armed = false;
    }
    if (event->type() != QEvent::KeyPress && event->type() != QEvent::KeyRelease)
        return false;
    auto *key = static_cast<QKeyEvent *>(event);
    if (key->isAutoRepeat())
        return false;
    const int k = key->key();
    if (event->type() == QEvent::KeyPress) {
        if (k == kChordA || k == kChordB) {
            if (m_held.isEmpty())
                m_armed = true;
            m_held.insert(k);
        } else {
            // Any other key, a modifier too, while the chord's are down:
            // not the chord this time.
            m_armed = false;
            if (isModifier(k))
                m_held.insert(k);
        }
        return false;
    }
    const bool chord = m_armed && m_held.contains(kChordA) && m_held.contains(kChordB)
                       && m_held.size() == 2 && (k == kChordA || k == kChordB);
    m_held.remove(k);
    if (chord)
        m_armed = false;
    if (m_held.isEmpty())
        m_armed = false;
    if (chord)
        toggle();
    return false;
}

#ifndef Q_OS_MACOS
// X11: the window system's keyboard grab on the screen's window. A
// window manager's shortcuts (Alt+Tab, the workspaces) are its own grabs
// of those keys, which a program's grab of the whole keyboard comes before.
bool SimKeyCapture::platformStart(Failure *failure, QString *error)
{
    const QString platform = QGuiApplication::platformName();
    if (platform != QLatin1String("xcb")) {
        *failure = Failure::Unsupported;
        *error = platform.startsWith(QLatin1String("wayland"))
            ? tr("Under Wayland a program cannot take the keyboard from the desktop's shortcuts. "
                 "Start the simulator under X11 (QT_QPA_PLATFORM=xcb) to capture it.")
            : tr("The keyboard cannot be captured with Qt's %1 platform.").arg(platform);
        return false;
    }
    if (!m_screen || !m_screen->setKeyboardGrabEnabled(true)) {
        *failure = Failure::Refused;
        *error = tr("The window system did not let the simulator take the keyboard "
                    "(another program may have it).");
        return false;
    }
    return true;
}

void SimKeyCapture::platformStop()
{
    if (m_screen)
        m_screen->setKeyboardGrabEnabled(false);
}

QString SimKeyCapture::launchingApp() const
{
    return QString();
}
#endif
