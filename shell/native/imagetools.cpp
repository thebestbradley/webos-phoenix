// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "imagetools.h"

#include <QBuffer>
#include <QByteArray>

QString ImageTools::pngBase64(const QImage &image) const
{
    if (image.isNull())
        return QString();
    QByteArray bytes;
    QBuffer buffer(&bytes);
    buffer.open(QIODevice::WriteOnly);
    if (!image.save(&buffer, "PNG"))
        return QString();
    return QString::fromLatin1(bytes.toBase64());
}
