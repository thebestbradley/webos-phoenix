// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// DropShare's web server in phoenix-sim (docs/M6-PLAN.md F4 item 8;
// docs/APP-RUNTIME.md "DropShare"): Phoenix's own take on the webOS
// Archive's LuneDrop, as an extension of Touch to Share. Another phone or
// a computer on the same network opens the address the device shows as a
// QR code, in any browser:
//   receive  the page there uploads files to the device
//            (POST <token>/upload?name=&type=, one file a request, then
//            POST <token>/done); they wait here until the runtime takes
//            them into /media/internal/Downloads (takeFile).
//   send     the page there lists the files the device offers
//            (GET <token>/files) and downloads them (GET <token>/file/N).
// Each session has its own token (128 random bits) in every address;
// anything else is 404. A session ends when its transfer is done (the
// uploader says so, or every file offered was downloaded whole), after
// ten minutes without a request, or when stopped; the port closes with
// it. Limits: 512 MB a file, 2 GB and 50 files a session.
//
// The server is plain Qt Network, no WebEngine, so build/simnet-test runs
// it against real sockets. On a device the same requests are served by
// the dropshare service (see the docs).
#pragma once

#include <QDir>
#include <QElapsedTimer>
#include <QHash>
#include <QHostAddress>
#include <QObject>
#include <QPointer>
#include <QTemporaryDir>
#include <QTimer>
#include <QVariantMap>
#include <functional>
#include <memory>

class QFile;
class QTcpServer;
class QTcpSocket;

class SimDropShare : public QObject
{
    Q_OBJECT
public:
    // pages(name) gives the page another device opens ("receive.html",
    // "send.html"): the app's web/ folder.
    explicit SimDropShare(std::function<QByteArray(const QString &)> pages, QObject *parent = nullptr);
    ~SimDropShare() override;

    qint64 maxFileBytes = 512LL * 1024 * 1024;
    qint64 maxSessionBytes = 2048LL * 1024 * 1024;
    int maxFiles = 50;
    int idleTimeoutMs = 10 * 60 * 1000;
    // The address the URL names: the first LAN address, unless set (tests).
    QHostAddress advertise;

    // {mode: "receive" | "send"} -> {returnValue, url, token, port, address,
    // mode} or {returnValue: false, errorText}. "send" offers the files
    // added with offerFile since the last stop.
    QVariantMap start(const QVariantMap &options);
    void stop(const QString &reason = QStringLiteral("stopped"));
    // {state: "off" | "waiting" | "transferring" | "done" | "timeout" |
    // "stopped" | "failed", mode, url, files: [{id, name, type, size,
    // received, done, taken, downloads}], errorText?}
    QVariantMap status() const;

    // Send: a file to offer (its bytes; Phoenix's media files live in the
    // page's store, so the runtime hands them over).
    int offerFile(const QString &name, const QString &type, const QByteArray &data);
    // ... or in parts: begin (its size), parts in order, end (-1 / false
    // when it does not fit the limits or the parts did not add up).
    int offerBegin(const QString &name, const QString &type, qint64 size);
    bool offerPart(int id, const QByteArray &data);
    bool offerEnd(int id);
    // Receive: a finished upload's bytes, and forgetting it once taken.
    QByteArray fileData(int id) const;
    bool takeFile(int id);

    // The JSON API the runtime calls through phoenix-sim's scheme handler
    // (/__phoenix/dropshare?req={op, ...}): start, stop, status, take.
    QVariantMap request(const QVariantMap &req);

signals:
    void changed();

private:
    struct Entry {
        int id = 0;
        QString name;
        QString type;
        qint64 size = 0;
        qint64 received = 0;
        bool done = false;
        bool taken = false;
        int downloads = 0;
        QString path;
    };
    struct Conn;

    void onConnection();
    void onReadyRead(QTcpSocket *s);
    void handleHeaders(QTcpSocket *s, Conn *c);
    void reply(QTcpSocket *s, int status, const QByteArray &type, const QByteArray &body,
               const QList<QPair<QByteArray, QByteArray>> &extra = {});
    void replyJson(QTcpSocket *s, int status, const QVariantMap &o);
    void finishUpload(QTcpSocket *s, Conn *c);
    void sendFile(QTcpSocket *s, Entry &e);
    void touch();
    void setState(const QString &state);
    void checkAllSent();
    QString uniqueName(const QString &name) const;
    static QString cleanName(const QString &name);

    std::function<QByteArray(const QString &)> m_pages;
    std::unique_ptr<QTemporaryDir> m_dir;
    QTcpServer *m_server = nullptr;
    QTimer m_idle;
    QString m_state = QStringLiteral("off");
    QString m_mode;
    QString m_token;
    QString m_url;
    QString m_error;
    QList<Entry> m_files;
    int m_nextId = 1;
    // Files are being offered for the next send session.
    bool m_offering = false;
    qint64 m_sessionBytes = 0;
    QHash<QTcpSocket *, Conn *> m_conns;
};
