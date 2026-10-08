// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// simnet-test: phoenix-sim's network pieces without a window: the
// browser's content blocker list and user agents (contentfilter.h), and
// DropShare's web server (simdropshare.h) over real sockets: the page, the
// token, uploads and their limits, the end of a session, sending.
//
//   build/simnet-test

#include "contentfilter.h"
#include "simdropshare.h"

#include <QCoreApplication>
#include <QElapsedTimer>
#include <QEventLoop>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkProxy>
#include <QNetworkReply>
#include <QTemporaryFile>
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

static void contentFilter()
{
    ContentFilter f;
    check(f.load(QStringLiteral(PHOENIX_REPO_DIR "/runtime/content-blocker/hosts.txt")), "Phoenix's block list loads");
    check(f.size() > 50, "... with its hosts");
    check(f.blocks(QStringLiteral("doubleclick.net")), "a listed host is blocked");
    check(f.blocks(QStringLiteral("ads.g.doubleclick.net")), "... and the hosts under it");
    check(f.blocks(QStringLiteral("WWW.Google-Analytics.com")), "... whatever the case");
    check(!f.blocks(QStringLiteral("google.com")), "a domain above a listed host is not");
    check(!f.blocks(QStringLiteral("notdoubleclick.net")), "nor a name that only ends the same");
    check(!f.blocks(QStringLiteral("webosphoenix.org")), "an unlisted site loads");
    check(!f.blocks(QString()), "nothing for no host");

    QTemporaryFile hosts;
    check(hosts.open(), "a hosts file to read");
    hosts.write("# a comment\n0.0.0.0 tracker.example # after\n\nads.example.org\n127.0.0.1 localhost\n");
    hosts.flush();
    ContentFilter g;
    check(g.load(hosts.fileName()) && g.size() == 2, "a hosts file's lines and comments are read; localhost is not blocked");
    check(g.blocks(QStringLiteral("x.tracker.example")) && g.blocks(QStringLiteral("ads.example.org")), "... both forms");
    check(!g.load(QStringLiteral("/nonexistent/hosts.txt")), "a missing list fails to load");
}

static void userAgents()
{
    const QString chromium = QStringLiteral("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                                            "QtWebEngine/6.8.1 Chrome/122.0.6261.171 Safari/537.36");
    check(ContentFilter::userAgent(chromium, QStringLiteral("desktop"), true) == chromium, "desktop: Chromium's own");
    const QString phone = ContentFilter::userAgent(chromium, QStringLiteral("mobile"), true);
    check(phone == QStringLiteral("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) "
                                  "Chrome/122.0.0.0 Mobile Safari/537.36"), "phone: Chrome on Android, Mobile, no QtWebEngine token");
    const QString tablet = ContentFilter::userAgent(chromium, QStringLiteral("mobile"), false);
    check(tablet == QStringLiteral("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) "
                                   "Chrome/122.0.0.0 Safari/537.36"), "tablet: Chrome on an Android tablet, not Mobile");
    check(!phone.contains(QLatin1String("webOS")) && !tablet.contains(QLatin1String("hpwOS")),
          "no webOS token, which sites turn away as an old or TV browser");
}

struct Http {
    int status = 0;
    QByteArray body;
    QByteArray disposition;
};

static Http http(QNetworkAccessManager &net, const QByteArray &method, const QString &url, const QByteArray &body = {})
{
    QNetworkRequest req { QUrl(url) };
    req.setHeader(QNetworkRequest::ContentTypeHeader, QByteArrayLiteral("application/octet-stream"));
    QNetworkReply *r = net.sendCustomRequest(req, method, body);
    QEventLoop loop;
    QObject::connect(r, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    QTimer::singleShot(20000, &loop, &QEventLoop::quit);
    loop.exec();
    Http out;
    out.status = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    out.body = r->readAll();
    out.disposition = r->rawHeader("Content-Disposition");
    r->deleteLater();
    return out;
}

// Runs the event loop until cond() holds (or 20 s, a failure).
static bool waitUntil(const std::function<bool()> &cond)
{
    QElapsedTimer t;
    t.start();
    while (!cond() && t.elapsed() < 20000) {
        QEventLoop loop;
        QTimer::singleShot(10, &loop, &QEventLoop::quit);
        loop.exec();
    }
    return cond();
}

static QVariantMap fileOf(const QVariantMap &status, int i)
{
    return status.value(QStringLiteral("files")).toList().value(i).toMap();
}

static void dropShare()
{
    QNetworkProxy::setApplicationProxy(QNetworkProxy(QNetworkProxy::NoProxy));
    QNetworkAccessManager net;
    SimDropShare ds([](const QString &name) { return QByteArray("<html>") + name.toUtf8() + "</html>"; });
    ds.advertise = QHostAddress(QHostAddress::LocalHost);

    // Receive.
    const QVariantMap r = ds.start({ { QStringLiteral("mode"), QStringLiteral("receive") } });
    const QString url = r.value(QStringLiteral("url")).toString();
    const QString token = r.value(QStringLiteral("token")).toString();
    check(r.value(QStringLiteral("returnValue")).toBool() && url.startsWith(QLatin1String("http://127.0.0.1:")) && url.endsWith(token + QLatin1Char('/')),
          "receive: a session has an address with its token");
    check(token.size() >= 22, "... a token of 128 random bits");
    check(ds.status().value(QStringLiteral("state")) == QLatin1String("waiting"), "... and waits");
    const Http page = http(net, "GET", url);
    check(page.status == 200 && page.body == "<html>receive.html</html>", "receive: the address gives the upload page");
    const QString base = url.left(url.size() - token.size() - 1);
    check(http(net, "GET", base).status == 404 && http(net, "GET", base + QStringLiteral("nottoken/")).status == 404,
          "receive: without the token, nothing");
    const Http up = http(net, "POST", url + QStringLiteral("upload?name=") + QUrl::toPercentEncoding(QStringLiteral("../Holiday photo.jpg"))
                                      + QStringLiteral("&type=image/jpeg"), QByteArray("JPEGDATA"));
    check(up.status == 200, "receive: a file uploads");
    QVariantMap st = ds.status();
    check(fileOf(st, 0).value(QStringLiteral("name")) == QLatin1String("Holiday photo.jpg") && fileOf(st, 0).value(QStringLiteral("done")).toBool()
              && fileOf(st, 0).value(QStringLiteral("type")) == QLatin1String("image/jpeg"),
          "receive: it waits with its name (no folders) and type");
    http(net, "POST", url + QStringLiteral("upload?name=Holiday%20photo.jpg"), QByteArray("SECOND"));
    check(fileOf(ds.status(), 1).value(QStringLiteral("name")) == QLatin1String("Holiday photo (2).jpg"), "receive: a second of the same name is numbered");
    const int id = fileOf(st, 0).value(QStringLiteral("id")).toInt();
    check(ds.fileData(id) == "JPEGDATA", "receive: its bytes are there for the device");
    ds.maxFileBytes = 4;
    check(http(net, "POST", url + QStringLiteral("upload?name=big.bin"), QByteArray("12345")).status == 413, "receive: a file over the limit is refused");
    ds.maxFileBytes = 512LL * 1024 * 1024;
    check(ds.status().value(QStringLiteral("files")).toList().size() == 2, "... and not kept");
    check(http(net, "POST", url + QStringLiteral("done")).status == 200, "receive: the uploader says it is done");
    check(waitUntil([&]() { return ds.status().value(QStringLiteral("state")) == QLatin1String("done"); }), "receive: the session is done");
    check(http(net, "GET", url).status == 0, "receive: and its port is closed");
    check(ds.takeFile(id) && ds.fileData(id).isEmpty(), "receive: a file taken is gone");

    // Send.
    const int a = ds.offerFile(QStringLiteral("notes.txt"), QStringLiteral("text/plain"), QByteArray("hello webOS"));
    const int b = ds.offerFile(QStringLiteral("Señal.pdf"), QStringLiteral("application/pdf"), QByteArray(200000, 'x'));
    const QVariantMap s = ds.start({ { QStringLiteral("mode"), QStringLiteral("send") } });
    const QString surl = s.value(QStringLiteral("url")).toString();
    check(s.value(QStringLiteral("returnValue")).toBool() && s.value(QStringLiteral("token")) != token, "send: a new session, a new token");
    check(http(net, "GET", surl).body == "<html>send.html</html>", "send: the address gives the download page");
    const QJsonArray list = QJsonDocument::fromJson(http(net, "GET", surl + QStringLiteral("files")).body).object().value(QStringLiteral("files")).toArray();
    check(list.size() == 2 && list.at(1).toObject().value(QStringLiteral("name")).toString() == QStringLiteral("Señal.pdf"), "send: it lists the files offered");
    const Http fa = http(net, "GET", surl + QStringLiteral("file/") + QString::number(a));
    check(fa.status == 200 && fa.body == "hello webOS" && fa.disposition.startsWith("attachment; filename=\"notes.txt\""), "send: a file downloads with its name");
    check(ds.status().value(QStringLiteral("state")) == QLatin1String("transferring"), "send: one of two: still on");
    const Http fb = http(net, "GET", surl + QStringLiteral("file/") + QString::number(b));
    check(fb.status == 200 && fb.body.size() == 200000 && fb.disposition.contains("filename*=UTF-8''Se%C3%B1al.pdf"), "send: a large file whole, its name in UTF-8");
    check(waitUntil([&]() { return ds.status().value(QStringLiteral("state")) == QLatin1String("done"); }), "send: every file went: done");
    check(http(net, "GET", surl + QStringLiteral("files")).status == 0, "send: and the port is closed");
    check(!ds.start({ { QStringLiteral("mode"), QStringLiteral("send") } }).value(QStringLiteral("returnValue")).toBool(),
          "send: the files went with their session");

    // The runtime hands a file over in parts; they must add up.
    const int p = ds.offerBegin(QStringLiteral("parts.bin"), QString(), 6);
    check(p > 0 && ds.offerPart(p, "abc") && ds.offerPart(p, "def") && ds.offerEnd(p), "send: a file in parts");
    const int q = ds.offerBegin(QStringLiteral("short.bin"), QString(), 6);
    check(ds.offerPart(q, "abc") && !ds.offerEnd(q), "send: parts short of its size are refused");
    check(!ds.offerPart(p, "x"), "send: nor more than its size");
    ds.maxFileBytes = 4;
    check(ds.offerBegin(QStringLiteral("big.bin"), QString(), 5) < 0, "send: a file over the limit is refused");
    ds.maxFileBytes = 512LL * 1024 * 1024;
    const QVariantMap ps = ds.start({ { QStringLiteral("mode"), QStringLiteral("send") } });
    check(http(net, "GET", ps.value(QStringLiteral("url")).toString() + QStringLiteral("file/") + QString::number(p)).body == "abcdef",
          "send: and downloads whole");
    ds.stop();

    // Ten minutes without a request (here a moment) end a session.
    ds.idleTimeoutMs = 300;
    ds.start({ { QStringLiteral("mode"), QStringLiteral("receive") } });
    check(waitUntil([&]() { return ds.status().value(QStringLiteral("state")) == QLatin1String("timeout"); }), "a session left alone times out");
    ds.start({ { QStringLiteral("mode"), QStringLiteral("receive") } });
    ds.stop();
    check(ds.status().value(QStringLiteral("state")) == QLatin1String("stopped") && ds.status().value(QStringLiteral("url")).toString().isEmpty(),
          "a session stopped has no address");
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    contentFilter();
    userAgents();
    dropShare();
    std::printf("%s\n", failures ? "FAILED" : "PASSED");
    return failures ? 1 : 0;
}
