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
#include <QProcess>
#include <cstdio>
#include <functional>
#if defined(Q_OS_LINUX)
#include <csignal>
#include <sys/types.h>
#endif

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

// The shell's side of "killed, its llama-server goes too": a LocalModels
// that starts the stand-in and waits to be killed.
static int runChild(const QString &models)
{
    LocalModels lm;
    lm.setModelsDir(models);
    lm.setServerCommand({ QStandardPaths::findExecutable(QStringLiteral("node")),
                          QStringLiteral(PHOENIX_REPO_DIR "/apps/assistant/service/test/mock-providers.cjs") });
    QObject::connect(&lm, &LocalModels::ready, [](const QString &, const QString &) { std::printf("ready\n"); std::fflush(stdout); });
    lm.ensure(QStringLiteral("m"), QStringLiteral("c1"));
    return QCoreApplication::exec();
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    if (argc == 3 && QByteArray(argv[1]) == "--child")
        return runChild(QString::fromLocal8Bit(argv[2]));
    QTemporaryDir dir;
    Files files;
    files.body = QByteArray("GGUF stand-in\n").repeated(5000);
    const QString base = QStringLiteral("http://127.0.0.1:%1").arg(files.serverPort());
    const QString sha = QString::fromLatin1(QCryptographicHash::hash(files.body, QCryptographicHash::Sha256).toHex());

    LocalModels lm;
    lm.setModelsDir(dir.filePath(QStringLiteral("models")));
    // Built-in models: none yet (the default looks beside the program).
    const QString shipped = dir.filePath(QStringLiteral("shipped"));
    lm.setBuiltInDirs({ shipped });
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

#if defined(Q_OS_LINUX)
    // The shell killed outright (no stop()): its llama-server goes with it.
    {
        QProcess child;
        child.start(QCoreApplication::applicationFilePath(), { QStringLiteral("--child"), dir.filePath(QStringLiteral("models")) });
        waitFor([&]() { child.waitForReadyRead(50); return child.canReadLine() || child.state() == QProcess::NotRunning; }, 20000);
        const QByteArray said = child.readLine().trimmed();
        QFile kids(QStringLiteral("/proc/%1/task/%1/children").arg(child.processId()));
        const qint64 server = kids.open(QIODevice::ReadOnly) ? kids.readAll().trimmed().split(' ').first().toLongLong() : 0;
        check(said == "ready" && server > 0, "a shell running llama-server");
        ::kill(pid_t(child.processId()), SIGKILL);
        child.waitForFinished(3000);
        waitFor([&]() { return server <= 0 || ::kill(pid_t(server), 0) != 0; }, 5000);
        check(server > 0 && ::kill(pid_t(server), 0) != 0, "killed, its llama-server goes too");
    }
#endif

    lm.remove(QStringLiteral("m"));
    check(lm.status().value(QStringLiteral("installed")).toList().isEmpty(), "removed");

    // A built-in model: listed, run from where it is, never removed.
    QDir().mkpath(shipped);
    {
        QFile f(shipped + QStringLiteral("/qwen3-0.6b-q8_0.gguf"));
        f.open(QIODevice::WriteOnly);
        f.write(files.body);
    }
    const QVariantMap builtIn = lm.status().value(QStringLiteral("installed")).toList().value(0).toMap();
    check(builtIn.value(QStringLiteral("id")) == QStringLiteral("qwen3-0.6b-q8_0") && builtIn.value(QStringLiteral("builtIn")).toBool(),
          "a built-in model is installed");
    QString builtInUrl;
    QObject::connect(&lm, &LocalModels::ready, [&](const QString &id, const QString &url) { if (id == QStringLiteral("r4")) builtInUrl = url; });
    lm.ensure(QStringLiteral("qwen3-0.6b-q8_0"), QStringLiteral("r4"));
    waitFor([&]() { return !builtInUrl.isEmpty(); }, 20000);
    check(!builtInUrl.isEmpty(), "and runs from where it is");
    lm.remove(QStringLiteral("qwen3-0.6b-q8_0"));
    check(QFile::exists(shipped + QStringLiteral("/qwen3-0.6b-q8_0.gguf")), "and is never removed");
    lm.stop();

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

    // A voice for "%v": the one asked for, else the voice property.
    Speech voiced;
    const QString vout = dir.filePath(QStringLiteral("voiced.txt"));
    voiced.setCommand({ node, QStringLiteral("-e"),
                        QStringLiteral("require('fs').writeFileSync(%1, process.argv[1])").arg(QStringLiteral("'") + vout + QStringLiteral("'")),
                        QStringLiteral("%v") });
    voiced.setVoice(QStringLiteral("expr-voice-3-f"));
    bool vdone = false;
    QObject::connect(&voiced, &Speech::finished, [&]() { vdone = true; });
    voiced.speak(QStringLiteral("Hi."));
    waitFor([&]() { return vdone; }, 5000);
    QFile vf(vout);
    check(vf.open(QIODevice::ReadOnly) && vf.readAll() == "expr-voice-3-f", "the voice property for %v");
    vf.close();
    vdone = false;
    voiced.speak(QStringLiteral("Hi."), QStringLiteral("en"), QStringLiteral("expr-voice-5-m"));
    waitFor([&]() { return vdone; }, 5000);
    check(vf.open(QIODevice::ReadOnly) && vf.readAll() == "expr-voice-5-m", "a voice asked for");

    // Kitten TTS by default, Flite when it cannot speak: phoenix-tts and
    // flite stood in for by scripts (the real ones: tts-test, the simulator).
    QDir(dir.path()).mkpath(QStringLiteral("bin"));
    const QString kittenLog = dir.filePath(QStringLiteral("kitten.txt")), fliteLog = dir.filePath(QStringLiteral("flite.txt"));
    auto script = [&](const QString &name, const QString &body) {
        QFile f(dir.filePath(QStringLiteral("bin/") + name));
        f.open(QIODevice::WriteOnly);
        f.write((QStringLiteral("#!/bin/sh\n") + body).toUtf8());
        f.close();
        f.setPermissions(f.permissions() | QFileDevice::ExeOwner);
        return f.fileName();
    };
    const QString kitten = script(QStringLiteral("phoenix-tts"),
        QStringLiteral("if [ \"$1\" = --check ]; then echo '{\"ok\":true,\"voices\":[\"expr-voice-3-f\",\"expr-voice-5-m\"]}'; exit 0; fi\n"
                       "echo \"$*:$(/bin/cat)\" > '%1'\n[ -e '%2' ] && exit 4\nexit 0\n").arg(kittenLog, dir.filePath(QStringLiteral("no-sound"))));
    script(QStringLiteral("flite"), QStringLiteral("echo \"$(/bin/cat)\" > '%1'\n").arg(fliteLog));
    const QByteArray path = qgetenv("PATH");
    qputenv("PHOENIX_TTS_PROGRAM", kitten.toUtf8());
    qputenv("PATH", dir.filePath(QStringLiteral("bin")).toUtf8());
    Speech kit;
    kit.setVoice(QStringLiteral("expr-voice-5-m"));
    check(kit.available() && kit.engine() == QStringLiteral("Kitten TTS") && kit.voices().size() == 2, "Kitten TTS by default, with its voices");
    bool kdone = false;
    QObject::connect(&kit, &Speech::finished, [&]() { kdone = true; });
    kit.speak(QStringLiteral("The flashlight is on."));
    waitFor([&]() { return kdone; }, 5000);
    QFile kf(kittenLog);
    check(kf.open(QIODevice::ReadOnly) && kf.readAll().trimmed() == "--voice expr-voice-5-m:The flashlight is on.", "phoenix-tts with the voice");
    kf.close();
    QFile(dir.filePath(QStringLiteral("no-sound"))).open(QIODevice::WriteOnly);
    kdone = false;
    kit.speak(QStringLiteral("Bluetooth is off."));
    waitFor([&]() { return kdone; }, 5000);
    QFile ff(fliteLog);
    check(ff.open(QIODevice::ReadOnly) && ff.readAll().trimmed() == "Bluetooth is off.", "Kitten cannot speak: the same words with Flite");
    QFile(fliteLog).remove();
    kdone = false;
    kit.speak(QStringLiteral("Bonjour."), QStringLiteral("fr"));
    waitFor([&]() { return kdone; }, 5000);
    QFile ff2(fliteLog);
    check(ff2.open(QIODevice::ReadOnly) && ff2.readAll().trimmed() == "Bonjour.", "another language: the fallback");
    qputenv("PHOENIX_TTS_PROGRAM", dir.filePath(QStringLiteral("nowhere/phoenix-tts")).toUtf8());
    Speech plain;
    check(plain.engine() == QStringLiteral("flite") && plain.voices().isEmpty(), "no phoenix-tts: Flite, no voices");
    qputenv("PATH", path);
    qunsetenv("PHOENIX_TTS_PROGRAM");

    std::printf("%s\n", failures ? "FAILED" : "all passed");
    return failures ? 1 : 0;
}
