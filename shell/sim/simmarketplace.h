// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix Marketplace's catalog service on this computer, started with
// the simulator (--marketplace, the Services menu, the Marketplace's Start
// Local Catalog in the simulator, or every time: Services > Start Catalog
// with the Simulator): server/marketplace/bin/serve.sh, which sets the
// catalog up the first time (its database, signing key, curated web apps
// and a first publish) and serves it at http://127.0.0.1:8088/, where the
// simulator's Marketplace looks (/etc/palm/phoenix/servers.json).
//
// One catalog per user, shared by every simulator of every checkout
// (docs/APP-STORE.md 3.16): its folder (folder()) is outside the checkouts
// (on a Mac ~/Library/Application Support/Phoenix/catalog, elsewhere
// $XDG_DATA_HOME/phoenix/catalog, or MARKETPLACE_DATA), and serve.sh imports
// a checkout's old server/marketplace/data into it the first time. Given the
// folder the simulators list themselves in (setInstancesDir: SimInstances),
// serve.sh leaves the server running under a watch of its own: it goes on
// while any simulator runs, whichever started it, and stops a few seconds
// after the last one quits or crashes. One already running is used: this
// folder's (its server.json), or one an older simulator started (from its
// own checkout's data; its key is not known here). Without that folder (the
// tests' first half), the server is this simulator's child and stops with it.
//
// startAsync() never blocks: the state goes stopped -> starting -> running
// (or failed, with the reason in error()), stateChanged() each time; sim.qml
// shows it in the Services menu and passes it to the pages (the runtime's
// org.webosphoenix.simulator). start() waits for the same, for --marketplace
// before the shell loads. While it runs it is looked at every few seconds:
// gone (stopped by its watch as this simulator started, or killed), it is
// started again, unless someone stopped it from the menu.
//
// The catalog fills itself (bin/web-apps.py fill, in the background): the
// fill's state is the folder's fill/status.json (fillState, fillText), and
// refill() runs one now.

#pragma once

#include <QDeadlineTimer>
#include <QObject>
#include <QPointer>
#include <QProcess>
#include <QString>

class QFileSystemWatcher;
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
    // The catalog's folder and its log there (simulator.log).
    Q_PROPERTY(QString folder READ folder CONSTANT)
    Q_PROPERTY(QString logFile READ logFile CONSTANT)
    // Running, and this simulator started it.
    Q_PROPERTY(bool ownsServer READ ownsServer NOTIFY stateChanged)
    // Running: "here" (this simulator started it), "shared" (this folder's,
    // started by another simulator or by hand) or "older" (not this
    // folder's: an older simulator's, used as it is); else "".
    Q_PROPERTY(QString origin READ origin NOTIFY stateChanged)
    // Starting for the first time: serve.sh sets the catalog up first
    // (no signing key yet, nor one to import), which takes longer.
    Q_PROPERTY(bool settingUp READ settingUp NOTIFY stateChanged)
    // While it runs: the catalog's public key (base64), read from the
    // catalog's folder on this computer (public/v1/key.json, which its
    // publish writes), not from the network. The simulator's Marketplace
    // trusts it without the fingerprint step (the runtime's defaultSources):
    // whatever answers at 127.0.0.1:8088 must sign its index with this
    // folder's key. "" when there is none (stopped, failed, or an older
    // simulator's catalog: then the user checks its fingerprint as for any
    // catalog).
    Q_PROPERTY(QString key READ key NOTIFY stateChanged)
    // The fill (fill/status.json): "" (none yet), "starting" (asked for
    // here), "running", "done", "offline" (the web apps could not be
    // fetched: the next start tries again), "failed", or "stopped" (it
    // ended before it finished).
    Q_PROPERTY(QString fillState READ fillState NOTIFY fillChanged)
    // What it does now (running), or what it did.
    Q_PROPERTY(QString fillText READ fillText NOTIFY fillChanged)
    // When it finished (ISO 8601, UTC), "" while it runs or before any.
    Q_PROPERTY(QString fillFinished READ fillFinished NOTIFY fillChanged)
public:
    enum State { Stopped, Starting, Running, Failed };
    Q_ENUM(State)

    // Where the simulator's Marketplace reads the catalog (servers.json).
    static constexpr quint16 defaultPort = 8088;

    explicit SimMarketplace(const QString &repoDir, quint16 port = defaultPort, QObject *parent = nullptr);
    ~SimMarketplace() override;

    // The user's one local catalog: MARKETPLACE_DATA, else the platform's
    // (the same as serve.sh's, src/bootstrap.php's and bin/web-apps.py's).
    static QString defaultFolder();

    // The folder the simulators list themselves in (SimInstances::dir()):
    // the catalog started from here outlives this simulator while others
    // run. Before startAsync.
    void setInstancesDir(const QString &dir) { m_instancesDir = dir; }
    // A phoenix-default-apps checkout the fill publishes the 2.0 apps from
    // (the setting marketplace/defaultApps), else the fill's own choice.
    void setDefaultAppsDir(const QString &dir) { m_defaultAppsDir = dir; }

    // Starts the service, or finds it running, without waiting; how long
    // it may take to answer (the first time it sets itself up first).
    Q_INVOKABLE void startAsync(int timeoutMs = 90000);
    // Stops it: the one this simulator's child serves, or the shared one
    // (for every simulator: they do not start it again until asked). An
    // older simulator's goes on (it stays running here). Without waiting.
    Q_INVOKABLE void stop();
    // startAsync, then waits until it answers or fails. False with error().
    bool start(int timeoutMs = 60000);
    // A fill now (bin/web-apps.py fill --force), in the background, beyond
    // this simulator's life; false when it cannot start (no python3).
    Q_INVOKABLE bool refill();

    State state() const { return m_state; }
    QString stateName() const;
    QString error() const { return m_error; }
    QString url() const;
    QString folder() const { return m_folder; }
    QString logFile() const;
    bool ownsServer() const { return m_state == Running && m_origin == QLatin1String("here"); }
    QString origin() const { return m_state == Running ? m_origin : QString(); }
    bool settingUp() const { return m_settingUp; }
    QString key() const;
    QString fillState() const { return m_fillState; }
    QString fillText() const { return m_fillText; }
    QString fillFinished() const { return m_fillFinished; }
    // Whether this computer has the PHP the catalog needs on PATH (for
    // starting it with every run only where it can start).
    static bool phpAvailable();

signals:
    void stateChanged();
    void fillChanged();

private:
    void setState(State state, const QString &error = QString());
    void probe();
    void launch();
    void onFinished(int exitCode, QProcess::ExitStatus status);
    void adopt();
    void checkAlive();
    void readFill();
    void watchFill();
    QString logTail() const;
    // serve.sh leaves the server to its watch (setInstancesDir).
    bool shared() const { return !m_instancesDir.isEmpty(); }
    // server.json: the process serving this folder's catalog on this port;
    // 0 when none is.
    qint64 serverPid() const;
    QString stopMarker() const;

    QString m_dir;      // server/marketplace
    QString m_folder;   // the catalog's
    QString m_instancesDir;
    QString m_defaultAppsDir;
    quint16 m_port;
    QProcess m_process;
    State m_state = Stopped;
    QString m_error;
    QString m_origin;
    bool m_settingUp = false;
    bool m_stopping = false;
    // While starting: a connection tried every 150 ms until one is made or
    // the deadline passes; the first try only looks for one running.
    QTimer *m_poll;
    // While running: is it still there (every 3 s).
    QTimer *m_alive;
    QPointer<QTcpSocket> m_probe;
    QPointer<QTcpSocket> m_aliveProbe;
    QDeadlineTimer m_deadline;
    int m_timeoutMs = 90000;
    bool m_launched = false;
    QFileSystemWatcher *m_fillWatch = nullptr;
    QString m_fillState;
    QString m_fillText;
    QString m_fillFinished;
};
