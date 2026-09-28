// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "keyinjector.h"

#include <QCoreApplication>
#include <QKeyEvent>

bool KeyInjector::sendKey(QQuickItem *item, int key, quint32 nativeScanCode)
{
    if (!item || !item->window())
        return false;
    item->forceActiveFocus(Qt::OtherFocusReason);

    QKeyEvent press(QEvent::KeyPress, key, Qt::NoModifier, nativeScanCode, 0, 0);
    QCoreApplication::sendEvent(item, &press);
    const bool accepted = press.isAccepted();
    QKeyEvent release(QEvent::KeyRelease, key, Qt::NoModifier, nativeScanCode, 0, 0);
    QCoreApplication::sendEvent(item, &release);
    return accepted;
}
