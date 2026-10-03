// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The user touching the device: every touch, click, wheel turn or key, seen
// at the window before any item (or web view) gets it. The display's timers
// start again from it (LunaSysMgr's DisplayManager hears every input event
// for the same reason, DisplayManager::updateLastEvent).
//
// While asleep (the screen is off) the touch panel and keyboard are off
// too: their events stop here, except the keys in passKeys (Power, Home),
// which wake the screen.

#pragma once

#include <QElapsedTimer>
#include <QObject>
#include <QVariantList>
#include <QtQml/qqmlregistration.h>

class UserActivity : public QObject
{
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(bool asleep READ asleep WRITE setAsleep NOTIFY asleepChanged)
    // Qt key codes that still go through while asleep.
    Q_PROPERTY(QVariantList passKeys READ passKeys WRITE setPassKeys NOTIFY passKeysChanged)
    // While asleep, a press or click asks to wake (wakeRequested) instead of
    // going nowhere: phoenix-sim's window, whose Power button (F3) a Mac
    // keyboard keeps for itself. A device's touch panel is off: false.
    Q_PROPERTY(bool tapToWake READ tapToWake WRITE setTapToWake NOTIFY tapToWakeChanged)

public:
    explicit UserActivity(QObject *parent = nullptr);
    ~UserActivity() override;

    bool asleep() const { return m_asleep; }
    void setAsleep(bool asleep);
    QVariantList passKeys() const { return m_passKeys; }
    void setPassKeys(const QVariantList &keys);
    bool tapToWake() const { return m_tapToWake; }
    void setTapToWake(bool on);

signals:
    // At most every 250 ms while a finger moves; at once for a press or key.
    void activity();
    void asleepChanged();
    void passKeysChanged();
    void wakeRequested();
    void tapToWakeChanged();

protected:
    bool eventFilter(QObject *watched, QEvent *event) override;

private:
    bool m_asleep = false;
    QVariantList m_passKeys;
    bool m_tapToWake = false;
    QElapsedTimer m_lastMove;
};
