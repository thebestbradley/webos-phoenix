// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "keyboardaccess.h"

#include <QCoreApplication>
#include <QDateTime>
#include <QKeyEvent>
#include <QTimerEvent>
#include <QWindow>

namespace {

bool isModifierKey(int key)
{
    switch (key) {
    case Qt::Key_Shift:
    case Qt::Key_Control:
    case Qt::Key_Alt:
    case Qt::Key_AltGr:
    case Qt::Key_Meta:
    case Qt::Key_Super_L:
    case Qt::Key_Super_R:
        return true;
    default:
        return false;
    }
}

} // namespace

KeyboardAccess::KeyboardAccess(QObject *parent)
    : QObject(parent)
{
    if (QCoreApplication::instance())
        QCoreApplication::instance()->installEventFilter(this);
}

KeyboardAccess::~KeyboardAccess()
{
    if (QCoreApplication::instance())
        QCoreApplication::instance()->removeEventFilter(this);
}

#define KA_SETTER(name, member, type)              \
    void KeyboardAccess::name(type v)              \
    {                                              \
        if (member == v)                           \
            return;                                \
        member = v;                                \
        emit settingsChanged();                    \
    }

KA_SETTER(setSlowKeysDelay, m_slowDelay, int)
KA_SETTER(setBounceKeys, m_bounce, bool)
KA_SETTER(setBounceKeysDelay, m_bounceDelay, int)
KA_SETTER(setRepeatDelay, m_repeatDelay, int)
KA_SETTER(setRepeatInterval, m_repeatInterval, int)
#undef KA_SETTER

void KeyboardAccess::setStickyKeys(bool on)
{
    if (m_sticky == on)
        return;
    m_sticky = on;
    if (!on)
        clearModifiers();
    emit settingsChanged();
}

void KeyboardAccess::setSlowKeys(bool on)
{
    if (m_slow == on)
        return;
    m_slow = on;
    if (!on) {
        m_slowTimer.stop();
        m_slowKey = 0;
    }
    emit settingsChanged();
}

void KeyboardAccess::setCustomRepeat(bool on)
{
    if (m_customRepeat == on)
        return;
    m_customRepeat = on;
    if (!on)
        stopRepeat();
    emit settingsChanged();
}

void KeyboardAccess::clearModifiers()
{
    if (!m_latched && !m_locked)
        return;
    m_latched = {};
    m_locked = {};
    emit modifiersChanged();
}

Qt::KeyboardModifier KeyboardAccess::modifierFor(int key)
{
    switch (key) {
    case Qt::Key_Shift: return Qt::ShiftModifier;
    case Qt::Key_Control: return Qt::ControlModifier;
    case Qt::Key_Alt:
    case Qt::Key_AltGr: return Qt::AltModifier;
    case Qt::Key_Meta:
    case Qt::Key_Super_L:
    case Qt::Key_Super_R: return Qt::MetaModifier;
    default: return Qt::NoModifier;
    }
}

void KeyboardAccess::send(QWindow *window, QEvent::Type type, int key, Qt::KeyboardModifiers mods, const QString &text,
                          bool autoRepeat, quint32 scanCode, quint32 virtualKey, quint32 nativeMods)
{
    if (!window)
        return;
    QString t = text;
    // A latched Shift capitalises the letter as a held one would.
    if ((mods & Qt::ShiftModifier) && t.size() == 1 && t.at(0).isLetter())
        t = t.toUpper();
    QKeyEvent ev(type, key, mods, scanCode, virtualKey, nativeMods, t, autoRepeat);
    ++m_sending;
    QCoreApplication::sendEvent(window, &ev);
    --m_sending;
}

bool KeyboardAccess::deliverPress(QWindow *window, QKeyEvent *key)
{
    // key is either the keyboard's own event (false: let it go on, unless
    // sticky modifiers change it) or one slow keys held back (always sent).
    const bool heldBack = !key->spontaneous();
    const int code = key->key();
    Qt::KeyboardModifiers mods = key->modifiers();
    bool sent = false;

    if (m_sticky) {
        if (isModifierKey(code)) {
            m_modifierDown = code;
            m_otherSinceModifier = false;
        } else {
            if (m_modifierDown)
                m_otherSinceModifier = true;
            const Qt::KeyboardModifiers extra = m_latched | m_locked;
            if (extra) {
                mods |= extra;
                send(window, QEvent::KeyPress, code, mods, key->text(), false,
                     key->nativeScanCode(), key->nativeVirtualKey(), key->nativeModifiers());
                m_stickyPressed.insert(code);
                m_stickyMods = mods;
                sent = true;
                if (m_latched) {
                    m_latched = {};
                    emit modifiersChanged();
                }
            }
        }
    }
    if (!sent && heldBack) {
        send(window, QEvent::KeyPress, code, mods, key->text(), false,
             key->nativeScanCode(), key->nativeVirtualKey(), key->nativeModifiers());
        sent = true;
    }

    if (m_customRepeat && m_repeatDelay > 0 && !isModifierKey(code)) {
        m_repeatWindow = window;
        m_repeatKey = code;
        m_repeatMods = mods;
        m_repeatText = key->text();
        m_repeatScan = key->nativeScanCode();
        m_repeatVirtual = key->nativeVirtualKey();
        m_repeatNativeMods = key->nativeModifiers();
        m_repeatTimer.start(m_repeatDelay, this);
    }
    return sent;
}

bool KeyboardAccess::deliverRelease(QWindow *window, QKeyEvent *key)
{
    const int code = key->key();
    if (code == m_repeatKey)
        stopRepeat();

    if (m_sticky && isModifierKey(code)) {
        if (m_modifierDown == code && !m_otherSinceModifier) {
            // On its own: latch it; again: lock it; again: let it go.
            const Qt::KeyboardModifier mod = modifierFor(code);
            if (m_locked & mod) {
                m_locked &= ~mod;
            } else if (m_latched & mod) {
                m_latched &= ~mod;
                m_locked |= mod;
            } else {
                m_latched |= mod;
            }
            emit modifiersChanged();
        }
        m_modifierDown = 0;
        return false;
    }
    if (m_stickyPressed.remove(code)) {
        send(window, QEvent::KeyRelease, code, m_stickyMods, key->text(), false,
             key->nativeScanCode(), key->nativeVirtualKey(), key->nativeModifiers());
        return true;
    }
    return false;
}

void KeyboardAccess::stopRepeat()
{
    m_repeatTimer.stop();
    m_repeatKey = 0;
}

bool KeyboardAccess::eventFilter(QObject *watched, QEvent *event)
{
    const QEvent::Type type = event->type();
    if (type != QEvent::KeyPress && type != QEvent::KeyRelease)
        return false;
    // Once per key, at the window (it then goes to the focused item).
    auto *window = qobject_cast<QWindow *>(watched);
    if (!window || m_sending || !event->spontaneous())
        return false;
    auto *key = static_cast<QKeyEvent *>(event);
    const int code = key->key();

    if (!m_hardwareKeySeen) {
        m_hardwareKeySeen = true;
        emit hardwareKeySeenChanged();
    }
    if (type == QEvent::KeyPress && !key->isAutoRepeat())
        emit hardwareKeyPressed(code);
    if (!m_sticky && !m_slow && !m_bounce && !m_customRepeat)
        return false;

    if (key->isAutoRepeat()) {
        // Ours replace the keyboard's; a key not (yet) counted does not repeat.
        if (m_customRepeat || m_bounced.contains(code) || (m_slow && code == m_slowKey))
            return true;
        if (type == QEvent::KeyPress && m_stickyPressed.contains(code)) {
            send(window, type, code, m_stickyMods, key->text(), true,
                 key->nativeScanCode(), key->nativeVirtualKey(), key->nativeModifiers());
            return true;
        }
        if (type == QEvent::KeyRelease && m_stickyPressed.contains(code))
            return true;
        return false;
    }

    if (type == QEvent::KeyPress) {
        if (m_bounce && code == m_lastReleasedKey
            && QDateTime::currentMSecsSinceEpoch() - m_lastReleaseTime < m_bounceDelay) {
            m_bounced.insert(code);
            emit keyIgnored(code);
            return true;
        }
        if (m_slow) {
            // Wait: it counts if still down after slowKeysDelay.
            m_slowTimer.start(m_slowDelay, this);
            m_slowWindow = window;
            m_slowKey = code;
            m_slowMods = key->modifiers();
            m_slowText = key->text();
            m_slowScan = key->nativeScanCode();
            m_slowVirtual = key->nativeVirtualKey();
            m_slowNativeMods = key->nativeModifiers();
            return true;
        }
        return deliverPress(window, key);
    }

    // KeyRelease
    if (m_bounced.remove(code))
        return true;
    m_lastReleasedKey = code;
    m_lastReleaseTime = QDateTime::currentMSecsSinceEpoch();
    if (m_slow) {
        if (code == m_slowKey) {
            // Let go too soon: it never happened.
            m_slowTimer.stop();
            m_slowKey = 0;
            emit keyIgnored(code);
            return true;
        }
        // Held long enough: its release goes on as usual.
        m_slowAccepted.remove(code);
    }
    return deliverRelease(window, key);
}

void KeyboardAccess::timerEvent(QTimerEvent *event)
{
    if (event->timerId() == m_slowTimer.timerId()) {
        m_slowTimer.stop();
        const int code = m_slowKey;
        m_slowKey = 0;
        if (!m_slowWindow || !code)
            return;
        m_slowAccepted.insert(code);
        // A stand-in for the press, not spontaneous: deliverPress sends it.
        QKeyEvent press(QEvent::KeyPress, code, m_slowMods, m_slowScan, m_slowVirtual, m_slowNativeMods,
                        m_slowText, false);
        deliverPress(m_slowWindow, &press);
        return;
    }
    if (event->timerId() == m_repeatTimer.timerId()) {
        if (!m_repeatWindow || !m_repeatKey) {
            stopRepeat();
            return;
        }
        m_repeatTimer.start(qMax(10, m_repeatInterval), this);
        send(m_repeatWindow, QEvent::KeyPress, m_repeatKey, m_repeatMods, m_repeatText, true,
             m_repeatScan, m_repeatVirtual, m_repeatNativeMods);
        return;
    }
    QObject::timerEvent(event);
}
