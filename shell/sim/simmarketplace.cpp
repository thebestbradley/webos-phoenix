// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "simmarketplace.h"

#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QFileInfo>
#include <QFileSystemWatcher>
#include <QHostAddress>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcessEnvironment>
#include <QStandardPaths>
#include <QTcpSocket>
#include <QTimer>

#include <cerrno>
#include <csignal>

#ifdef Q_OS_LINUX
#include <sys/prctl.h>
#endif

namespace {

// A process by its id: there (kill with no signal; EPERM: someone else's).
bool processAlive(qint64 pid)
{
    if (pid <= 0)
        return false;
    return ::kill(static_cast<pid_t>(pid), 0) == 0 || errno == EPERM;
}

QJsonObject readJson(const QString &path)
{
    QFile f(path);
    if (!f.open(QIODevice::ReadOnly))
        return {};
    return QJsonDocument::fromJson(f.readAll()).object();
}

} // namespace

SimMarketplace::SimMarketplace(const QString &repoDir, quint16 port, QObject *parent)
    : QObject(parent)
    , m_dir(QDir(repoDir).filePath(QStringLiteral("server/marketplace")))
    , m_folder(defaultFolder())
    , m_port(port)
    , m_poll(new QTimer(this))
    , m_alive(new QTimer(this))
{
    m_poll->setSingleShot(true);
    m_poll->setInterval(150);
    connect(m_poll, &QTimer::timeout, this, &SimMarketplace::probe);
    m_alive->setInterval(3000);
    connect(m_alive, &QTimer::timeout, this, &SimMarketplace::checkAlive);
    connect(&m_process, &QProcess::finished, this, &SimMarketplace::onFinished);
    connect(&m_process, &QProcess::errorOccurred, this, [this](QProcess::ProcessError e) {
        if (e == QProcess::FailedToStart && m_state == Starting)
            setState(Failed, QStringLiteral("could not run %1: %2")
                .arg(QDir(m_dir).filePath(QStringLiteral("bin/serve.sh")), m_process.errorString()));
    });
    readFill();
}

// The fill's state, as it changes (whoever runs it), once the catalog is
// wanted here.
void SimMarketplace::watchFill()
{
    if (m_fillWatch)
        return;
    const QString fillDir = QDir(m_folder).filePath(QStringLiteral("fill"));
    if (!QDir().mkpath(fillDir))
        return;
    m_fillWatch = new QFileSystemWatcher(QStringList { fillDir }, this);
    connect(m_fillWatch, &QFileSystemWatcher::directoryChanged, this, &SimMarketplace::readFill);
    readFill();
}

SimMarketplace::~SimMarketplace()
{
    m_process.disconnect(this);
    // A server left to its watch goes on while other simulators run (the
    // watch stops it once none is left); only one serve.sh still setting up,
    // or the server this simulator's child is, stops here.
    if (m_process.state() == QProcess::NotRunning)
        return;
    m_process.terminate();
    if (!m_process.waitForFinished(3000)) {
        m_process.kill();
        m_process.waitForFinished(1000);
    }
}

QString SimMarketplace::defaultFolder()
{
    const QString data = qEnvironmentVariable("MARKETPLACE_DATA");
    if (!data.isEmpty())
        return QDir(data).absolutePath();
#ifdef Q_OS_MACOS
    return QDir::homePath() + QStringLiteral("/Library/Application Support/Phoenix/catalog");
#else
    const QString xdg = qEnvironmentVariable("XDG_DATA_HOME");
    return QDir(xdg.isEmpty() ? QDir::homePath() + QStringLiteral("/.local/share") : xdg).filePath(QStringLiteral("phoenix/catalog"));
#endif
}

QString SimMarketplace::stateName() const
{
    switch (m_state) {
    case Starting: return QStringLiteral("starting");
    case Running: return QStringLiteral("running");
    case Failed: return QStringLiteral("failed");
    case Stopped: break;
    }
    return QStringLiteral("stopped");
}

QString SimMarketplace::url() const
{
    return QStringLiteral("http://127.0.0.1:%1/").arg(m_port);
}

QString SimMarketplace::logFile() const
{
    return QDir(m_folder).filePath(QStringLiteral("simulator.log"));
}

QString SimMarketplace::stopMarker() const
{
    return QDir(m_folder).filePath(QStringLiteral("server.stopped"));
}

QString SimMarketplace::key() const
{
    if (m_state != Running || m_origin == QLatin1String("older"))
        return {};
    const QString k = readJson(QDir(m_folder).filePath(QStringLiteral("public/v1/key.json"))).value(QStringLiteral("key")).toString();
    return QByteArray::fromBase64(k.toLatin1()).size() == 32 ? k : QString();
}

bool SimMarketplace::phpAvailable()
{
    return !QStandardPaths::findExecutable(QStringLiteral("php")).isEmpty();
}

qint64 SimMarketplace::serverPid() const
{
    const QJsonObject s = readJson(QDir(m_folder).filePath(QStringLiteral("server.json")));
    const qint64 pid = s.value(QStringLiteral("pid")).toInteger();
    return s.value(QStringLiteral("port")).toInt() == m_port && processAlive(pid) ? pid : 0;
}

void SimMarketplace::setState(State state, const QString &error)
{
    if (state != Starting)
        m_poll->stop();
    if (state != Starting && m_probe) {
        m_probe->disconnect(this);
        m_probe->deleteLater();
    }
    if (state == Running) {
        m_alive->start();
        watchFill();
    } else {
        m_alive->stop();
    }
    if (state == m_state && error == m_error)
        return;
    m_state = state;
    m_error = error;
    if (state != Starting)
        m_settingUp = false;
    emit stateChanged();
}

void SimMarketplace::startAsync(int timeoutMs)
{
    // Already on its way, or this simulator's child serving it. One found
    // running is looked for again: it may have stopped meanwhile.
    if (m_state == Starting || (m_state == Running && !shared() && m_process.state() != QProcess::NotRunning))
        return;
    // This simulator wants it: a stop from the menu no longer holds.
    QFile::remove(stopMarker());
    m_launched = false;
    m_stopping = false;
    m_timeoutMs = timeoutMs;
    m_deadline = QDeadlineTimer(timeoutMs);
    setState(Starting);
    probe();
}

// One connection to the port: it answers (running), or not yet (serve.sh
// is started the first time, then tried again until the deadline).
void SimMarketplace::probe()
{
    if (m_state != Starting)
        return;
    if (m_probe) {
        m_probe->disconnect(this);
        m_probe->deleteLater();
    }
    auto *socket = new QTcpSocket(this);
    m_probe = socket;
    // A connection that neither opens nor fails (a port that drops what
    // comes) counts as not answering: every try ends within a second.
    auto *giveUp = new QTimer(socket);
    giveUp->setSingleShot(true);
    connect(socket, &QTcpSocket::connected, this, [this, socket, giveUp]() {
        giveUp->stop();
        socket->disconnect(this);
        socket->deleteLater();
        if (m_state == Starting)
            adopt();
    });
    const auto notYet = [this, socket, giveUp]() {
        giveUp->stop();
        socket->disconnect(this);
        socket->abort();
        socket->deleteLater();
        if (m_state != Starting)
            return;
        if (!m_launched) {
            launch();
        } else if (m_deadline.hasExpired()) {
            setState(Failed, QStringLiteral("the catalog service did not answer at %1 in time (see %2)").arg(url(), logFile()));
            stop();
        } else {
            m_poll->start();
        }
    };
    connect(socket, &QTcpSocket::errorOccurred, this, notYet);
    connect(giveUp, &QTimer::timeout, this, notYet);
    giveUp->start(1000);
    socket->connectToHost(QHostAddress(QHostAddress::LocalHost), m_port);
}

// It answers: whose is it? Started here, this folder's (its server.json:
// another simulator's, or serve.sh run by hand), or neither (an older
// simulator's, serving its own checkout's catalog).
void SimMarketplace::adopt()
{
    if (m_launched)
        m_origin = QStringLiteral("here");
    else if (serverPid())
        m_origin = QStringLiteral("shared");
    else
        m_origin = QStringLiteral("older");
    setState(Running);
}

void SimMarketplace::launch()
{
    m_launched = true;
    const QString serve = QDir(m_dir).filePath(QStringLiteral("bin/serve.sh"));
    if (!QFile::exists(serve)) {
        setState(Failed, QStringLiteral("%1 is missing").arg(serve));
        return;
    }
    if (QStandardPaths::findExecutable(QStringLiteral("php")).isEmpty()) {
#ifdef Q_OS_MACOS
        setState(Failed, QStringLiteral("PHP 8 is needed: brew install php (./phoenix installs it)"));
#else
        setState(Failed, QStringLiteral("PHP 8 with sodium and pdo_sqlite is needed: sudo apt install php-cli php-sqlite3 (./phoenix installs it)"));
#endif
        return;
    }

    QDir().mkpath(m_folder);
    // serve.sh sets the catalog up when it has no signing key yet, nor a
    // checkout's old catalog to import.
    m_settingUp = !QFileInfo::exists(QDir(m_folder).filePath(QStringLiteral("signing.key")))
        && !QFileInfo::exists(QDir(m_dir).filePath(QStringLiteral("data/signing.key")));
    // The catalog's log: everything that serves or fills it appends to it.
    // Nothing serves it now: it starts empty.
    const QString log = logFile();
    {
        QFile f(log);
        if (f.open(QIODevice::WriteOnly | QIODevice::Truncate))
            f.close();
    }
    m_process.setWorkingDirectory(m_dir);
    m_process.setStandardOutputFile(log, QIODevice::Append);
    m_process.setProcessChannelMode(QProcess::MergedChannels);
    QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
    env.insert(QStringLiteral("MARKETPLACE_BASE_URL"), url() + QStringLiteral("v1/"));
    env.insert(QStringLiteral("MARKETPLACE_DATA"), m_folder);
    if (shared())
        env.insert(QStringLiteral("PHOENIX_SIM_INSTANCES"), m_instancesDir);
    if (!m_defaultAppsDir.isEmpty())
        env.insert(QStringLiteral("PHOENIX_DEFAULT_APPS"), m_defaultAppsDir);
    m_process.setProcessEnvironment(env);
#ifdef Q_OS_LINUX
    // Without the simulators' folder serve.sh ends by exec'ing PHP's
    // server, which is then this simulator's: should the simulator be
    // killed, the server goes too (the parent-death signal outlives the
    // exec). Shared, serve.sh hands the server to its watch and returns
    // (the signal is not passed on to its children); killed while it sets
    // up, it stops.
    m_process.setChildProcessModifier([] { ::prctl(PR_SET_PDEATHSIG, SIGTERM); });
#endif
    m_process.start(QStringLiteral("/bin/sh"), { serve, QString::number(m_port) });
    // settingUp changed: the menu says so.
    emit stateChanged();
    m_poll->start();
}

QString SimMarketplace::logTail() const
{
    QFile f(logFile());
    return f.open(QIODevice::ReadOnly) ? QString::fromUtf8(f.readAll().right(2000)).trimmed() : QString();
}

void SimMarketplace::onFinished(int exitCode, QProcess::ExitStatus status)
{
    if (m_stopping) {
        m_stopping = false;
        if (m_state != Failed)
            setState(Stopped);
        return;
    }
    if (m_state != Starting && m_state != Running)
        return;
    // Shared: serve.sh set the catalog up and left the server to its watch.
    if (shared() && status == QProcess::NormalExit && exitCode == 0)
        return;
    const QString tail = logTail();
    setState(Failed, QStringLiteral("the catalog service %1%2")
        .arg(status == QProcess::CrashExit ? QStringLiteral("crashed") : QStringLiteral("stopped with exit code %1").arg(exitCode),
             tail.isEmpty() ? QString() : QStringLiteral(":\n") + tail));
}

void SimMarketplace::stop()
{
    if (!shared() && m_process.state() != QProcess::NotRunning) {
        m_stopping = true;
        m_poll->stop();
        m_process.terminate();
        // PHP's server goes on SIGTERM; should it not, it is killed.
        QTimer::singleShot(3000, &m_process, [this]() {
            if (m_process.state() != QProcess::NotRunning)
                m_process.kill();
        });
        return;
    }
    // An older simulator's goes on, and is used.
    if (m_state == Running && m_origin == QLatin1String("older"))
        return;
    if (shared() && (m_state == Running || m_state == Starting)) {
        // The shared one stops for every simulator; they do not start it
        // again (stopMarker) until one is asked to.
        QFile marker(stopMarker());
        if (marker.open(QIODevice::WriteOnly))
            marker.close();
        if (m_process.state() != QProcess::NotRunning)
            m_process.terminate();
        if (const qint64 pid = serverPid())
            ::kill(static_cast<pid_t>(pid), SIGTERM);
    }
    setState(Stopped);
}

// While it runs: still there? Gone without a stop from the menu (its
// watch stopped it as this simulator started, someone killed it, the older
// simulator serving it quit), it is started again, from this folder.
void SimMarketplace::checkAlive()
{
    readFill();
    // Not shared (the tests' first half): this simulator's child, or one
    // found running, as before the catalog was shared.
    if (!shared() || m_state != Running || m_aliveProbe)
        return;
    auto *socket = new QTcpSocket(this);
    m_aliveProbe = socket;
    auto *giveUp = new QTimer(socket);
    giveUp->setSingleShot(true);
    connect(socket, &QTcpSocket::connected, this, [this, socket, giveUp]() {
        giveUp->stop();
        socket->disconnect(this);
        socket->deleteLater();
        // Whose it is may have changed (an older simulator's gone and this
        // folder's started by another simulator).
        if (m_state == Running && m_origin == QLatin1String("older") && serverPid()) {
            m_origin = QStringLiteral("shared");
            emit stateChanged();
        }
    });
    const auto gone = [this, socket, giveUp]() {
        giveUp->stop();
        socket->disconnect(this);
        socket->abort();
        socket->deleteLater();
        if (m_state != Running)
            return;
        if (QFileInfo::exists(stopMarker())) {
            setState(Stopped);
            return;
        }
        startAsync(m_timeoutMs);
    };
    connect(socket, &QTcpSocket::errorOccurred, this, gone);
    connect(giveUp, &QTimer::timeout, this, gone);
    giveUp->start(1500);
    socket->connectToHost(QHostAddress(QHostAddress::LocalHost), m_port);
}

void SimMarketplace::readFill()
{
    const QJsonObject s = readJson(QDir(m_folder).filePath(QStringLiteral("fill/status.json")));
    QString state = s.value(QStringLiteral("state")).toString();
    QString text = state == QLatin1String("running") ? s.value(QStringLiteral("now")).toString() : s.value(QStringLiteral("text")).toString();
    // One that stopped before it finished (killed, the computer slept).
    if (state == QLatin1String("running") && !processAlive(s.value(QStringLiteral("pid")).toInteger())) {
        state = QStringLiteral("stopped");
        text = QStringLiteral("it stopped before it finished");
    }
    // A refill asked for here that has not written its state yet.
    if (state != QLatin1String("running") && m_fillState == QLatin1String("starting"))
        return;
    const QString finished = s.value(QStringLiteral("finished")).toString();
    if (state == m_fillState && text == m_fillText && finished == m_fillFinished)
        return;
    m_fillState = state;
    m_fillText = text;
    m_fillFinished = finished;
    emit fillChanged();
}

bool SimMarketplace::refill()
{
    watchFill();
    const QString python = QStandardPaths::findExecutable(QStringLiteral("python3"));
    const QString script = QDir(m_dir).filePath(QStringLiteral("bin/web-apps.py"));
    if (python.isEmpty() || !QFile::exists(script)) {
        m_fillState = QStringLiteral("failed");
        m_fillText = python.isEmpty() ? QStringLiteral("python3 is needed to fill the catalog") : script + QStringLiteral(" is missing");
        emit fillChanged();
        return false;
    }
    QProcess p;
    p.setProgram(python);
    p.setArguments({ QStringLiteral("-I"), script, QStringLiteral("fill"), QStringLiteral("--force") });
    p.setWorkingDirectory(m_dir);
    QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
    env.insert(QStringLiteral("MARKETPLACE_DATA"), m_folder);
    env.insert(QStringLiteral("MARKETPLACE_BASE_URL"), url() + QStringLiteral("v1/"));
    if (!m_defaultAppsDir.isEmpty())
        env.insert(QStringLiteral("PHOENIX_DEFAULT_APPS"), m_defaultAppsDir);
    p.setProcessEnvironment(env);
    p.setStandardInputFile(QProcess::nullDevice());
    p.setStandardOutputFile(logFile(), QIODevice::Append);
    p.setStandardErrorFile(logFile(), QIODevice::Append);
    // On its own: it goes on (and publishes what it fetched) should this
    // simulator quit.
    if (!p.startDetached()) {
        m_fillState = QStringLiteral("failed");
        m_fillText = QStringLiteral("could not run %1").arg(script);
        emit fillChanged();
        return false;
    }
    m_fillState = QStringLiteral("starting");
    m_fillText = QStringLiteral("starting");
    m_fillFinished.clear();
    emit fillChanged();
    // Its state comes in fill/status.json; should it end before it writes
    // one (another fill runs), the file says what that one does.
    QTimer::singleShot(10000, this, [this]() {
        if (m_fillState == QLatin1String("starting")) {
            m_fillState.clear();
            readFill();
        }
    });
    return true;
}

bool SimMarketplace::start(int timeoutMs)
{
    startAsync(timeoutMs);
    if (m_state == Starting) {
        QEventLoop loop;
        connect(this, &SimMarketplace::stateChanged, &loop, [this, &loop]() {
            if (m_state != Starting)
                loop.quit();
        });
        // The deadline ends it as failed; this only makes sure the wait
        // ends whatever happens.
        QTimer::singleShot(timeoutMs + 5000, &loop, &QEventLoop::quit);
        loop.exec();
    }
    if (m_state == Starting) {
        setState(Failed, QStringLiteral("the catalog service did not answer at %1 in time (see %2)").arg(url(), logFile()));
        stop();
    }
    return m_state == Running;
}
