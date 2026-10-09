// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix Marketplace's catalog service on this computer, started with
// the simulator (--marketplace, the Services menu, the Marketplace's Start
// Local Catalog in the simulator, or every time: Services > Start Catalog
// with the Simulator): server/marketplace/bin/serve.sh, which sets the
// catalog up the first time (its database, signing key, curated web apps
// and a first publish) and serves it at http://127.0.0.1:8088/, where the
// simulator's Marketplace looks
// (apps/marketplace/service/etc/palm/marketplace/sources.json). One that
// is already running (another simulator's) is used as it is; one started
// here stops with the simulator. Its log is server/marketplace/data/simulator.log.
//
// startAsync() never blocks: the state goes stopped -> starting -> running
// (or failed, with the reason in error()), stateChanged() each time; sim.qml
// shows it in the Services menu and passes it to the pages (the runtime's
// org.webosphoenix.simulator). start() waits for the same, for --marketplace
// before the shell loads.

#pragma once

#include <QDeadlineTimer>
#include <QObject>
#include <QPointer>
#include <QProcess>
#include <QString>

class QTcpSocket;
class QTimer;

class SimMarketplace : public QObject
{
    Q_OBJECT
    // "stopped", "starting", "running" or "failed".
    Q_PROPERTY(QString state READ stateName NOTIFY stateChanged)
    // Why it failed (failed), else "".
    Q_PROPERTY(QString error READ error NOTIFY stateChanged)
    Q_PROPERTY(QString url READ url CONSTANT)
    Q_PROPERTY(QString logFile READ logFile CONSTANT)
    // Running, and this simulator started it (and will stop it); running
    // and not owned: another one's.
    Q_PROPERTY(bool ownsServer READ ownsServer NOTIFY stateChanged)
    // Starting for the first time: serve.sh sets the catalog up first
    // (no signing key yet), which takes longer.
    Q_PROPERTY(bool settingUp READ settingUp NOTIFY stateChanged)
public:
    enum State { Stopped, Starting, Running, Failed };
    Q_ENUM(State)

    // Where the simulator's Marketplace reads the catalog (sources.json).
    static constexpr quint16 defaultPort = 8088;

    explicit SimMarketplace(const QString &repoDir, quint16 port = defaultPort, QObject *parent = nullptr);
    ~SimMarketplace() override;

    // Starts the service, or finds it running, without waiting; how long
    // it may take to answer (the first time it sets itself up first).
    Q_INVOKABLE void startAsync(int timeoutMs = 90000);
    // Stops the one this simulator started (an other's goes on: it stays
    // running here). Without waiting: stopped once it has.
    Q_INVOKABLE void stop();
    // startAsync, then waits until it answers or fails. False with error().
    bool start(int timeoutMs = 60000);

    State state() const { return m_state; }
    QString stateName() const;
    QString error() const { return m_error; }
    QString url() const;
    QString logFile() const;
    bool ownsServer() const { return m_state == Running && m_process.state() != QProcess::NotRunning; }
    bool settingUp() const { return m_settingUp; }

signals:
    void stateChanged();

private:
    void setState(State state, const QString &error = QString());
    void probe();
    void launch();
    void onFinished(int exitCode, QProcess::ExitStatus status);
    QString logTail() const;

    QString m_dir;      // server/marketplace
    quint16 m_port;
    QProcess m_process;
    State m_state = Stopped;
    QString m_error;
    bool m_settingUp = false;
    bool m_stopping = false;
    // While starting: a connection tried every 150 ms until one is made or
    // the deadline passes; the first try only looks for one running.
    QTimer *m_poll;
    QPointer<QTcpSocket> m_probe;
    QDeadlineTimer m_deadline;
    bool m_launched = false;
};
