// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "simdropshare.h"

#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkInterface>
#include <QRandomGenerator>
#include <QRegularExpression>
#include <QTcpServer>
#include <QTcpSocket>
#include <QUrl>
#include <QUrlQuery>

struct SimDropShare::Conn {
    QByteArray head;
    bool headersDone = false;
    QByteArray method;
    QString path;
    QUrlQuery query;
    qint64 length = -1;
    qint64 got = 0;
    QFile *upload = nullptr;
    int entry = -1;
    // Sending a file in pieces as the socket takes them.
    QFile *sending = nullptr;
    int sendingEntry = -1;
};

static const int kChunk = 64 * 1024;

SimDropShare::SimDropShare(std::function<QByteArray(const QString &)> pages, QObject *parent)
    : QObject(parent), m_pages(std::move(pages))
{
    m_idle.setSingleShot(true);
    connect(&m_idle, &QTimer::timeout, this, [this]() { stop(QStringLiteral("timeout")); });
}

SimDropShare::~SimDropShare()
{
    stop();
}

QString SimDropShare::cleanName(const QString &name)
{
    QString n = QFileInfo(name).fileName();
    n.replace(QRegularExpression(QStringLiteral("[\\\\/:*?\"<>|\\x00-\\x1f]")), QStringLiteral("_"));
    n = n.trimmed();
    while (n.startsWith(QLatin1Char('.')))
        n.remove(0, 1);
    if (n.isEmpty())
        n = QStringLiteral("file");
    return n.left(200);
}

QString SimDropShare::uniqueName(const QString &name) const
{
    QString n = cleanName(name);
    auto taken = [this](const QString &x) {
        for (const Entry &e : m_files)
            if (e.name == x)
                return true;
        return false;
    };
    if (!taken(n))
        return n;
    const QFileInfo fi(n);
    const QString base = fi.completeBaseName(), ext = fi.suffix();
    for (int i = 2;; ++i) {
        const QString x = ext.isEmpty() ? QStringLiteral("%1 (%2)").arg(base).arg(i)
                                        : QStringLiteral("%1 (%2).%3").arg(base).arg(i).arg(ext);
        if (!taken(x))
            return x;
    }
}

QVariantMap SimDropShare::start(const QVariantMap &options)
{
    const QString mode = options.value(QStringLiteral("mode")).toString();
    if (mode != QLatin1String("receive") && mode != QLatin1String("send"))
        return { { QStringLiteral("returnValue"), false }, { QStringLiteral("errorText"), QStringLiteral("mode is receive or send") } };
    if (mode == QLatin1String("send") && m_files.isEmpty())
        return { { QStringLiteral("returnValue"), false }, { QStringLiteral("errorText"), QStringLiteral("Nothing to send") } };
    // A new session: a new token, a new port. Files offered stay for "send".
    if (m_server) {
        m_server->close();
        m_server->deleteLater();
        m_server = nullptr;
    }
    for (QTcpSocket *s : m_conns.keys())
        s->abort();
    if (mode == QLatin1String("receive")) {
        m_files.clear();
        m_dir.reset();
    }
    if (!m_dir)
        m_dir = std::make_unique<QTemporaryDir>();
    m_server = new QTcpServer(this);
    connect(m_server, &QTcpServer::newConnection, this, &SimDropShare::onConnection);
    // Every network the computer is on (the LAN), on a port of its own.
    if (!m_server->listen(QHostAddress::Any, 0)) {
        m_error = m_server->errorString();
        setState(QStringLiteral("failed"));
        return { { QStringLiteral("returnValue"), false }, { QStringLiteral("errorText"), m_error } };
    }
    QByteArray bytes(16, 0);
    for (int i = 0; i < bytes.size(); ++i)
        bytes[i] = char(QRandomGenerator::system()->bounded(256));
    m_token = QString::fromLatin1(bytes.toBase64(QByteArray::Base64UrlEncoding | QByteArray::OmitTrailingEquals));
    m_mode = mode;
    m_offering = false;
    m_sessionBytes = 0;
    m_error.clear();

    QHostAddress host = advertise;
    if (host.isNull()) {
        for (const QNetworkInterface &nif : QNetworkInterface::allInterfaces()) {
            if (!(nif.flags() & QNetworkInterface::IsUp) || (nif.flags() & QNetworkInterface::IsLoopBack))
                continue;
            for (const QNetworkAddressEntry &a : nif.addressEntries())
                if (a.ip().protocol() == QAbstractSocket::IPv4Protocol && !a.ip().isLoopback()) {
                    host = a.ip();
                    break;
                }
            if (!host.isNull())
                break;
        }
    }
    if (host.isNull())
        host = QHostAddress(QHostAddress::LocalHost);
    m_url = QStringLiteral("http://%1:%2/%3/").arg(host.toString()).arg(m_server->serverPort()).arg(m_token);
    setState(QStringLiteral("waiting"));
    touch();
    // The simulator says where, as a device shows it (the QR code).
    qInfo("DropShare: %s at %s", qPrintable(m_mode), qPrintable(m_url));
    return { { QStringLiteral("returnValue"), true }, { QStringLiteral("url"), m_url }, { QStringLiteral("token"), m_token },
             { QStringLiteral("port"), int(m_server->serverPort()) }, { QStringLiteral("address"), host.toString() },
             { QStringLiteral("mode"), m_mode } };
}

void SimDropShare::stop(const QString &reason)
{
    m_idle.stop();
    if (m_server) {
        m_server->close();
        m_server->deleteLater();
        m_server = nullptr;
    }
    const auto conns = m_conns.keys();
    for (QTcpSocket *s : conns)
        s->disconnectFromHost();
    m_token.clear();
    if (m_state == QLatin1String("waiting") || m_state == QLatin1String("transferring")
        || (reason == QLatin1String("stopped") && m_state != QLatin1String("off")))
        setState(reason);
    // Offered files are not kept past their session.
    if (m_mode == QLatin1String("send")) {
        m_files.clear();
        m_dir.reset();
    }
}

void SimDropShare::setState(const QString &state)
{
    if (state == m_state)
        return;
    m_state = state;
    emit changed();
}

void SimDropShare::touch()
{
    if (m_server)
        m_idle.start(idleTimeoutMs);
}

QVariantMap SimDropShare::status() const
{
    QVariantList files;
    for (const Entry &e : m_files)
        files << QVariantMap { { QStringLiteral("id"), e.id }, { QStringLiteral("name"), e.name }, { QStringLiteral("type"), e.type },
                               { QStringLiteral("size"), double(e.size) }, { QStringLiteral("received"), double(e.received) },
                               { QStringLiteral("done"), e.done }, { QStringLiteral("taken"), e.taken },
                               { QStringLiteral("downloads"), e.downloads } };
    QVariantMap out { { QStringLiteral("returnValue"), true }, { QStringLiteral("state"), m_state },
                      { QStringLiteral("mode"), m_mode }, { QStringLiteral("url"), m_server ? m_url : QString() },
                      { QStringLiteral("files"), files } };
    if (!m_error.isEmpty())
        out[QStringLiteral("errorText")] = m_error;
    return out;
}

int SimDropShare::offerBegin(const QString &name, const QString &type, qint64 size)
{
    // The first file of a new send: whatever was here before goes.
    if (!m_offering) {
        if (m_server)
            stop();
        m_files.clear();
        m_dir.reset();
        m_mode = QStringLiteral("send");
        m_offering = true;
    }
    if (m_files.size() >= maxFiles || size < 0 || size > maxFileBytes)
        return -1;
    if (!m_dir)
        m_dir = std::make_unique<QTemporaryDir>();
    Entry e;
    e.id = m_nextId++;
    e.name = uniqueName(name);
    e.type = type.isEmpty() ? QStringLiteral("application/octet-stream") : type;
    e.size = size;
    e.path = m_dir->filePath(QStringLiteral("offer-%1").arg(e.id));
    QFile f(e.path);
    if (!f.open(QIODevice::WriteOnly))
        return -1;
    m_files << e;
    return e.id;
}

bool SimDropShare::offerPart(int id, const QByteArray &data)
{
    for (Entry &e : m_files)
        if (e.id == id && !e.done) {
            if (e.received + data.size() > e.size)
                return false;
            QFile f(e.path);
            if (!f.open(QIODevice::Append) || f.write(data) != data.size())
                return false;
            e.received += data.size();
            return true;
        }
    return false;
}

bool SimDropShare::offerEnd(int id)
{
    for (int i = 0; i < m_files.size(); ++i)
        if (m_files[i].id == id && !m_files[i].done) {
            if (m_files[i].received != m_files[i].size) {
                QFile::remove(m_files[i].path);
                m_files.removeAt(i);
                return false;
            }
            m_files[i].done = true;
            emit changed();
            return true;
        }
    return false;
}

int SimDropShare::offerFile(const QString &name, const QString &type, const QByteArray &data)
{
    const int id = offerBegin(name, type, data.size());
    return id > 0 && offerPart(id, data) && offerEnd(id) ? id : -1;
}

QByteArray SimDropShare::fileData(int id) const
{
    for (const Entry &e : m_files)
        if (e.id == id && e.done) {
            QFile f(e.path);
            return f.open(QIODevice::ReadOnly) ? f.readAll() : QByteArray();
        }
    return {};
}

bool SimDropShare::takeFile(int id)
{
    for (Entry &e : m_files)
        if (e.id == id && e.done && !e.taken) {
            e.taken = true;
            QFile::remove(e.path);
            emit changed();
            return true;
        }
    return false;
}

QVariantMap SimDropShare::request(const QVariantMap &req)
{
    const QString op = req.value(QStringLiteral("op")).toString();
    if (op == QLatin1String("start"))
        return start(req);
    if (op == QLatin1String("stop")) {
        stop();
        return status();
    }
    if (op == QLatin1String("take"))
        return { { QStringLiteral("returnValue"), takeFile(req.value(QStringLiteral("id")).toInt()) } };
    if (op == QLatin1String("status"))
        return status();
    if (op == QLatin1String("offerBegin")) {
        const int id = offerBegin(req.value(QStringLiteral("name")).toString(), req.value(QStringLiteral("type")).toString(),
                                  qint64(req.value(QStringLiteral("size")).toDouble()));
        return id > 0 ? QVariantMap { { QStringLiteral("returnValue"), true }, { QStringLiteral("id"), id } }
                      : QVariantMap { { QStringLiteral("returnValue"), false }, { QStringLiteral("errorText"), QStringLiteral("The file is too large to share") } };
    }
    if (op == QLatin1String("offerPart"))
        return { { QStringLiteral("returnValue"), offerPart(req.value(QStringLiteral("id")).toInt(),
                     QByteArray::fromBase64(req.value(QStringLiteral("data")).toString().toLatin1())) } };
    if (op == QLatin1String("offerEnd"))
        return { { QStringLiteral("returnValue"), offerEnd(req.value(QStringLiteral("id")).toInt()) } };
    return { { QStringLiteral("returnValue"), false }, { QStringLiteral("errorText"), QStringLiteral("Unknown op: ") + op } };
}

// ---- HTTP ---------------------------------------------------------------------------

void SimDropShare::onConnection()
{
    while (m_server && m_server->hasPendingConnections()) {
        QTcpSocket *s = m_server->nextPendingConnection();
        // Its own, not the server's: a session that ends (the server goes)
        // still finishes its last answer.
        s->setParent(this);
        auto *c = new Conn;
        m_conns.insert(s, c);
        connect(s, &QTcpSocket::readyRead, this, [this, s]() { onReadyRead(s); });
        connect(s, &QTcpSocket::bytesWritten, this, [this, s]() {
            Conn *c = m_conns.value(s);
            if (!c || !c->sending)
                return;
            if (s->bytesToWrite() > kChunk)
                return;
            const QByteArray piece = c->sending->read(kChunk);
            if (!piece.isEmpty()) {
                s->write(piece);
                return;
            }
            // The whole file went.
            for (Entry &e : m_files)
                if (e.id == c->sendingEntry)
                    ++e.downloads;
            delete c->sending;
            c->sending = nullptr;
            s->disconnectFromHost();
            emit changed();
            checkAllSent();
        });
        connect(s, &QTcpSocket::disconnected, this, [this, s]() {
            Conn *c = m_conns.take(s);
            if (c) {
                if (c->upload) {
                    // An upload cut off: it does not count.
                    c->upload->remove();
                    delete c->upload;
                    for (int i = 0; i < m_files.size(); ++i)
                        if (m_files[i].id == c->entry && !m_files[i].done) {
                            m_sessionBytes -= m_files[i].size;
                            m_files.removeAt(i);
                            emit changed();
                            break;
                        }
                }
                delete c->sending;
                delete c;
            }
            s->deleteLater();
        });
    }
}

void SimDropShare::onReadyRead(QTcpSocket *s)
{
    Conn *c = m_conns.value(s);
    if (!c)
        return;
    touch();
    if (!c->headersDone) {
        c->head += s->readAll();
        const int end = c->head.indexOf("\r\n\r\n");
        if (end < 0) {
            if (c->head.size() > 16 * 1024)
                reply(s, 431, "text/plain", "Request headers too large\n");
            return;
        }
        const QByteArray rest = c->head.mid(end + 4);
        c->head.truncate(end);
        c->headersDone = true;
        handleHeaders(s, c);
        if (!c->upload || rest.isEmpty())
            return;
        c->upload->write(rest);
        c->got += rest.size();
    } else if (c->upload) {
        const QByteArray data = s->readAll();
        c->upload->write(data);
        c->got += data.size();
    } else {
        s->readAll();
        return;
    }
    for (Entry &e : m_files)
        if (e.id == c->entry)
            e.received = c->got;
    if (c->got > c->length) {
        reply(s, 400, "text/plain", "More than Content-Length\n");
        return;
    }
    if (c->got == c->length)
        finishUpload(s, c);
}

void SimDropShare::handleHeaders(QTcpSocket *s, Conn *c)
{
    const QList<QByteArray> lines = c->head.split('\n');
    const QList<QByteArray> first = lines.value(0).trimmed().split(' ');
    if (first.size() < 2) {
        reply(s, 400, "text/plain", "Bad request\n");
        return;
    }
    c->method = first.at(0);
    const QUrl url(QString::fromUtf8(first.at(1)));
    c->query = QUrlQuery(url);
    for (int i = 1; i < lines.size(); ++i) {
        const QByteArray l = lines.at(i).trimmed();
        const int colon = l.indexOf(':');
        if (colon > 0 && l.left(colon).trimmed().toLower() == "content-length")
            c->length = l.mid(colon + 1).trimmed().toLongLong();
    }
    // /<token>/<what>: anything else, or an old token, is not here.
    const QStringList parts = url.path().split(QLatin1Char('/'), Qt::SkipEmptyParts);
    if (m_token.isEmpty() || parts.isEmpty() || parts.first() != m_token) {
        reply(s, 404, "text/plain", "Not found\n");
        return;
    }
    c->path = parts.mid(1).join(QLatin1Char('/'));
    const bool receive = m_mode == QLatin1String("receive");

    if (c->method == "GET" && c->path.isEmpty()) {
        const QByteArray page = m_pages ? m_pages(receive ? QStringLiteral("receive.html") : QStringLiteral("send.html")) : QByteArray();
        if (page.isEmpty())
            reply(s, 500, "text/plain", "The page is missing\n");
        else
            reply(s, 200, "text/html; charset=utf-8", page);
        return;
    }
    if (receive && c->method == "POST" && c->path == QLatin1String("upload")) {
        if (c->length < 0) {
            reply(s, 411, "text/plain", "Length required\n");
            return;
        }
        int count = 0;
        for (const Entry &e : m_files)
            count += e.done || e.received > 0 ? 1 : 0;
        if (c->length > maxFileBytes || m_sessionBytes + c->length > maxSessionBytes || count >= maxFiles) {
            replyJson(s, 413, { { QStringLiteral("returnValue"), false }, { QStringLiteral("errorText"), QStringLiteral("Too large") } });
            return;
        }
        Entry e;
        e.id = m_nextId++;
        e.name = uniqueName(c->query.queryItemValue(QStringLiteral("name"), QUrl::FullyDecoded));
        e.type = c->query.queryItemValue(QStringLiteral("type"), QUrl::FullyDecoded);
        if (e.type.isEmpty())
            e.type = QStringLiteral("application/octet-stream");
        e.size = c->length;
        e.path = m_dir->filePath(QStringLiteral("upload-%1").arg(e.id));
        c->upload = new QFile(e.path);
        if (!c->upload->open(QIODevice::WriteOnly)) {
            delete c->upload;
            c->upload = nullptr;
            replyJson(s, 500, { { QStringLiteral("returnValue"), false }, { QStringLiteral("errorText"), QStringLiteral("Cannot store it") } });
            return;
        }
        c->entry = e.id;
        m_sessionBytes += c->length;
        m_files << e;
        setState(QStringLiteral("transferring"));
        emit changed();
        if (c->length == 0)
            finishUpload(s, c);
        return;
    }
    if (receive && c->method == "POST" && c->path == QLatin1String("done")) {
        replyJson(s, 200, { { QStringLiteral("returnValue"), true } });
        // The uploader is finished: the session ends once its files are in.
        m_idle.stop();
        if (m_server) {
            m_server->close();
            m_server->deleteLater();
            m_server = nullptr;
        }
        m_token.clear();
        setState(QStringLiteral("done"));
        return;
    }
    if (!receive && c->method == "GET" && c->path == QLatin1String("files")) {
        QJsonArray list;
        for (const Entry &e : m_files)
            list.append(QJsonObject { { QStringLiteral("id"), e.id }, { QStringLiteral("name"), e.name },
                                      { QStringLiteral("type"), e.type }, { QStringLiteral("size"), double(e.size) } });
        reply(s, 200, "application/json", QJsonDocument(QJsonObject { { QStringLiteral("files"), list } }).toJson(QJsonDocument::Compact));
        return;
    }
    if (!receive && c->method == "GET" && c->path.startsWith(QLatin1String("file/"))) {
        const int id = c->path.mid(5).toInt();
        for (Entry &e : m_files)
            if (e.id == id) {
                setState(QStringLiteral("transferring"));
                sendFile(s, e);
                return;
            }
        reply(s, 404, "text/plain", "Not found\n");
        return;
    }
    reply(s, 405, "text/plain", "Not allowed\n");
}

void SimDropShare::finishUpload(QTcpSocket *s, Conn *c)
{
    c->upload->close();
    delete c->upload;
    c->upload = nullptr;
    for (Entry &e : m_files)
        if (e.id == c->entry) {
            e.done = true;
            e.received = e.size;
            replyJson(s, 200, { { QStringLiteral("returnValue"), true }, { QStringLiteral("name"), e.name } });
        }
    emit changed();
}

void SimDropShare::sendFile(QTcpSocket *s, Entry &e)
{
    Conn *c = m_conns.value(s);
    auto *f = new QFile(e.path);
    if (!c || !f->open(QIODevice::ReadOnly)) {
        delete f;
        reply(s, 404, "text/plain", "Not found\n");
        return;
    }
    // Content-Disposition with the name for any browser (RFC 6266).
    QByteArray ascii = e.name.toLatin1();
    ascii.replace('"', '_');
    QByteArray head = "HTTP/1.1 200 OK\r\nContent-Type: " + e.type.toLatin1()
        + "\r\nContent-Length: " + QByteArray::number(e.size)
        + "\r\nContent-Disposition: attachment; filename=\"" + ascii + "\"; filename*=UTF-8''"
        + QUrl::toPercentEncoding(e.name) + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
    c->sending = f;
    c->sendingEntry = e.id;
    s->write(head);
    s->write(f->read(kChunk));
}

void SimDropShare::checkAllSent()
{
    if (m_mode != QLatin1String("send") || m_files.isEmpty())
        return;
    for (const Entry &e : m_files)
        if (e.downloads == 0)
            return;
    // Every file went to the other device: the session is done.
    m_idle.stop();
    if (m_server) {
        m_server->close();
        m_server->deleteLater();
        m_server = nullptr;
    }
    m_token.clear();
    // The files offered are not kept past their session.
    m_files.clear();
    setState(QStringLiteral("done"));
}

void SimDropShare::reply(QTcpSocket *s, int status, const QByteArray &type, const QByteArray &body,
                         const QList<QPair<QByteArray, QByteArray>> &extra)
{
    static const QHash<int, QByteArray> reasons = {
        { 200, "OK" }, { 400, "Bad Request" }, { 404, "Not Found" }, { 405, "Method Not Allowed" },
        { 411, "Length Required" }, { 413, "Payload Too Large" }, { 431, "Request Header Fields Too Large" },
        { 500, "Internal Server Error" } };
    QByteArray out = "HTTP/1.1 " + QByteArray::number(status) + ' ' + reasons.value(status, "Error")
        + "\r\nContent-Type: " + type + "\r\nContent-Length: " + QByteArray::number(body.size())
        + "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n";
    for (const auto &h : extra)
        out += h.first + ": " + h.second + "\r\n";
    out += "\r\n" + body;
    if (Conn *c = m_conns.value(s)) {
        // Whatever else comes on this connection is not read.
        if (c->upload) {
            c->upload->remove();
            delete c->upload;
            c->upload = nullptr;
            for (int i = 0; i < m_files.size(); ++i)
                if (m_files[i].id == c->entry && !m_files[i].done) {
                    m_sessionBytes -= m_files[i].size;
                    m_files.removeAt(i);
                    emit changed();
                    break;
                }
        }
    }
    s->write(out);
    s->disconnectFromHost();
}

void SimDropShare::replyJson(QTcpSocket *s, int status, const QVariantMap &o)
{
    reply(s, status, "application/json", QJsonDocument(QJsonObject::fromVariantMap(o)).toJson(QJsonDocument::Compact));
}
