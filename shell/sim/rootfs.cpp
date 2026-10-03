// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "rootfs.h"

#include <QBuffer>
#include <QFileInfo>
#include <QJsonArray>
#include <QDir>
#include <QDirIterator>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMimeDatabase>
#include <QRegularExpression>
#include <QUrl>
#include <algorithm>

#ifdef PHOENIX_HAVE_WEBENGINE
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <QUrlQuery>
#include <QWebEngineUrlRequestJob>
#include <QWebEngineUrlScheme>
#endif

static const char kAppsPrefix[] = "/usr/palm/applications/";
// Enyo 1.0's framework pages an app opens as its own windows
// (dashboard-window/dashboard.html for enyo.windows.openDashboard).
static const char kEnyoPrefix[] = "/usr/palm/frameworks/enyo/";
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

    // Files of the original apps we do not redistribute (docs/LEGAL.md).
    for (const auto &e : cfg.value(QStringLiteral("exclude")).toArray())
        m_excluded.append(e.toString());

    const QJsonObject mounts = cfg.value(QStringLiteral("mounts")).toObject();
    for (auto it = mounts.begin(); it != mounts.end(); ++it)
        m_mounts.append({ it.key(), QDir(repoDir).filePath(it.value().toString()) });
    std::sort(m_mounts.begin(), m_mounts.end(), [](const auto &a, const auto &b) {
        return a.first.size() > b.first.size();
    });

    for (const auto &dirValue : cfg.value(QStringLiteral("applicationDirs")).toArray())
        m_applicationDirs.append(QDir(repoDir).filePath(dirValue.toString()));
    for (const auto &dirValue : cfg.value(QStringLiteral("systemApps")).toArray())
        m_systemApps.append(QDir(repoDir).filePath(dirValue.toString()));
    rescan();
    m_valid = true;
}

void Rootfs::setInstalledDir(const QString &dir)
{
    m_installedDir = dir;
    rescan();
}

static const char kDataPrefix[] = "/var/luna/";

void Rootfs::setDataDir(const QString &dir)
{
    m_dataDir = dir;
    // setInstalledDir, or rescan(), reads the launch points kept there.
}

QString Rootfs::dataPath(const QString &devicePath) const
{
    const QString path = QDir::cleanPath(devicePath);
    if (m_dataDir.isEmpty() || !path.startsWith(QLatin1String(kDataPrefix))
        || path.split(QLatin1Char('/')).contains(QStringLiteral("..")))
        return {};
    return QDir::cleanPath(m_dataDir + path);
}

QString Rootfs::launchPointsDir() const
{
    return m_dataDir.isEmpty() ? QString() : dataPath(QStringLiteral("/var/luna/launchpoints"));
}

qint64 Rootfs::dirSize(const QString &dir)
{
    qint64 total = 0;
    QDirIterator it(dir, QDir::Files | QDir::Hidden | QDir::NoSymLinks, QDirIterator::Subdirectories);
    while (it.hasNext()) {
        it.next();
        total += it.fileInfo().size();
    }
    return total;
}

// A PNG's width, from its header (0 if it is not a PNG). The simulator's
// tests link Qt Core only, so no QImageReader.
int Rootfs::pngSide(const QString &file)
{
    QFile f(file);
    if (!f.open(QIODevice::ReadOnly))
        return 0;
    const QByteArray head = f.read(24);
    if (head.size() < 24 || !head.startsWith("\x89PNG") || head.mid(12, 4) != "IHDR")
        return 0;
    const auto *p = reinterpret_cast<const uchar *>(head.constData()) + 16;
    return int((quint32(p[0]) << 24) | (quint32(p[1]) << 16) | (quint32(p[2]) << 8) | quint32(p[3]));
}

// The biggest <stem>-<N>x<N>.png an overlay puts beside app `id`'s icon
// (`icon` is relative to the app's folder), or "" if none does.
QString Rootfs::overlayLargestIcon(const QString &id, const QString &icon) const
{
    const QFileInfo iconInfo(icon);
    const QRegularExpression re(QLatin1Char('^') + QRegularExpression::escape(iconInfo.completeBaseName())
        + QStringLiteral("-(\\d+)x\\1\\.") + QRegularExpression::escape(iconInfo.suffix()) + QLatin1Char('$'));
    QString best;
    int bestSide = 0;
    for (const QString &overlay : m_overlays) {
        const QDir dir(QDir::cleanPath(overlay + QString::fromLatin1(kAppsPrefix) + id + QLatin1Char('/') + iconInfo.path()));
        const auto names = dir.entryList({ iconInfo.completeBaseName() + QStringLiteral("-*.") + iconInfo.suffix() }, QDir::Files);
        for (const QString &name : names) {
            const auto m = re.match(name);
            if (m.hasMatch() && m.captured(1).toInt() > bestSide) {
                bestSide = m.captured(1).toInt();
                best = dir.filePath(name);
            }
        }
    }
    return best;
}

void Rootfs::rescan()
{
    m_appDirs.clear();
    m_apps.clear();
    m_launchPoints.clear();
    m_installed.clear();
    m_dynamic.clear();
    QHash<QString, QVariantMap> appEntries;   // app id -> its launcher entry
    // systemApps are always hidden from the launcher (Just Type, the system UI).
    auto addApp =[&](QString appDir, const QString &name, bool system, bool installed) {
        // Built apps (e.g. React) keep their installable output in dist/.
        if (!QFileInfo::exists(appDir + QStringLiteral("/appinfo.json")))
            appDir += QStringLiteral("/dist");
        QFile info(appDir + QStringLiteral("/appinfo.json"));
        if (!info.open(QIODevice::ReadOnly))
            return;
        QByteArray json = info.readAll();
        if (json.startsWith("\xEF\xBB\xBF"))   // UTF-8 BOM
            json.remove(0, 3);
        const QJsonObject app = QJsonDocument::fromJson(json).object();
        const QString id = app.value(QStringLiteral("id")).toString(name);
        if (m_appDirs.contains(id))
            return;
        m_appDirs.insert(id, appDir);
        const QString root = QString::fromLatin1(kAppsPrefix) + id + QLatin1Char('/');
        const QString mainFile = app.value(QStringLiteral("main")).toString(QStringLiteral("index.html"));
        // A hosted web app (an installed PWA) starts at its site's URL.
        const QString main = mainFile.startsWith(QLatin1String("https://")) || mainFile.startsWith(QLatin1String("http://"))
            ? mainFile : urlFor(root + mainFile);
        // Phoenix launcher metadata (see docs/APP-RUNTIME.md): launcherTab
        // (0 Apps, 1 Downloads, 2 Settings), hidden, quickLaunch (slot
        // 1-4), launchPoints.
        const QJsonObject phoenix = app.value(QStringLiteral("phoenix")).toObject();
        const int tab = phoenix.value(QStringLiteral("launcherTab")).toInt(0);
        // The launcher page the app names (Phoenix's launcherTab: 0 Apps,
        // 1 Downloads, 2 Settings, 3 Favorites), or "" to let the
        // launcher place it (LauncherLayout.pageFor: category, keywords,
        // installed).
        static const QStringList pageNames = { QStringLiteral("apps"), QStringLiteral("downloads"),
                                               QStringLiteral("prefs"), QStringLiteral("favorites") };
        auto pageOf = [](const QJsonObject &o, const QString &fallback) {
            const int t = o.value(QStringLiteral("launcherTab")).toInt(-1);
            return o.contains(QStringLiteral("launcherTab")) && t >= 0 && t < pageNames.size() ? pageNames.at(t) : fallback;
        };
        QStringList keywords;
        for (const auto &k : app.value(QStringLiteral("keywords")).toArray())
            keywords.append(k.toString());
        // Dock (Exhibition) mode: "exhibitionMode", or the older "dockMode",
        // with an optional title (ApplicationDescription.cpp:369-398).
        QJsonValue dock = app.value(QStringLiteral("exhibitionMode"));
        if (!dock.isBool())
            dock = app.value(QStringLiteral("dockMode"));
        QJsonObject dockOptions = app.value(QStringLiteral("exhibitionModeOptions")).toObject();
        if (dockOptions.isEmpty())
            dockOptions = app.value(QStringLiteral("dockModeOptions")).toObject();
        QVariantMap entry;
        entry[QStringLiteral("id")] = id;
        entry[QStringLiteral("appId")] = id;
        entry[QStringLiteral("title")] = app.value(QStringLiteral("title")).toString(id);
        entry[QStringLiteral("type")] = app.value(QStringLiteral("type")).toString(QStringLiteral("web"));
        // Shown when the launcher asks before removing it ("Remove Application?").
        entry[QStringLiteral("version")] = app.value(QStringLiteral("version")).toString();
        entry[QStringLiteral("noWindow")] = app.value(QStringLiteral("noWindow")).toBool();
        // The orientation the app's window starts in, until the page asks
        // (luna-sysmgr ApplicationDescription.cpp:464-469).
        entry[QStringLiteral("requestedWindowOrientation")] = app.value(QStringLiteral("requestedWindowOrientation")).toString();
        entry[QStringLiteral("main")] = main;
        entry[QStringLiteral("params")] = QString();
        // -1 keeps an app out of the launcher.
        entry[QStringLiteral("tab")] = system || phoenix.value(QStringLiteral("hidden")).toBool() ? -1 : tab;
        entry[QStringLiteral("page")] = pageOf(phoenix, QString());
        entry[QStringLiteral("category")] = app.value(QStringLiteral("category")).toString();
        entry[QStringLiteral("keywords")] = keywords.join(QLatin1Char('\n'));
        entry[QStringLiteral("dynamic")] = false;
        entry[QStringLiteral("quickLaunch")] = phoenix.value(QStringLiteral("quickLaunch")).toInt(0);
        // The app's files on disk, for device paths the shell resolves itself (wallpapers).
        entry[QStringLiteral("dir")] = QUrl::fromLocalFile(appDir + QLatin1Char('/')).toString();
        // The shell loads icons itself, from the file on disk.
        const QString icon = app.value(QStringLiteral("icon")).toString(QStringLiteral("icon.png"));
        entry[QStringLiteral("icon")] = QUrl::fromLocalFile(appDir + QLatin1Char('/') + icon).toString();
        // A bigger picture of the icon, for dense screens and the loading
        // card: "splashicon" (luna-sysmgr ApplicationDescription.cpp:242-246;
        // icon-256x256.png in the core apps), or OSE's "largeIcon".
        QString large = app.value(QStringLiteral("splashicon")).toString();
        if (large.isEmpty())
            large = app.value(QStringLiteral("largeIcon")).toString();
        QString largeFile = large.isEmpty() ? QString() : appDir + QLatin1Char('/') + large;
        if (!largeFile.isEmpty() && !QFileInfo::exists(largeFile))
            largeFile.clear();
        // The compat overlay may add bigger icons beside the app's icon:
        // icon-512x512.png for the Open webOS apps, whose own folders are
        // submodules we leave unchanged (tools/upscale-app-icons.py). On a
        // device they are installed beside the icon, where HiDpi::icon finds
        // them; here the icon is read from the app's own folder, so the
        // biggest one the overlay adds is the large icon when it beats the
        // splashicon (the splashicon, beside the icon, is still found).
        const QString overlayIcon = overlayLargestIcon(id, icon);
        if (!overlayIcon.isEmpty() && pngSide(overlayIcon) > (largeFile.isEmpty() ? 0 : pngSide(largeFile)))
            largeFile = overlayIcon;
        entry[QStringLiteral("largeIcon")] = largeFile.isEmpty() ? QString() : QUrl::fromLocalFile(largeFile).toString();
        // The loading card's own icon and background (CardLoading.cpp:79-116):
        // the splashicon itself, drawn at SplashIconSize; "splashBackground"
        // (or "splashbackground"), tiled over the card, when the file is there.
        const QString splashIconFile = large.isEmpty() || large != app.value(QStringLiteral("splashicon")).toString()
            ? QString() : appDir + QLatin1Char('/') + large;
        entry[QStringLiteral("splashIcon")] = !splashIconFile.isEmpty() && QFileInfo::exists(splashIconFile)
            ? QUrl::fromLocalFile(splashIconFile).toString() : QString();
        QString splashBg = app.value(QStringLiteral("splashBackground")).toString();
        if (splashBg.isEmpty())
            splashBg = app.value(QStringLiteral("splashbackground")).toString();
        const QString splashBgFile = splashBg.isEmpty() ? QString() : appDir + QLatin1Char('/') + splashBg;
        entry[QStringLiteral("splashBackground")] = !splashBgFile.isEmpty() && QFileInfo::exists(splashBgFile)
            ? QUrl::fromLocalFile(splashBgFile).toString() : QString();
        // Installed by the user: the launcher may delete it (uninstall).
        entry[QStringLiteral("installed")] = installed;
        // The app's files (getSizeOfApps, getUserInstalledAppSizes).
        const qint64 size = dirSize(appDir);
        entry[QStringLiteral("size")] = size;
        if (installed)
            m_installed.append(id);
        m_apps.append(entry);
        appEntries.insert(id, entry);
        QVariantMap record;
        record[QStringLiteral("id")] = id;
        record[QStringLiteral("appId")] = id;
        record[QStringLiteral("launchPointId")] = id + QStringLiteral("_default");
        record[QStringLiteral("title")] = entry.value(QStringLiteral("title"));
        record[QStringLiteral("appmenu")] = entry.value(QStringLiteral("title"));
        record[QStringLiteral("icon")] = root + icon;
        record[QStringLiteral("params")] = QVariantMap();
        record[QStringLiteral("hidden")] = entry.value(QStringLiteral("tab")).toInt() < 0;
        record[QStringLiteral("universalSearch")] = app.value(QStringLiteral("universalSearch")).toVariant();
        record[QStringLiteral("removable")] = installed;
        record[QStringLiteral("version")] = app.value(QStringLiteral("version")).toString();
        // LaunchPoint::toJSON (LaunchPoint.cpp:262-310): the vendor, the
        // package, its size (user-installed apps; 0 for the built-in ones).
        record[QStringLiteral("vendor")] = app.value(QStringLiteral("vendor")).toString();
        record[QStringLiteral("vendorUrl")] = app.value(QStringLiteral("vendorurl")).toString();
        record[QStringLiteral("packageId")] = id;
        record[QStringLiteral("size")] = installed ? size : 0;
        record[QStringLiteral("appSize")] = size;
        record[QStringLiteral("system")] = system;
        record[QStringLiteral("noWindow")] = app.value(QStringLiteral("noWindow")).toBool();
        if (dock.toBool()) {
            record[QStringLiteral("exhibitionMode")] = true;
            record[QStringLiteral("exhibitionModeTitle")] = dockOptions.value(QStringLiteral("title")).toString(entry.value(QStringLiteral("title")).toString());
        }
        // The types the app opens (appinfo.json "mimeTypes": [{mime, extension,
        // stream}], luna-sysmgr's resource handlers), for the application
        // manager's listAllHandlersForMime and open {target}.
        if (app.contains(QStringLiteral("mimeTypes")))
            record[QStringLiteral("mimeTypes")] = app.value(QStringLiteral("mimeTypes")).toVariant();
        // What it takes from the share sheet ("phoenix": {"shareTargets"};
        // docs/SHARE-AND-FILES.md).
        if (phoenix.contains(QStringLiteral("shareTargets")))
            record[QStringLiteral("shareTargets")] = phoenix.value(QStringLiteral("shareTargets")).toVariant();
        m_launchPoints.append(record);

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
            point[QStringLiteral("page")] = pageOf(lp, entry.value(QStringLiteral("page")).toString());
            point[QStringLiteral("icon")] = QUrl::fromLocalFile(appDir + QLatin1Char('/') + lp.value(QStringLiteral("icon")).toString(icon)).toString();
            // Its own icon's bigger siblings are found beside it (HiDpi::icon).
            if (lp.contains(QStringLiteral("icon")))
                point[QStringLiteral("largeIcon")] = QString();
            point[QStringLiteral("noWindow")] = false;
            point[QStringLiteral("quickLaunch")] = lp.value(QStringLiteral("quickLaunch")).toInt(0);
            m_apps.append(point);
            QVariantMap pointRecord;
            pointRecord[QStringLiteral("id")] = id;
            pointRecord[QStringLiteral("appId")] = id;
            pointRecord[QStringLiteral("launchPointId")] = lpId;
            pointRecord[QStringLiteral("title")] = point.value(QStringLiteral("title"));
            pointRecord[QStringLiteral("appmenu")] = point.value(QStringLiteral("title"));
            pointRecord[QStringLiteral("removable")] = false;
            pointRecord[QStringLiteral("icon")] = root + lp.value(QStringLiteral("icon")).toString(icon);
            pointRecord[QStringLiteral("params")] = lp.value(QStringLiteral("params")).toObject().toVariantMap();
            pointRecord[QStringLiteral("hidden")] = false;
            m_launchPoints.append(pointRecord);
        }
    };
    for (const QString &dir : m_applicationDirs) {
        QDir base(dir);
        const auto entries = base.entryList(QDir::Dirs | QDir::NoDotAndDotDot, QDir::Name);
        for (const QString &name : entries)
            addApp(base.filePath(name), name, false, false);
    }
    for (const QString &dir : m_systemApps)
        addApp(dir, QFileInfo(dir).fileName(), true, false);
    // Installed apps come last: a built-in app keeps its id.
    if (!m_installedDir.isEmpty()) {
        QDir base(QDir(m_installedDir).filePath(QStringLiteral("usr/palm/applications")));
        const auto entries = base.entryList(QDir::Dirs | QDir::NoDotAndDotDot, QDir::Name);
        for (const QString &name : entries)
            if (!name.endsWith(QLatin1String(".new")) && !name.endsWith(QLatin1String(".old")))
                addApp(base.filePath(name), name, false, true);
    }

    // Launch points apps added (applicationManager/addLaunchPoint): one
    // file each, named by its id, holding LaunchPoint::toJSON's record
    // (ApplicationManager::addLaunchPoint, scanForLaunchPoints). Those of
    // apps that are gone are left out.
    const QString lpDir = launchPointsDir();
    if (!lpDir.isEmpty()) {
        const auto files = QDir(lpDir).entryList(QDir::Files, QDir::Name);
        for (const QString &name : files) {
            QFile f(QDir(lpDir).filePath(name));
            if (!f.open(QIODevice::ReadOnly))
                continue;
            const QJsonObject lp = QJsonDocument::fromJson(f.readAll()).object();
            const QString appId = lp.value(QStringLiteral("id")).toString();
            if (!appEntries.contains(appId) || lp.value(QStringLiteral("launchPointId")).toString() != name)
                continue;
            const QVariantMap app = appEntries.value(appId);
            const QString iconPath = lp.value(QStringLiteral("icon")).toString();
            QString iconFile = iconPath.isEmpty() ? QString() : resolve(iconPath);
            if (!iconFile.isEmpty() && !QFileInfo(iconFile).isFile())
                iconFile.clear();
            const QByteArray params = QJsonDocument(lp.value(QStringLiteral("params")).toObject()).toJson(QJsonDocument::Compact);
            QVariantMap point = app;
            point[QStringLiteral("id")] = name;
            point[QStringLiteral("title")] = lp.value(QStringLiteral("title")).toString();
            point[QStringLiteral("params")] = QString::fromUtf8(params);
            const QString main = app.value(QStringLiteral("main")).toString();
            point[QStringLiteral("main")] = main + (main.contains(QLatin1Char('?')) ? QStringLiteral("&") : QStringLiteral("?"))
                + QStringLiteral("launchParams=") + QString::fromLatin1(QUrl::toPercentEncoding(QString::fromUtf8(params)));
            // A launch point of a hidden app (Settings) still shows.
            point[QStringLiteral("tab")] = 0;
            point[QStringLiteral("page")] = QStringLiteral("favorites");
            point[QStringLiteral("dynamic")] = true;
            point[QStringLiteral("icon")] = iconFile.isEmpty() ? app.value(QStringLiteral("icon")).toString()
                                                               : QUrl::fromLocalFile(iconFile).toString();
            point[QStringLiteral("largeIcon")] = QString();
            point[QStringLiteral("noWindow")] = false;
            point[QStringLiteral("quickLaunch")] = 0;
            point[QStringLiteral("removable")] = lp.value(QStringLiteral("removable")).toBool(true);
            m_apps.append(point);
            QVariantMap record = lp.toVariantMap();
            record[QStringLiteral("appId")] = appId;
            record[QStringLiteral("hidden")] = false;
            record[QStringLiteral("dynamic")] = true;
            m_launchPoints.append(record);
            m_dynamic.insert(name, record);
        }
    }
}

QByteArray Rootfs::launchPointsJson() const
{
    QJsonArray all;
    for (const QVariantMap &lp : m_launchPoints)
        all.append(QJsonObject::fromVariantMap(lp));
    return QJsonDocument(all).toJson(QJsonDocument::Compact);
}

QString RootfsFiles::fileUrl(const QString &devicePath) const
{
    const QString file = m_rootfs->resolve(devicePath);
    return !file.isEmpty() && QFileInfo(file).isFile() ? QUrl::fromLocalFile(file).toString() : QString();
}

QVariantList RootfsFiles::twinDirectories() const
{
    QVariantList pairs;
    for (const auto &p : m_rootfs->twinDirectories())
        pairs.append(QVariant(QStringList { p.first, p.second }));
    return pairs;
}

QList<QPair<QString, QString>> Rootfs::twinDirectories() const
{
    QList<QPair<QString, QString>> pairs;
    for (const auto &m : m_mounts) {
        if (!m.first.endsWith(QLatin1Char('/')) || !QFileInfo(m.second).isDir())
            continue;
        for (const QString &overlay : m_overlays) {
            const QString twin = QDir::cleanPath(overlay + m.first);
            if (QFileInfo(twin).isDir())
                pairs.append({ QDir::cleanPath(m.second), twin });
        }
    }
    return pairs;
}

QString Rootfs::urlFor(const QString &devicePath)
{
    return scheme() + QStringLiteral("://rootfs") + devicePath;
}

QString Rootfs::resolve(const QString &devicePath) const
{
    const QString path = QDir::cleanPath(devicePath);
    if (path.split(QLatin1Char('/')).contains(QStringLiteral("..")) || m_excluded.contains(path))
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
    const QString data = dataPath(path);
    if (!data.isEmpty())
        return data;
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
    // FetchApiAllowed (Qt 6.6+): fetch() works on it, as on a device's
    // file:// apps. Flutter's web apps load their renderer (WebAssembly) and
    // fonts with fetch(); without it Chromium refuses the scheme.
    QWebEngineUrlScheme::Flags flags = QWebEngineUrlScheme::SecureScheme
                                       | QWebEngineUrlScheme::LocalAccessAllowed
                                       | QWebEngineUrlScheme::CorsEnabled;
#if QT_VERSION >= QT_VERSION_CHECK(6, 6, 0)
    flags |= QWebEngineUrlScheme::FetchApiAllowed;
#endif
    scheme.setFlags(flags);
    QWebEngineUrlScheme::registerScheme(scheme);
}

static void replyJson(QWebEngineUrlRequestJob *job, const QJsonObject &o)
{
    auto *buffer = new QBuffer(job);
    buffer->setData(QJsonDocument(o).toJson(QJsonDocument::Compact));
    buffer->open(QIODevice::ReadOnly);
    job->reply("application/json;charset=utf-8", buffer);
}

void RootfsSchemeHandler::proxy(QWebEngineUrlRequestJob *job)
{
    const QJsonObject req = QJsonDocument::fromJson(
        QUrlQuery(job->requestUrl()).queryItemValue(QStringLiteral("req"), QUrl::FullyDecoded).toUtf8()).object();
    const QUrl url(req.value(QStringLiteral("url")).toString());
    if (!url.isValid() || (url.scheme() != QLatin1String("http") && url.scheme() != QLatin1String("https")) || url.host().isEmpty()) {
        replyJson(job, { { QStringLiteral("error"), QStringLiteral("unsupported URL: ") + url.toString() },
                         { QStringLiteral("code"), QStringLiteral("BAD_SERVER") } });
        return;
    }
    if (!m_network)
        m_network = new QNetworkAccessManager(this);
    QNetworkRequest nr(url);
    nr.setTransferTimeout(60000);
    nr.setAttribute(QNetworkRequest::RedirectPolicyAttribute, req.value(QStringLiteral("follow")).toBool()
                    ? QNetworkRequest::NoLessSafeRedirectPolicy : QNetworkRequest::ManualRedirectPolicy);
    const QJsonObject headers = req.value(QStringLiteral("headers")).toObject();
    for (auto it = headers.begin(); it != headers.end(); ++it)
        nr.setRawHeader(it.key().toUtf8(), it.value().toString().toUtf8());
    const QByteArray method = req.value(QStringLiteral("method")).toString(QStringLiteral("GET")).toUtf8();
    const QJsonValue body = req.value(QStringLiteral("body"));
    QNetworkReply *reply = body.isString()
        ? m_network->sendCustomRequest(nr, method, body.toString().toUtf8())
        : m_network->sendCustomRequest(nr, method);
    const bool binary = req.value(QStringLiteral("binary")).toBool();
    QPointer<QWebEngineUrlRequestJob> guard(job);
    QObject::connect(reply, &QNetworkReply::finished, reply, [reply, guard, binary]() {
        reply->deleteLater();
        if (!guard)
            return;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (status == 0) {
            QString code = QStringLiteral("ECONNRESET");
            switch (reply->error()) {
            case QNetworkReply::HostNotFoundError: code = QStringLiteral("ENOTFOUND"); break;
            case QNetworkReply::ConnectionRefusedError: code = QStringLiteral("ECONNREFUSED"); break;
            case QNetworkReply::TimeoutError: case QNetworkReply::OperationCanceledError: code = QStringLiteral("ETIMEDOUT"); break;
            case QNetworkReply::SslHandshakeFailedError: code = QStringLiteral("UNABLE_TO_VERIFY_LEAF_SIGNATURE"); break;
            default: break;
            }
            replyJson(guard, { { QStringLiteral("error"), reply->errorString() }, { QStringLiteral("code"), code } });
            return;
        }
        QJsonObject out;
        out[QStringLiteral("status")] = status;
        out[QStringLiteral("url")] = reply->url().toString();
        QJsonObject h;
        for (const auto &pair : reply->rawHeaderPairs())
            h[QString::fromUtf8(pair.first).toLower()] = QString::fromUtf8(pair.second);
        out[QStringLiteral("headers")] = h;
        const QByteArray data = reply->readAll();
        if (binary)
            out[QStringLiteral("bodyBase64")] = QString::fromLatin1(data.toBase64());
        else
            out[QStringLiteral("body")] = QString::fromUtf8(data);
        replyJson(guard, out);
    });
}

void RootfsSchemeHandler::requestStarted(QWebEngineUrlRequestJob *job)
{
    const QString devicePath = job->requestUrl().path();
    if (devicePath == QLatin1String("/__phoenix/proxy")) {
        proxy(job);
        return;
    }
    if (devicePath == QLatin1String("/usr/share/phoenix/host.json")) {
        auto *buffer = new QBuffer(job);
        buffer->setData(m_rootfs->hostInfo());
        buffer->open(QIODevice::ReadOnly);
        job->reply("application/json;charset=utf-8", buffer);
        return;
    }
    if (devicePath == QLatin1String("/usr/share/phoenix/apps.json")) {
        auto *buffer = new QBuffer(job);
        buffer->setData(m_rootfs->launchPointsJson());
        buffer->open(QIODevice::ReadOnly);
        job->reply("application/json;charset=utf-8", buffer);
        return;
    }
    if (devicePath == QLatin1String("/__phoenix/snapshot")) {
        if (!m_snapshots) {
            replyJson(job, { { QStringLiteral("returnValue"), false }, { QStringLiteral("errorText"), QStringLiteral("No pictures here") } });
            return;
        }
        replyJson(job, m_snapshots->request(QJsonDocument::fromJson(
            QUrlQuery(job->requestUrl()).queryItemValue(QStringLiteral("req"), QUrl::FullyDecoded).toUtf8()).object()));
        return;
    }
    // A picture still being made is answered once it is there.
    const QString clean = QDir::cleanPath(devicePath);
    if (m_snapshots && m_snapshots->isPending(clean)) {
        QPointer<QWebEngineUrlRequestJob> guard(job);
        m_snapshots->whenReady(clean, [this, guard, clean](bool) {
            if (guard)
                serveFile(guard, clean);
        });
        return;
    }
    serveFile(job, devicePath);
}

void RootfsSchemeHandler::serveFile(QWebEngineUrlRequestJob *job, const QString &devicePath)
{
    const QString file = m_rootfs->resolve(devicePath);
    QFile f(file);
    if (file.isEmpty() || !QFileInfo(file).isFile() || !f.open(QIODevice::ReadOnly)) {
        job->fail(QWebEngineUrlRequestJob::UrlNotFound);
        return;
    }
    QByteArray data = f.readAll();
    QByteArray mime = QMimeDatabase().mimeTypeForFile(file, QMimeDatabase::MatchExtension).name().toLatin1();

    // App pages, and Enyo 1.0 pages an app opens as a window, get the webOS
    // runtime before any of their own scripts: on webOS every window of an
    // app had PalmSystem (WebAppMgr).
    if ((devicePath.startsWith(QLatin1String(kAppsPrefix)) || devicePath.startsWith(QLatin1String(kEnyoPrefix)))
        && file.endsWith(QLatin1String(".html"))) {
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
