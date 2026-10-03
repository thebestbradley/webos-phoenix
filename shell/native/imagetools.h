// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Images for the shell's screen captures (docs/SCREENSHOTS.md): an
// ItemGrabResult's image as PNG bytes in base64, for the web runtime to
// save (QML has no way to read an image's bytes).
//
//   item.grabToImage(r => source.saveScreenshot(ImageTools.pngBase64(r.image), title))

#pragma once

#include <QImage>
#include <QObject>
#include <QString>
#include <QtQml/qqmlregistration.h>

class ImageTools : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

public:
    using QObject::QObject;

    // The image as a PNG, base64; "" for a null image.
    Q_INVOKABLE QString pngBase64(const QImage &image) const;
};
