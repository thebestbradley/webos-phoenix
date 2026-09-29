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

private:
    const Rootfs *m_rootfs;
};

#ifdef PHOENIX_HAVE_WEBENGINE
class RootfsSchemeHandler : public QWebEngineUrlSchemeHandler
{
public:
    explicit RootfsSchemeHandler(const Rootfs *rootfs, QObject *parent = nullptr)
        : QWebEngineUrlSchemeHandler(parent), m_rootfs(rootfs) {}

    void requestStarted(QWebEngineUrlRequestJob *job) override;

    // Must run before the QGuiApplication is created.
    static void registerScheme();

private:
    const Rootfs *m_rootfs;
};
#endif
