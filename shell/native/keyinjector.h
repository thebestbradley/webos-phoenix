// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sends a key press and release to an item, as if typed while it had focus.
// The device shell uses it to deliver the webOS Back key to the focused app's
// surface: WebOSSurfaceItem forwards key events to its Wayland client by the
// event's native scan code (luna-surfacemanager, webossurfaceitem.cpp
// processKeyEvent), and QML cannot create key events itself.
//
// The Qt key is passed in rather than named here, so this builds against
// stock Qt: webOS's Qt::Key_webOS_Back exists only in its patched qtbase and
// reaches QML as WebOS.Key_webOS_Back (WebOS.Global).

#pragma once

#include <QObject>
#include <QQuickItem>
#include <QtQml/qqmlregistration.h>

class KeyInjector : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

public:
    using QObject::QObject;

    // Gives `item` active focus and sends it a key press then release.
    // `nativeScanCode` is the XKB keycode (evdev code + 8). Returns whether
    // the item accepted the press.
    Q_INVOKABLE bool sendKey(QQuickItem *item, int key, quint32 nativeScanCode);
};
