// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-sim's TCP relay for the connectors that speak a protocol of their
// own over bytes (the drives' SFTP: SSH; apps/connectors/drives/lib/ssh):
// a page has no TCP, this computer does. The kit's ctx.net.connect({binary:
// true}) in the page (runtime/phoenix-runtime.js, "Binary TCP: the host's
// relay") posts "tcp" host messages:
//
//   {op: "open", id, host, port}    a connection; "connected", or "closed"
//                                   with error ECONNREFUSED / ENOTFOUND /
//                                   ETIMEDOUT / ENETUNREACH
//   {op: "write", id, data}         bytes (Base64) to send
//   {op: "close", id}               hang up
//
// SimWindowSource hands them to request() with the window they came from;
// events go back to that window through event(), which it runs as
// __phoenixRuntime.tcpEvent({id, event: "connected" | "data" | "closed",
// data?, error?, message?}). A window's connections close with it.
//
// It reaches what this computer reaches, as the pages' HTTP proxy does
// (/__phoenix/proxy); the connector's own rule (only its account's server,
// docs/SYNERGY-CONNECTORS.md 3.2 rule 8) is the kit's, in the page.
// tools/serve-rootfs.py does the same over a WebSocket (/__phoenix/tcp).

#pragma once

#include <QHash>
#include <QObject>
#include <QString>
#include <QVariantMap>

class QTcpSocket;
class QTimer;

class SimTcp : public QObject
{
    Q_OBJECT
public:
    explicit SimTcp(QObject *parent = nullptr);
    ~SimTcp() override;

    // A "tcp" host message from a page.
    Q_INVOKABLE void request(const QString &windowUid, const QVariantMap &payload);
    // The window went: its connections close.
    Q_INVOKABLE void closeWindow(const QString &windowUid);
    Q_INVOKABLE int connectionCount() const { return m_connections.size(); }

signals:
    // Deliver to the page in windowUid: __phoenixRuntime.tcpEvent(json).
    void event(const QString &windowUid, const QString &json);

private:
    struct Connection
    {
        QString window;
        QString id;
        QTcpSocket *socket = nullptr;
        QTimer *timeout = nullptr;
        bool connected = false;
        bool done = false;
    };

    void open(const QString &window, const QString &id, const QString &host, int port);
    void send(Connection *c, const QVariantMap &fields);
    void finish(const QString &key, const QString &error, const QString &message);
    static QString keyOf(const QString &window, const QString &id) { return window + QLatin1Char('/') + id; }

    QHash<QString, Connection *> m_connections;
};
