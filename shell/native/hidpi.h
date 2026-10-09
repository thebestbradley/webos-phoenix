// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Picks the art to draw at the shell's density. The shell scales by
// Theme.u (device pixels per legacy pixel), not by the window's
// devicePixelRatio, so Qt's own "@2x" lookup never runs; this does the same
// job for Theme.u:
//
//   - Shell art: next to name.png may be name@1.5x.png, name@2x.png,
//     name@3x.png or name@4x.png, the same picture with k times the pixels.
//     variant(url, scale) gives the smallest of them with k >= scale (the
//     largest if none is big enough), and the file itself when scale <= 1 or
//     there are none, so a 1.0 density draws exactly the 1x art.
//     variantScale(url) is the k of a file variant() returned (1 for 1x):
//     callers divide sourceSize by it; borderScale(url) is what BorderImage
//     borders given in 1x pixels need.
//
//   - App icons: appinfo.json's "icon" is 64 px; apps ship bigger ones
//     beside it, "splashicon" (icon-256x256.png in every Open webOS core app)
//     and Phoenix's own icon-256x256.png. icon(url, pixels, large) keeps
//     the icon when it has at least `pixels`, else takes the smallest
//     candidate that does (the largest if none): `large`, and the icon's
//     siblings named icon-<N>x<N>.png, icon-<N>.png or icon@<k>x.png.
//
// Lookups hit the disk once per file and are cached; URLs that are not local
// files (or qrc) come back unchanged.

#pragma once

#include <QHash>
#include <QObject>
#include <QSize>
#include <QUrl>
#include <QtQml/qqmlregistration.h>

class HiDpi : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

public:
    using QObject::QObject;

    // The variant factors looked for, smallest first.
    static const QList<qreal> &factors();

    Q_INVOKABLE QUrl variant(const QUrl &url, qreal scale) const;
    Q_INVOKABLE qreal variantScale(const QUrl &url) const;
    // What to multiply a BorderImage's borders (in 1x art pixels) by for
    // `url`. Qt already treats a file named name@<digit>x.ext as having that
    // device pixel ratio (QQuickImageBase's resolve2xLocalFile): its
    // BorderImage borders are taken in 1x pixels and its implicit size is
    // the 1x size. So this is 1 for @2x / @3x / @4x, and 1.5 for @1.5x,
    // which Qt reads as 1.
    Q_INVOKABLE qreal borderScale(const QUrl &url) const;
    Q_INVOKABLE QUrl icon(const QUrl &url, qreal pixels, const QUrl &large = QUrl()) const;
    // An image file's size in pixels, read from its header; (-1, -1) if it
    // cannot be read.
    Q_INVOKABLE QSize imageSize(const QUrl &url) const;
    // Whether an icon's picture fills its whole square, corners opaque (a
    // site's icon, made for a mask), rather than a webOS icon's shape with
    // a margin around it. AppIcon puts such a picture on a rounded plate.
    Q_INVOKABLE bool fullBleed(const QUrl &url) const;
    // Files in `twin` count as icon()'s siblings of the files in `dir` (and
    // in its subdirectories, matched by path). On a device the compat
    // overlay's files are installed beside the original app's, so an icon's
    // HiDPI variants there sit beside it; the simulator serves the same
    // device directory from two places (runtime/rootfs.json: a submodule
    // and compat/rootfs) and says so here.
    Q_INVOKABLE void addTwinDirectory(const QString &dir, const QString &twin);

private:
    QStringList siblingDirs(const QString &dir) const;

    QList<QPair<QString, QString>> m_twins;
    mutable QHash<QString, QUrl> m_variants;
    mutable QHash<QString, QSize> m_sizes;
    mutable QHash<QString, bool> m_fullBleed;
    mutable QHash<QString, QStringList> m_siblings;
};
