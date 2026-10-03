// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Pictures of web pages for the browser (BrowserAdapter's saveViewToFile,
// generateIconFromFile, resizeImage and deleteImage, which BrowserServer
// answered on webOS): the page's thumbnail for a bookmark and the icon
// for a launcher shortcut (Share > Add to Launcher). The runtime asks with
// /__phoenix/snapshot?req={op, ...} (RootfsSchemeHandler); a picture of a
// view is taken by the shell (grabRequested -> finishGrab, the page's
// Chromium view in WebAppWindow.qml), the rest is done here. The calls
// return at once, as the plugin's did; a file still being made is
// answered when it is ready (whenReady), so a page that shows it at once
// gets it. Files go under /var/luna/ in the simulator's data folder
// (Rootfs::dataPath).

#pragma once

#include <QHash>
#include <QImage>
#include <QJsonObject>
#include <QList>
#include <QObject>
#include <QRect>
#include <QString>
#include <functional>

#include "rootfs.h"

class SimSnapshots : public QObject, public PictureMaker
{
    Q_OBJECT
public:
    explicit SimSnapshots(const Rootfs *rootfs, QObject *parent = nullptr)
        : QObject(parent), m_rootfs(rootfs) {}

    // One request: {op: "save", view, path, rect: [left, top, width,
    // height]} (a picture of the view, scaled to width x height from its
    // top), {op: "icon", src, path, rect} (a 64 x 64 launcher icon from that
    // part of src), {op: "resize", src, path, width, height}, {op:
    // "delete", path}. -> {returnValue, errorText}.
    QJsonObject request(const QJsonObject &req) override;

    // A file being made: done(ok) is called when it is (or failed).
    bool isPending(const QString &devicePath) const override { return m_waiting.contains(devicePath); }
    void whenReady(const QString &devicePath, const std::function<void(bool)> &done) override;

    // The shell's picture of the view for grab request id (null: none).
    Q_INVOKABLE void finishGrab(int id, const QImage &image);

    // The icon for a launcher shortcut from part of a page's picture:
    // the part's top square, with rounded corners and a thin edge, in
    // 64 x 64 (BrowserServer's own art was not released).
    static QImage launcherIcon(const QImage &picture, const QRect &part);

signals:
    // Take a picture of the web view viewId (WebAppWindow's enyo.WebView
    // views) and give it to finishGrab(id, image).
    void grabRequested(int id, const QString &viewId);

private:
    struct Grab { QString path; QSize size; };
    bool writable(const QString &devicePath) const;
    void finish(const QString &devicePath, bool ok);
    void afterSource(const QString &src, const std::function<void()> &run);

    const Rootfs *m_rootfs;
    int m_nextGrab = 1;
    QHash<int, Grab> m_grabs;
    QHash<QString, QList<std::function<void(bool)>>> m_waiting;
};
