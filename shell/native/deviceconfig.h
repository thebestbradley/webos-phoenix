// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the device's maker says about the hardware, from a JSON file the
// device image installs: /etc/phoenix/device.json, or the file named by the
// PHOENIX_DEVICE_CONFIG environment variable. A missing file or key means
// the default. Read once, at first use.
//
//   hardwareHomeButton  (bool, default false) the device has a Home button
//       (a physical or capacitive key) that its maker uses instead of the
//       on-screen gesture bar; the shell then hides the bar and the key does
//       its job. Phoenix keeps the gesture bar on phones and tablets alike
//       otherwise.

#pragma once

#include <QJsonObject>
#include <QObject>
#include <QtQml/qqmlregistration.h>

class DeviceConfig : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON
    Q_PROPERTY(bool hardwareHomeButton READ hardwareHomeButton CONSTANT)
    Q_PROPERTY(QString path READ path CONSTANT)

public:
    explicit DeviceConfig(QObject *parent = nullptr);

    bool hardwareHomeButton() const;
    QString path() const { return m_path; }

private:
    QString m_path;
    QJsonObject m_values;
};
