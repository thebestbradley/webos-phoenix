// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What phoenix-sim remembers between runs (the launcher layout, whether
// First Use has run: "firstuse/done", as LunaSysMgr's ran-first-use file), in its
// settings file (QSettings: ~/.config/webos-phoenix/phoenix-sim.conf on
// Linux). Exposed to QML as simSettings.

#pragma once

#include <QObject>
#include <QSettings>
#include <QString>

class SimSettings : public QObject
{
    Q_OBJECT
public:
    using QObject::QObject;

    Q_INVOKABLE QString value(const QString &key) const
    {
        return QSettings().value(key).toString();
    }

    Q_INVOKABLE void setValue(const QString &key, const QString &value)
    {
        QSettings().setValue(key, value);
    }
};
