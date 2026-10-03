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

    // Device path (e.g. /usr/palm/applications/<id>/index.html) -> file.
    QString resolve(const QString &devicePath) const;
    // Each mount's directory paired with each overlay's directory at the
    // same device path, where the overlay has one.
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

    // Launcher entries as maps: id, appId (the app; differs from id for a
    // launch point), title, type, noWindow, main (phoenix:// URL, with
    // ?launchParams= for launch points), params (JSON), tab (-1 = hidden),
    // dir and icon (file URLs, for the shell).
    QVariantList apps() const { return m_apps; }

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
    bool m_valid = false;
    QString m_error;
    QString m_repoDir;
    QStringList m_overlays;                    // searched first
    QStringList m_excluded;                    // never served
    QList<QPair<QString, QString>> m_mounts;   // longest prefix first
    QHash<QString, QString> m_appDirs;         // app id -> directory
    QStringList m_applicationDirs;             // rootfs.json applicationDirs, absolute
    QStringList m_systemApps;                  // rootfs.json systemApps, absolute
    QString m_installedDir;
    QStringList m_installed;                   // ids of installed apps
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

#ifdef PHOENIX_HAVE_WEBENGINE
class QNetworkAccessManager;

class RootfsSchemeHandler : public QWebEngineUrlSchemeHandler
{
public:
    explicit RootfsSchemeHandler(const Rootfs *rootfs, QObject *parent = nullptr)
        : QWebEngineUrlSchemeHandler(parent), m_rootfs(rootfs) {}

    void requestStarted(QWebEngineUrlRequestJob *job) override;

    // Must run before the QGuiApplication is created.
    static void registerScheme();

private:
    // GET /__phoenix/proxy?req={method, url, headers, body, binary?, follow?}:
    // one HTTP request for the simulated services that talk to servers (DAV
    // accounts, backups to WebDAV, the Marketplace), which servers' CORS
    // rules would refuse from a page; answers {status, headers, url, body |
    // bodyBase64} or {error, code}, as tools/serve-rootfs.py's POST
    // /__phoenix/proxy does.
    void proxy(QWebEngineUrlRequestJob *job);

    const Rootfs *m_rootfs;
    QNetworkAccessManager *m_network = nullptr;
};
#endif
