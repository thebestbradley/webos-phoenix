// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "memorymonitor.h"

#include <QFile>

#ifdef Q_OS_MACOS
#include <mach/mach.h>
#include <sys/sysctl.h>

// A Mac running phoenix-sim: {total, available} in MB from the kernel's
// page counts, -1 if they can't be read. Available is free plus inactive
// pages (inactive ones are reclaimed before anything is paged out), the
// nearest thing macOS has to Linux's MemAvailable.
static QPair<int, int> readMacMemory()
{
    uint64_t total = 0;
    size_t len = sizeof total;
    if (sysctlbyname("hw.memsize", &total, &len, nullptr, 0) != 0)
        return { -1, -1 };
    // One send right for the process's life, not one per refresh.
    static const mach_port_t host = mach_host_self();
    vm_size_t page = 0;
    vm_statistics64_data_t vm {};
    mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
    if (host_page_size(host, &page) != KERN_SUCCESS
        || host_statistics64(host, HOST_VM_INFO64, reinterpret_cast<host_info64_t>(&vm), &count) != KERN_SUCCESS)
        return { int(total / (1024 * 1024)), -1 };
    const uint64_t available = (uint64_t(vm.free_count) + vm.inactive_count) * page;
    return { int(total / (1024 * 1024)), int(available / (1024 * 1024)) };
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
