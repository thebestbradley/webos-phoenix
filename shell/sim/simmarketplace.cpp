// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "simmarketplace.h"

#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QFileInfo>
#include <QHostAddress>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcessEnvironment>
#include <QStandardPaths>
#include <QTcpSocket>
#include <QTimer>

#ifdef Q_OS_LINUX
#include <signal.h>
#include <sys/prctl.h>
#endif

SimMarketplace::SimMarketplace(const QString &repoDir, quint16 port, QObject *parent)
    : QObject(parent)
    , m_dir(QDir(repoDir).filePath(QStringLiteral("server/marketplace")))
    , m_port(port)
    , m_poll(new QTimer(this))
{
    m_poll->setSingleShot(true);
    m_poll->setInterval(150);
    connect(m_poll, &QTimer::timeout, this, &SimMarketplace::probe);
    connect(&m_process, &QProcess::finished, this, &SimMarketplace::onFinished);
    connect(&m_process, &QProcess::errorOccurred, this, [this](QProcess::ProcessError e) {
        if (e == QProcess::FailedToStart && m_state == Starting)
            setState(Failed, QStringLiteral("could not run %1: %2")
                .arg(QDir(m_dir).filePath(QStringLiteral("bin/serve.sh")), m_process.errorString()));
    });
}

SimMarketplace::~SimMarketplace()
{
    m_process.disconnect(this);
    if (m_process.state() == QProcess::NotRunning)
        return;
    m_process.terminate();
    if (!m_process.waitForFinished(3000)) {
        m_process.kill();
        m_process.waitForFinished(1000);
    }
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
    const QString data = qEnvironmentVariable("MARKETPLACE_DATA", QDir(m_dir).filePath(QStringLiteral("data")));
    return QDir(data).filePath(QStringLiteral("simulator.log"));
}

QString SimMarketplace::key() const
{
    if (m_state != Running)
        return {};
    QFile f(QDir(QFileInfo(logFile()).absolutePath()).filePath(QStringLiteral("public/v1/key.json")));
    if (!f.open(QIODevice::ReadOnly))
        return {};
    const QString k = QJsonDocument::fromJson(f.readAll()).object().value(QStringLiteral("key")).toString();
    return QByteArray::fromBase64(k.toLatin1()).size() == 32 ? k : QString();
}

bool SimMarketplace::phpAvailable()
{
    return !QStandardPaths::findExecutable(QStringLiteral("php")).isEmpty();
}

void SimMarketplace::setState(State state, const QString &error)
{
    if (state != Starting)
        m_poll->stop();
    if (state != Starting && m_probe) {
        m_probe->disconnect(this);
        m_probe->deleteLater();
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
    // Already on its way, or ours and running. One found running is looked
    // for again: it may have stopped with its simulator.
    if (m_state == Starting || ownsServer())
        return;
    m_launched = false;
    m_stopping = false;
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
            setState(Running);
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

    const QString log = logFile();
    const QString data = QFileInfo(log).absolutePath();
    QDir().mkpath(data);
    // serve.sh sets the catalog up when it has no signing key yet.
    m_settingUp = !QFileInfo::exists(QDir(data).filePath(QStringLiteral("signing.key")));
    m_process.setWorkingDirectory(m_dir);
    m_process.setStandardOutputFile(log);
    m_process.setProcessChannelMode(QProcess::MergedChannels);
    QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
    env.insert(QStringLiteral("MARKETPLACE_BASE_URL"), url() + QStringLiteral("v1/"));
    m_process.setProcessEnvironment(env);
    // serve.sh ends by exec'ing PHP's server, so stopping this process stops it.
#ifdef Q_OS_LINUX
    // And should the simulator be killed, the server goes too (the parent-
    // death signal outlives the exec). A Mac has no such thing: a server
    // left behind is found running, and used, next time.
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
    const QString tail = logTail();
    setState(Failed, QStringLiteral("the catalog service %1%2")
        .arg(status == QProcess::CrashExit ? QStringLiteral("crashed") : QStringLiteral("stopped with exit code %1").arg(exitCode),
             tail.isEmpty() ? QString() : QStringLiteral(":\n") + tail));
}

void SimMarketplace::stop()
{
    if (m_process.state() != QProcess::NotRunning) {
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
    // Another simulator's goes on, and is used.
    if (m_state == Running)
        return;
    setState(Stopped);
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
