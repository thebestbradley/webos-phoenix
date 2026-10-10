// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "siminstaller.h"
#include "rootfs.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRandomGenerator>
#include <QRegularExpression>
#include <QStorageInfo>
#include <QUrl>

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
    // A pre-installed package installed again from the catalog: the user's now.
    m_rootfs->forgetSeeded(appId);
    m_rootfs->rescan();
    return {};
}

QString SimInstaller::remove(const QString &appId)
{
    if (!m_rootfs->isInstalled(appId))
        return QStringLiteral("No such id");
    if (!QDir(QDir(appsDir(m_rootfs)).filePath(appId)).removeRecursively())
        return QStringLiteral("Cannot remove ") + appId;
    m_rootfs->forgetSeeded(appId);
    m_rootfs->rescan();
    return {};
}

QVariantList SimInstaller::apps() const
{
    return m_rootfs->apps();
}

void SimInstaller::rescan()
{
    m_rootfs->rescan();
}

QVariantMap SimInstaller::addLaunchPoint(const QVariantMap &lp)
{
    const QString appId = lp.value(QStringLiteral("id")).toString();
    const QString dir = m_rootfs->launchPointsDir();
    if (dir.isEmpty())
        return { { QStringLiteral("error"), QStringLiteral("Failed to save launch point") } };
    const QString appDir = m_rootfs->appDir(appId);
    if (appId.isEmpty() || appDir.isEmpty())
        return { { QStringLiteral("error"), QStringLiteral("Unable to find id: ") + appId } };
    const QString title = lp.value(QStringLiteral("title")).toString();
    if (title.isEmpty())
        return { { QStringLiteral("error"), QStringLiteral("Invalid arguments") } };
    // The icon, absolute (getAbsolutePath against the app's folder,
    // ApplicationManagerService.cpp:3266-3269).
    QString icon = lp.value(QStringLiteral("icon")).toString();
    if (icon.startsWith(QLatin1String("file://")))
        icon = QUrl(icon).path();
    if (!icon.isEmpty() && !icon.startsWith(QLatin1Char('/')))
        icon = QStringLiteral("/usr/palm/applications/") + appId + QLatin1Char('/') + icon;
    QVariant params = lp.value(QStringLiteral("params"));
    if (params.typeId() == QMetaType::QString)
        params = QJsonDocument::fromJson(params.toString().toUtf8()).object().toVariantMap();
    if (!QDir().mkpath(dir))
        return { { QStringLiteral("error"), QStringLiteral("Failed to save launch point") } };
    QString id;
    for (int tries = 0; tries < 1000 && id.isEmpty(); ++tries) {
        const QString candidate = QStringLiteral("%1").arg(1 + QRandomGenerator::global()->bounded(1000000), 8, 10, QLatin1Char('0'));
        if (!QFileInfo::exists(QDir(dir).filePath(candidate)))
            id = candidate;
    }
    if (id.isEmpty())
        return { { QStringLiteral("error"), QStringLiteral("Failed to save launch point") } };
    QJsonObject record;
    record[QStringLiteral("id")] = appId;
    record[QStringLiteral("launchPointId")] = id;
    record[QStringLiteral("title")] = title;
    const QString appmenu = lp.value(QStringLiteral("appmenu")).toString();
    record[QStringLiteral("appmenu")] = appmenu.isEmpty() ? title : appmenu;
    record[QStringLiteral("icon")] = icon;
    record[QStringLiteral("params")] = QJsonObject::fromVariantMap(params.toMap());
    record[QStringLiteral("removable")] = lp.value(QStringLiteral("removable"), true).toBool();
    QFile out(QDir(dir).filePath(id));
    const QByteArray json = QJsonDocument(record).toJson(QJsonDocument::Compact);
    if (!out.open(QIODevice::WriteOnly) || out.write(json) != json.size())
        return { { QStringLiteral("error"), QStringLiteral("Failed to save launch point") } };
    out.close();
    m_rootfs->rescan();
    return { { QStringLiteral("launchPointId"), id } };
}

QString SimInstaller::removeLaunchPoint(const QString &launchPointId)
{
    // Only the numbered ones apps added; never an app's default
    // (ApplicationManager::removeLaunchPoint, :2048-2093).
    static const QRegularExpression number(QStringLiteral("^[0-9]+$"));
    const QVariantMap lp = m_rootfs->dynamicLaunchPoint(launchPointId);
    if (!number.match(launchPointId).hasMatch() || lp.isEmpty())
        return QStringLiteral("launch point [") + launchPointId + QStringLiteral("] not found");
    if (!lp.value(QStringLiteral("removable"), true).toBool())
        return QStringLiteral("launch point [") + launchPointId + QStringLiteral("] not marked non-removable");
    if (!QFile::remove(QDir(m_rootfs->launchPointsDir()).filePath(launchPointId)))
        return QStringLiteral("launch point deletion failed");
    m_rootfs->rescan();
    return {};
}

qint64 SimInstaller::freeSpaceKB() const
{
    QString dir = m_rootfs->installedDir();
    while (!dir.isEmpty() && !QFileInfo::exists(dir))
        dir = QFileInfo(dir).path() == dir ? QString() : QFileInfo(dir).path();
    if (dir.isEmpty())
        return -1;
    const QStorageInfo info(dir);
    return info.isValid() ? info.bytesAvailable() / 1024 : -1;
}
