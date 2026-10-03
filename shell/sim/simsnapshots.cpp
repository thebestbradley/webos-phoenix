// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "simsnapshots.h"
#include "rootfs.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QPainter>
#include <QPainterPath>
#include <QTimer>

// Pictures only go where the browser keeps them.
static const char kPicturesPrefix[] = "/var/luna/data/browser/";

bool SimSnapshots::writable(const QString &devicePath) const
{
    const QString path = QDir::cleanPath(devicePath);
    return path.startsWith(QLatin1String(kPicturesPrefix)) && path.endsWith(QLatin1String(".png"))
        && !m_rootfs->dataPath(path).isEmpty();
}

void SimSnapshots::whenReady(const QString &devicePath, const std::function<void(bool)> &done)
{
    if (!m_waiting.contains(devicePath)) {
        done(QFileInfo(m_rootfs->dataPath(devicePath)).isFile());
        return;
    }
    m_waiting[devicePath].append(done);
}

void SimSnapshots::finish(const QString &devicePath, bool ok)
{
    const auto waiting = m_waiting.take(devicePath);
    for (const auto &done : waiting)
        done(ok);
}

// Run when src is there (now, or once it is made).
void SimSnapshots::afterSource(const QString &src, const std::function<void()> &run)
{
    if (m_waiting.contains(src))
        m_waiting[src].append([run](bool) { run(); });
    else
        run();
}

static QRect rectOf(const QJsonObject &req)
{
    const QJsonArray r = req.value(QStringLiteral("rect")).toArray();
    return r.size() == 4 ? QRect(r[0].toInt(), r[1].toInt(), r[2].toInt(), r[3].toInt()) : QRect();
}

QJsonObject SimSnapshots::request(const QJsonObject &req)
{
    auto fail = [](const QString &text) {
        return QJsonObject { { QStringLiteral("returnValue"), false }, { QStringLiteral("errorText"), text } };
    };
    const QJsonObject done { { QStringLiteral("returnValue"), true } };
    const QString op = req.value(QStringLiteral("op")).toString();
    const QString path = QDir::cleanPath(req.value(QStringLiteral("path")).toString());
    if (!writable(path))
        return fail(QStringLiteral("Not a path for pictures: ") + path);
    const QString file = m_rootfs->dataPath(path);

    if (op == QLatin1String("delete")) {
        QFile::remove(file);
        return done;
    }
    QDir().mkpath(QFileInfo(file).path());

    if (op == QLatin1String("save")) {
        const QRect r = rectOf(req);
        if (r.width() <= 0 || r.height() <= 0)
            return fail(QStringLiteral("rect: [left, top, width, height]"));
        const int id = m_nextGrab++;
        m_grabs.insert(id, { path, r.size() });
        m_waiting.insert(path, {});
        // Not taken within a few seconds (no such view): it fails.
        QTimer::singleShot(5000, this, [this, id]() {
            if (m_grabs.contains(id))
                finishGrab(id, QImage());
        });
        emit grabRequested(id, req.value(QStringLiteral("view")).toString());
        return done;
    }

    const QString src = QDir::cleanPath(req.value(QStringLiteral("src")).toString());
    if (op != QLatin1String("icon") && op != QLatin1String("resize"))
        return fail(QStringLiteral("op: save, icon, resize or delete"));
    if (!writable(src))
        return fail(QStringLiteral("Not a path for pictures: ") + src);
    const QRect r = rectOf(req);
    const QSize size(req.value(QStringLiteral("width")).toInt(), req.value(QStringLiteral("height")).toInt());
    if (op == QLatin1String("resize") && (size.width() <= 0 || size.height() <= 0))
        return fail(QStringLiteral("width and height are required"));
    m_waiting.insert(path, {});
    afterSource(src, [this, op, src, path, file, r, size]() {
        const QImage in(m_rootfs->dataPath(src));
        bool ok = false;
        if (!in.isNull()) {
            const QImage out = op == QLatin1String("icon")
                ? launcherIcon(in, r.isValid() ? r : in.rect())
                : in.scaled(size, Qt::IgnoreAspectRatio, Qt::SmoothTransformation);
            ok = out.save(file, "PNG");
        }
        finish(path, ok);
    });
    return done;
}

void SimSnapshots::finishGrab(int id, const QImage &image)
{
    if (!m_grabs.contains(id))
        return;
    const Grab g = m_grabs.take(id);
    bool ok = false;
    if (!image.isNull()) {
        // The top of the view, at the picture's shape, scaled down.
        const int h = qMin(image.height(), qRound(image.width() * qreal(g.size.height()) / g.size.width()));
        const QImage part = image.copy(0, 0, image.width(), qMax(1, h));
        ok = part.scaled(g.size, Qt::IgnoreAspectRatio, Qt::SmoothTransformation)
                 .convertToFormat(QImage::Format_ARGB32).save(m_rootfs->dataPath(g.path), "PNG");
    }
    finish(g.path, ok);
}

QImage SimSnapshots::launcherIcon(const QImage &picture, const QRect &part)
{
    const QRect area = part.intersected(picture.rect());
    const int side = qMin(area.width(), area.height());
    const QImage square = picture.copy(area.x(), area.y(), side, side)
                              .scaled(56, 56, Qt::IgnoreAspectRatio, Qt::SmoothTransformation);
    QImage icon(64, 64, QImage::Format_ARGB32_Premultiplied);
    icon.fill(Qt::transparent);
    QPainter p(&icon);
    p.setRenderHint(QPainter::Antialiasing);
    QPainterPath frame;
    frame.addRoundedRect(QRectF(4, 4, 56, 56), 8, 8);
    p.setClipPath(frame);
    p.drawImage(4, 4, square);
    p.setClipping(false);
    p.setPen(QPen(QColor(0, 0, 0, 110), 1));
    p.setBrush(Qt::NoBrush);
    p.drawRoundedRect(QRectF(4.5, 4.5, 55, 55), 8, 8);
    p.end();
    return icon;
}
