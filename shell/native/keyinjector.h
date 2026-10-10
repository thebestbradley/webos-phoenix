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

    // The virtual keyboard's keystrokes, as LunaSysMgr's IME sent them
    // (SysmgrIMEModel::sendKeyEvent, SysmgrIMEDataInterface.cpp:167-190):
    // a press and a release of `key` with `modifiers` and the character it
    // types, to whatever has the keyboard focus in the window of `client`
    // (the focused text field, or the web view whose page has an editable
    // element focused). `client` gets the active focus first if it has not.
    // Returns whether the press was accepted.
    Q_INVOKABLE bool sendImeKey(QQuickItem *client, int key, int modifiers);

    // Text the keyboard enters in one go (".com", "http://":
    // IMEController::commitText), as an input method commit.
    Q_INVOKABLE bool commitText(QQuickItem *client, const QString &text);

    // Text being composed at the cursor (KeyboardHost.setPreedit), as an
    // input method's preedit: shown in the field, not yet in it; "" ends it.
    Q_INVOKABLE bool setPreedit(QQuickItem *client, const QString &text);

    // A wheel event at (x, y) in `item`, delivered through its window as
    // the platform delivers one: a trackpad's has a pixel delta, a scroll
    // phase (Qt::ScrollPhase) and, with natural scrolling, `inverted`; a
    // mouse wheel's only an angle delta. QML's TestCase.mouseWheel sends
    // only the latter, so the tests of trackpad gestures use this.
    // Returns whether it was accepted.
    Q_INVOKABLE bool sendWheel(QQuickItem *item, qreal x, qreal y, const QPoint &pixelDelta,
                               const QPoint &angleDelta, int phase, bool inverted);
};
