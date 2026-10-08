// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's on-device model (docs/M6-PLAN.md F3, layer 3) as
// the shell runs it: GGUF models downloaded into modelsDir (redirects
// followed, as Hugging Face sends them from a CDN; the SHA-256 checked) and
// llama.cpp's llama-server started for the one in use on 127.0.0.1, with
// --jinja so it calls tools in the model's own format, then stopped after
// idleMs without requests to give the memory back. The assistant service
// talks to that server's OpenAI-compatible Chat Completions.
//
// The server is serverCommand (a program and arguments before ours), or
// llama-server on the PATH; available says whether there is one.
//
//   status() -> {available, server, running, model, error, ramBytes,
//                installed: [{id, file, size}], downloading: {id, received, total} | null}
//   download(id, url, sha256, size)   one at a time; changed() as it goes
//   cancel(id), remove(id)
//   ensure(id, requestId)             ready(requestId, baseUrl) or failed(requestId, error)
//
// phoenix-sim passes the runtime's "assistant" host messages here
// (SimWindowSource); a device's service runs llama-server itself
// (apps/assistant/service/lib/node-device.js).

#pragma once

#include <QByteArray>
#include <QCryptographicHash>
#include <QFile>
#include <QObject>
#include <QPointer>
#include <QStringList>
#include <QVariantMap>
#include <QtQml/qqmlregistration.h>

class QNetworkAccessManager;
class QNetworkReply;
class QProcess;
class QTimer;

class LocalModels : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(QString modelsDir READ modelsDir WRITE setModelsDir NOTIFY changed)
    Q_PROPERTY(QStringList serverCommand READ serverCommand WRITE setServerCommand NOTIFY changed)
    Q_PROPERTY(int idleMs READ idleMs WRITE setIdleMs NOTIFY changed)
    Q_PROPERTY(int startTimeoutMs READ startTimeoutMs WRITE setStartTimeoutMs NOTIFY changed)
    Q_PROPERTY(bool available READ available NOTIFY changed)
    Q_PROPERTY(bool running READ running NOTIFY changed)
    Q_PROPERTY(QString error READ error NOTIFY changed)

public:
    explicit LocalModels(QObject *parent = nullptr);
    ~LocalModels() override;

    QString modelsDir() const { return m_dir; }
    void setModelsDir(const QString &d);
    QStringList serverCommand() const { return m_command; }
    void setServerCommand(const QStringList &c);
    int idleMs() const { return m_idleMs; }
    void setIdleMs(int ms);
    int startTimeoutMs() const { return m_startTimeoutMs; }
    void setStartTimeoutMs(int ms) { if (ms != m_startTimeoutMs) { m_startTimeoutMs = ms; emit changed(); } }
    bool available() const { return !serverProgram().isEmpty(); }
    bool running() const;
    QString error() const { return m_error; }

    Q_INVOKABLE QVariantMap status() const;
    Q_INVOKABLE void download(const QString &id, const QString &url, const QString &sha256, qint64 size);
    Q_INVOKABLE void cancel(const QString &id);
    Q_INVOKABLE void remove(const QString &id);
    Q_INVOKABLE void ensure(const QString &id, const QString &requestId);
    Q_INVOKABLE void stop();

    // The device's memory in bytes (0 if unknown).
    static qint64 totalMemory();

signals:
    void changed();
    void ready(const QString &requestId, const QString &baseUrl);
    void failed(const QString &requestId, const QString &error);

private:
    QString serverProgram() const;
    QString fileFor(const QString &id) const;
    void setError(const QString &e);
    void pollHealth();
    void finishStart(bool ok, const QString &why);

    QString m_dir;
    QStringList m_command;
    int m_idleMs = 5 * 60 * 1000;
    int m_startTimeoutMs = 120000;
    QString m_error;

    QNetworkAccessManager *m_net = nullptr;
    QPointer<QNetworkReply> m_reply;
    QFile m_part;
    QCryptographicHash m_hash{QCryptographicHash::Sha256};
    QString m_downloadId, m_downloadSha;
    qint64 m_received = 0, m_total = 0;

    QProcess *m_server = nullptr;
    QString m_model;            // the model the server runs
    QString m_baseUrl;          // set once it answers /health
    int m_port = 0;
    qint64 m_startDeadline = 0;
    QStringList m_waiting;      // requestIds for the start under way
    QString m_stderr;
    QTimer *m_idle = nullptr;
    QTimer *m_poll = nullptr;
};
