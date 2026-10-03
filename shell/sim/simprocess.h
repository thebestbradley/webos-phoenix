// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The simulator's own process, exposed to QML as simProcess: restart()
// starts phoenix-sim again with the same arguments and quits this one, as
// the device restarts (com.palm.power/shutdown/machineReboot; a system
// update's "Install now", which restarts with --updating: the boot shows
// "Updating the system"). eraseAndRestart() is the restart after a Full
// Erase or a security policy's wipe: the new process waits for this one
// to be gone, removes the simulator's data (its data and cache folders and
// its settings file: the web runtime's storage, db8, the USB drive's
// files, installed apps, "firstuse/done") and starts into First Use; the
// options that set up a demo state or the old device's security policy
// are left out (--scene, --launch, --open, --first-use, --turn,
// --security-policy).
#pragma once

#include <QCoreApplication>
#include <QDir>
#include <QObject>
#include <QProcess>
#include <QSettings>
#include <QStandardPaths>
#include <QThread>

#ifdef Q_OS_UNIX
#include <fcntl.h>
#include <signal.h>
#include <sys/types.h>
#include <unistd.h>
#endif

class SimProcess : public QObject
{
    Q_OBJECT
public:
    using QObject::QObject;

    Q_INVOKABLE bool restart(const QStringList &extraArgs = {})
    {
        QStringList args = withoutOptions(QCoreApplication::arguments().mid(1), { QStringLiteral("updating"), QStringLiteral("erase-data") },
                                          { QStringLiteral("erase-data") });
        args += extraArgs;
        return relaunch(args);
    }

    Q_INVOKABLE bool eraseAndRestart()
    {
        const QStringList dropped = { QStringLiteral("scene"), QStringLiteral("launch"), QStringLiteral("open"),
                                      QStringLiteral("first-use"), QStringLiteral("turn"), QStringLiteral("security-policy"),
                                      QStringLiteral("updating"), QStringLiteral("erase-data") };
        const QStringList withValues = { QStringLiteral("scene"), QStringLiteral("launch"), QStringLiteral("open"),
                                         QStringLiteral("turn"), QStringLiteral("security-policy"), QStringLiteral("erase-data") };
        QStringList args = withoutOptions(QCoreApplication::arguments().mid(1), dropped, withValues);
        args << QStringLiteral("--erase-data") << QString::number(QCoreApplication::applicationPid());
        return relaunch(args);
    }

    // phoenix-sim --erase-data PID, before anything reads the data: wait
    // (up to 20 s) for the process that asked to be gone, then remove it.
    // Apps installed into a folder given with --installed-dir stay there.
    static void eraseData(qint64 pid)
    {
#ifdef Q_OS_UNIX
        for (int i = 0; pid > 0 && i < 200 && ::kill(static_cast<pid_t>(pid), 0) == 0; ++i)
            QThread::msleep(100);
#else
        Q_UNUSED(pid);
        QThread::msleep(2000);
#endif
        QDir(QStandardPaths::writableLocation(QStandardPaths::AppDataLocation)).removeRecursively();
        QDir(QStandardPaths::writableLocation(QStandardPaths::CacheLocation)).removeRecursively();
        QSettings settings;
        settings.clear();
        settings.sync();
    }

private:
    static bool relaunch(const QStringList &args)
    {
        // The new process must not inherit this one's descriptors: Qt 6.4's
        // startDetached passes on those without close-on-exec, among them
        // the sockets to Chromium's zygote processes, which then never see
        // this process end and stay behind for good. This process is about
        // to quit, so its descriptors may as well all close on exec.
#ifdef Q_OS_UNIX
        const long max = qMin(::sysconf(_SC_OPEN_MAX), 65536L);
        for (int fd = 3; fd < max; ++fd) {
            const int flags = ::fcntl(fd, F_GETFD);
            if (flags != -1 && !(flags & FD_CLOEXEC))
                ::fcntl(fd, F_SETFD, flags | FD_CLOEXEC);
        }
#endif
        if (!QProcess::startDetached(QCoreApplication::applicationFilePath(), args))
            return false;
        QCoreApplication::quit();
        return true;
    }

    // args less the options named (as --name or -name, with =value, or
    // followed by their value when they take one).
    static QStringList withoutOptions(const QStringList &args, const QStringList &names, const QStringList &withValues)
    {
        QStringList out;
        for (int i = 0; i < args.size(); ++i) {
            QString a = args[i];
            QString name = a;
            while (name.startsWith(QLatin1Char('-')))
                name.remove(0, 1);
            const int eq = name.indexOf(QLatin1Char('='));
            const bool inlineValue = eq >= 0;
            if (inlineValue)
                name.truncate(eq);
            if (a.startsWith(QLatin1Char('-')) && names.contains(name)) {
                if (!inlineValue && withValues.contains(name))
                    ++i;
                continue;
            }
            out << a;
        }
        return out;
    }
};
