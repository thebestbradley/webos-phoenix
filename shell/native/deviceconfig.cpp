// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "deviceconfig.h"

#include <QFile>
#include <QJsonDocument>
#include <QJsonParseError>

DeviceConfig::DeviceConfig(QObject *parent)
    : QObject(parent)
{
    m_path = qEnvironmentVariable("PHOENIX_DEVICE_CONFIG", QStringLiteral("/etc/phoenix/device.json"));
    QFile f(m_path);
    if (!f.open(QIODevice::ReadOnly))
        return;
    QJsonParseError err;
    const QJsonDocument doc = QJsonDocument::fromJson(f.readAll(), &err);
    if (err.error != QJsonParseError::NoError || !doc.isObject()) {
        qWarning("phoenix: %s is not a JSON object (%s); using the defaults",
                 qPrintable(m_path), qPrintable(err.errorString()));
        return;
    }
    m_values = doc.object();
}

bool DeviceConfig::hardwareHomeButton() const
{
    return m_values.value(QStringLiteral("hardwareHomeButton")).toBool(false);
}

int DeviceConfig::homeButtonOrientationAngle() const
{
    return m_values.value(QStringLiteral("homeButtonOrientationAngle")).toInt(0);
}

QString DeviceConfig::formFactor() const
{
    const QString f = m_values.value(QStringLiteral("formFactor")).toString(QStringLiteral("auto"));
    if (f == QLatin1String("phone") || f == QLatin1String("tablet") || f == QLatin1String("auto"))
        return f;
    qWarning("phoenix: %s: formFactor \"%s\" is not phone, tablet or auto; using auto",
             qPrintable(m_path), qPrintable(f));
    return QStringLiteral("auto");
}

qreal DeviceConfig::density() const
{
    const double d = m_values.value(QStringLiteral("density")).toDouble(0);
    return d > 0 ? d : 0;
}
