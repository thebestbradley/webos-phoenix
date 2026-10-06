// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "memorymonitor.h"

#include <QFile>

#ifdef Q_OS_MACOS
#include <sys/sysctl.h>

// A Mac running phoenix-sim: {total, available} in MB, -1 if they can't be
// read. Available is the share of memory the kernel itself counts as
// available (kern.memorystatus_level, a percentage: what macOS's memory
// pressure goes by). Free plus inactive pages is not it: macOS keeps little
// free and holds much as compressed or purgeable memory it gives back
// readily, so on an ordinary Mac that sum can sit near the 5 % that refuses
// a launch.
static QPair<int, int> readMacMemory()
{
    uint64_t total = 0;
    size_t len = sizeof total;
    if (sysctlbyname("hw.memsize", &total, &len, nullptr, 0) != 0)
        return { -1, -1 };
    const int totalMb = int(total / (1024 * 1024));
    int level = 0;
    len = sizeof level;
    if (sysctlbyname("kern.memorystatus_level", &level, &len, nullptr, 0) != 0 || level < 0 || level > 100)
        return { totalMb, -1 };
    return { totalMb, int(qint64(totalMb) * level / 100) };
}
#endif

MemoryMonitor::MemoryMonitor(QObject *parent)
    : QObject(parent)
{
    m_timer.setInterval(5000);
    connect(&m_timer, &QTimer::timeout, this, &MemoryMonitor::refresh);
    m_timer.start();
    refresh();
}

QPair<int, int> MemoryMonitor::parse(const QByteArray &meminfo)
{
    int total = -1, available = -1;
    for (const QByteArray &line : meminfo.split('\n')) {
        const int colon = line.indexOf(':');
        if (colon < 0)
            continue;
        const QByteArray key = line.left(colon);
        if (key != "MemTotal" && key != "MemAvailable")
            continue;
        // "MemTotal:        8048196 kB"
        const QList<QByteArray> parts = line.mid(colon + 1).simplified().split(' ');
        bool ok = false;
        const qlonglong kb = parts.value(0).toLongLong(&ok);
        if (!ok)
            continue;
        (key == "MemTotal" ? total : available) = int(kb / 1024);
    }
    return { total, available };
}

void MemoryMonitor::refresh()
{
#ifdef Q_OS_MACOS
    const auto [total, available] = readMacMemory();
#else
    QFile f(QStringLiteral("/proc/meminfo"));
    if (!f.open(QIODevice::ReadOnly))
        return;
    const auto [total, available] = parse(f.readAll());
#endif
    if (total == m_totalMb && available == m_availableMb)
        return;
    m_totalMb = total;
    m_availableMb = available;
    emit changed();
}

bool MemoryMonitor::low() const
{
    if (m_forceLow)
        return true;
    if (m_availableMb < 0 || m_totalMb <= 0)
        return false;
    return m_availableMb < qMax(m_lowThresholdMb, m_totalMb / 20);
}

void MemoryMonitor::setForceLow(bool on)
{
    if (on == m_forceLow)
        return;
    m_forceLow = on;
    emit changed();
}

void MemoryMonitor::setLowThresholdMb(int mb)
{
    if (mb == m_lowThresholdMb)
        return;
    m_lowThresholdMb = mb;
    emit changed();
}
