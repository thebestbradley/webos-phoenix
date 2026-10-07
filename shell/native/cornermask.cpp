// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "cornermask.h"

#include <QImage>
#include <QPainter>
#include <QQuickWindow>
#include <QtMath>

namespace {

qreal smoothstep(qreal e0, qreal e1, qreal x)
{
    const qreal t = qBound<qreal>(0, (x - e0) / (e1 - e0), 1);
    return t * t * (3 - 2 * t);
}

} // namespace

CornerMask::CornerMask(QQuickItem *parent)
    : QQuickPaintedItem(parent)
{
    setAntialiasing(false);
    setOpaquePainting(false);
}

void CornerMask::setSourceWidth(qreal w)
{
    if (qFuzzyCompare(w, m_sourceWidth))
        return;
    m_sourceWidth = w;
    emit changed();
    update();
}

void CornerMask::setSourceHeight(qreal h)
{
    if (qFuzzyCompare(h, m_sourceHeight))
        return;
    m_sourceHeight = h;
    emit changed();
    update();
}

void CornerMask::setFullSize(bool f)
{
    if (f == m_fullSize)
        return;
    m_fullSize = f;
    emit changed();
    update();
}

void CornerMask::geometryChange(const QRectF &newGeometry, const QRectF &oldGeometry)
{
    QQuickPaintedItem::geometryChange(newGeometry, oldGeometry);
    if (newGeometry.size() != oldGeometry.size())
        emit changed();
}

// (Center - Start) * src along one axis: the corner's size in pixels.
static qreal cornerSize(qreal dst, qreal src, qreal factor)
{
    if (dst <= 0)
        return 0;
    if (src < dst)
        src = dst;
    const qreal center = dst * 0.5 / src;
    const qreal start = qMin(factor, center);
    return (center - start) * src;
}

qreal CornerMask::cornerWidth() const
{
    return cornerSize(width(), m_sourceWidth > 0 ? m_sourceWidth : width(), 0.491);
}

qreal CornerMask::cornerHeight() const
{
    const qreal factor = width() > height() ? 0.473 : 0.478;
    return cornerSize(height(), m_sourceHeight > 0 ? m_sourceHeight : height(), factor);
}

qreal CornerMask::alphaAt(qreal x, qreal y) const
{
    const qreal w = width(), h = height();
    if (x < 0 || y < 0 || x > w || y > h)
        return 0;
    const qreal rx = cornerWidth(), ry = cornerHeight();
    // The shader divides by these; where one is 0 (Start clamped to
    // Center) that axis has no rounding at all.
    const qreal cx = rx > 0 ? qMax<qreal>(0, (qAbs(x - w / 2) - (w / 2 - rx)) / rx) : 0;
    const qreal cy = ry > 0 ? qMax<qreal>(0, (qAbs(y - h / 2) - (h / 2 - ry)) / ry) : 0;
    const qreal delta = m_fullSize ? 0.01 : 0.3;
    return smoothstep(1, 1 - delta, qSqrt(cx * cx + cy * cy));
}

void CornerMask::paint(QPainter *painter)
{
    const qreal w = width(), h = height();
    if (w <= 0 || h <= 0)
        return;
    painter->fillRect(QRectF(0, 0, w, h), Qt::white);
    const qreal rx = cornerWidth(), ry = cornerHeight();
    if (rx <= 0 && ry <= 0)
        return;

    // Each corner at device pixels: the painter draws in item units, the
    // texture is item size times the window's pixel ratio.
    const qreal dpr = window() ? window()->effectiveDevicePixelRatio() : 1.0;
    const int pw = qMax(1, qCeil(qMax<qreal>(rx, 1) * dpr));
    const int ph = qMax(1, qCeil(qMax<qreal>(ry, 1) * dpr));
    const QSizeF box(pw / dpr, ph / dpr);
    const QPointF origins[4] = { { 0, 0 }, { w - box.width(), 0 }, { 0, h - box.height() },
                                 { w - box.width(), h - box.height() } };
    painter->setCompositionMode(QPainter::CompositionMode_Source);
    for (const QPointF &o : origins) {
        QImage img(pw, ph, QImage::Format_ARGB32_Premultiplied);
        for (int py = 0; py < ph; ++py) {
            auto *line = reinterpret_cast<QRgb *>(img.scanLine(py));
            for (int px = 0; px < pw; ++px) {
                // The centre of this device pixel, in item coordinates.
                const qreal a = alphaAt(o.x() + (px + 0.5) / dpr, o.y() + (py + 0.5) / dpr);
                const int v = qRound(a * 255);
                line[px] = qRgba(v, v, v, v);
            }
        }
        painter->drawImage(QRectF(o, box), img);
    }
}
