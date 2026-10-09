// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The virtual webOS filesystem (runtime/rootfs.json) and the phoenix://
// URL scheme that serves it to web apps in the simulator.

#pragma once

#include <QHash>
#include <QObject>
#include <QList>
#include <QPair>
#include <QString>
#include <QStringList>
#include <QVariantList>
#include <QVariantMap>
#include <QJsonObject>
#include <functional>
#include <QtGlobal>

#ifdef PHOENIX_HAVE_WEBENGINE
#include <QWebEngineUrlSchemeHandler>
#endif

class Rootfs
{
public:
    // repoDir: the checkout root that contains runtime/rootfs.json.
    explicit Rootfs(const QString &repoDir);

    bool isValid() const { return m_valid; }
    QString error() const { return m_error; }
    // What rootfs.json names that is missing or empty in the checkout, as
    // paths in it (a submodule's folder for anything in third_party/): the
    // original webOS apps and frameworks when the git submodules were not
    // fetched. Their apps are left out of the launcher.
    QStringList missing() const { return m_missing; }

    // Device path (e.g. /usr/palm/applications/<id>/index.html) -> file.
    QString resolve(const QString &devicePath) const;
    // Each mount's and each app's directory paired with each overlay's
    // directory at the same device path, where the overlay has one.
    QList<QPair<QString, QString>> twinDirectories() const;

    // Apps the user installed (com.webos.appInstallService in the runtime,
    // through SimInstaller): a folder laid out like a device's
    // /media/cryptofs/apps (usr/palm/applications/<id>/), whose apps are
    // served at /usr/palm/applications/<id>/ like the built-in ones and are
    // removable. rescan() reads the apps again after a change.
    void setInstalledDir(const QString &dir);
    QString installedDir() const { return m_installedDir; }
    bool isInstalled(const QString &appId) const { return m_installed.contains(appId); }
    bool hasApp(const QString &appId) const { return m_appDirs.contains(appId); }
    void rescan();

    // The device's writable /var/luna/ (the simulator's data folder):
    // launch points apps add (/var/luna/launchpoints/<id>, as
    // LunaSysMgr's lunaLaunchPointsPath, Settings.cpp:90) and files apps
    // save there (the browser's page pictures, /var/luna/data/browser/).
    void setDataDir(const QString &dir);
    QString dataDir() const { return m_dataDir; }
    // The file for a device path under /var/luna/, or "" (not writable here).
    QString dataPath(const QString &devicePath) const;
    QString launchPointsDir() const;
    // A launch point an app added, by its id, as stored (empty if none).
    QVariantMap dynamicLaunchPoint(const QString &launchPointId) const { return m_dynamic.value(launchPointId); }
    // The app's folder on disk ("" if there is no such app).
    QString appDir(const QString &appId) const { return m_appDirs.value(appId); }

    // Launcher entries as maps: id, appId (the app; differs from id for a
    // launch point), title, type, noWindow, main (phoenix:// URL, with
    // ?launchParams= for launch points), params (JSON), tab (-1 = hidden),
    // page (the launcher page appinfo.json names, "" for none), dynamic (a
    // launch point an app added), category, keywords ("\n"-separated),
    // installed, size (bytes), dir and icon (file URLs, for the shell).
    QVariantList apps() const { return m_apps; }

    // The bytes of the files under dir.
    static qint64 dirSize(const QString &dir);

    // The same apps for the simulated applicationManager in web pages
    // (served as /usr/share/phoenix/apps.json): the launch point records
    // listLaunchPoints returns, with device paths.
    QByteArray launchPointsJson() const;

    // What this host offers the runtime (served as /usr/share/phoenix/host.json):
    // {"pty": "host"} when phoenix-sim runs the Terminal's shells.
    void setHostInfo(const QByteArray &json) { m_hostInfo = json; }
    QByteArray hostInfo() const { return m_hostInfo; }

    static QString scheme() { return QStringLiteral("phoenix"); }
    static QString urlFor(const QString &devicePath);

private:
    static int pngSide(const QString &file);
    QString overlayLargestIcon(const QString &id, const QString &icon) const;

    bool m_valid = false;
    QString m_error;
    QStringList m_missing;
    QString m_repoDir;
    QStringList m_overlays;                    // searched first
    QStringList m_excluded;                    // never served
    QList<QPair<QString, QString>> m_mounts;   // longest prefix first
    QHash<QString, QString> m_appDirs;         // app id -> directory
    QStringList m_applicationDirs;             // rootfs.json applicationDirs, absolute
    QStringList m_systemApps;                  // rootfs.json systemApps, absolute
    QString m_installedDir;
    QString m_dataDir;
    QStringList m_installed;                   // ids of installed apps
    QHash<QString, QVariantMap> m_dynamic;     // launch points apps added, by id
    QVariantList m_apps;
    QList<QVariantMap> m_launchPoints;
    QByteArray m_hostInfo = "{}";
};

// The virtual filesystem for the shell's own QML (simRootfs): banner and
// dashboard icons that apps name by their device path.
class RootfsFiles : public QObject
{
    Q_OBJECT
public:
    explicit RootfsFiles(const Rootfs *rootfs, QObject *parent = nullptr)
        : QObject(parent), m_rootfs(rootfs) {}

    // A file URL for a device path (e.g. /usr/lib/luna/system/...png), or "".
    Q_INVOKABLE QString fileUrl(const QString &devicePath) const;
    // [directory, twin] pairs: a mounted directory (luna-systemui's in
    // third_party) and the overlay's directory at the same device path,
    // whose files a device installs beside it (HiDpi.addTwinDirectory).
    Q_INVOKABLE QVariantList twinDirectories() const;

private:
    const Rootfs *m_rootfs;
};

// What makes the browser's page pictures (SimSnapshots), as the scheme
// handler sees it: requests at /__phoenix/snapshot, and files still being
// made, answered once they are.
class PictureMaker
{
public:
    virtual ~PictureMaker() = default;
    virtual QJsonObject request(const QJsonObject &req) = 0;
    virtual bool isPending(const QString &devicePath) const = 0;
    virtual void whenReady(const QString &devicePath, const std::function<void(bool)> &done) = 0;
};

#ifdef PHOENIX_HAVE_WEBENGINE
class QNetworkAccessManager;
class SimDropShare;

class RootfsSchemeHandler : public QWebEngineUrlSchemeHandler
{
public:
    explicit RootfsSchemeHandler(const Rootfs *rootfs, QObject *parent = nullptr)
        : QWebEngineUrlSchemeHandler(parent), m_rootfs(rootfs) {}

    void requestStarted(QWebEngineUrlRequestJob *job) override;

    // Must run before the QGuiApplication is created.
    static void registerScheme();

    // The browser's page pictures (/__phoenix/snapshot, and files still
    // being made).
    void setSnapshots(PictureMaker *snapshots) { m_snapshots = snapshots; }

    // DropShare's server (simdropshare.h) for the runtime's
    // org.webosphoenix.dropshare: GET /__phoenix/dropshare?req={op, ...}
    // (start, stop, status, take, and a file to send in parts: offerBegin,
    // offerPart with base64 data, offerEnd), GET
    // /__phoenix/dropshare/file?id=N (a file received). Not a POST body:
    // QtWebEngine's requestBody() reads a large one only part way, or
    // blocks.
    void setDropShare(SimDropShare *dropShare) { m_dropShare = dropShare; }

private:
    void dropShare(QWebEngineUrlRequestJob *job, const QString &devicePath);
    void serveFile(QWebEngineUrlRequestJob *job, const QString &devicePath);
    // GET /__phoenix/proxy?req={method, url, headers, body, binary?, follow?}:
    // one HTTP request for the simulated services that talk to servers (DAV
    // accounts, backups to WebDAV, the Marketplace), which servers' CORS
    // rules would refuse from a page; answers {status, headers, url, body |
    // bodyBase64} or {error, code}, as tools/serve-rootfs.py's POST
    // /__phoenix/proxy does. With progress: ID, GET
    // /__phoenix/proxy/progress?id=ID answers {received, total} (total -1
    // when the server did not say) while the body comes, {} after: the
    // simulated download manager's progress.
    void proxy(QWebEngineUrlRequestJob *job);
    void proxyProgress(QWebEngineUrlRequestJob *job);

    const Rootfs *m_rootfs;
    QNetworkAccessManager *m_network = nullptr;
    PictureMaker *m_snapshots = nullptr;
    SimDropShare *m_dropShare = nullptr;
    QHash<QString, QPair<qint64, qint64>> m_progress;   // progress id -> received, total
};
#endif
