// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "deviceconfig.h"

#include <QFile>
#include <QJsonArray>
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

qreal DeviceConfig::displayCornerRadius() const
{
    const double r = m_values.value(QStringLiteral("displayCornerRadius")).toDouble(0);
    return r > 0 ? r : 0;
}

QVariantList DeviceConfig::displayCutouts() const
{
    QVariantList list;
    for (const QJsonValue &v : m_values.value(QStringLiteral("displayCutouts")).toArray()) {
        const QJsonObject c = v.toObject();
        const QString shape = c.value(QStringLiteral("shape")).toString(QStringLiteral("rect"));
        const double w = c.value(QStringLiteral("width")).toDouble(0), h = c.value(QStringLiteral("height")).toDouble(0);
        if ((shape != QLatin1String("circle") && shape != QLatin1String("rect")) || !(w > 0) || !(h > 0)) {
            qWarning("phoenix: %s: a displayCutouts entry needs a shape (circle or rect), a width and a height; left out",
                     qPrintable(m_path));
            continue;
        }
        list << QVariantMap { { QStringLiteral("shape"), shape },
                              { QStringLiteral("x"), c.value(QStringLiteral("x")).toDouble(0) },
                              { QStringLiteral("y"), c.value(QStringLiteral("y")).toDouble(0) },
                              { QStringLiteral("width"), w }, { QStringLiteral("height"), h } };
    }
    return list;
}

bool DeviceConfig::hasRingerSwitch() const
{
    return m_values.value(QStringLiteral("ringerSwitch")).isObject();
}
