// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The simulator's own process, exposed to QML as simProcess: restart()
// starts phoenix-sim again with the same arguments and quits this one, as
// the device restarts (com.palm.power/shutdown/machineReboot; a system
// update's "Install now").

#pragma once

#include <QCoreApplication>
#include <QObject>
#include <QProcess>

class SimProcess : public QObject
{
    Q_OBJECT
public:
    using QObject::QObject;

    Q_INVOKABLE bool restart()
    {
        const QStringList args = QCoreApplication::arguments().mid(1);
        if (!QProcess::startDetached(QCoreApplication::applicationFilePath(), args))
            return false;
        QCoreApplication::quit();
        return true;
    }
};
