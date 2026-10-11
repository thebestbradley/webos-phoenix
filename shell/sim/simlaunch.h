// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-sim's --launch value: an app id, or an app id with the launch
// params to start it with, "appId:{json}", as the application manager's
// launch {id, params} gives them (luna-send -n 1
// luna://com.palm.applicationManager/launch '{"id": ..., "params": {...}}'
// on a device):
//
//   --launch com.palm.app.clock
//   --launch 'com.palm.app.clock:{"action": "edit", "key": "alarm1"}'
//
// The params must be a JSON object. An app id has no ":" (reverse-DNS
// names: letters, digits, ".", "-", "_"), so the first ":" ends it.
// (simlaunch_test.cpp; docs/APP-RUNTIME.md, after --extra-rootfs.)

#pragma once

#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QRegularExpression>
#include <QString>
#include <QVariantMap>

struct SimLaunch
{
    QString appId;
    QVariantMap params;   // empty: launched as without params
};

// False, with *error saying why, when the value is not an app id or an
// app id with a JSON object.
inline bool parseSimLaunch(const QString &value, SimLaunch *out, QString *error)
{
    const int colon = value.indexOf(QLatin1Char(':'));
    const QString id = (colon < 0 ? value : value.left(colon)).trimmed();
    static const QRegularExpression appIdPattern(QStringLiteral("^[A-Za-z0-9_][A-Za-z0-9._-]*$"));
    if (!appIdPattern.match(id).hasMatch()) {
        *error = QStringLiteral("--launch %1: not an app id (appId, or appId:{json})").arg(value);
        return false;
    }
    QVariantMap params;
    if (colon >= 0) {
        QJsonParseError parseError;
        const QJsonDocument doc = QJsonDocument::fromJson(value.mid(colon + 1).trimmed().toUtf8(), &parseError);
        if (parseError.error != QJsonParseError::NoError || !doc.isObject()) {
            *error = QStringLiteral("--launch %1: the launch params after \"%2:\" must be a JSON object (%3)")
                         .arg(value, id, parseError.error != QJsonParseError::NoError ? parseError.errorString()
                                                                                      : QStringLiteral("not an object"));
            return false;
        }
        params = doc.object().toVariantMap();
    }
    out->appId = id;
    out->params = params;
    return true;
}
