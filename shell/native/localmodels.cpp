// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "localmodels.h"

#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QFileInfo>
#include <QHostAddress>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QProcess>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QTcpServer>
#include <QTimer>
#include <QUrl>

#if defined(Q_OS_MACOS)
#include <sys/sysctl.h>
#include <sys/types.h>
#endif
#if defined(Q_OS_LINUX)
#include <csignal>
#include <sys/prctl.h>
#endif

LocalModels::LocalModels(QObject *parent)
    : QObject(parent)
{
    m_builtInDirs = { QDir(QCoreApplication::applicationDirPath()).filePath(QStringLiteral("models")),
                      QStringLiteral("/usr/share/phoenix/models") };
    m_idle = new QTimer(this);
    m_idle->setSingleShot(true);
    m_idle->setInterval(m_idleMs);
    connect(m_idle, &QTimer::timeout, this, &LocalModels::stop);
    m_poll = new QTimer(this);
    m_poll->setInterval(250);
    connect(m_poll, &QTimer::timeout, this, &LocalModels::pollHealth);
}

LocalModels::~LocalModels()
{
    if (m_reply)
        m_reply->abort();
    if (m_server) {
        m_server->disconnect(this);
        m_server->kill();
        m_server->waitForFinished(2000);
    }
}

void LocalModels::setModelsDir(const QString &d)
{
    if (d == m_dir)
        return;
    m_dir = d;
    emit changed();
}

void LocalModels::setServerCommand(const QStringList &c)
{
    if (c == m_command)
        return;
    m_command = c;
    emit changed();
}

void LocalModels::setIdleMs(int ms)
{
    if (ms == m_idleMs)
        return;
    m_idleMs = ms;
    m_idle->setInterval(ms);
    emit changed();
}

bool LocalModels::running() const
{
    return m_server && m_server->state() != QProcess::NotRunning;
}

QString LocalModels::serverProgram() const
{
    if (!m_command.isEmpty()) {
        const QString p = m_command.first();
        if (QFileInfo(p).isAbsolute())
            return QFileInfo(p).isExecutable() ? p : QString();
        return QStandardPaths::findExecutable(p);
    }
    return QStandardPaths::findExecutable(QStringLiteral("llama-server"));
}

QString LocalModels::fileFor(const QString &id) const
{
    // Ids are the catalogue's (lib/models.js): letters, digits, . _ -.
    QString safe = id;
    safe.replace(QRegularExpression(QStringLiteral("[^A-Za-z0-9._-]")), QStringLiteral("_"));
    return QDir(m_dir).filePath(safe + QStringLiteral(".gguf"));
}

QString LocalModels::builtInFile(const QString &id) const
{
    const QString name = QFileInfo(fileFor(id)).fileName();
    for (const QString &d : m_builtInDirs) {
        const QString f = QDir(d).filePath(name);
        if (QFileInfo::exists(f))
            return f;
    }
    return QString();
}

void LocalModels::setError(const QString &e)
{
    m_error = e;
    emit changed();
}

qint64 LocalModels::totalMemory()
{
#if defined(Q_OS_LINUX)
    QFile f(QStringLiteral("/proc/meminfo"));
    if (f.open(QIODevice::ReadOnly)) {
        const QByteArray all = f.readAll();
        const int i = all.indexOf("MemTotal:");
        if (i >= 0) {
            const QByteArray rest = all.mid(i + 9, 40).trimmed();
            return rest.left(rest.indexOf(' ')).toLongLong() * 1024;
        }
    }
#elif defined(Q_OS_MACOS)
    int64_t mem = 0;
    size_t len = sizeof(mem);
    if (sysctlbyname("hw.memsize", &mem, &len, nullptr, 0) == 0)
        return mem;
#endif
    return 0;
}

QVariantMap LocalModels::status() const
{
    QVariantList installed;
    const QFileInfoList files = QDir(m_dir).entryInfoList({ QStringLiteral("*.gguf") }, QDir::Files, QDir::Name);
    QStringList ids;
    for (const QFileInfo &fi : files) {
        ids << fi.completeBaseName();
        installed.append(QVariantMap{ { QStringLiteral("id"), fi.completeBaseName() },
                                      { QStringLiteral("file"), fi.absoluteFilePath() },
                                      { QStringLiteral("size"), double(fi.size()) } });
    }
    for (const QString &d : m_builtInDirs) {
        for (const QFileInfo &fi : QDir(d).entryInfoList({ QStringLiteral("*.gguf") }, QDir::Files, QDir::Name)) {
            if (ids.contains(fi.completeBaseName()))
                continue;
            ids << fi.completeBaseName();
            installed.append(QVariantMap{ { QStringLiteral("id"), fi.completeBaseName() },
                                          { QStringLiteral("file"), fi.absoluteFilePath() },
                                          { QStringLiteral("size"), double(fi.size()) },
                                          { QStringLiteral("builtIn"), true } });
        }
    }
    QVariantMap st{
        { QStringLiteral("available"), available() },
        { QStringLiteral("server"), serverProgram() },
        { QStringLiteral("running"), running() && !m_baseUrl.isEmpty() },
        { QStringLiteral("model"), m_model },
        { QStringLiteral("error"), m_error },
        { QStringLiteral("ramBytes"), double(totalMemory()) },
        { QStringLiteral("installed"), installed },
    };
    if (!m_downloadId.isEmpty())
        st[QStringLiteral("downloading")] = QVariantMap{ { QStringLiteral("id"), m_downloadId },
                                                         { QStringLiteral("received"), double(m_received) },
                                                         { QStringLiteral("total"), double(m_total) } };
    else
        st[QStringLiteral("downloading")] = QVariant();
    return st;
}

// ---- Downloads ------------------------------------------------------------------------

void LocalModels::download(const QString &id, const QString &url, const QString &sha256, qint64 size)
{
    if (!m_downloadId.isEmpty()) {
        setError(tr("Already downloading %1").arg(m_downloadId));
        return;
    }
    const QUrl u(url);
    if (!u.isValid() || (u.scheme() != QLatin1String("https") && u.scheme() != QLatin1String("http"))) {
        setError(tr("Not a download address: %1").arg(url));
        return;
    }
    QDir().mkpath(m_dir);
    m_part.setFileName(fileFor(id) + QStringLiteral(".part"));
    if (!m_part.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
        setError(tr("Cannot write %1").arg(m_part.fileName()));
        return;
    }
    if (!m_net)
        m_net = new QNetworkAccessManager(this);
    m_hash.reset();
    m_downloadId = id;
    m_downloadSha = sha256.toLower();
    m_received = 0;
    m_total = size;
    m_error.clear();
    QNetworkRequest req(u);
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    req.setHeader(QNetworkRequest::UserAgentHeader, QStringLiteral("webOS-Phoenix-Assistant/0.1"));
    req.setTransferTimeout(60000);   // without data for a minute
    m_reply = m_net->get(req);
    QNetworkReply *reply = m_reply;
    connect(reply, &QNetworkReply::readyRead, this, [this, reply]() {
        if (reply != m_reply)
            return;
        const QByteArray chunk = reply->readAll();
        m_hash.addData(chunk);
        m_part.write(chunk);
        m_received += chunk.size();
    });
    connect(reply, &QNetworkReply::downloadProgress, this, [this, reply](qint64, qint64 total) {
        if (reply == m_reply && total > 0)
            m_total = total;
        emit changed();
    });
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        if (reply != m_reply)
            return;   // cancelled
        m_reply = nullptr;
        const QString id = m_downloadId;
        m_downloadId.clear();
        const QByteArray rest = reply->readAll();
        m_hash.addData(rest);
        m_part.write(rest);
        m_part.close();
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (reply->error() != QNetworkReply::NoError || status != 200) {
            QFile::remove(m_part.fileName());
            setError(tr("%1: %2").arg(id, reply->error() != QNetworkReply::NoError ? reply->errorString()
                                                                                   : QStringLiteral("HTTP %1").arg(status)));
            return;
        }
        const QString sha = QString::fromLatin1(m_hash.result().toHex());
        if (!m_downloadSha.isEmpty() && sha != m_downloadSha) {
            QFile::remove(m_part.fileName());
            setError(tr("%1: the download is damaged (SHA-256)").arg(id));
            return;
        }
        QFile::remove(fileFor(id));
        QFile::rename(m_part.fileName(), fileFor(id));
        setError(QString());
    });
    emit changed();
}

void LocalModels::cancel(const QString &id)
{
    if (m_downloadId != id || !m_reply)
        return;
    QNetworkReply *r = m_reply;
    m_reply = nullptr;
    m_downloadId.clear();
    r->abort();
    m_part.close();
    QFile::remove(m_part.fileName());
    emit changed();
}

void LocalModels::remove(const QString &id)
{
    if (m_model == id)
        stop();
    QFile::remove(fileFor(id));
    emit changed();
}

// ---- The server ------------------------------------------------------------------------

void LocalModels::ensure(const QString &id, const QString &requestId)
{
    if (running() && m_model == id && !m_baseUrl.isEmpty()) {
        m_idle->start();
        const QString url = m_baseUrl;
        QTimer::singleShot(0, this, [this, requestId, url]() { emit ready(requestId, url); });
        return;
    }
    if (running() && m_model == id) {
        m_waiting.append(requestId);   // starting
        return;
    }
    const QString file = QFileInfo::exists(fileFor(id)) ? fileFor(id) : builtInFile(id);
    if (file.isEmpty()) {
        QTimer::singleShot(0, this, [this, requestId, id]() { emit failed(requestId, tr("%1 is not downloaded").arg(id)); });
        return;
    }
    const QString program = serverProgram();
    if (program.isEmpty()) {
        QTimer::singleShot(0, this, [this, requestId]() { emit failed(requestId, tr("llama-server is not installed")); });
        return;
    }
    stop();
    // A free port on the loopback.
    {
        QTcpServer probe;
        probe.listen(QHostAddress::LocalHost, 0);
        m_port = probe.serverPort();
    }
    m_model = id;
    m_baseUrl.clear();
    m_stderr.clear();
    m_waiting = { requestId };
    m_server = new QProcess(this);
    QStringList args = m_command.mid(1);
    // 8,192 tokens: the commands as tools are some 4,900 with the system
    // prompt (4,096 no longer held them: "exceeds the available context
    // size"); one slot, so the tools stay cached between requests; the
    // cache in 8 bits with flash attention, which keeps it as small as
    // 4,096 was (Qwen3 0.6B: 1.3 GB in all, measured; lib/node-device.js
    // the same on a device). Prompts read 512 tokens at a time (-b; the
    // physical batch is 512 anyway): llama-server sees that a request was
    // given up on (the assistant's deadline) only between batches, and with
    // its default 2,048 it went on 46 s for one nobody waited for, the next
    // question queued behind it (measured on a busy 4-core computer; 9 s
    // with 512).
    args << QStringLiteral("-m") << file << QStringLiteral("--host") << QStringLiteral("127.0.0.1")
         << QStringLiteral("--port") << QString::number(m_port) << QStringLiteral("--jinja") << QStringLiteral("-c") << QStringLiteral("8192")
         << QStringLiteral("-np") << QStringLiteral("1") << QStringLiteral("-fa") << QStringLiteral("on")
         << QStringLiteral("-ctk") << QStringLiteral("q8_0") << QStringLiteral("-ctv") << QStringLiteral("q8_0")
         << QStringLiteral("-b") << QStringLiteral("512");
    m_server->setProgram(program);
    m_server->setArguments(args);
    m_server->setProcessChannelMode(QProcess::SeparateChannels);
#if defined(Q_OS_LINUX)
    // It ends with the shell however the shell ends: stop() runs only on a
    // clean exit, and phoenix-sim killed (a test's timeout, xvfb-run gone)
    // left llama-server behind, the model in memory and, mid-request, its
    // cores busy for whatever ran next (several found on a build machine).
    m_server->setChildProcessModifier([]() { ::prctl(PR_SET_PDEATHSIG, SIGTERM); });
#endif
    connect(m_server, &QProcess::readyReadStandardError, this, [this]() {
        if (m_server)
            m_stderr = (m_stderr + QString::fromLocal8Bit(m_server->readAllStandardError())).right(2000);
    });
    connect(m_server, &QProcess::finished, this, [this](int code) {
        const QString last = m_stderr.trimmed().section(QLatin1Char('\n'), -1);
        if (m_baseUrl.isEmpty())
            finishStart(false, tr("llama-server exited (%1): %2").arg(code).arg(last));
        else
            setError(tr("llama-server stopped (%1)").arg(code));
        m_baseUrl.clear();
        m_model.clear();
        emit changed();
    });
    connect(m_server, &QProcess::errorOccurred, this, [this](QProcess::ProcessError e) {
        if (e == QProcess::FailedToStart)
            finishStart(false, tr("llama-server could not start"));
    });
    m_startDeadline = QDateTime::currentMSecsSinceEpoch() + m_startTimeoutMs;
    m_server->start();
    m_poll->start();
    emit changed();
}

void LocalModels::pollHealth()
{
    if (!running() || m_waiting.isEmpty()) {
        m_poll->stop();
        return;
    }
    if (QDateTime::currentMSecsSinceEpoch() > m_startDeadline) {
        finishStart(false, tr("llama-server did not start in time"));
        stop();
        return;
    }
    if (!m_net)
        m_net = new QNetworkAccessManager(this);
    QNetworkRequest req(QUrl(QStringLiteral("http://127.0.0.1:%1/health").arg(m_port)));
    req.setTransferTimeout(1000);
    QNetworkReply *r = m_net->get(req);
    connect(r, &QNetworkReply::finished, this, [this, r]() {
        r->deleteLater();
        if (r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt() == 200 && m_baseUrl.isEmpty() && running()) {
            m_baseUrl = QStringLiteral("http://127.0.0.1:%1/v1").arg(m_port);
            finishStart(true, QString());
        }
    });
}

void LocalModels::finishStart(bool ok, const QString &why)
{
    m_poll->stop();
    const QStringList waiting = m_waiting;
    m_waiting.clear();
    if (ok) {
        m_error.clear();
        m_idle->start();
    } else {
        m_error = why;
    }
    for (const QString &id : waiting) {
        if (ok)
            emit ready(id, m_baseUrl);
        else
            emit failed(id, why);
    }
    emit changed();
}

void LocalModels::stop()
{
    m_idle->stop();
    m_poll->stop();
    if (m_server) {
        QProcess *p = m_server;
        m_server = nullptr;
        p->disconnect(this);
        p->terminate();
        if (!p->waitForFinished(3000))
            p->kill();
        p->deleteLater();
    }
    const QStringList waiting = m_waiting;
    m_waiting.clear();
    for (const QString &id : waiting)
        emit failed(id, tr("stopped"));
    m_model.clear();
    m_baseUrl.clear();
    emit changed();
}
