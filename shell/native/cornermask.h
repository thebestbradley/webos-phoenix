// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A card's corners, as the Palm devices drew them: luna-sysmgr's
// CardRoundedCornerShaderStage (USE_ROUNDEDCORNER_SHADER on every device
// build), evaluated for every device pixel so the edge is as crisp as the
// device's own shader at any scale factor. White inside, transparent
// outside: the mask OpacityMask applies to a card (Card.qml).
//
// The shader worked in the coordinates of the app's whole buffer (the
// "source", full screen), while the card (the "destination") is the buffer
// less the status bar's padding (CardWindow::initializeRoundedCornerStage,
// CardWindow.cpp:2491-2531, radius 40):
//     Center = dst / 2 / src
//     Start  = min(factor, Center)    0.491 across; 0.473 down when the
//                                     card is wider than tall, else 0.478
//     Coord  = max((abs(tc - Center) - Start) / (Center - Start), 0)
//     Alpha  = smoothstep(1, 1 - Delta, length(Coord))
//     Delta  = 0.01 at full size, 0.3 scaled (CardRoundedCornerShaderStage.h:23-127)
// So a corner is (Center - Start) * src pixels across each way: about 9 by
// 7 on a TouchPad card in landscape.

#pragma once

#include <QQuickPaintedItem>
#include <QtQml/qqmlregistration.h>

class CornerMask : public QQuickPaintedItem
{
    Q_OBJECT
    QML_ELEMENT
    // The app's buffer; 0 means the card's own size.
    Q_PROPERTY(qreal sourceWidth READ sourceWidth WRITE setSourceWidth NOTIFY changed)
    Q_PROPERTY(qreal sourceHeight READ sourceHeight WRITE setSourceHeight NOTIFY changed)
    // The card at full size: the edge sharpens (Delta 0.01 instead of 0.3).
    Q_PROPERTY(bool fullSize READ fullSize WRITE setFullSize NOTIFY changed)
    // The corner's size in item pixels, across and down (for tests).
    Q_PROPERTY(qreal cornerWidth READ cornerWidth NOTIFY changed)
    Q_PROPERTY(qreal cornerHeight READ cornerHeight NOTIFY changed)

public:
    explicit CornerMask(QQuickItem *parent = nullptr);

    qreal sourceWidth() const { return m_sourceWidth; }
    void setSourceWidth(qreal w);
    qreal sourceHeight() const { return m_sourceHeight; }
    void setSourceHeight(qreal h);
    bool fullSize() const { return m_fullSize; }
    void setFullSize(bool f);
    qreal cornerWidth() const;
    qreal cornerHeight() const;

    // The mask's alpha (0..1) at a point in item coordinates.
    Q_INVOKABLE qreal alphaAt(qreal x, qreal y) const;

    void paint(QPainter *painter) override;

signals:
    void changed();

protected:
    void geometryChange(const QRectF &newGeometry, const QRectF &oldGeometry) override;

private:
    qreal m_sourceWidth = 0;
    qreal m_sourceHeight = 0;
    bool m_fullSize = false;
};
