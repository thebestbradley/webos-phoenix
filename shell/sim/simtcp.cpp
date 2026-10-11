// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "simtcp.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QTcpSocket>
#include <QTimer>

namespace {

constexpr int kConnectTimeoutMs = 20000;

// Qt's socket errors as the error codes Node gives (what the kit and the
// connectors read: an OFFLINE file error, CONNECTION_FAILED, HOST_NOT_FOUND).
QString errorCode(QAbstractSocket::SocketError e)
{
    switch (e) {
    case QAbstractSocket::ConnectionRefusedError: return QStringLiteral("ECONNREFUSED");
    case QAbstractSocket::HostNotFoundError: return QStringLiteral("ENOTFOUND");
    case QAbstractSocket::SocketTimeoutError: return QStringLiteral("ETIMEDOUT");
    case QAbstractSocket::NetworkError: return QStringLiteral("ENETUNREACH");
    case QAbstractSocket::RemoteHostClosedError: return QString();
    default: return QStringLiteral("ECONNRESET");
    }
}

} // namespace

SimTcp::SimTcp(QObject *parent) : QObject(parent) {}

SimTcp::~SimTcp()
{
    for (Connection *c : std::as_const(m_connections)) {
        c->socket->disconnect(this);
        c->socket->abort();
        delete c;
    }
}

void SimTcp::send(Connection *c, const QVariantMap &fields)
{
    QJsonObject o = QJsonObject::fromVariantMap(fields);
    o.insert(QStringLiteral("id"), c->id);
    emit event(c->window, QString::fromUtf8(QJsonDocument(o).toJson(QJsonDocument::Compact)));
}

void SimTcp::request(const QString &windowUid, const QVariantMap &payload)
{
    const QString op = payload.value(QStringLiteral("op")).toString();
    const QString id = payload.value(QStringLiteral("id")).toString();
    if (windowUid.isEmpty() || id.isEmpty())
        return;
    const QString key = keyOf(windowUid, id);
    if (op == QLatin1String("open")) {
        if (m_connections.contains(key))
            return;
        open(windowUid, id, payload.value(QStringLiteral("host")).toString(), payload.value(QStringLiteral("port")).toInt());
        return;
    }
    Connection *c = m_connections.value(key);
    if (!c)
        return;
    if (op == QLatin1String("write")) {
        if (c->connected)
            c->socket->write(QByteArray::fromBase64(payload.value(QStringLiteral("data")).toString().toLatin1()));
    } else if (op == QLatin1String("close")) {
        // The page hung up: nothing more to tell it.
        m_connections.remove(key);
        if (c->socket) {
            c->socket->disconnect(this);
            c->socket->disconnectFromHost();
            c->socket->deleteLater();
        }
        delete c;
    }
}

void SimTcp::open(const QString &window, const QString &id, const QString &host, int port)
{
    auto *c = new Connection;
    c->window = window;
    c->id = id;
    const QString key = keyOf(window, id);
    m_connections.insert(key, c);
    if (host.isEmpty() || port <= 0 || port > 65535) {
        finish(key, QStringLiteral("EINVAL"), QStringLiteral("No host or port"));
        return;
    }
    c->socket = new QTcpSocket(this);
    c->socket->setSocketOption(QAbstractSocket::LowDelayOption, 1);
    c->timeout = new QTimer(c->socket);
    c->timeout->setSingleShot(true);
    connect(c->timeout, &QTimer::timeout, this, [this, key, host, port]() {
        finish(key, QStringLiteral("ETIMEDOUT"), QStringLiteral("%1:%2 did not answer").arg(host).arg(port));
    });
    connect(c->socket, &QTcpSocket::connected, this, [this, key]() {
        Connection *x = m_connections.value(key);
        if (!x)
            return;
        x->timeout->stop();
        x->connected = true;
        send(x, { { QStringLiteral("event"), QStringLiteral("connected") } });
    });
    connect(c->socket, &QTcpSocket::readyRead, this, [this, key]() {
        Connection *x = m_connections.value(key);
        if (!x)
            return;
        const QByteArray data = x->socket->readAll();
        if (!data.isEmpty())
            send(x, { { QStringLiteral("event"), QStringLiteral("data") }, { QStringLiteral("data"), QString::fromLatin1(data.toBase64()) } });
    });
    connect(c->socket, &QTcpSocket::errorOccurred, this, [this, key](QAbstractSocket::SocketError e) {
        Connection *x = m_connections.value(key);
        if (x)
            finish(key, errorCode(e), x->socket->errorString());
    });
    connect(c->socket, &QTcpSocket::disconnected, this, [this, key]() { finish(key, QString(), QString()); });
    c->timeout->start(kConnectTimeoutMs);
    c->socket->connectToHost(host, static_cast<quint16>(port));
}

void SimTcp::finish(const QString &key, const QString &error, const QString &message)
{
    Connection *c = m_connections.value(key);
    if (!c || c->done)
        return;
    c->done = true;
    // What came before the close goes first.
    if (c->socket && c->socket->bytesAvailable() > 0) {
        const QByteArray data = c->socket->readAll();
        send(c, { { QStringLiteral("event"), QStringLiteral("data") }, { QStringLiteral("data"), QString::fromLatin1(data.toBase64()) } });
    }
    QVariantMap closed{ { QStringLiteral("event"), QStringLiteral("closed") } };
    if (!error.isEmpty()) {
        closed.insert(QStringLiteral("error"), error);
        closed.insert(QStringLiteral("message"), message);
    }
    send(c, closed);
    m_connections.remove(key);
    if (c->socket) {
        c->socket->disconnect(this);
        c->socket->abort();
        c->socket->deleteLater();
    }
    delete c;
}

void SimTcp::closeWindow(const QString &windowUid)
{
    const QStringList keys = m_connections.keys();
    for (const QString &k : keys) {
        Connection *c = m_connections.value(k);
        if (!c || c->window != windowUid)
            continue;
        m_connections.remove(k);
        if (c->socket) {
            c->socket->disconnect(this);
            c->socket->abort();
            c->socket->deleteLater();
        }
        delete c;
    }
}
