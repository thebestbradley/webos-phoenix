// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's on-device model runner and speech, without a model or a
// voice (CI: build/localmodels-test): a "model" downloaded from a local
// server through a redirect and checked against its SHA-256, a wrong one
// refused, llama-server stood in for by the assistant's mock server
// (apps/assistant/service/test/mock-providers.cjs, which answers /health
// and Chat Completions as llama-server does), and a speech program that
// writes what it is given to a file. Needs Node.js for the stand-in.

#include "localmodels.h"
#include "speech.h"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDir>
#include <QElapsedTimer>
#include <QEventLoop>
#include <QFile>
#include <QHostAddress>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QStandardPaths>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QTimer>
#include <cstdio>
#include <functional>

static int failures = 0;
static void check(bool ok, const char *what)
{
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok)
        ++failures;
}

static bool waitFor(const std::function<bool()> &cond, int ms)
{
    QElapsedTimer t;
    t.start();
    while (!cond() && t.elapsed() < ms) {
        QEventLoop loop;
        QTimer::singleShot(20, &loop, &QEventLoop::quit);
        loop.exec();
    }
    return cond();
}

// /redirect/m.gguf -> 302 -> /files/m.gguf (the body).
class Files : public QTcpServer
{
public:
    QByteArray body;
    Files() { listen(QHostAddress::LocalHost, 0); }
protected:
    void incomingConnection(qintptr fd) override
    {
        auto *s = new QTcpSocket(this);
        s->setSocketDescriptor(fd);
        connect(s, &QTcpSocket::readyRead, s, [this, s]() {
            const QByteArray req = s->readAll();
            const QByteArray path = req.split(' ').value(1);
            if (path == "/redirect/m.gguf")
                s->write("HTTP/1.1 302 Found\r\nLocation: /files/m.gguf\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            else if (path == "/files/m.gguf")
                s->write("HTTP/1.1 200 OK\r\nContent-Length: " + QByteArray::number(body.size()) + "\r\nConnection: close\r\n\r\n" + body);
            else
                s->write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            s->disconnectFromHost();
        });
    }
};

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    QTemporaryDir dir;
    Files files;
    files.body = QByteArray("GGUF stand-in\n").repeated(5000);
    const QString base = QStringLiteral("http://127.0.0.1:%1").arg(files.serverPort());
    const QString sha = QString::fromLatin1(QCryptographicHash::hash(files.body, QCryptographicHash::Sha256).toHex());

    LocalModels lm;
    lm.setModelsDir(dir.filePath(QStringLiteral("models")));
    check(LocalModels::totalMemory() >= 0, "the device's memory");

    // A wrong SHA-256: refused, nothing kept.
    lm.download(QStringLiteral("bad"), base + QStringLiteral("/redirect/m.gguf"), QString(64, QLatin1Char('0')), files.body.size());
    check(lm.status().value(QStringLiteral("downloading")).toMap().value(QStringLiteral("id")) == QStringLiteral("bad"), "downloading");
    waitFor([&]() { return lm.status().value(QStringLiteral("downloading")).isNull(); }, 10000);
    check(lm.error().contains(QStringLiteral("damaged")), "a damaged download is refused");
    check(lm.status().value(QStringLiteral("installed")).toList().isEmpty(), "and not kept");

    // Through the redirect, checked.
    lm.download(QStringLiteral("m"), base + QStringLiteral("/redirect/m.gguf"), sha, files.body.size());
    waitFor([&]() { return lm.status().value(QStringLiteral("downloading")).isNull(); }, 10000);
    const QVariantList inst = lm.status().value(QStringLiteral("installed")).toList();
    check(inst.size() == 1 && inst.first().toMap().value(QStringLiteral("id")) == QStringLiteral("m")
          && inst.first().toMap().value(QStringLiteral("size")).toLongLong() == files.body.size(), "a model downloaded through a redirect");
    check(lm.error().isEmpty(), "without an error");

    // No server: says so.
    lm.setServerCommand({ dir.filePath(QStringLiteral("nowhere/llama-server")) });
    check(!lm.available(), "no llama-server");
    QString failedWith;
    QObject::connect(&lm, &LocalModels::failed, [&](const QString &, const QString &e) { failedWith = e; });
    lm.ensure(QStringLiteral("m"), QStringLiteral("r0"));
    waitFor([&]() { return !failedWith.isEmpty(); }, 2000);
    check(failedWith.contains(QStringLiteral("not installed")), "ensure fails without llama-server");

    // The stand-in llama-server.
    const QString node = QStandardPaths::findExecutable(QStringLiteral("node"));
    const QString mock = QStringLiteral(PHOENIX_REPO_DIR "/apps/assistant/service/test/mock-providers.cjs");
    if (node.isEmpty()) {
        std::printf("FAIL Node.js is needed for the llama-server stand-in\n");
        return 1;
    }
    lm.setServerCommand({ node, mock });
    check(lm.available(), "llama-server found");
    QString readyUrl;
    QObject::connect(&lm, &LocalModels::ready, [&](const QString &id, const QString &url) { if (id == QStringLiteral("r1")) readyUrl = url; });
    lm.ensure(QStringLiteral("m"), QStringLiteral("r1"));
    waitFor([&]() { return !readyUrl.isEmpty(); }, 20000);
    check(readyUrl.startsWith(QStringLiteral("http://127.0.0.1:")) && readyUrl.endsWith(QStringLiteral("/v1")), "the server answers on the loopback");
    check(lm.running() && lm.status().value(QStringLiteral("model")) == QStringLiteral("m"), "running the model");

    // Its Chat Completions.
    QNetworkAccessManager net;
    QNetworkRequest req(QUrl(readyUrl + QStringLiteral("/chat/completions")));
    req.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    QNetworkReply *r = net.post(req, R"({"model":"m","messages":[{"role":"user","content":"hello"}]})");
    waitFor([&]() { return r->isFinished(); }, 5000);
    check(r->readAll().contains("chat says: hello"), "it answers");
    r->deleteLater();

    // Asked again: the same server at once.
    QString again;
    QObject::connect(&lm, &LocalModels::ready, [&](const QString &id, const QString &url) { if (id == QStringLiteral("r2")) again = url; });
    lm.ensure(QStringLiteral("m"), QStringLiteral("r2"));
    waitFor([&]() { return !again.isEmpty(); }, 2000);
    check(again == readyUrl, "the running server again");

    // Idle: stopped.
    lm.setIdleMs(300);
    lm.ensure(QStringLiteral("m"), QStringLiteral("r3"));
    waitFor([&]() { return !lm.running(); }, 5000);
    check(!lm.running(), "stopped when idle");

    lm.remove(QStringLiteral("m"));
    check(lm.status().value(QStringLiteral("installed")).toList().isEmpty(), "removed");

    // Speech: a program reading the text.
    Speech sp;
    const QString out = dir.filePath(QStringLiteral("spoken.txt"));
    sp.setCommand({ node, QStringLiteral("-e"),
                    QStringLiteral("require('fs').writeFileSync(%1, process.argv[1] + ':' + require('fs').readFileSync(0, 'utf8'))")
                        .arg(QStringLiteral("'") + out + QStringLiteral("'")),
                    QStringLiteral("%l") });
    check(sp.available() && sp.engine() == QFileInfo(node).fileName(), "a speech program");
    bool done = false;
    QObject::connect(&sp, &Speech::finished, [&]() { done = true; });
    check(sp.speak(QStringLiteral("The flashlight is on."), QStringLiteral("en")), "speaks");
    waitFor([&]() { return done; }, 5000);
    QFile f(out);
    check(f.open(QIODevice::ReadOnly) && f.readAll() == "en:The flashlight is on.", "with the text on its input and the language");
    Speech none;
    none.setCommand({ dir.filePath(QStringLiteral("nowhere/espeak-ng")) });
    check(!none.available() && !none.speak(QStringLiteral("hi")), "no program, no speech");

    std::printf("%s\n", failures ? "FAILED" : "all passed");
    return failures ? 1 : 0;
}
