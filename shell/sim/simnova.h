// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Dev push in the simulator (docs/DEV-PUSH.md: `nova push -d sim`, the
// table of section 2 and section 11). phoenix-sim runs the device's novad
// over its own data folder (services/nova/sim.js, with Node), so nova pairs
// with it and pushes to it as to a device:
//
// - SimNova starts sim.js (when Node and the script are there) and stops it
//   with the simulator (its stdin closes). It watches
//   <data>/var/luna/nova/restart.json, where sim.js asks for the restarts a
//   bundle needs, and restarts phoenix-sim for them, opening the app a
//   bundle changed (--launch): the shell, WebAppMgr and a device restart
//   are all one restart here, a few seconds.
// - The files: Rootfs::developerOverlayFile serves the overlay's files
//   first to the pages (phoenix://), and shellWithPushedChanges gives the
//   shell's QML engine a tree with the overlay's QML files and assets
//   (/usr/share/phoenix/qml and assets on a device; shell/qml and
//   shell/assets in the checkout here).
#pragma once

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QFileSystemWatcher>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QObject>
#include <QProcess>
#include <QStandardPaths>

#include <functional>

#include "rootfs.h"
#include "simprocess.h"

class SimNova : public QObject
{
    Q_OBJECT
public:
    SimNova(const Rootfs *rootfs, const QString &repoDir, const QString &instance, SimProcess *process, QObject *parent = nullptr)
        : QObject(parent), m_rootfs(rootfs), m_repoDir(repoDir), m_instance(instance), m_process(process)
    {
    }
    ~SimNova() override { stop(); }

    void start()
    {
        const QString data = m_rootfs->dataDir();
        const QString script = QDir(m_repoDir).filePath(QStringLiteral("services/nova/sim.js"));
        const QString node = QStandardPaths::findExecutable(QStringLiteral("node"));
        if (data.isEmpty() || !QFileInfo::exists(script) || node.isEmpty()) {
            qInfo("phoenix-sim: dev push (nova -d sim) is off: %s", node.isEmpty() ? "Node.js is not installed" : "no services/nova/sim.js");
            return;
        }
        const QString dir = QDir(data).filePath(QStringLiteral("var/luna/nova"));
        QDir().mkpath(dir);
        m_restartFile = QDir(dir).filePath(QStringLiteral("restart.json"));
        m_seenSeq = readRestart().value(QStringLiteral("seq")).toDouble();
        m_watcher.addPath(dir);
        connect(&m_watcher, &QFileSystemWatcher::directoryChanged, this, &SimNova::checkRestart);

        QStringList args = { script, QStringLiteral("--data"), data, QStringLiteral("--repo"), m_repoDir, QStringLiteral("--parent"), QStringLiteral("stdin") };
        if (!m_instance.isEmpty())
            args << QStringLiteral("--instance") << m_instance;
        m_child.setProcessChannelMode(QProcess::ForwardedChannels);
        m_child.start(node, args);
    }

    void stop()
    {
        if (m_child.state() == QProcess::NotRunning)
            return;
        m_child.closeWriteChannel();
        if (!m_child.waitForFinished(2000)) {
            m_child.terminate();
            if (!m_child.waitForFinished(1000))
                m_child.kill();
        }
    }

private:
    QJsonObject readRestart() const
    {
        QFile f(m_restartFile);
        if (!f.open(QIODevice::ReadOnly))
            return {};
        return QJsonDocument::fromJson(f.readAll()).object();
    }

    void checkRestart()
    {
        const QJsonObject r = readRestart();
        const double seq = r.value(QStringLiteral("seq")).toDouble();
        if (seq <= m_seenSeq)
            return;
        m_seenSeq = seq;
        QString app;
        for (const QJsonValue &v : r.value(QStringLiteral("restart")).toArray()) {
            const QString what = v.toString();
            if (what.startsWith(QLatin1String("app:")) && app.isEmpty())
                app = what.mid(4);
        }
        qInfo("phoenix-sim: restarting for the pushed changes (%s)",
              qPrintable(QJsonDocument(r.value(QStringLiteral("restart")).toArray()).toJson(QJsonDocument::Compact)));
        stop();
        if (!app.isEmpty())
            m_process->restartReplacing({ QStringLiteral("launch"), QStringLiteral("scene"), QStringLiteral("open") },
                                        { QStringLiteral("--launch"), app });
        else
            m_process->restart();
    }

    const Rootfs *m_rootfs;
    QString m_repoDir;
    QString m_instance;
    SimProcess *m_process;
    QProcess m_child;
    QFileSystemWatcher m_watcher;
    QString m_restartFile;
    double m_seenSeq = 0;
};

// The boot step a device runs before luna-surfacemanager starts (DEV-PUSH
// 4.2, 4.6): services/nova/sim.js --boot-only clears the overlay after
// Revert to Image and takes the "active" marker away with Developer Mode
// off, so the shell's QML is picked (shellWithPushedChanges) from what the
// overlay holds now, not from before the Revert. -> false where it could not
// run (no Node, no script), when pushed changes are left out.
inline bool bootDeveloperOverlay(const Rootfs *rootfs, const QString &repoDir)
{
    const QString data = rootfs->dataDir();
    const QString script = QDir(repoDir).filePath(QStringLiteral("services/nova/sim.js"));
    const QString node = QStandardPaths::findExecutable(QStringLiteral("node"));
    if (data.isEmpty() || !QFileInfo::exists(script) || node.isEmpty())
        return false;
    QProcess p;
    p.setProcessChannelMode(QProcess::ForwardedChannels);
    p.start(node, { script, QStringLiteral("--data"), data, QStringLiteral("--boot-only") });
    if (!p.waitForFinished(30000)) {
        p.kill();
        p.waitForFinished(1000);
        qWarning("phoenix-sim: the developer overlay's boot step did not finish; pushed changes are left out");
        return false;
    }
    if (p.exitStatus() != QProcess::NormalExit || p.exitCode() != 0) {
        qWarning("phoenix-sim: the developer overlay's boot step failed; pushed changes are left out");
        return false;
    }
    return true;
}

// The shell's QML and assets with the developer overlay's files: when the
// overlay holds any under /usr/share/phoenix/qml or assets, a tree at
// <overlay>/shell/{qml,assets} that links to the checkout's shell/qml and
// shell/assets and has the pushed files in their places, made at start
// (a push restarts the simulator); its qml is then the folder the QML
// engine loads sim.qml and imports from, so a pushed file sits beside its
// module's other files (a QML file finds the types of its own folder) and
// "../assets" still reaches the assets. -> the QML folder to load
inline QString shellWithPushedChanges(const Rootfs *rootfs, const QString &qmlDir, const QString &assetsDir)
{
    const QString base = rootfs->developerOverlayDir();
    const QString upper = base + QStringLiteral("/upper/usr/share/phoenix");
    if (base.isEmpty() || !QFileInfo::exists(base + QStringLiteral("/active"))
        || !(QFileInfo(upper + QStringLiteral("/qml")).isDir() || QFileInfo(upper + QStringLiteral("/assets")).isDir()))
        return qmlDir;
    const QString merged = base + QStringLiteral("/shell");
    QDir(merged).removeRecursively();
    // src (the checkout's) and pushed (the overlay's) at dst: a link to src
    // where nothing under it was pushed, else a folder of the same.
    std::function<bool(const QString &, const QString &, const QString &)> lay =
        [&lay](const QString &src, const QString &pushed, const QString &dst) -> bool {
        const QFileInfo p(pushed);
        if (!p.exists())
            return QFile::link(src, dst);
        if (p.isFile()) {
            const QFileInfo wh(p.absolutePath() + QStringLiteral("/.wh.") + p.fileName());
            return wh.exists() || QFile::copy(pushed, dst);
        }
        if (!QDir().mkpath(dst))
            return false;
        QStringList names = QDir(src).entryList(QDir::AllEntries | QDir::NoDotAndDotDot | QDir::Hidden);
        for (const QString &n : QDir(pushed).entryList(QDir::Files | QDir::Dirs | QDir::NoDotAndDotDot | QDir::Hidden))
            if (!n.startsWith(QLatin1String(".wh.")) && !names.contains(n))
                names << n;
        for (const QString &n : std::as_const(names)) {
            if (QFileInfo::exists(pushed + QStringLiteral("/.wh.") + n))
                continue;
            const QString s = src + QLatin1Char('/') + n, q = pushed + QLatin1Char('/') + n;
            if (!QFileInfo::exists(s) && QFileInfo(q).isFile()) {
                if (!QFile::copy(q, dst + QLatin1Char('/') + n))
                    return false;
            } else if (!lay(s, q, dst + QLatin1Char('/') + n)) {
                return false;
            }
        }
        return true;
    };
    if (!lay(QDir(qmlDir).absolutePath(), upper + QStringLiteral("/qml"), merged + QStringLiteral("/qml"))
        || !lay(QDir(assetsDir).absolutePath(), upper + QStringLiteral("/assets"), merged + QStringLiteral("/assets"))) {
        qWarning("phoenix-sim: could not lay out the pushed shell files in %s; the checkout's are used", qPrintable(merged));
        return qmlDir;
    }
    qInfo("phoenix-sim: the shell has pushed changes (nova push -d sim): %s", qPrintable(merged));
    return merged + QStringLiteral("/qml");
}
