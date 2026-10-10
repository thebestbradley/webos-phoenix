// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "keyinjector.h"
#include "keytext.h"

#include <QCoreApplication>
#include <QInputMethodEvent>
#include <QKeyEvent>
#include <QQuickWindow>
#include <QWheelEvent>

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

static QQuickItem *focusTarget(QQuickItem *client)
{
    if (!client || !client->window())
        return nullptr;
    if (!client->hasActiveFocus())
        client->forceActiveFocus(Qt::OtherFocusReason);
    return client->window()->activeFocusItem();
}

bool KeyInjector::sendImeKey(QQuickItem *client, int key, int modifiers)
{
    QQuickItem *target = focusTarget(client);
    if (!target)
        return false;
    // The character the key types (SysmgrIMEDataInterface.cpp:171-187;
    // keytext.h, shared with the device's Maliit input method).
    const auto mods = Qt::KeyboardModifiers(modifiers);
    const QString text = PhoenixKeyText::keyText(key, mods);

    QKeyEvent press(QEvent::KeyPress, key, mods, text);
    QCoreApplication::sendEvent(target, &press);
    const bool accepted = press.isAccepted();
    QKeyEvent release(QEvent::KeyRelease, key, mods, text);
    QCoreApplication::sendEvent(target, &release);
    return accepted;
}

bool KeyInjector::commitText(QQuickItem *client, const QString &text)
{
    QQuickItem *target = focusTarget(client);
    if (!target)
        return false;
    QInputMethodEvent event;
    event.setCommitString(text);
    QCoreApplication::sendEvent(target, &event);
    return event.isAccepted();
}

bool KeyInjector::setPreedit(QQuickItem *client, const QString &text)
{
    QQuickItem *target = focusTarget(client);
    if (!target)
        return false;
    QList<QInputMethodEvent::Attribute> attributes;
    attributes << QInputMethodEvent::Attribute(QInputMethodEvent::Cursor, int(text.size()), 1);
    QInputMethodEvent event(text, attributes);
    QCoreApplication::sendEvent(target, &event);
    return event.isAccepted();
}

bool KeyInjector::sendWheel(QQuickItem *item, qreal x, qreal y, const QPoint &pixelDelta,
                            const QPoint &angleDelta, int phase, bool inverted)
{
    if (!item || !item->window())
        return false;
    QQuickWindow *window = item->window();
    const QPointF pos = item->mapToScene(QPointF(x, y));
    QWheelEvent event(pos, window->mapToGlobal(pos), pixelDelta, angleDelta, Qt::NoButton, Qt::NoModifier,
                      Qt::ScrollPhase(phase), inverted);
    QCoreApplication::sendEvent(window, &event);
    return event.isAccepted();
}
