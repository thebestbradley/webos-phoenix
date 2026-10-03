// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Keyboard accessibility for a hardware keyboard (GAPS V8 (4); the owner
// asked for iOS's Full Keyboard Access set): sticky keys, slow keys,
// bounce keys and the key repeat delay and rate. webOS had none of these;
// they work on the keys as they come from the keyboard, before the shell
// or any app sees them, so every app gets them.
//
//   sticky keys  a modifier (Shift, Ctrl, Alt, Meta) pressed and released
//                on its own holds for the next key; pressed twice it
//                stays down until pressed again
//   slow keys    a key counts only once it has been held slowKeysDelay ms
//   bounce keys  a key pressed again within bounceKeysDelay ms of its
//                release is ignored
//   repeat       a held key repeats after repeatDelay ms, then every
//                repeatInterval ms (the keyboard's own repeats are
//                dropped); repeatDelay 0 turns repeating off
//
// Only keys from the keyboard (spontaneous events) are changed; the
// virtual keyboard's (KeyInjector) and the ones this sends go through.

#pragma once

#include <QBasicTimer>
#include <QEvent>
#include <QObject>
#include <QPointer>
#include <QSet>
#include <QtQml/qqmlregistration.h>

class QKeyEvent;
class QWindow;

class KeyboardAccess : public QObject
{
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(bool stickyKeys READ stickyKeys WRITE setStickyKeys NOTIFY settingsChanged)
    Q_PROPERTY(bool slowKeys READ slowKeys WRITE setSlowKeys NOTIFY settingsChanged)
    Q_PROPERTY(int slowKeysDelay READ slowKeysDelay WRITE setSlowKeysDelay NOTIFY settingsChanged)
    Q_PROPERTY(bool bounceKeys READ bounceKeys WRITE setBounceKeys NOTIFY settingsChanged)
    Q_PROPERTY(int bounceKeysDelay READ bounceKeysDelay WRITE setBounceKeysDelay NOTIFY settingsChanged)
    // Off: the keyboard's own repeat. On: repeatDelay / repeatInterval.
    Q_PROPERTY(bool customRepeat READ customRepeat WRITE setCustomRepeat NOTIFY settingsChanged)
    Q_PROPERTY(int repeatDelay READ repeatDelay WRITE setRepeatDelay NOTIFY settingsChanged)
    Q_PROPERTY(int repeatInterval READ repeatInterval WRITE setRepeatInterval NOTIFY settingsChanged)
    // Sticky keys' modifiers waiting for the next key, and the ones locked
    // down (Qt::KeyboardModifiers), for an indicator.
    Q_PROPERTY(int latchedModifiers READ latchedModifiers NOTIFY modifiersChanged)
    Q_PROPERTY(int lockedModifiers READ lockedModifiers NOTIFY modifiersChanged)
    // A spontaneous (hardware) key went by: a keyboard is in use.
    Q_PROPERTY(bool hardwareKeySeen READ hardwareKeySeen NOTIFY hardwareKeySeenChanged)

public:
    explicit KeyboardAccess(QObject *parent = nullptr);
    ~KeyboardAccess() override;

    bool stickyKeys() const { return m_sticky; }
    void setStickyKeys(bool on);
    bool slowKeys() const { return m_slow; }
    void setSlowKeys(bool on);
    int slowKeysDelay() const { return m_slowDelay; }
    void setSlowKeysDelay(int ms);
    bool bounceKeys() const { return m_bounce; }
    void setBounceKeys(bool on);
    int bounceKeysDelay() const { return m_bounceDelay; }
    void setBounceKeysDelay(int ms);
    bool customRepeat() const { return m_customRepeat; }
    void setCustomRepeat(bool on);
    int repeatDelay() const { return m_repeatDelay; }
    void setRepeatDelay(int ms);
    int repeatInterval() const { return m_repeatInterval; }
    void setRepeatInterval(int ms);
    int latchedModifiers() const { return int(m_latched); }
    int lockedModifiers() const { return int(m_locked); }
    bool hardwareKeySeen() const { return m_hardwareKeySeen; }

    // Drops latched and locked modifiers (sticky keys off, the lock screen).
    Q_INVOKABLE void clearModifiers();

signals:
    void settingsChanged();
    void modifiersChanged();
    void hardwareKeySeenChanged();
    // A key pressed on the keyboard (not the virtual keyboard's).
    void hardwareKeyPressed(int key);
    // A key the accessibility rules held back or dropped (for tests and a
    // future click sound).
    void keyIgnored(int key);

protected:
    bool eventFilter(QObject *watched, QEvent *event) override;
    void timerEvent(QTimerEvent *event) override;

private:
    static Qt::KeyboardModifier modifierFor(int key);
    void send(QWindow *window, QEvent::Type type, int key, Qt::KeyboardModifiers mods, const QString &text,
              bool autoRepeat, quint32 scanCode, quint32 virtualKey, quint32 nativeMods);
    // After slow keys: sticky modifiers, then delivery and repeat.
    bool deliverPress(QWindow *window, QKeyEvent *key);
    bool deliverRelease(QWindow *window, QKeyEvent *key);
    void stopRepeat();

    bool m_sticky = false;
    bool m_slow = false;
    int m_slowDelay = 300;
    bool m_bounce = false;
    int m_bounceDelay = 300;
    bool m_customRepeat = false;
    int m_repeatDelay = 500;
    int m_repeatInterval = 50;
    bool m_hardwareKeySeen = false;

    int m_sending = 0;  // > 0 while this sends an event of its own

    // Sticky keys.
    Qt::KeyboardModifiers m_latched;
    Qt::KeyboardModifiers m_locked;
    int m_modifierDown = 0;         // a modifier pressed, nothing else yet
    bool m_otherSinceModifier = false;
    QSet<int> m_stickyPressed;      // keys sent with sticky modifiers, by key
    Qt::KeyboardModifiers m_stickyMods;

    // Slow keys: the key waiting to count.
    QBasicTimer m_slowTimer;
    QPointer<QWindow> m_slowWindow;
    int m_slowKey = 0;
    Qt::KeyboardModifiers m_slowMods;
    QString m_slowText;
    quint32 m_slowScan = 0, m_slowVirtual = 0, m_slowNativeMods = 0;
    QSet<int> m_slowAccepted;       // pressed long enough: their release goes

    // Bounce keys.
    int m_lastReleasedKey = 0;
    qint64 m_lastReleaseTime = 0;
    QSet<int> m_bounced;            // a press dropped: drop its release too

    // Repeat.
    QBasicTimer m_repeatTimer;
    QPointer<QWindow> m_repeatWindow;
    int m_repeatKey = 0;
    Qt::KeyboardModifiers m_repeatMods;
    QString m_repeatText;
    quint32 m_repeatScan = 0, m_repeatVirtual = 0, m_repeatNativeMods = 0;
};
