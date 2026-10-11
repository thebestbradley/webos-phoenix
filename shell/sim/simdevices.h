// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-sim --device ID: the first targets (docs/HARDWARE.md, "Device
// profiles"), from the same files the device images ship, compiled in
// (CMakeLists.txt, "sim-devices"):
//
//   :/devices/device-profiles.json   the table: each device's panel (pixels,
//       upright as it is used), diagonal, orientation, buttons, CPUs and
//       memory (meta-phoenix/recipes-phoenix/phoenix-device-config/files/)
//   :/devices/<config>/device.json   what the shell reads on the device:
//       form factor, density, Home button, ringer switch, the screen's
//       corner radius and camera cutouts (DeviceConfig reads it here too:
//       phoenix-sim points PHOENIX_DEVICE_CONFIG at it)
//
// So the simulator shows a device the way its image will configure it, and
// nothing is written down twice.

#pragma once

#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QString>
#include <QStringList>
#include <QVariantList>

namespace SimDevices {

inline QJsonArray profiles()
{
    QFile f(QStringLiteral(":/devices/device-profiles.json"));
    if (!f.open(QIODevice::ReadOnly))
        return {};
    return QJsonDocument::fromJson(f.readAll()).object().value(QStringLiteral("profiles")).toArray();
}

// The device.json a profile's image installs (a resource path).
inline QString configPath(const QJsonObject &profile)
{
    return QStringLiteral(":/devices/%1/device.json").arg(profile.value(QStringLiteral("config")).toString());
}

// The profile with this id, with its device.json's values merged in under
// "deviceConfig"; empty, with *error set, when there is none.
inline QJsonObject profile(const QString &id, QString *error)
{
    QStringList ids;
    for (const QJsonValue &v : profiles()) {
        QJsonObject p = v.toObject();
        ids << p.value(QStringLiteral("id")).toString();
        if (ids.last() != id)
            continue;
        QFile f(configPath(p));
        if (!f.open(QIODevice::ReadOnly)) {
            *error = QStringLiteral("%1: its device.json (%2) is missing").arg(id, configPath(p));
            return {};
        }
        p.insert(QStringLiteral("deviceConfig"), QJsonDocument::fromJson(f.readAll()).object());
        return p;
    }
    *error = QStringLiteral("no device \"%1\"; there are: %2").arg(id, ids.join(QStringLiteral(", ")));
    return {};
}

// For View > Device: each profile's id and name.
inline QVariantList menuEntries()
{
    QVariantList list;
    for (const QJsonValue &v : profiles()) {
        const QJsonObject p = v.toObject();
        list << QVariantMap { { QStringLiteral("id"), p.value(QStringLiteral("id")).toString() },
                              { QStringLiteral("name"), p.value(QStringLiteral("name")).toString() } };
    }
    return list;
}

} // namespace SimDevices
