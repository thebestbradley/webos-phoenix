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

QString LocalModels::partFile(const QString &id, int n, int count) const
{
    if (count <= 1)
        return fileFor(id);
    QString f = fileFor(id);
    f.chop(5);   // ".gguf"
    return f + QStringLiteral("-%1-of-%2.gguf").arg(n, 5, 10, QLatin1Char('0')).arg(count, 5, 10, QLatin1Char('0'));
}

QString LocalModels::modelFile(const QString &dir, const QString &id) const
{
    const QString name = QFileInfo(fileFor(id)).completeBaseName();
    const QString whole = QDir(dir).filePath(name + QStringLiteral(".gguf"));
    if (QFileInfo::exists(whole))
        return whole;
    // In parts: the first, when every one of them is here.
    const QStringList firsts = QDir(dir).entryList({ name + QStringLiteral("-00001-of-*.gguf") }, QDir::Files);
    for (const QString &first : firsts) {
        const int count = first.mid(name.size() + 10, 5).toInt();
        bool all = count > 1;
        for (int n = 2; all && n <= count; ++n)
            all = QFileInfo::exists(QDir(dir).filePath(name + QStringLiteral("-%1-of-%2.gguf").arg(n, 5, 10, QLatin1Char('0'))
                                                       .arg(count, 5, 10, QLatin1Char('0'))));
        if (all)
            return QDir(dir).filePath(first);
    }
    return QString();
}

QString LocalModels::builtInFile(const QString &id) const
{
    for (const QString &d : m_builtInDirs) {
        const QString f = modelFile(d, id);
        if (!f.isEmpty())
            return f;
    }
    return QString();
}

void LocalModels::removeFiles(const QString &id)
{
    const QString name = QFileInfo(fileFor(id)).completeBaseName();
    QFile::remove(fileFor(id));
    for (const QString &f : QDir(m_dir).entryList({ name + QStringLiteral("-0*-of-0*.gguf") }, QDir::Files))
        QFile::remove(QDir(m_dir).filePath(f));
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
    // A model is installed when its file, or every one of its parts, is
    // here; listed once, its size all of them.
    static const QRegularExpression part(QStringLiteral("^(.+)-(\\d{5})-of-(\\d{5})$"));
    QVariantList installed;
    QStringList ids;
    auto scan = [&](const QString &dir, bool builtIn) {
        for (const QFileInfo &fi : QDir(dir).entryInfoList({ QStringLiteral("*.gguf") }, QDir::Files, QDir::Name)) {
            QString id = fi.completeBaseName();
            const QRegularExpressionMatch m = part.match(id);
            if (m.hasMatch()) {
                if (m.captured(2).toInt() != 1)
                    continue;
                id = m.captured(1);
            }
            const QString file = modelFile(dir, id);
            if (ids.contains(id) || file.isEmpty())
                continue;
            qint64 size = 0;
            if (m.hasMatch()) {
                for (const QFileInfo &p : QDir(dir).entryInfoList({ id + QStringLiteral("-0*-of-") + m.captured(3) + QStringLiteral(".gguf") }, QDir::Files))
                    size += p.size();
            } else {
                size = fi.size();
            }
            ids << id;
            QVariantMap e{ { QStringLiteral("id"), id }, { QStringLiteral("file"), file }, { QStringLiteral("size"), double(size) } };
            if (builtIn)
                e[QStringLiteral("builtIn")] = true;
            installed.append(e);
        }
    };
    scan(m_dir, false);
    for (const QString &d : m_builtInDirs)
        scan(d, true);
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
    downloadFrom(id, { QVariantMap{ { QStringLiteral("kind"), QStringLiteral("") },
                                    { QStringLiteral("files"), QVariantList{ QVariantMap{ { QStringLiteral("url"), url },
                                                                                          { QStringLiteral("sha256"), sha256 },
                                                                                          { QStringLiteral("size"), double(size) } } } } } });
}

void LocalModels::downloadFrom(const QString &id, const QVariantList &sources)
{
    if (!m_downloadId.isEmpty()) {
        setError(tr("Already downloading %1").arg(m_downloadId));
        return;
    }
    if (sources.isEmpty()) {
        setError(tr("%1: nowhere to download it from").arg(id));
        return;
    }
    QDir().mkpath(m_dir);
    if (!m_net)
        m_net = new QNetworkAccessManager(this);
    m_downloadId = id;
    m_sources = sources;
    m_source = 0;
    m_file = 0;
    m_doneBytes = 0;
    m_failures.clear();
    m_error.clear();
    startFile();
    emit changed();
}

void LocalModels::startFile()
{
    const QVariantMap src = m_sources.value(m_source).toMap();
    const QVariantList files = src.value(QStringLiteral("files")).toList();
    if (m_file == 0) {
        m_total = 0;
        for (const QVariant &f : files)
            m_total += qint64(f.toMap().value(QStringLiteral("size")).toDouble());
        m_doneBytes = 0;
    }
    m_received = m_doneBytes;
    const QVariantMap file = files.value(m_file).toMap();
    const QUrl u(file.value(QStringLiteral("url")).toString());
    if (files.isEmpty() || !u.isValid() || (u.scheme() != QLatin1String("https") && u.scheme() != QLatin1String("http"))) {
        fileFailed(tr("not a download address: %1").arg(u.toString()));
        return;
    }
    m_part.setFileName(partFile(m_downloadId, m_file + 1, files.size()) + QStringLiteral(".part"));
    if (!m_part.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
        fileFailed(tr("cannot write %1").arg(m_part.fileName()));
        return;
    }
    m_hash.reset();
    m_downloadSha = file.value(QStringLiteral("sha256")).toString().toLower();
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
        if (reply != m_reply)
            return;
        if (m_total <= 0 && total > 0)   // no size given: the server's
            m_total = m_doneBytes + total;
        emit changed();
    });
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        if (reply != m_reply)
            return;   // cancelled
        m_reply = nullptr;
        const QByteArray rest = reply->readAll();
        m_hash.addData(rest);
        m_part.write(rest);
        m_received += rest.size();
        m_part.close();
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (reply->error() != QNetworkReply::NoError || status != 200) {
            QFile::remove(m_part.fileName());
            fileFailed(reply->error() != QNetworkReply::NoError ? reply->errorString() : QStringLiteral("HTTP %1").arg(status));
            return;
        }
        const QString sha = QString::fromLatin1(m_hash.result().toHex());
        if (!m_downloadSha.isEmpty() && sha != m_downloadSha) {
            QFile::remove(m_part.fileName());
            fileFailed(tr("the download is damaged (SHA-256)"));
            return;
        }
        const QString done = m_part.fileName().chopped(5);   // ".part"
        QFile::remove(done);
        QFile::rename(m_part.fileName(), done);
        const int count = m_sources.value(m_source).toMap().value(QStringLiteral("files")).toList().size();
        m_doneBytes = m_received;
        if (++m_file < count) {
            startFile();
            return;
        }
        m_downloadId.clear();
        m_sources.clear();
        setError(QString());
    });
}

// A file of this source did not come: its parts go, and the next source is
// tried; when none is left, the error says what each one did.
void LocalModels::fileFailed(const QString &why)
{
    const QVariantMap src = m_sources.value(m_source).toMap();
    const QString kind = src.value(QStringLiteral("kind")).toString();
    const int count = src.value(QStringLiteral("files")).toList().size();
    for (int n = 1; n <= count; ++n)
        QFile::remove(partFile(m_downloadId, n, count));
    m_failures << (kind.isEmpty() ? why : kind + QStringLiteral(": ") + why);
    if (++m_source < m_sources.size()) {
        m_file = 0;
        startFile();
        return;
    }
    const QString id = m_downloadId;
    m_downloadId.clear();
    m_sources.clear();
    setError(tr("%1: %2").arg(id, m_failures.join(QStringLiteral("; "))));
}

void LocalModels::cancel(const QString &id)
{
    if (m_downloadId != id || !m_reply)
        return;
    QNetworkReply *r = m_reply;
    m_reply = nullptr;
    m_downloadId.clear();
    const int count = m_sources.value(m_source).toMap().value(QStringLiteral("files")).toList().size();
    m_sources.clear();
    r->abort();
    m_part.close();
    QFile::remove(m_part.fileName());
    for (int n = 1; n <= count; ++n)
        QFile::remove(partFile(id, n, count));
    emit changed();
}

void LocalModels::remove(const QString &id)
{
    if (m_model == id)
        stop();
    removeFiles(id);
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
    QString file = modelFile(m_dir, id);
    if (file.isEmpty())
        file = builtInFile(id);
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
    // 4,096 tokens with the default 16-bit cache: the on-device model gets
    // one tool at a time and a shared prompt of some 1,400 tokens
    // (apps/assistant/service/assistant.js localPrefix, which holds the
    // conversation it sees to the rest), and this reads a prompt twice as
    // fast as the 8,192 tokens in 8 bits it had (200 against 100 tokens a
    // second for Qwen3 0.6B on a 4-core computer) in the same memory (1.83
    // against 1.86 GB; docs/AI-AND-MCP.md). One slot, so its prompt is kept
    // between requests; flash attention. Prompts read 512 tokens at a time
    // (-b; the physical batch is 512 anyway): llama-server sees that a
    // request was given up on (the assistant's deadline) only between
    // batches, and with its default 2,048 it went on 46 s for one nobody
    // waited for, the next question queued behind it (measured on a busy
    // 4-core computer; 9 s with 512). lib/node-device.js the same on a device.
    args << QStringLiteral("-m") << file << QStringLiteral("--host") << QStringLiteral("127.0.0.1")
         << QStringLiteral("--port") << QString::number(m_port) << QStringLiteral("--jinja") << QStringLiteral("-c") << QStringLiteral("4096")
         << QStringLiteral("-np") << QStringLiteral("1") << QStringLiteral("-fa") << QStringLiteral("on")
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
