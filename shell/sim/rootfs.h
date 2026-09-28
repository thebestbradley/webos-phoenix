// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The virtual webOS filesystem (runtime/rootfs.json) and the phoenix://
// URL scheme that serves it to web apps in the simulator.

#pragma once

#include <QHash>
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

    // Installed apps as maps: id, title, type, noWindow, main (phoenix:// URL)
    // and icon (file URL, for the shell).
    QVariantList apps() const { return m_apps; }

    static QString scheme() { return QStringLiteral("phoenix"); }
    static QString urlFor(const QString &devicePath);

private:
    bool m_valid = false;
    QString m_error;
    QString m_repoDir;
    QStringList m_overlays;                    // searched first
    QList<QPair<QString, QString>> m_mounts;   // longest prefix first
    QHash<QString, QString> m_appDirs;         // app id -> directory
    QVariantList m_apps;
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
