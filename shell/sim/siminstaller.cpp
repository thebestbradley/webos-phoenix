// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "siminstaller.h"
#include "rootfs.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>

bool SimInstaller::validId(const QString &appId)
{
    static const QRegularExpression re(QStringLiteral("^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+$"));
    return appId.size() <= 128 && re.match(appId).hasMatch();
}

static QString appsDir(const Rootfs *rootfs)
{
    return QDir(rootfs->installedDir()).filePath(QStringLiteral("usr/palm/applications"));
}

QString SimInstaller::install(const QString &appId, const QVariantList &files)
{
    if (m_rootfs->installedDir().isEmpty())
        return QStringLiteral("Installing apps is not available");
    if (!validId(appId))
        return QStringLiteral("Not a valid app id: ") + appId;
    if (m_rootfs->hasApp(appId) && !m_rootfs->isInstalled(appId))
        return QStringLiteral("A built-in app has the id ") + appId;

    const QString dir = QDir(appsDir(m_rootfs)).filePath(appId);
    const QString temp = dir + QStringLiteral(".new");
    QDir(temp).removeRecursively();
    if (!QDir().mkpath(temp))
        return QStringLiteral("Cannot write ") + temp;
    bool hasInfo = false;
    for (const QVariant &v : files) {
        const QVariantMap f = v.toMap();
        const QString rel = QDir::cleanPath(f.value(QStringLiteral("path")).toString());
        if (rel.isEmpty() || rel.startsWith(QLatin1Char('/')) || rel == QLatin1String("..") || rel.startsWith(QLatin1String("../"))) {
            QDir(temp).removeRecursively();
            return QStringLiteral("A file outside the app: ") + rel;
        }
        const QByteArray data = QByteArray::fromBase64(f.value(QStringLiteral("data")).toByteArray());
        if (rel == QLatin1String("appinfo.json")) {
            QByteArray json = data;
            if (json.startsWith("\xEF\xBB\xBF"))
                json.remove(0, 3);
            if (QJsonDocument::fromJson(json).object().value(QStringLiteral("id")).toString() != appId) {
                QDir(temp).removeRecursively();
                return QStringLiteral("appinfo.json does not have the id ") + appId;
            }
            hasInfo = true;
        }
        const QString path = QDir(temp).filePath(rel);
        QDir().mkpath(QFileInfo(path).path());
        QFile out(path);
        if (!out.open(QIODevice::WriteOnly) || out.write(data) != data.size()) {
            QDir(temp).removeRecursively();
            return QStringLiteral("Cannot write ") + path;
        }
    }
    if (!hasInfo) {
        QDir(temp).removeRecursively();
        return QStringLiteral("The app has no appinfo.json");
    }
    // Swap the new files in.
    const QString old = dir + QStringLiteral(".old");
    QDir(old).removeRecursively();
    if (QFileInfo::exists(dir) && !QDir().rename(dir, old))
        return QStringLiteral("Cannot replace ") + dir;
    if (!QDir().rename(temp, dir))
        return QStringLiteral("Cannot write ") + dir;
    QDir(old).removeRecursively();
    m_rootfs->rescan();
    return {};
}

QString SimInstaller::remove(const QString &appId)
{
    if (!m_rootfs->isInstalled(appId))
        return QStringLiteral("No such id");
    if (!QDir(QDir(appsDir(m_rootfs)).filePath(appId)).removeRecursively())
        return QStringLiteral("Cannot remove ") + appId;
    m_rootfs->rescan();
    return {};
}

QVariantList SimInstaller::apps() const
{
    return m_rootfs->apps();
}
