// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "simmarketplace.h"

#include <QDeadlineTimer>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QHostAddress>
#include <QProcessEnvironment>
#include <QStandardPaths>
#include <QTcpSocket>
#include <QThread>

#ifdef Q_OS_LINUX
#include <signal.h>
#include <sys/prctl.h>
#endif

SimMarketplace::SimMarketplace(const QString &repoDir, quint16 port)
    : m_dir(QDir(repoDir).filePath(QStringLiteral("server/marketplace")))
    , m_port(port)
{
}

SimMarketplace::~SimMarketplace()
{
    if (m_process.state() == QProcess::NotRunning)
        return;
    m_process.terminate();
    if (!m_process.waitForFinished(3000)) {
        m_process.kill();
        m_process.waitForFinished(1000);
    }
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

bool SimMarketplace::answers(int timeoutMs) const
{
    QTcpSocket socket;
    socket.connectToHost(QHostAddress(QHostAddress::LocalHost), m_port);
    return socket.waitForConnected(timeoutMs);
}

bool SimMarketplace::start(int timeoutMs)
{
    m_error.clear();
    if (answers(300))
        return true;

    const QString serve = QDir(m_dir).filePath(QStringLiteral("bin/serve.sh"));
    if (!QFile::exists(serve)) {
        m_error = QStringLiteral("%1 is missing").arg(serve);
        return false;
    }
    if (QStandardPaths::findExecutable(QStringLiteral("php")).isEmpty()) {
#ifdef Q_OS_MACOS
        m_error = QStringLiteral("PHP 8 is needed: brew install php (or scripts/mac-setup.sh)");
#else
        m_error = QStringLiteral("PHP 8 with sodium and pdo_sqlite is needed: sudo apt install php-cli php-sqlite3 (or scripts/linux-setup.sh)");
#endif
        return false;
    }

    const QString log = logFile();
    QDir().mkpath(QFileInfo(log).absolutePath());
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
    if (!m_process.waitForStarted(5000)) {
        m_error = QStringLiteral("could not run %1: %2").arg(serve, m_process.errorString());
        return false;
    }

    const QDeadlineTimer deadline(timeoutMs);
    while (!deadline.hasExpired()) {
        if (m_process.waitForFinished(0) || m_process.state() == QProcess::NotRunning) {
            QFile f(log);
            const QString tail = f.open(QIODevice::ReadOnly)
                ? QString::fromUtf8(f.readAll().right(2000)).trimmed() : QString();
            m_error = QStringLiteral("the catalog service stopped (exit code %1)%2")
                .arg(m_process.exitCode())
                .arg(tail.isEmpty() ? QString() : QStringLiteral(":\n") + tail);
            return false;
        }
        if (answers(200))
            return true;
        QThread::msleep(100);
    }
    m_error = QStringLiteral("the catalog service did not answer at %1 within %2 s (see %3)")
        .arg(url()).arg(timeoutMs / 1000).arg(log);
    return false;
}
