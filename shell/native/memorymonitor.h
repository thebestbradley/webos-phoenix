// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// How much memory is left for another app, for refusing a launch the way
// LunaSysMgr's MemoryMonitor did (MemoryMonitor::allowNewNativeAppLaunch:
// no new app once memory is low; WindowServerLuna::
// createMemoryAlertWindow tells the user). The Palm kernel's memchute
// thresholds are gone; Phoenix calls memory low when MemAvailable in
// /proc/meminfo is under lowThresholdMb, or under 5 % of MemTotal if that
// is more. On a Mac running phoenix-sim the same, with the share of memory
// macOS counts as available (kern.memorystatus_level). forceLow
// (phoenix-sim --low-memory) makes it low anywhere.

#pragma once

#include <QObject>
#include <QTimer>
#include <QtQml/qqmlregistration.h>

class MemoryMonitor : public QObject
{
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(int availableMb READ availableMb NOTIFY changed)
    Q_PROPERTY(int totalMb READ totalMb NOTIFY changed)
    Q_PROPERTY(bool low READ low NOTIFY changed)
    Q_PROPERTY(bool forceLow READ forceLow WRITE setForceLow NOTIFY changed)
    Q_PROPERTY(int lowThresholdMb READ lowThresholdMb WRITE setLowThresholdMb NOTIFY changed)

public:
    explicit MemoryMonitor(QObject *parent = nullptr);

    int availableMb() const { return m_availableMb; }
    int totalMb() const { return m_totalMb; }
    bool low() const;
    bool forceLow() const { return m_forceLow; }
    void setForceLow(bool on);
    int lowThresholdMb() const { return m_lowThresholdMb; }
    void setLowThresholdMb(int mb);

    // Read /proc/meminfo (a Mac: kern.memorystatus_level) now; a launch
    // asks before deciding.
    Q_INVOKABLE void refresh();

    // Parses /proc/meminfo's text: {MemTotal, MemAvailable} in MB, -1 if missing.
    static QPair<int, int> parse(const QByteArray &meminfo);

signals:
    void changed();

private:
    int m_availableMb = -1;
    int m_totalMb = -1;
    bool m_forceLow = false;
    int m_lowThresholdMb = 128;
    QTimer m_timer;
};
