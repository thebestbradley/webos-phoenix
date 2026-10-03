// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Installing and removing apps in the simulator: what appinstalld does on a
// device (unpack an .ipk into /media/cryptofs/apps). The runtime's
// com.webos.appInstallService unpacks the package in the page and hands
// the app's files here (SimWindowSource, "installApp" host message); they
// go to the Rootfs's installed folder, and the app list is read again.

#pragma once

#include <QObject>
#include <QString>
#include <QVariantList>
#include <QVariantMap>

class Rootfs;

class SimInstaller : public QObject
{
    Q_OBJECT
public:
    explicit SimInstaller(Rootfs *rootfs, QObject *parent = nullptr)
        : QObject(parent), m_rootfs(rootfs) {}

    // files: [{path (relative to the app's folder), data (base64)}], with
    // appinfo.json saying the same id. Replaces an installed app of that id;
    // never a built-in one. "" when done, else what is wrong.
    Q_INVOKABLE QString install(const QString &appId, const QVariantList &files);
    // Removes an installed app. "" when done, else what is wrong.
    Q_INVOKABLE QString remove(const QString &appId);
    // The apps as Rootfs::apps() has them now.
    Q_INVOKABLE QVariantList apps() const;
    // Read the apps again (applicationManager/rescan).
    Q_INVOKABLE void rescan();

    // A launch point an app adds for itself (applicationManager/
    // addLaunchPoint; ApplicationManager::addLaunchPoint): lp is {id (the
    // app), title, appmenu, icon (a device path; relative ones are the
    // app's), params (an object), removable}. Stored as
    // /var/luna/launchpoints/<id>, the id eight random digits as LunaSysMgr
    // made them (findUniqueFileName). -> {launchPointId} or {error}.
    Q_INVOKABLE QVariantMap addLaunchPoint(const QVariantMap &lp);
    // Removes one an app added (removeLaunchPoint): "" when done, else
    // what is wrong, in LunaSysMgr's words.
    Q_INVOKABLE QString removeLaunchPoint(const QString &launchPointId);

    // Free space where apps are installed, in KB (queryInstallCapacity);
    // -1 if unknown.
    Q_INVOKABLE qint64 freeSpaceKB() const;

    static bool validId(const QString &appId);

private:
    Rootfs *m_rootfs;
};
