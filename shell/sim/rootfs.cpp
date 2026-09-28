// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "rootfs.h"

#include <QBuffer>
#include <QFileInfo>
#include <QJsonArray>
#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMimeDatabase>
#include <QUrl>
#include <algorithm>

#ifdef PHOENIX_HAVE_WEBENGINE
#include <QWebEngineUrlRequestJob>
#include <QWebEngineUrlScheme>
#endif

static const char kAppsPrefix[] = "/usr/palm/applications/";
static const char kRuntimeTag[] =
    "<script src=\"/usr/share/phoenix/runtime/phoenix-runtime.js\"></script>";

Rootfs::Rootfs(const QString &repoDir)
    : m_repoDir(repoDir)
{
    QFile f(QDir(repoDir).filePath(QStringLiteral("runtime/rootfs.json")));
    if (!f.open(QIODevice::ReadOnly)) {
        m_error = QStringLiteral("cannot read %1").arg(f.fileName());
        return;
    }
    const QJsonObject cfg = QJsonDocument::fromJson(f.readAll()).object();

    for (const auto &o : cfg.value(QStringLiteral("overlays")).toArray())
        m_overlays.append(QDir(repoDir).filePath(o.toString()));

    const QJsonObject mounts = cfg.value(QStringLiteral("mounts")).toObject();
    for (auto it = mounts.begin(); it != mounts.end(); ++it)
        m_mounts.append({ it.key(), QDir(repoDir).filePath(it.value().toString()) });
    std::sort(m_mounts.begin(), m_mounts.end(), [](const auto &a, const auto &b) {
        return a.first.size() > b.first.size();
    });

    for (const auto &dirValue : cfg.value(QStringLiteral("applicationDirs")).toArray()) {
        QDir base(QDir(repoDir).filePath(dirValue.toString()));
        const auto entries = base.entryList(QDir::Dirs | QDir::NoDotAndDotDot, QDir::Name);
        for (const QString &name : entries) {
            // Built apps (e.g. React) keep their installable output in dist/.
            QString appDir = base.filePath(name);
            if (!QFileInfo::exists(appDir + QStringLiteral("/appinfo.json")))
                appDir += QStringLiteral("/dist");
            QFile info(appDir + QStringLiteral("/appinfo.json"));
            if (!info.open(QIODevice::ReadOnly))
                continue;
            QByteArray json = info.readAll();
            if (json.startsWith("\xEF\xBB\xBF"))   // UTF-8 BOM
                json.remove(0, 3);
            const QJsonObject app = QJsonDocument::fromJson(json).object();
            const QString id = app.value(QStringLiteral("id")).toString(name);
            if (m_appDirs.contains(id))
                continue;
            m_appDirs.insert(id, appDir);
            const QString root = QString::fromLatin1(kAppsPrefix) + id + QLatin1Char('/');
            const QString main = urlFor(root + app.value(QStringLiteral("main")).toString(QStringLiteral("index.html")));
            // Phoenix launcher metadata (see docs/APP-RUNTIME.md): launcherTab
            // (0 Apps, 1 Downloads, 2 Settings), hidden, quickLaunch (slot
            // 1-4), launchPoints.
            const QJsonObject phoenix = app.value(QStringLiteral("phoenix")).toObject();
            const int tab = phoenix.value(QStringLiteral("launcherTab")).toInt(0);
            QVariantMap entry;
            entry[QStringLiteral("id")] = id;
            entry[QStringLiteral("appId")] = id;
            entry[QStringLiteral("title")] = app.value(QStringLiteral("title")).toString(id);
            entry[QStringLiteral("type")] = app.value(QStringLiteral("type")).toString(QStringLiteral("web"));
            entry[QStringLiteral("noWindow")] = app.value(QStringLiteral("noWindow")).toBool();
            entry[QStringLiteral("main")] = main;
            entry[QStringLiteral("params")] = QString();
            // -1 keeps an app out of the launcher.
            entry[QStringLiteral("tab")] = phoenix.value(QStringLiteral("hidden")).toBool() ? -1 : tab;
            entry[QStringLiteral("quickLaunch")] = phoenix.value(QStringLiteral("quickLaunch")).toInt(0);
            // The app's files on disk, for device paths the shell resolves itself (wallpapers).
            entry[QStringLiteral("dir")] = QUrl::fromLocalFile(appDir + QLatin1Char('/')).toString();
            // The shell loads icons itself, from the file on disk.
            const QString icon = app.value(QStringLiteral("icon")).toString(QStringLiteral("icon.png"));
            entry[QStringLiteral("icon")] = QUrl::fromLocalFile(appDir + QLatin1Char('/') + icon).toString();
            m_apps.append(entry);

            // Launch points: more launcher icons for the same app, each
            // starting it with its own launch params (its own card).
            for (const auto &lpValue : phoenix.value(QStringLiteral("launchPoints")).toArray()) {
                const QJsonObject lp = lpValue.toObject();
                const QString lpId = lp.value(QStringLiteral("id")).toString();
                if (lpId.isEmpty())
                    continue;
                const QByteArray params = QJsonDocument(lp.value(QStringLiteral("params")).toObject()).toJson(QJsonDocument::Compact);
                QVariantMap point = entry;
                point[QStringLiteral("id")] = lpId;
                point[QStringLiteral("title")] = lp.value(QStringLiteral("title")).toString(entry.value(QStringLiteral("title")).toString());
                point[QStringLiteral("params")] = QString::fromUtf8(params);
                point[QStringLiteral("main")] = main + QStringLiteral("?launchParams=") + QString::fromLatin1(QUrl::toPercentEncoding(QString::fromUtf8(params)));
                point[QStringLiteral("tab")] = lp.value(QStringLiteral("launcherTab")).toInt(tab);
                point[QStringLiteral("icon")] = QUrl::fromLocalFile(appDir + QLatin1Char('/') + lp.value(QStringLiteral("icon")).toString(icon)).toString();
                point[QStringLiteral("noWindow")] = false;
                point[QStringLiteral("quickLaunch")] = lp.value(QStringLiteral("quickLaunch")).toInt(0);
                m_apps.append(point);
            }
        }
    }
    m_valid = true;
}

QString Rootfs::urlFor(const QString &devicePath)
{
    return scheme() + QStringLiteral("://rootfs") + devicePath;
}

QString Rootfs::resolve(const QString &devicePath) const
{
    const QString path = QDir::cleanPath(devicePath);
    if (path.split(QLatin1Char('/')).contains(QStringLiteral("..")))
        return {};
    for (const QString &overlay : m_overlays) {
        const QString f = overlay + path;
        if (QFileInfo(f).isFile())
            return f;
    }
    for (const auto &m : m_mounts) {
        QString prefix = m.first;
        if (path == prefix || path + QLatin1Char('/') == prefix)
            return m.second;
        if (path.startsWith(prefix))
            return m.second + path.mid(prefix.size());
    }
    const QString appsPrefix = QString::fromLatin1(kAppsPrefix);
    if (path.startsWith(appsPrefix)) {
        const QString rest = path.mid(appsPrefix.size());
        const QString id = rest.section(QLatin1Char('/'), 0, 0);
        const auto it = m_appDirs.constFind(id);
        if (it != m_appDirs.constEnd())
            return it.value() + rest.mid(id.size());
    }
    return {};
}

#ifdef PHOENIX_HAVE_WEBENGINE
void RootfsSchemeHandler::registerScheme()
{
    QWebEngineUrlScheme scheme(Rootfs::scheme().toLatin1());
    // A host-based "standard" scheme gives every app one shared origin
    // (phoenix://rootfs), so they share localStorage like apps on a device
    // share db8, and absolute paths like /usr/palm/frameworks/... resolve.
    scheme.setSyntax(QWebEngineUrlScheme::Syntax::Host);
    scheme.setFlags(QWebEngineUrlScheme::SecureScheme
                    | QWebEngineUrlScheme::LocalAccessAllowed
                    | QWebEngineUrlScheme::CorsEnabled);
    QWebEngineUrlScheme::registerScheme(scheme);
}

void RootfsSchemeHandler::requestStarted(QWebEngineUrlRequestJob *job)
{
    const QString devicePath = job->requestUrl().path();
    const QString file = m_rootfs->resolve(devicePath);
    QFile f(file);
    if (file.isEmpty() || !QFileInfo(file).isFile() || !f.open(QIODevice::ReadOnly)) {
        job->fail(QWebEngineUrlRequestJob::UrlNotFound);
        return;
    }
    QByteArray data = f.readAll();
    QByteArray mime = QMimeDatabase().mimeTypeForFile(file, QMimeDatabase::MatchExtension).name().toLatin1();

    // App pages get the webOS runtime before any of their own scripts.
    if (devicePath.startsWith(QLatin1String(kAppsPrefix)) && file.endsWith(QLatin1String(".html"))) {
        const int head = data.toLower().indexOf("<head");
        const int close = head >= 0 ? data.indexOf('>', head) : -1;
        if (close >= 0)
            data.insert(close + 1, kRuntimeTag);
        else
            data.prepend(kRuntimeTag);
        mime = "text/html";
    }

    // The sources are UTF-8; without a charset Chromium reads scripts as Latin-1.
    if (mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json") || mime.endsWith("+xml"))
        mime += ";charset=utf-8";

    auto *buffer = new QBuffer(job);
    buffer->setData(data);
    buffer->open(QIODevice::ReadOnly);
    job->reply(mime, buffer);
}
#endif
