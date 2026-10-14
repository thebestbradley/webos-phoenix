// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The simulators running for this user on this computer, for the Window
// menu (SimChrome): each phoenix-sim, whatever checkout or build it came
// from (a 1.0 one from webos-phoenix beside a 2.0 one from
// phoenix-ember-glass-ui, each --instance NAME), lists itself in one
// per-user folder, outside any checkout and any instance's data folder:
// the user's runtime folder (QStandardPaths::RuntimeLocation:
// $XDG_RUNTIME_DIR on Linux, ~/Library/Application Support on a Mac) /
// phoenix-sim-instances. There each has
//   KEY.json  what it is: {name, pid, socket, info: {mode, adaptive, width,
//             height, device, look, checkout, ...}}, rewritten as it changes
//   KEY.sock  a local socket it listens on; "raise\n" asks it to come to
//             the front (raiseRequested). In a folder too deep for a
//             socket's path, in the temporary folder instead
// KEY is its application name: phoenix-sim, or phoenix-sim-NAME for
// --instance NAME (main.cpp), so one instance has one entry.
//
// An entry counts while its socket takes a connection: one a simulator
// left behind when it crashed (its process gone, or its pid reused) is
// dropped, and its files removed. A folder that cannot be written leaves
// this one out of the list (start() is false), but it still lists the
// others and itself. An instance name another live simulator has (the
// one this restarts, still quitting) is waited for: this one lists itself
// once that one is gone.

#pragma once

#include <QList>
#include <QObject>
#include <QString>
#include <QVariantMap>

class QFileSystemWatcher;
class QLocalServer;
class QTimer;

class SimInstances : public QObject
{
    Q_OBJECT
public:
    struct Instance {
        QString key;        // phoenix-sim or phoenix-sim-NAME
        QString name;       // NAME, "" for the default instance
        qint64 pid = 0;
        QVariantMap info;
        bool self = false;  // this process's
    };

    // dir: the folder they list themselves in (defaultDir()); name: this
    // one's --instance, "" for none.
    SimInstances(const QString &dir, const QString &name, QObject *parent = nullptr);
    ~SimInstances() override;

    // The user's runtime folder's phoenix-sim-instances.
    static QString defaultDir();
    // phoenix-sim, or phoenix-sim-NAME.
    static QString keyFor(const QString &name);

    QString dir() const { return m_dir; }
    QString key() const { return m_key; }
    QString name() const { return m_name; }
    bool registered() const { return m_registered; }
    // Its name is another live simulator's: tried again every second.
    bool waiting() const { return m_waiting; }

    // Lists this one (listens on its socket, writes its entry); false if it
    // is not listed now (see above). info: what it is now (setInfo).
    bool start(const QVariantMap &info);
    // What it is now, rewritten in its entry when it changes.
    void setInfo(const QVariantMap &info);
    QVariantMap info() const { return m_info; }

    // The simulators running now, this one among them: the default
    // instance first, then by name. Stale entries are dropped.
    QList<Instance> instances();

    // Asks the simulator listed as key to come to the front; false if it
    // is not there (gone meanwhile) or did not take the message.
    bool raise(const QString &key);

signals:
    // Another simulator asked this one to come to the front.
    void raiseRequested();
    // An entry came, went or changed in the folder.
    void changed();

private:
    bool tryRegister();
    QString socketPath() const;
    bool writeEntry();
    void removeEntry();
    static bool answers(const QString &socket);

    QString m_dir;
    QString m_name;
    QString m_key;
    QVariantMap m_info;
    QLocalServer *m_server = nullptr;
    QFileSystemWatcher *m_watcher = nullptr;
    QTimer *m_retry = nullptr;
    bool m_registered = false;
    bool m_waiting = false;
};
